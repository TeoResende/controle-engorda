import { apiAuth, ErroApi, SemConexao } from "./api";
import { db, gravarMeta, type AnimalLocal, type PesagemPendente } from "./db";
import { lerSessao } from "./sessao";

/**
 * Motor de sincronização.
 *
 * A ordem importa: envia → servidor confirma → **só então** apaga a cópia local.
 * Se a conexão cair no meio, o registro continua na fila e sobe na próxima
 * tentativa. Como o id é gerado no celular, reenviar não duplica nada.
 */

type ResultadoEnvio = {
  id: string;
  situacao: "criada" | "duplicada" | "erro";
  detalhe: string | null;
};

type RespostaLote = {
  criadas: number;
  duplicadas: number;
  erros: number;
  resultados: ResultadoEnvio[];
};

export type ResumoSync = {
  enviadas: number;
  comErro: number;
  restantes: number;
  motivo?: string;
};

const LOTE_MAXIMO = 200;

/** Sobe o áudio de uma pesagem já aceita. Devolve se conseguiu. */
async function enviarAudio(pesagemId: string, audio: Blob): Promise<boolean> {
  try {
    const formulario = new FormData();
    formulario.append("arquivo", audio, "observacao.webm");
    await apiAuth(`/pesagens/${pesagemId}/audio`, {
      method: "POST",
      body: formulario,
      // Sem Content-Type manual: o navegador põe o boundary do multipart.
      headers: {},
    });
    return true;
  } catch {
    return false;
  }
}

let sincronizando = false;

export async function pendentes(): Promise<number> {
  return db.fila.count();
}

export async function enfileirar(pesagem: PesagemPendente): Promise<void> {
  await db.fila.put(pesagem);
}

/**
 * Sobe a fila. Seguro chamar a qualquer momento — sai na hora se já houver uma
 * sincronização em andamento ou se não houver o que enviar.
 */
export async function sincronizar(): Promise<ResumoSync> {
  const restantesAgora = await db.fila.count();

  if (sincronizando) return { enviadas: 0, comErro: 0, restantes: restantesAgora, motivo: "em andamento" };
  if (!lerSessao()) return { enviadas: 0, comErro: 0, restantes: restantesAgora, motivo: "sem sessão" };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { enviadas: 0, comErro: 0, restantes: restantesAgora, motivo: "offline" };
  }
  if (restantesAgora === 0) return { enviadas: 0, comErro: 0, restantes: 0 };

  sincronizando = true;
  let enviadas = 0;
  let comErro = 0;

  try {
    // Em blocos: um dia inteiro de curral sem sinal pode acumular centenas.
    for (;;) {
      const bloco = await db.fila.orderBy("coletado_em").limit(LOTE_MAXIMO).toArray();
      if (bloco.length === 0) break;

      const resposta = await apiAuth<RespostaLote>("/pesagens/lote", {
        method: "POST",
        body: JSON.stringify(
          bloco.map((p) => ({
            id: p.id,
            animal_id: p.animal_id,
            brinco: p.brinco,
            data: p.data,
            peso_kg: p.peso_kg,
            observacao_texto: p.observacao_texto,
            latitude: p.latitude,
            longitude: p.longitude,
            coletado_em: p.coletado_em,
          })),
        ),
      });

      // A pesagem confirma primeiro; o áudio vai depois, um a um. Se o áudio
      // falhar, o registro fica na fila — mas a pesagem já está no servidor, e
      // reenviá-la não duplica (o id é o mesmo).
      const confirmados: string[] = [];
      for (const r of resposta.resultados) {
        if (r.situacao === "erro") {
          // Fica na fila com o motivo à vista: erro de dado não se resolve
          // sozinho e o técnico precisa saber para corrigir.
          comErro += 1;
          const item = bloco.find((p) => p.id === r.id);
          if (item) {
            await db.fila.update(r.id, {
              tentativas: item.tentativas + 1,
              ultimo_erro: r.detalhe,
            });
          }
        } else {
          const item = bloco.find((p) => p.id === r.id);
          if (item?.audio && !item.audio_enviado) {
            const subiu = await enviarAudio(r.id, item.audio);
            if (!subiu) {
              // Peso salvo, áudio pendente: fica na fila só pelo áudio.
              await db.fila.update(r.id, { tentativas: item.tentativas + 1 });
              continue;
            }
          }
          confirmados.push(r.id);
        }
      }

      // Apaga a cópia local só depois da confirmação do servidor.
      if (confirmados.length > 0) await db.fila.bulkDelete(confirmados);
      enviadas += confirmados.length;

      // Nada confirmado neste bloco: insistir entraria em laço infinito.
      if (confirmados.length === 0) break;
    }

    await gravarMeta("ultima_sincronizacao", new Date().toISOString());
  } catch (erro) {
    const motivo =
      erro instanceof SemConexao
        ? "sem conexão"
        : erro instanceof ErroApi
          ? erro.message
          : "falha inesperada";
    return { enviadas, comErro, restantes: await db.fila.count(), motivo };
  } finally {
    sincronizando = false;
  }

  return { enviadas, comErro, restantes: await db.fila.count() };
}

/**
 * Atualiza a cópia local do rebanho.
 *
 * Sem isso a tela de coleta não consegue nem dizer de que animal é o brinco
 * quando o celular está sem sinal.
 */
export async function baixarRebanho(): Promise<number> {
  type Pagina = { itens: AnimalLocal[]; total: number };
  const animais: AnimalLocal[] = [];
  let deslocamento = 0;

  for (;;) {
    const pagina = await apiAuth<Pagina>(
      `/animais?limite=200&deslocamento=${deslocamento}`,
    );
    animais.push(...pagina.itens);
    deslocamento += pagina.itens.length;
    if (pagina.itens.length === 0 || animais.length >= pagina.total) break;
  }

  await db.transaction("rw", db.animais, async () => {
    await db.animais.clear();
    await db.animais.bulkPut(
      animais.map((a) => ({
        id: a.id,
        brinco: a.brinco,
        nome: a.nome ?? null,
        raca: a.raca ?? null,
        porte: a.porte ?? null,
        lote_id: a.lote_id ?? null,
        status: a.status,
        ultimo_peso: a.ultimo_peso ?? null,
        ultima_pesagem: a.ultima_pesagem ?? null,
      })),
    );
  });
  await gravarMeta("rebanho_atualizado_em", new Date().toISOString());
  return animais.length;
}

/** Sobe a fila e atualiza o rebanho — o que se faz assim que há sinal. */
export async function sincronizarTudo(): Promise<ResumoSync> {
  const resumo = await sincronizar();
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      await baixarRebanho();
    } catch {
      // Rebanho desatualizado não impede coletar: é só cache de conveniência.
    }
  }
  return resumo;
}
