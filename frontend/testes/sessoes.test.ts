import { beforeEach, describe, expect, it } from "vitest";

import {
  fazendaAtiva,
  lerSessao,
  lerSessoes,
  limparSessao,
  salvarSessao,
  salvarSessoes,
  trocarFazendaAtiva,
  type Sessao,
} from "@/lib/sessao";

/**
 * Sessões por fazenda.
 *
 * Guardar todas é o que permite trocar de fazenda **sem internet**: emitir token
 * exige servidor, e no curral — onde a troca acontece — não há.
 */

function sessao(fazenda_id: string, fazenda_nome: string): Sessao {
  return {
    access_token: `token-${fazenda_id}`,
    refresh_token: `refresh-${fazenda_id}`,
    fazenda_id,
    papel: "tecnico",
    admin_master: false,
    fazenda_nome,
  };
}

const BOA_VISTA = sessao("f1", "Boa Vista");
const SANTA_CLARA = sessao("f2", "Santa Clara");

beforeEach(() => {
  localStorage.clear();
});

describe("guardar e trocar", () => {
  it("guarda várias e abre a primeira", () => {
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    expect(lerSessoes()).toHaveLength(2);
    expect(fazendaAtiva()).toBe("f1");
  });

  it("troca sem precisar de rede", () => {
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    expect(trocarFazendaAtiva("f2")).toBe(true);
    expect(lerSessao()?.access_token).toBe("token-f2");
  });

  it("não troca para fazenda que não está no aparelho", () => {
    /* Trocar para uma sessão inexistente deixaria o app sem token — e o técnico
       sem conseguir nem coletar. */
    salvarSessoes([BOA_VISTA]);
    expect(trocarFazendaAtiva("f9")).toBe(false);
    expect(fazendaAtiva()).toBe("f1");
  });

  it("mantém a fazenda aberta ao rebaixar as sessões", () => {
    // A sincronização rebaixa as sessões periodicamente; se isso mudasse a
    // fazenda aberta, a tela trocaria sozinha embaixo do técnico.
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    trocarFazendaAtiva("f2");
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    expect(fazendaAtiva()).toBe("f2");
  });

  it("escolhe outra se a aberta deixou de existir", () => {
    // Vínculo revogado: a fazenda some da lista e o app precisa seguir de pé.
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    trocarFazendaAtiva("f2");
    salvarSessoes([BOA_VISTA]);
    expect(fazendaAtiva()).toBe("f1");
  });

  it("renovar o token de uma fazenda não derruba as outras", () => {
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    salvarSessao({ ...BOA_VISTA, access_token: "token-novo" });

    expect(lerSessoes()).toHaveLength(2);
    expect(lerSessoes().find((s) => s.fazenda_id === "f2")?.access_token).toBe("token-f2");
  });

  it("sair apaga tudo", () => {
    salvarSessoes([BOA_VISTA, SANTA_CLARA]);
    limparSessao();
    expect(lerSessoes()).toEqual([]);
    expect(lerSessao()).toBeNull();
  });
});

describe("compatibilidade com o formato antigo", () => {
  it("migra quem já estava logado", () => {
    /* Sem a migração, uma mudança interna deslogaria o técnico — no meio do
       campo, onde ele não consegue entrar de novo sem sinal. */
    localStorage.setItem("engorda.sessao", JSON.stringify(BOA_VISTA));

    expect(lerSessao()?.fazenda_id).toBe("f1");
    expect(lerSessoes()).toHaveLength(1);
    expect(localStorage.getItem("engorda.sessao")).toBeNull();
  });

  it("conteúdo corrompido não trava o app", () => {
    localStorage.setItem("engorda.sessoes", "{isso não é json");
    expect(lerSessao()).toBeNull();
  });
});
