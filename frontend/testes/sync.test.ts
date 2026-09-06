import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, type PesagemPendente } from "@/lib/db";

/**
 * M5 — motor de sincronização.
 *
 * A regra que estes testes protegem: **a cópia local só é apagada depois que o
 * servidor confirmou**. Perder uma pesagem coletada no curral é o pior defeito
 * possível deste sistema, e é um defeito silencioso — ninguém percebe até
 * alguém procurar o peso e ele não estar lá.
 */

const respostas: unknown[] = [];
let ultimoCorpo: unknown = null;

vi.mock("@/lib/api", () => ({
  apiAuth: vi.fn(async (_caminho: string, opcoes: RequestInit) => {
    ultimoCorpo = JSON.parse(String(opcoes.body));
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    return proxima;
  }),
  ErroApi: class ErroApi extends Error {},
  SemConexao: class SemConexao extends Error {},
}));

const SESSAO = {
  access_token: "t",
  refresh_token: "r",
  fazenda_id: "f",
  papel: "tecnico" as const,
  admin_master: false,
};

vi.mock("@/lib/sessao", () => ({
  lerSessao: () => SESSAO,
  lerSessoes: () => [SESSAO],
  salvarSessoes: vi.fn(),
  fazendaAtiva: () => "f",
}));

const { sincronizar, enfileirar } = await import("@/lib/sync");

function pesagem(id: string, brinco = "1001"): PesagemPendente {
  return {
    id,
    fazenda_id: "f",
    animal_id: null,
    brinco,
    data: "2026-09-04",
    peso_kg: "300.00",
    observacao_texto: null,
    latitude: null,
    longitude: null,
    coletado_em: `2026-09-04T10:0${id.slice(-1)}:00Z`,
    tentativas: 0,
    ultimo_erro: null,
  };
}

beforeEach(async () => {
  await db.fila.clear();
  await db.animais.clear();
  respostas.length = 0;
  ultimoCorpo = null;
});

describe("fila de pesagens", () => {
  it("apaga a cópia local só depois da confirmação", async () => {
    await enfileirar(pesagem("a1"));
    await enfileirar(pesagem("a2"));
    respostas.push({
      criadas: 2,
      duplicadas: 0,
      erros: 0,
      resultados: [
        { id: "a1", situacao: "criada", detalhe: null },
        { id: "a2", situacao: "criada", detalhe: null },
      ],
    });

    const resumo = await sincronizar();

    expect(resumo.enviadas).toBe(2);
    expect(await db.fila.count()).toBe(0);
  });

  it("mantém na fila o que o servidor não confirmou", async () => {
    await enfileirar(pesagem("b1"));
    await enfileirar(pesagem("b2"));
    respostas.push({
      criadas: 1,
      duplicadas: 0,
      erros: 1,
      resultados: [
        { id: "b1", situacao: "criada", detalhe: null },
        { id: "b2", situacao: "erro", detalhe: "Nenhum animal ativo com o brinco 9999" },
      ],
    });

    await sincronizar();

    const restantes = await db.fila.toArray();
    expect(restantes.map((p) => p.id)).toEqual(["b2"]);
    // O motivo fica gravado para o técnico ver e corrigir.
    expect(restantes[0].ultimo_erro).toContain("9999");
    expect(restantes[0].tentativas).toBe(1);
  });

  it("duplicada conta como confirmada e sai da fila", async () => {
    // Reenvio depois de uma resposta perdida: o servidor já tinha o registro.
    await enfileirar(pesagem("c1"));
    respostas.push({
      criadas: 0,
      duplicadas: 1,
      erros: 0,
      resultados: [{ id: "c1", situacao: "duplicada", detalhe: null }],
    });

    await sincronizar();

    expect(await db.fila.count()).toBe(0);
  });

  it("não apaga nada quando a rede falha no meio", async () => {
    await enfileirar(pesagem("d1"));
    respostas.push(new Error("rede caiu"));

    const resumo = await sincronizar();

    expect(resumo.enviadas).toBe(0);
    expect(resumo.motivo).toBeTruthy();
    expect(await db.fila.count()).toBe(1);
  });

  it("não tenta enviar offline", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
    await enfileirar(pesagem("e1"));

    const resumo = await sincronizar();

    expect(resumo.motivo).toBe("offline");
    expect(await db.fila.count()).toBe(1);
    Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  });

  it("envia em ordem de coleta", async () => {
    await enfileirar(pesagem("f2"));
    await enfileirar(pesagem("f1"));
    respostas.push({
      criadas: 2,
      duplicadas: 0,
      erros: 0,
      resultados: [
        { id: "f1", situacao: "criada", detalhe: null },
        { id: "f2", situacao: "criada", detalhe: null },
      ],
    });

    await sincronizar();

    // coletado_em de f1 é anterior ao de f2.
    expect((ultimoCorpo as { id: string }[]).map((p) => p.id)).toEqual(["f1", "f2"]);
  });

  it("um item ruim não trava a fila para sempre", async () => {
    /* O item com erro fica, mas os bons do mesmo bloco sobem — e o laço para em
       vez de reenviar o mesmo bloco eternamente. */
    await enfileirar(pesagem("g1"));
    respostas.push({
      criadas: 0,
      duplicadas: 0,
      erros: 1,
      resultados: [{ id: "g1", situacao: "erro", detalhe: "peso inválido" }],
    });

    const resumo = await sincronizar();

    expect(resumo.comErro).toBe(1);
    expect(await db.fila.count()).toBe(1);
  });
});

