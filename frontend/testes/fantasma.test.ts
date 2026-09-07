import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, limparCacheLocal, type AnimalLocal, type PesagemPendente } from "@/lib/db";

/**
 * Limpeza de fazenda/animal fantasma depois de um reset ou perda de acesso.
 *
 * A regra inegociável: **a fila nunca é apagada automaticamente.** Ela guarda
 * pesagens ainda não enviadas — dado, não cache. Só o rebanho e a identidade,
 * que se reconstroem sozinhos, podem ser limpos.
 */

const SESSOES = [
  { fazenda_id: "valida", access_token: "t", refresh_token: "r", papel: "tecnico" as const, admin_master: false },
];

vi.mock("@/lib/sessao", () => ({
  lerSessoes: () => SESSOES,
  lerSessao: () => SESSOES[0],
  fazendaAtiva: () => "valida",
}));

function animal(id: string, fazenda_id: string): AnimalLocal {
  return {
    id, fazenda_id, brinco: id, nome: null, raca: null, porte: null,
    lote_id: null, status: "ativo", ultimo_peso: null, ultima_pesagem: null,
  };
}

function pesagem(id: string, fazenda_id: string): PesagemPendente {
  return {
    id, fazenda_id, animal_id: null, brinco: "9", data: "2026-09-06", peso_kg: "300.00",
    observacao_texto: null, latitude: null, longitude: null,
    coletado_em: "2026-09-06T10:00:00Z", tentativas: 0, ultimo_erro: null,
  };
}

beforeEach(async () => {
  await db.animais.clear();
  await db.fila.clear();
  await db.meta.clear();
});

describe("varredura de fantasmas", () => {
  it("apaga o rebanho de fazenda que não é mais do usuário, mantém o da válida", async () => {
    await db.animais.bulkPut([
      animal("a", "valida"),
      animal("b", "fantasma-apagada-no-reset"),
      animal("c", "fantasma-apagada-no-reset"),
    ]);

    const { limparFazendasFantasma } = await import("@/lib/sync");
    await limparFazendasFantasma();

    const restantes = (await db.animais.toArray()).map((a) => a.fazenda_id);
    expect(restantes).toEqual(["valida"]);
  });

  it("NUNCA apaga a fila, nem de fazenda fantasma", async () => {
    await db.fila.bulkPut([pesagem("p1", "valida"), pesagem("p2", "fantasma-apagada-no-reset")]);

    const { limparFazendasFantasma } = await import("@/lib/sync");
    await limparFazendasFantasma();

    // As duas pesagens continuam — perder coleta não enviada é o pior defeito.
    expect(await db.fila.count()).toBe(2);
  });

  it("sem sessão conhecida, não apaga nada (evita zerar por estado transitório)", async () => {
    await db.animais.bulkPut([animal("a", "valida"), animal("b", "outra")]);
    vi.resetModules();
    vi.doMock("@/lib/sessao", () => ({ lerSessoes: () => [], lerSessao: () => null, fazendaAtiva: () => null }));
    const { limparFazendasFantasma } = await import("@/lib/sync");

    await limparFazendasFantasma();

    expect(await db.animais.count()).toBe(2);
    vi.doUnmock("@/lib/sessao");
  });
});

describe("sair da conta", () => {
  it("limparCacheLocal apaga rebanho e identidade, mas preserva a fila", async () => {
    await db.animais.bulkPut([animal("a", "valida")]);
    await db.meta.put({ chave: "identidade", valor: { nome: "Carlos" } });
    await db.fila.bulkPut([pesagem("p1", "valida")]);

    await limparCacheLocal();

    expect(await db.animais.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
    expect(await db.fila.count()).toBe(1); // a coleta não enviada fica
  });
});
