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
