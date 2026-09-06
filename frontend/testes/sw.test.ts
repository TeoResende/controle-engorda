import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Service Worker: o arquivo de maior risco do projeto.
 *
 * Ele decide se o app do técnico abre no curral e quão rápido cada tela troca.
 * Já causou três defeitos silenciosos — HTML guardado sem os scripts, uma barra
 * invertida a mais no caminho dos `/_next/static`, fontes nunca varridas — e
 * nenhum deles apareceu em teste porque não havia teste.
 *
 * Aqui o `sw.js` é carregado de verdade num sandbox, com `caches` e `fetch` de
 * mentira. O que se testa é a política: **o que responde na hora, o que vai à
 * rede e o que sobrevive sem sinal.**
 */

type Manipulador = (evento: unknown) => void;

function carregarWorker(guardado: Record<string, string>, rede: (url: string) => Promise<Response>) {
  const ouvintes = new Map<string, Manipulador>();
  const cache = {
    async match(chave: unknown) {
      const url = typeof chave === "string" ? chave : (chave as Request).url;
      const conteudo = guardado[url];
      return conteudo === undefined ? undefined : new Response(conteudo);
    },
    async put(chave: unknown, resposta: Response) {
      const url = typeof chave === "string" ? chave : (chave as Request).url;
      guardado[url] = await resposta.text();
    },
    async addAll() {},
  };

  const self = {
    addEventListener: (nome: string, fn: Manipulador) => ouvintes.set(nome, fn),
    location: { origin: "https://app.teste" },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: (req: unknown) => rede(typeof req === "string" ? req : (req as Request).url),
  };

  const codigo = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(codigo, {
    self,
    caches: self.caches,
    fetch: self.fetch,
    Response,
    Request,
    URL,
    console,
    addEventListener: self.addEventListener,
  });

  return { ouvintes, guardado };
}

/** Dispara o handler de `fetch` e devolve o que ele respondeu. */
async function pedir(
  ouvintes: Map<string, Manipulador>,
  url: string,
  modo: "navigate" | "no-cors" = "navigate",
): Promise<Response | null> {
  const fetchHandler = ouvintes.get("fetch");
  if (!fetchHandler) throw new Error("o worker não registrou o handler de fetch");

  let respondida: Promise<Response> | null = null;
  fetchHandler({
    request: { url, method: "GET", mode: modo },
    respondWith: (p: Promise<Response>) => {
      respondida = p;
    },
    waitUntil: () => {},
  });
  return respondida ? await respondida : null;
}

const TELA = "https://app.teste/tecnico/animais";

describe("service worker do técnico", () => {
  let rede: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rede = vi.fn(async () => new Response("da rede"));
  });

  it("responde do cache na hora, sem esperar a rede", async () => {
    // É a mudança que fez a troca de tela deixar de travar no curral: com sinal
    // ruim, a rede demora segundos e a cópia perfeita está ali do lado.
    const { ouvintes } = carregarWorker({ "/tecnico/animais": "guardada" }, rede);

    const resposta = await pedir(ouvintes, TELA);

    expect(await resposta!.text()).toBe("guardada");
  });

  it("mesmo respondendo do cache, busca a versão nova em segundo plano", async () => {
    const { ouvintes } = carregarWorker({ "/tecnico/animais": "guardada" }, rede);

    await pedir(ouvintes, TELA);

    expect(rede).toHaveBeenCalled();
  });

  it("sem nada guardado, vai à rede", async () => {
    const { ouvintes } = carregarWorker({}, rede);

    const resposta = await pedir(ouvintes, TELA);

    expect(await resposta!.text()).toBe("da rede");
  });

  it("sem cache e sem rede, cai na casca do app em vez de erro do navegador", async () => {
    const semRede = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { ouvintes } = carregarWorker({ "/tecnico": "casca do app" }, semRede);

    const resposta = await pedir(ouvintes, TELA);

    expect(await resposta!.text()).toBe("casca do app");
  });

  it("o dashboard não passa pelo cache: lá dado velho é pior que erro de rede", async () => {
    const { ouvintes } = carregarWorker({ "/dashboard": "guardada" }, rede);

    const resposta = await pedir(ouvintes, "https://app.teste/dashboard");

    // Não respondeu nada: o worker deixa a requisição seguir para a rede.
    expect(resposta).toBeNull();
  });

  it("a API nunca vem do cache", async () => {
    const { ouvintes } = carregarWorker({ "/api/animais": "guardada" }, rede);

    const resposta = await pedir(ouvintes, "https://app.teste/api/animais", "no-cors");

    expect(resposta).toBeNull();
  });
});
