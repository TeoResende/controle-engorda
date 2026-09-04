import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // fake-indexeddb dá um IndexedDB de verdade em memória: o motor de
    // sincronização é testado contra o Dexie real, não contra um dublê.
    setupFiles: ["./testes/preparo.ts"],
    include: ["testes/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
