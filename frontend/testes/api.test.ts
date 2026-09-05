import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, ErroApi, SemConexao } from "@/lib/api";

/**
 * O que estes testes protegem: **"sem conexão" tem que significar sem conexão**.
 *
 * Um proxy mal roteado devolvia o HTML de 404 do Next, o `JSON.parse` estourava,
 * e o `catch` da tela mostrava "você está sem internet" — mandando o usuário
 * procurar o problema no lugar errado enquanto a rede estava perfeita.
 */

const fetchFalso = vi.fn();
vi.stubGlobal("fetch", fetchFalso);

function resposta(corpo: string, status = 200): Response {
  return new Response(corpo, { status });
}

beforeEach(() => {
  fetchFalso.mockReset();
});

describe("cliente de API", () => {
  it("devolve o JSON quando dá certo", async () => {
    fetchFalso.mockResolvedValue(resposta(JSON.stringify({ precisa_configuracao: true })));
    await expect(api("/setup/status")).resolves.toEqual({ precisa_configuracao: true });
  });

  it("HTML no lugar de JSON não vira 'sem conexão'", async () => {
    fetchFalso.mockResolvedValue(resposta("<!DOCTYPE html><html>404</html>"));

    const erro = await api("/setup/status").catch((e) => e);

    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).not.toBeInstanceOf(SemConexao);
    expect(erro.message).toMatch(/não veio JSON/i);
  });

  it("erro do servidor com HTML informa o status, não a rede", async () => {
    fetchFalso.mockResolvedValue(resposta("<html>502 Bad Gateway</html>", 502));

    const erro = await api("/setup/status").catch((e) => e);

    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.status).toBe(502);
    expect(erro.message).toContain("502");
  });

  it("só falha de rede de verdade vira SemConexao", async () => {
    fetchFalso.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/setup/status")).rejects.toBeInstanceOf(SemConexao);
  });

  it("mensagem de erro do backend chega à tela", async () => {
    fetchFalso.mockResolvedValue(
      resposta(JSON.stringify({ detail: "E-mail ou senha inválidos" }), 401),
    );

    const erro = await api("/auth/login", { method: "POST" }).catch((e) => e);

    expect(erro.status).toBe(401);
    expect(erro.message).toBe("E-mail ou senha inválidos");
  });

  it("o 409 carrega a lista de fazendas para a tela de escolha", async () => {
    const detalhe = {
      detail: {
        mensagem: "Informe fazenda_id: o usuário atende mais de uma fazenda",
        fazendas: [{ fazenda_id: "f1", nome: "Boa Vista", papel: "tecnico" }],
      },
    };
    fetchFalso.mockResolvedValue(resposta(JSON.stringify(detalhe), 409));

    const erro = await api("/auth/login", { method: "POST" }).catch((e) => e);

    expect(erro.status).toBe(409);
    expect((erro.corpo as typeof detalhe).detail.fazendas).toHaveLength(1);
  });

  it("corpo vazio com 204 não quebra", async () => {
    fetchFalso.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api("/pesagens/x")).resolves.toBeNull();
  });
});

describe("checagem de instalação", () => {
  it("acusa sistema vazio", async () => {
    fetchFalso.mockResolvedValue(resposta(JSON.stringify({ precisa_configuracao: true })));
    const { precisaConfiguracao } = await import("@/lib/instalacao");
    await expect(precisaConfiguracao()).resolves.toBe(true);
  });

  it("com usuários cadastrados, não manda para o cadastro inicial", async () => {
    fetchFalso.mockResolvedValue(resposta(JSON.stringify({ precisa_configuracao: false })));
    const { precisaConfiguracao } = await import("@/lib/instalacao");
    await expect(precisaConfiguracao()).resolves.toBe(false);
  });

  it("API fora do ar não manda ninguém para o cadastro inicial", async () => {
    /* Falha de rede não é prova de sistema vazio — mandar para o primeiro
       acesso aqui ofereceria criar um admin num sistema que já tem dono. */
    fetchFalso.mockRejectedValue(new TypeError("Failed to fetch"));
    const { precisaConfiguracao } = await import("@/lib/instalacao");
    await expect(precisaConfiguracao()).resolves.toBe(false);
  });
});