/**
 * A tela de conferência não pode voltar a mostrar como pendente um animal que
 * o técnico acabou de pesar — nem depois que a fila sincroniza e o item some.
 * O "pesado hoje" vem da fila E da cópia do rebanho; salvar tem que atualizar a
 * cópia na hora, senão há uma janela de dado velho.
 */
describe("reflexo da pesagem na cópia do rebanho", () => {
  const HOJE = "2026-09-04";

  async function animalNoAparelho(brinco: string, ultima: string | null) {
    await db.animais.put({
      id: `id-${brinco}`,
      fazenda_id: "f",
      brinco,
      nome: null,
      raca: null,
      porte: null,
      lote_id: null,
      status: "ativo",
      ultimo_peso: ultima ? "250.00" : null,
      ultima_pesagem: ultima,
    });
  }

  it("marca o animal como pesado hoje assim que a pesagem é salva", async () => {
    await animalNoAparelho("1001", null);

    await enfileirar({ ...pesagem("x1", "1001"), data: HOJE, peso_kg: "312.00" });

    const a = await db.animais.get("id-1001");
    expect(a?.ultima_pesagem?.slice(0, 10)).toBe(HOJE);
    expect(a?.ultimo_peso).toBe("312.00");
  });

  it("sobrevive à sincronização: o item some da fila, a cópia continua marcada", async () => {
    await animalNoAparelho("1001", null);
    respostas.push({
      criadas: 1,
      duplicadas: 0,
      erros: 0,
      resultados: [{ id: "x2", situacao: "criada", detalhe: null }],
    });

    await enfileirar({ ...pesagem("x2", "1001"), data: HOJE });
    await sincronizar(); // sobe e apaga o item da fila

    expect(await db.fila.count()).toBe(0);
    const a = await db.animais.get("id-1001");
    expect(a?.ultima_pesagem?.slice(0, 10)).toBe(HOJE); // ainda pesado hoje
  });

  it("pesagem retroativa não apaga uma leitura mais recente já na cópia", async () => {
    await animalNoAparelho("1001", "2026-09-04");

    await enfileirar({ ...pesagem("x3", "1001"), data: "2026-08-01", peso_kg: "200.00" });

    const a = await db.animais.get("id-1001");
    expect(a?.ultima_pesagem).toBe("2026-09-04"); // preservada
    expect(a?.ultimo_peso).toBe("250.00");
  });

  it("animal que não está na cópia não quebra o salvamento", async () => {
    await expect(
      enfileirar({ ...pesagem("x4", "9999"), data: HOJE }),
    ).resolves.toBeUndefined();
    expect(await db.fila.count()).toBe(1);
  });
});
