import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { logoDaFazenda, logoGuardada } from "@/lib/marca";

/**
 * Logo da fazenda.
 *
 * O defeito que originou este arquivo era invisível: a logo era exibida com uma
 * tag `<img src>` apontando para uma rota que exige cabeçalho de autenticação.
 * O navegador busca `src` sem cabeçalho nenhum, a resposta era 401 e a imagem
 * simplesmente não aparecia — em nenhuma das quatro telas que a mostram, sem
 * erro visível. Quem enviava a logo concluía que o envio não tinha funcionado.
 *
 * O que se testa aqui é o que decide se a marca aparece ou some na hora errada.
 */

const FAZENDA = "fazenda-de-teste";
const CHAVE = `logo:${FAZENDA}`;

function blob(texto: string): Blob {
  return new Blob([texto], { type: "image/png" });
}

async function texto(b: Blob | null): Promise<string | null> {
  return b ? await b.text() : null;
}

beforeEach(async () => {
  await db.meta.clear();
  localStorage.setItem(
    "engorda.sessoes",
    JSON.stringify({
      ativa: FAZENDA,
      sessoes: [{ fazenda_id: FAZENDA, access_token: "token-de-teste" }],
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logo da fazenda", () => {
  it("manda o token — sem ele a rota responde 401 e a logo some", async () => {
    let cabecalhos: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, opcoes: RequestInit) => {
      cabecalhos = (opcoes.headers ?? {}) as Record<string, string>;
      return new Response(blob("imagem"), { status: 200 });
    });

    await logoDaFazenda(FAZENDA);

    expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
  });

  it("guarda o que baixou, para aparecer sem sinal na próxima vez", async () => {
    vi.stubGlobal("fetch", async () => new Response(blob("imagem"), { status: 200 }));

    await logoDaFazenda(FAZENDA);

    expect(await texto(await logoGuardada(FAZENDA))).toBe("imagem");
  });

  it("sem rede, devolve a guardada — no curral, marca vazia parece app quebrado", async () => {
    await db.meta.put({ chave: CHAVE, valor: blob("guardada") });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await texto(await logoDaFazenda(FAZENDA))).toBe("guardada");
  });

  it("erro do servidor também preserva a guardada", async () => {
    await db.meta.put({ chave: CHAVE, valor: blob("guardada") });
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));

    expect(await texto(await logoDaFazenda(FAZENDA))).toBe("guardada");
  });

  it("404 apaga a cópia: logo removida não pode continuar aparecendo", async () => {
    await db.meta.put({ chave: CHAVE, valor: blob("antiga") });
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));

    expect(await logoDaFazenda(FAZENDA)).toBeNull();
    expect(await logoGuardada(FAZENDA)).toBeNull();
  });

  it("é guardada por fazenda — quem atende duas troca sem internet", async () => {
    await db.meta.put({ chave: CHAVE, valor: blob("da-boa-vista") });

    expect(await logoGuardada("outra-fazenda")).toBeNull();
    expect(await texto(await logoGuardada(FAZENDA))).toBe("da-boa-vista");
  });
});
