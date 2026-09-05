import { describe, expect, it } from "vitest";

import type { AnimalLocal, PesagemPendente } from "@/lib/db";
import {
  contarODia,
  ordenarPendentesPrimeiro,
  pesadosHoje,
} from "@/lib/pesados-hoje";

/**
 * Conferência do dia na tela de animais.
 *
 * Errar aqui tem consequência no curral: um animal marcado como pesado sem ter
 * sido fica para trás, e um pesado que aparece como pendente é pesado duas
 * vezes. Por isso as duas fontes — a fila local e a cópia do rebanho — precisam
 * ser consideradas juntas.
 */

const HOJE = "2026-09-05";
const ONTEM = "2026-09-04";

function animal(brinco: string, ultima_pesagem: string | null = null): AnimalLocal {
  return {
    id: `id-${brinco}`,
    brinco,
    nome: null,
    raca: null,
    porte: null,
    lote_id: null,
    status: "ativo",
    ultimo_peso: ultima_pesagem ? "300.00" : null,
    ultima_pesagem,
  };
}

function naFila(brinco: string, data = HOJE): PesagemPendente {
  return {
    id: `fila-${brinco}`,
    animal_id: null,
    brinco,
    data,
    peso_kg: "310.00",
    observacao_texto: null,
    latitude: null,
    longitude: null,
    coletado_em: `${data}T10:00:00Z`,
    tentativas: 0,
    ultimo_erro: null,
  };
}

describe("quem já foi pesado hoje", () => {
  it("conta o que está na fila e ainda não subiu", () => {
    /* Sem isto, o animal reapareceria como pendente logo depois de pesado — o
       pior erro possível numa tela de conferência. */
    const animais = [animal("1001"), animal("1002")];
    expect(pesadosHoje(animais, [naFila("1001")], HOJE)).toEqual(new Set(["1001"]));
  });

  it("conta o que já sincronizou, mesmo pesado por outro técnico", () => {
    const animais = [animal("1001", HOJE), animal("1002")];
    expect(pesadosHoje(animais, [], HOJE)).toEqual(new Set(["1001"]));
  });

  it("junta as duas fontes sem duplicar", () => {
    // Sincronizado E ainda na fila (um reenvio pendente): conta uma vez.
    const animais = [animal("1001", HOJE), animal("1002")];
    const pesados = pesadosHoje(animais, [naFila("1001"), naFila("1002")], HOJE);
    expect(pesados).toEqual(new Set(["1001", "1002"]));
  });

  it("pesagem de ontem não conta como de hoje", () => {
    const animais = [animal("1001", ONTEM)];
    expect(pesadosHoje(animais, [naFila("1002", ONTEM)], HOJE).size).toBe(0);
  });

  it("aceita data com hora junto", () => {
    const animais = [animal("1001", `${HOJE}T08:30:00Z`)];
    expect(pesadosHoje(animais, [], HOJE)).toEqual(new Set(["1001"]));
  });
});

describe("contagem do dia", () => {
  it("diz quantos foram e quantos faltam", () => {
    const animais = [animal("1001", HOJE), animal("1002"), animal("1003")];
    expect(contarODia(animais, [naFila("1002")], HOJE)).toEqual({
      pesados: 2,
      faltam: 1,
      total: 3,
    });
  });

  it("não conta brinco que está na fila mas não existe no aparelho", () => {
    /* O técnico pode pesar um brinco que o rebanho local não conhece. Contá-lo
       faria "faltam" ficar negativo e a soma não fechar com o total. */
    const animais = [animal("1001"), animal("1002")];
    const contagem = contarODia(animais, [naFila("9999")], HOJE);
    expect(contagem).toEqual({ pesados: 0, faltam: 2, total: 2 });
  });

  it("rebanho vazio não quebra", () => {
    expect(contarODia([], [], HOJE)).toEqual({ pesados: 0, faltam: 0, total: 0 });
  });

  it("tudo pesado zera o que falta", () => {
    const animais = [animal("1001", HOJE), animal("1002", HOJE)];
    expect(contarODia(animais, [], HOJE).faltam).toBe(0);
  });
});

describe("ordem da lista", () => {
  it("põe quem falta em cima", () => {
    const animais = [animal("1001", HOJE), animal("1002"), animal("1003", HOJE), animal("1004")];
    const pesados = pesadosHoje(animais, [], HOJE);

    expect(ordenarPendentesPrimeiro(animais, pesados).map((a) => a.brinco)).toEqual([
      "1002",
      "1004",
      "1001",
      "1003",
    ]);
  });

  it("ordena o brinco por número, não por texto", () => {
    // Ordem alfabética poria "1010" antes de "999" e o técnico procuraria à toa.
    const animais = [animal("1010"), animal("999"), animal("1002")];
    expect(ordenarPendentesPrimeiro(animais, new Set()).map((a) => a.brinco)).toEqual([
      "999",
      "1002",
      "1010",
    ]);
  });

  it("não altera a lista recebida", () => {
    const animais = [animal("1001", HOJE), animal("1002")];
    const original = animais.map((a) => a.brinco);
    ordenarPendentesPrimeiro(animais, pesadosHoje(animais, [], HOJE));
    expect(animais.map((a) => a.brinco)).toEqual(original);
  });
});
