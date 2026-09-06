"use client";

import { useCallback, useEffect, useState } from "react";

import { Aviso, Botao, Campo, Cartao, Chip, Esqueleto, Vazio } from "@/components/ui";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { apiAuth, ErroApi } from "@/lib/api";
import { data as formatarData } from "@/lib/formato";
import { lerSessao, salvarSessao, type Sessao } from "@/lib/sessao";

type Fazenda = {
  id: string;
  nome: string;
  proprietario: string | null;
  endereco: string | null;
  criado_em: string;
  desativado_em: string | null;
};

/**
 * Cadastro de fazendas — a visão de dono do SaaS.
 *
 * A primeira fazenda nasce no primeiro acesso, junto com o admin master. Daí em
 * diante, cliente novo é fazenda nova, e é aqui que ela entra. A API já
 * permitia (`POST /fazendas`), mas não havia tela: quem instalava o sistema
 * ficava preso à fazenda inicial sem nenhuma pista de como criar a segunda.
 *
 * Só o admin master enxerga. Admin de fazenda administra a **dele** — abrir
 * fazenda é decisão de quem opera o SaaS.
 *
 * **Nada é apagado**, aqui também: desativar tira a fazenda de circulação e
 * bloqueia o login nela, mas animais, pesagens e histórico continuam no banco e
 * voltam inteiros se ela for reativada.
 */
export default function Fazendas() {
  const [fazendas, setFazendas] = useState<Fazenda[] | null>(null);
  const [incluirInativas, setIncluirInativas] = useState(false);
  const [criando, setCriando] = useState(false);
  const [semPermissao, setSemPermissao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const sessao = lerSessao();

  const carregar = useCallback(async () => {
    try {
      const lista = await apiAuth<Fazenda[]>(
        `/fazendas?incluir_inativas=${incluirInativas}`,
      );
      setFazendas(lista);
      setSemPermissao(false);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 403) setSemPermissao(true);
      setFazendas([]);
    }
  }, [incluirInativas]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      await acao();
      await carregar();
      setOk(mensagem);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível concluir");
    } finally {
      setOcupado(false);
    }
  }

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campos = new FormData(evento.currentTarget);
    const formulario = evento.currentTarget;
    await executar(
      () =>
        apiAuth("/fazendas", {
          method: "POST",
          body: JSON.stringify({
            nome: String(campos.get("nome")),
            proprietario: String(campos.get("proprietario")) || null,
            endereco: String(campos.get("endereco")) || null,
          }),
        }),
      "Fazenda criada. Use “Entrar” para começar a cadastrar animais nela.",
    );
    formulario.reset();
    setCriando(false);
  }

  /** Entrar numa fazenda é trocar de token — o `fazenda_id` viaja assinado
   *  dentro dele, e nenhum endpoint de dados aceita a fazenda vinda do
   *  cliente. */
  async function entrar(id: string) {
    const nova = await apiAuth<Sessao>("/auth/trocar-fazenda", {
      method: "POST",
      body: JSON.stringify({ fazenda_id: id }),
    });
    salvarSessao(nova);
    window.location.assign("/dashboard");
  }

  if (semPermissao) {
    return (
      <div className="flex flex-col gap-5">
        <header>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">Fazendas</h1>
        </header>
        <Aviso tom="atencao">
          Esta área é de quem administra o sistema inteiro. Para mudar os dados da
          fazenda em que você está, use Configurações.
        </Aviso>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">Fazendas</h1>
          <p className="text-sm text-verde/60">
            Todas as fazendas do sistema. Cliente novo entra aqui.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-verde/60">
            <input
              type="checkbox"
              checked={incluirInativas}
              onChange={(e) => setIncluirInativas(e.target.checked)}
            />
            mostrar desativadas
          </label>
          <Botao onClick={() => setCriando((v) => !v)}>
            {criando ? "Cancelar" : "Nova fazenda"}
          </Botao>
        </div>
      </header>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {ok && <Aviso tom="sucesso">{ok}</Aviso>}

      {criando && (
        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">Nova fazenda</h2>
          <p className="mt-0.5 text-sm text-verde/60">
            Você entra como admin dela. Proprietário e endereço podem ficar para depois.
          </p>
          <form onSubmit={criar} className="mt-4 grid gap-3 sm:grid-cols-3">
            <Campo name="nome" rotulo="Nome da fazenda" required minLength={2} />
            <Campo name="proprietario" rotulo="Proprietário" />
            <Campo name="endereco" rotulo="Endereço" />
            <div className="sm:col-span-3">
              <Botao type="submit" disabled={ocupado}>
                Criar fazenda
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      <Cartao>
        {fazendas === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Esqueleto key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : fazendas.length === 0 ? (
          <Vazio
            titulo="Nenhuma fazenda"
            descricao="Crie a primeira em “Nova fazenda”."
          />
        ) : (
          <Tabela colunas={["Fazenda", "Proprietário", "Criada em", "Situação", ""]}>
            {fazendas.map((f) => (
              <Linha key={f.id}>
                <Celula principal>
                  {f.nome}
                  {f.id === sessao?.fazenda_id && (
                    <span className="ml-2 align-middle text-xs font-normal text-verde/50">
                      você está aqui
                    </span>
                  )}
                </Celula>
                <Celula rotulo="Proprietário">{f.proprietario ?? "—"}</Celula>
                <Celula rotulo="Criada em">{formatarData(f.criado_em.slice(0, 10))}</Celula>
                <Celula rotulo="Situação">
                  <Chip tom={f.desativado_em ? "claro" : "lima"}>
                    {f.desativado_em ? "Desativada" : "Ativa"}
                  </Chip>
                </Celula>
                <Celula>
                  <div className="flex flex-wrap justify-end gap-2">
                    {f.desativado_em ? (
                      <button
                        onClick={() =>
                          executar(
                            () => apiAuth(`/fazendas/${f.id}/reativar`, { method: "POST" }),
                            `${f.nome} voltou a funcionar.`,
                          )
                        }
                        disabled={ocupado}
                        className="rounded-lg border border-borda px-3 py-1.5 text-xs font-bold text-verde transition hover:bg-verde/5 disabled:opacity-50"
                      >
                        Reativar
                      </button>
                    ) : (
                      <>
                        {f.id !== sessao?.fazenda_id && (
                          <button
                            onClick={() => entrar(f.id)}
                            disabled={ocupado}
                            className="rounded-lg border border-borda px-3 py-1.5 text-xs font-bold text-verde transition hover:bg-verde/5 disabled:opacity-50"
                          >
                            Entrar
                          </button>
                        )}
                        <button
                          onClick={() => {
                            // Desativar uma fazenda tira do ar todo mundo que
                            // trabalha nela: pede confirmação, mesmo sendo
                            // reversível.
                            if (
                              !window.confirm(
                                `Desativar ${f.nome}? Quem trabalha nela perde o acesso. Nada é apagado — dá para reativar depois.`,
                              )
                            )
                              return;
                            void executar(
                              () => apiAuth(`/fazendas/${f.id}`, { method: "DELETE" }),
                              `${f.nome} foi desativada. O histórico continua guardado.`,
                            );
                          }}
                          disabled={ocupado}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          Desativar
                        </button>
                      </>
                    )}
                  </div>
                </Celula>
              </Linha>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
