import "fake-indexeddb/auto";

// O código do app checa navigator.onLine e crypto.randomUUID; em Node eles ou
// não existem ou não são configuráveis por padrão.
if (!("onLine" in globalThis.navigator)) {
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: true,
    configurable: true,
    writable: true,
  });
}

/**
 * `localStorage` de mentira, para os testes das sessões.
 *
 * O ambiente é Node, e o módulo de sessão é síncrono de propósito — precisa
 * estar disponível na primeira renderização, antes de qualquer efeito.
 */
if (typeof globalThis.localStorage === "undefined") {
  const dados = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (c: string) => dados.get(c) ?? null,
      setItem: (c: string, v: string) => void dados.set(c, String(v)),
      removeItem: (c: string) => void dados.delete(c),
      clear: () => dados.clear(),
    },
  });
}
