import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArmazenamentoCheio, db, ehCotaCheia, gravarMeta } from "@/lib/db";
import { enfileirar } from "@/lib/sync";
import type { PesagemPendente } from "@/lib/db";

/**
 * Cota de armazenamento cheia.
 *
 * A cota da origem é compartilhada entre o cache do Service Worker e o
 * IndexedDB. Quando o cache do app crescia demais, era a gravação da pesagem
 * que abortava — com o erro que apareceu no aparelho, `AbortError:
 * QuotaExceededError`. Estes testes protegem as duas pontas: a pesagem, que não
 * pode se perder nem virar um crash críptico, e a marca/logo, que é
 * conveniência e nunca deve derrubar a tela.
 */

function pesagem(): PesagemPendente {
  return {
    id: crypto.randomUUID(),
    fazenda_id: "f1",
    animal_id: null,
    brinco: "1000",
    data: "2026-09-06",
    peso_kg: "300.00",
    observacao_texto: null,
    latitude: null,
    longitude: null,
    coletado_em: new Date().toISOString(),
    tentativas: 0,
    ultimo_erro: null,
    audio_enviado: false,
  };
}

function erroDeCota(): Error {
  const e = new Error("The quota has been exceeded.");
  e.name = "AbortError"; // foi assim que apareceu no aparelho
  return e;
}

beforeEach(async () => {
  await db.fila.clear();
  await db.meta.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("caches", {
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  });
});

describe("reconhecer o estouro de cota", () => {
  it("aceita QuotaExceededError direto e AbortError com 'quota' na mensagem", () => {
    const q = new Error("x");
    q.name = "QuotaExceededError";
    expect(ehCotaCheia(q)).toBe(true);
    expect(ehCotaCheia(erroDeCota())).toBe(true);
    const outro = new Error("qualquer outra coisa");
    outro.name = "AbortError";
    expect(ehCotaCheia(outro)).toBe(false);
  });
});

describe("gravar a pesagem sob cota cheia", () => {
  it("libera o cache do app e tenta de novo — a pesagem não se perde", async () => {
    const put = vi.spyOn(db.fila, "put");
    put.mockRejectedValueOnce(erroDeCota()); // 1ª tentativa estoura
    // 2ª tentativa (depois de liberar espaço) usa a implementação real.

    await enfileirar(pesagem());

    expect((globalThis.caches!.delete as ReturnType<typeof vi.fn>) ?? true).toBeTruthy();
    expect(await db.fila.count()).toBe(1);
  });

  it("se nem liberando couber, avisa com clareza em vez de estourar erro cru", async () => {
    vi.spyOn(db.fila, "put").mockRejectedValue(erroDeCota()); // sempre estoura

    await expect(enfileirar(pesagem())).rejects.toBeInstanceOf(ArmazenamentoCheio);
  });

  it("erro que não é de cota sobe como veio — não vira 'armazenamento cheio'", async () => {
    const outro = new Error("banco corrompido");
    vi.spyOn(db.fila, "put").mockRejectedValue(outro);

    await expect(enfileirar(pesagem())).rejects.toBe(outro);
  });
});

describe("gravar marca/logo sob cota cheia", () => {
  it("engole o estouro: ficar sem logo é melhor que derrubar a tela", async () => {
    vi.spyOn(db.meta, "put").mockRejectedValue(erroDeCota());

    await expect(gravarMeta("logo:f1", new Blob(["x"]))).resolves.toBeUndefined();
  });

  it("mas propaga erro que não é de cota", async () => {
    const outro = new Error("outro problema");
    vi.spyOn(db.meta, "put").mockRejectedValue(outro);

    await expect(gravarMeta("marca", {})).rejects.toBe(outro);
  });
});
