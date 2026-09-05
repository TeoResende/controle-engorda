import { animaisDaFazenda, filaDaFazenda, type AnimalLocal, type PesagemPendente } from "./db";
import { fazendaAtiva } from "./sessao";
import { hojeLocal } from "./formato";

/**
 * Quem já foi pesado hoje, do ponto de vista do aparelho.
 *
 * Duas fontes, e as duas importam:
 *
 * - a **fila local**, com o que o técnico acabou de registrar e ainda não subiu
 *   — some-la faria o animal reaparecer como pendente logo depois de pesado,
 *   que é o pior erro possível numa tela de conferência;
 * - a **cópia do rebanho**, cujo `ultima_pesagem` cobre o que já sincronizou,
 *   inclusive pesagens de outro técnico no mesmo dia.
 */
export function pesadosHoje(
  animais: AnimalLocal[],
  fila: PesagemPendente[],
  hoje = hojeLocal(),
): Set<string> {
  const brincos = new Set<string>();

  for (const p of fila) {
    if (p.data === hoje) brincos.add(p.brinco);
  }
  for (const a of animais) {
    if (a.ultima_pesagem?.slice(0, 10) === hoje) brincos.add(a.brinco);
  }
  return brincos;
}

export type ContagemDoDia = { pesados: number; faltam: number; total: number };

export function contarODia(
  animais: AnimalLocal[],
  fila: PesagemPendente[],
  hoje = hojeLocal(),
): ContagemDoDia {
  const pesados = pesadosHoje(animais, fila, hoje);
  // Conta só os animais que estão no aparelho: prometer um total que o técnico
  // não consegue alcançar sem sinal seria pior que não mostrar nada.
  const noAparelho = animais.filter((a) => pesados.has(a.brinco)).length;
  return {
    pesados: noAparelho,
    faltam: animais.length - noAparelho,
    total: animais.length,
  };
}

/**
 * Ordena deixando quem falta em cima.
 *
 * O que o técnico procura é o que ainda não fez; o já pesado só precisa estar
 * visível para conferência, e no fim da lista ele não atrapalha a rolagem.
 */
export function ordenarPendentesPrimeiro(
  animais: AnimalLocal[],
  pesados: Set<string>,
): AnimalLocal[] {
  return [...animais].sort((a, b) => {
    const feitoA = pesados.has(a.brinco) ? 1 : 0;
    const feitoB = pesados.has(b.brinco) ? 1 : 0;
    if (feitoA !== feitoB) return feitoA - feitoB;
    return a.brinco.localeCompare(b.brinco, "pt-BR", { numeric: true });
  });
}

/**
 * Fila e rebanho da **fazenda ativa** — as duas telas precisam dos dois.
 *
 * O recorte por fazenda não é detalhe: o técnico troca de fazenda sem sinal, e
 * misturar os rebanhos faria a conferência do dia contar animal que não é dali.
 */
export async function lerRebanhoEFila(): Promise<{
  animais: AnimalLocal[];
  fila: PesagemPendente[];
}> {
  const fazenda = fazendaAtiva();
  if (!fazenda) return { animais: [], fila: [] };

  const [animais, fila] = await Promise.all([
    animaisDaFazenda(fazenda).toArray(),
    filaDaFazenda(fazenda).toArray(),
  ]);
  return { animais, fila };
}

/** Quantas pesagens da fazenda ativa esperam envio. */
export async function contarFila(): Promise<number> {
  const fazenda = fazendaAtiva();
  return fazenda ? filaDaFazenda(fazenda).count() : 0;
}
