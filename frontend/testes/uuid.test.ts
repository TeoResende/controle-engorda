import { afterEach, describe, expect, it, vi } from "vitest";

import { novoUuid } from "@/lib/uuid";

/**
 * O id da pesagem é a chave de idempotência do envio (M4). Se ele falhar ao ser
 * gerado, o técnico não registra peso nenhum — e foi o que aconteceu: o app
 * aberto por http na rede local não tem `crypto.randomUUID`, que só existe em
 * contexto seguro.
 */

const FORMATO_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const cripto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "crypto", { value: cripto, configurable: true });
});

describe("geração de UUID", () => {
  it("usa crypto.randomUUID quando existe", () => {
    expect(novoUuid()).toMatch(FORMATO_V4);
  });

  it("funciona sem randomUUID (http, contexto inseguro)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: cripto.getRandomValues.bind(cripto) },
      configurable: true,
    });

    expect(novoUuid()).toMatch(FORMATO_V4);
  });

  it("funciona sem crypto nenhum", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });

    expect(novoUuid()).toMatch(FORMATO_V4);
  });

  it("não repete id", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: cripto.getRandomValues.bind(cripto) },
      configurable: true,
    });

    // Id repetido faria uma pesagem sumir dentro da outra no envio idempotente.
    const ids = new Set(Array.from({ length: 5000 }, novoUuid));
    expect(ids.size).toBe(5000);
  });
});
