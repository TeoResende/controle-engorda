import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, type AnimalLocal } from "@/lib/db";

/**
 * A conferência do técnico mostra o rebanho **vivo**. Animal morto, vendido ou
 * transferido saiu do curral: não entra na lista de pesar nem nos contadores.
 * O download já pede só ativos; este filtro local cobre a janela até o próximo
 * sync, quando uma cópia antiga ainda pode trazer quem saiu.
 */

vi.mock("@/lib/sessao", () => ({
  fazendaAtiva: () => "f1",
  lerSessao: () => ({ fazenda_id: "f1" }),
  lerSessoes: () => [{ fazenda_id: "f1" }],
}));

function animal(id: string, status: string): AnimalLocal {
  return {
    id, fazenda_id: "f1", brinco: id, nome: null, raca: null, porte: null,
    lote_id: null, status, ultimo_peso: null, ultima_pesagem: null,
  };
}

beforeEach(async () => {
  await db.animais.clear();
  await db.fila.clear();
});

describe("conferência esconde quem saiu do rebanho", () => {
  it("lerRebanhoEFila devolve só ativos", async () => {
    await db.animais.bulkPut([
      animal("vivo", "ativo"),
      animal("morto", "morto"),
      animal("vendido", "vendido"),
      animal("transferido", "transferido"),
    ]);

    const { lerRebanhoEFila } = await import("@/lib/pesados-hoje");
    const { animais } = await lerRebanhoEFila();

    expect(animais.map((a) => a.id)).toEqual(["vivo"]);
  });
});
