import Dexie, { type EntityTable } from "dexie";

/**
 * Banco local do celular do técnico.
 *
 * A fila de pesagens é a peça crítica: um registro só sai daqui depois que o
 * servidor confirmou o recebimento. Enquanto não confirmar, ele fica — mesmo
 * que o app feche, o celular reinicie ou o técnico passe o dia sem sinal.
 */

export type PesagemPendente = {
  /** UUID gerado aqui, offline. É ele que torna o reenvio idempotente. */
  id: string;
  /** De qual fazenda é esta pesagem — o envio usa o token dela. */
  fazenda_id: string;
  animal_id: string | null;
  brinco: string;
  data: string; // YYYY-MM-DD
  peso_kg: string;
  observacao_texto: string | null;
  latitude: number | null;
  longitude: number | null;
  coletado_em: string; // ISO, relógio do aparelho
  tentativas: number;
  ultimo_erro: string | null;
  /**
   * Áudio da observação, quando houver. Fica no mesmo registro da fila porque
   * ele só pode subir DEPOIS que a pesagem foi aceita — e some junto quando o
   * servidor confirma os dois.
   */
  audio?: Blob;
  audio_enviado?: boolean;
};

/** Cópia local do rebanho, para a coleta funcionar sem sinal. */
export type AnimalLocal = {
  id: string;
  fazenda_id: string;
  brinco: string;
  nome: string | null;
  raca: string | null;
  porte: string | null;
  lote_id: string | null;
  status: string;
  /** Referência que a tela de coleta mostra — precisa existir sem sinal. */
  ultimo_peso: string | null;
  ultima_pesagem: string | null;
};

export type Meta = { chave: string; valor: unknown };

const db = new Dexie("engorda") as Dexie & {
  fila: EntityTable<PesagemPendente, "id">;
  animais: EntityTable<AnimalLocal, "id">;
  meta: EntityTable<Meta, "chave">;
};

db.version(1).stores({
  fila: "id, brinco, coletado_em",
  animais: "id, brinco",
  meta: "chave",
});

/**
 * Versão 2: tudo passa a ser separado por fazenda.
 *
 * O técnico que atende duas fazendas troca entre elas sem sinal, e sem este
 * recorte veria o rebanho de uma dentro da outra — ou pior, mandaria a pesagem
 * para a fazenda errada.
 */
db.version(2)
  .stores({
    fila: "id, brinco, coletado_em, fazenda_id",
    animais: "id, brinco, fazenda_id, [fazenda_id+brinco]",
    meta: "chave",
  })
  .upgrade(async (transacao) => {
    // O que já estava no aparelho é de quem estava logado — a migração não tem
    // como saber de outra fazenda, e apagar seria perder pesagem coletada.
    const guardado = localStorage.getItem("engorda.sessoes") ?? localStorage.getItem("engorda.sessao");
    let fazenda = "";
    try {
      const dados = guardado ? JSON.parse(guardado) : null;
      fazenda = dados?.ativa ?? dados?.sessoes?.[0]?.fazenda_id ?? dados?.fazenda_id ?? "";
    } catch {
      /* sem sessão legível: os registros ficam sem fazenda e o próximo login os
         reassocia ao baixar o rebanho */
    }
    for (const tabela of ["fila", "animais"]) {
      await transacao
        .table(tabela)
        .toCollection()
        .modify((registro) => {
          registro.fazenda_id = registro.fazenda_id ?? fazenda;
        });
    }
  });

export { db };

export async function lerMeta<T>(chave: string): Promise<T | undefined> {
  return (await db.meta.get(chave))?.valor as T | undefined;
}

export async function gravarMeta(chave: string, valor: unknown): Promise<void> {
  await db.meta.put({ chave, valor });
}

/** Procura o animal na cópia local — é o que faz a tela de coleta abrir offline. */
export async function animalPorBrinco(
  brinco: string,
  fazenda_id: string,
): Promise<AnimalLocal | undefined> {
  // Busca pelo par: o mesmo brinco pode existir em duas fazendas, e devolver o
  // da errada faria a pesagem ir para o animal errado.
  return db.animais.where("[fazenda_id+brinco]").equals([fazenda_id, brinco]).first();
}

/** Rebanho da fazenda ativa. */
export function animaisDaFazenda(fazenda_id: string) {
  return db.animais.where("fazenda_id").equals(fazenda_id);
}

/** Fila da fazenda ativa. */
export function filaDaFazenda(fazenda_id: string) {
  return db.fila.where("fazenda_id").equals(fazenda_id);
}
