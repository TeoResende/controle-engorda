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
  brinco: string;
  nome: string | null;
  raca: string | null;
  lote_id: string | null;
  status: string;
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
): Promise<AnimalLocal | undefined> {
  return db.animais.where("brinco").equals(brinco).first();
}
