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

function carregarWorker(
  guardado: Record<string, string>,
  rede: (url: string) => Promise<Response>,
  chaveiaCota = false,
) {
  const ouvintes = new Map<string, Manipulador>();
  const ordem: string[] = [];
  const cache = {
    async match(chave: unknown) {
      const url = typeof chave === "string" ? chave : (chave as Request).url;
      const conteudo = guardado[url];
      return conteudo === undefined ? undefined : new Response(conteudo);
    },
    async put(chave: unknown, resposta: Response) {
      const url = typeof chave === "string" ? chave : (chave as Request).url;
      if (chaveiaCota && !(url in guardado)) {
        const e = new Error("Quota exceeded");
        e.name = "QuotaExceededError";
        throw e;
      }
      if (!(url in guardado)) ordem.push(url);
      guardado[url] = await resposta.text();
    },
    async keys() {
      // O Cache real devolve Request na ordem de inserção.
      return ordem.map((u) => ({ url: u.startsWith("http") ? u : "https://app.teste" + u }));
    },
    async delete(chave: unknown) {
      const url = typeof chave === "string" ? chave : (chave as { url: string }).url;
      const path = url.replace("https://app.teste", "");
      for (const k of [url, path]) {
        if (k in guardado) {
          delete guardado[k];
          const i = ordem.indexOf(k);
          if (i >= 0) ordem.splice(i, 1);
        }
      }
      return true;
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

  it("cota cheia ao guardar não derruba a navegação: entrega a página mesmo assim", async () => {
    // Era a causa do "erro no modo técnico": o cache lotava a cota da origem e
    // a escrita estourava. Guardar é conveniência — a resposta tem que sair.
    const rede2 = vi.fn(async () => new Response("da rede"));
    const { ouvintes } = carregarWorker({}, rede2, /* chaveiaCota */ true);

    const resposta = await pedir(ouvintes, TELA);

    expect(await resposta!.text()).toBe("da rede");
  });

  it("o cache de estáticos não cresce sem limite entre builds", async () => {
    const guardado: Record<string, string> = {};
    let n = 0;
    const rede2 = vi.fn(async () => new Response("chunk-" + n++));
    const { ouvintes } = carregarWorker(guardado, rede2);

    // Simula muitas gerações de chunks com hash novo (o que cada build produz).
    for (let i = 0; i < 500; i++) {
      await pedir(ouvintes, `https://app.teste/_next/static/chunks/${i}.js`, "no-cors");
    }

    const estaticos = Object.keys(guardado).filter((u) => u.includes("/_next/static/"));
    expect(estaticos.length).toBeLessThanOrEqual(400);
  });
});
