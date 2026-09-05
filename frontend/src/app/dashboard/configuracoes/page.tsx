"use client";

import { useCallback, useEffect, useState } from "react";

import { Celula, Linha, Tabela } from "@/components/tabela";
import { Aviso, Botao, Campo, Cartao, Chip, Esqueleto, Selecao } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { data as formatarData } from "@/lib/formato";
import { lerSessao } from "@/lib/sessao";
import { ROTULO_PAPEL } from "@/lib/sessao-usuario";

type Fazenda = {
  nome: string;
  proprietario: string | null;
  endereco: string | null;
  plano: string;
  criado_em: string;
};

type Membro = {
  id: string;
  nome: string;
  email: string;
  papel: "tecnico" | "cliente" | "admin";
  ativo: boolean;
  admin_master: boolean;
};

const PAPEIS = ["tecnico", "cliente", "admin"] as const;

export default function Configuracoes() {
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [membros, setMembros] = useState<Membro[] | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const sessao = lerSessao();
  const [meuId, setMeuId] = useState<string | null>(null);

  const carregarMembros = useCallback(async () => {
    try {
      setMembros(
        await apiAuth<Membro[]>(`/membros?incluir_inativos=${incluirInativos}`),
      );
    } catch (e) {
      if (e instanceof ErroApi && e.status === 403) setSemPermissao(true);
      setMembros([]);
    }
  }, [incluirInativos]);

  useEffect(() => {
    apiAuth<Fazenda>("/fazendas/atual").then(setFazenda).catch(() => setFazenda(null));
    apiAuth<{ usuario: { id: string } }>("/auth/eu")
      .then((e) => setMeuId(e.usuario.id))
      .catch(() => setMeuId(null));
  }, []);

  useEffect(() => {
    void carregarMembros();
  }, [carregarMembros]);

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      await acao();
      setOk(mensagem);
      await carregarMembros();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir");
    } finally {
      setOcupado(false);
    }
  }

  async function convidar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campos = new FormData(evento.currentTarget);
    const formulario = evento.currentTarget;
    await executar(
      () =>
        apiAuth("/membros", {
          method: "POST",
          body: JSON.stringify({
            nome: String(campos.get("nome")),
            email: String(campos.get("email")),
            senha: String(campos.get("senha")),
            papel: String(campos.get("papel")),
          }),
        }),
      "Membro adicionado. Ele já pode entrar com esse e-mail e senha.",
    );
    formulario.reset();
    setConvidando(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-titulo text-2xl font-extrabold text-verde">Configurações</h1>
        <p className="text-sm text-verde/60">Dados da fazenda e quem tem acesso</p>
      </header>

      <Cartao>
        <h2 className="font-titulo font-extrabold text-verde">Fazenda</h2>
        {!fazenda ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Esqueleto className="h-3 w-20" />
                <Esqueleto className="mt-2 h-4 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            {(
              [
                ["Nome", fazenda.nome],
                ["Proprietário", fazenda.proprietario ?? "—"],
                ["Endereço", fazenda.endereco ?? "—"],
                ["Cadastrada em", formatarData(fazenda.criado_em.slice(0, 10))],
              ] as [string, string][]
            ).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-xs font-bold uppercase tracking-wider text-verde/45">
                  {rotulo}
                </dt>
                <dd className="text-sm text-verde">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </Cartao>

      <Cartao>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-titulo font-extrabold text-verde">Equipe e permissões</h2>
            <p className="text-xs text-verde/55">
              Técnico registra pesagem · Cliente só acompanha · Admin gerencia a equipe
            </p>
          </div>
          {!semPermissao && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-verde/60">
                <input
                  type="checkbox"
                  checked={incluirInativos}
                  onChange={(e) => setIncluirInativos(e.target.checked)}
                />
                mostrar removidos
              </label>
              <button
                onClick={() => setConvidando((v) => !v)}
                className="rounded-xl bg-lima px-4 py-2 font-titulo text-sm font-bold text-verde"
              >
                {convidando ? "Cancelar" : "Adicionar pessoa"}
              </button>
            </div>
          )}
        </div>

        {semPermissao ? (
          <Aviso>
            Só um administrador da fazenda vê e gerencia a equipe. Sua conta é de{" "}
            {ROTULO_PAPEL[sessao?.papel ?? ""]?.toLowerCase() ?? "cliente"}.
          </Aviso>
        ) : (
          <>
            {convidando && (
              <form
                onSubmit={convidar}
                className="mb-4 grid gap-3 rounded-xl bg-verde/4 p-4 sm:grid-cols-2"
              >
                <Campo rotulo="Nome" name="nome" required minLength={2} />
                <Campo rotulo="E-mail" name="email" type="email" required />
                <Campo
                  rotulo="Senha inicial"
                  name="senha"
                  type="password"
                  required
                  minLength={8}
                  dica="Mínimo de 8 caracteres. Se o e-mail já existir no sistema, a senha atual dessa pessoa é mantida."
                />
                <Selecao
                  rotulo="Papel"
                  name="papel"
                  opcoes={[
                    ["tecnico", "Técnico de campo"],
                    ["cliente", "Cliente"],
                    ["admin", "Administrador"],
                  ]}
                  defaultValue="tecnico"
                />
                <div className="sm:col-span-2">
                  <Botao type="submit" variante="destaque" carregando={ocupado}>
                    {ocupado ? "Adicionando…" : "Adicionar à fazenda"}
                  </Botao>
                </div>
              </form>
            )}

            {erro && <Aviso tom="erro">{erro}</Aviso>}
            {ok && <Aviso tom="sucesso">{ok}</Aviso>}

            {!membros ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Esqueleto key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : (
              <Tabela colunas={["Nome", "E-mail", "Papel", "Situação", "Ações"]}>
                {membros.map((m) => {
                  // Admin master não é rebaixado nem removido por admin de
                  // fazenda, e ninguém muda o próprio papel nem se remove — a
                  // fazenda ficaria sem quem gerencia. O servidor recusa os
                  // dois casos; a tela não chega a oferecer.
                  const intocavel = m.admin_master || m.id === meuId;
                  return (
                    <Linha key={m.id}>
                      <Celula principal>
                        {m.nome}
                        {m.admin_master && (
                          <span className="ml-2">
                            <Chip tom="lima">master</Chip>
                          </span>
                        )}
                      </Celula>
                      <Celula rotulo="E-mail" className="break-all text-verde/70">
                        {m.email}
                      </Celula>
                      <Celula rotulo="Papel">
                        {intocavel ? (
                          ROTULO_PAPEL[m.papel]
                        ) : (
                          <select
                            value={m.papel}
                            disabled={ocupado || !m.ativo}
                            onChange={(e) =>
                              executar(
                                () =>
                                  apiAuth(`/membros/${m.id}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ papel: e.target.value }),
                                  }),
                                `${m.nome} agora é ${ROTULO_PAPEL[e.target.value].toLowerCase()}.`,
                              )
                            }
                            className="rounded-lg border border-borda bg-white px-2 py-1.5 text-sm text-verde disabled:opacity-40"
                          >
                            {PAPEIS.map((p) => (
                              <option key={p} value={p}>
                                {ROTULO_PAPEL[p]}
                              </option>
                            ))}
                          </select>
                        )}
                      </Celula>
                      <Celula rotulo="Situação">
                        <Chip tom={m.ativo ? "lima" : "claro"}>
                          {m.ativo ? "Ativo" : "Removido"}
                        </Chip>
                      </Celula>
                      <Celula rotulo="Ações">
                        {intocavel ? (
                          <span className="text-xs text-verde/40">
                            {m.id === meuId ? "você" : "—"}
                          </span>
                        ) : m.ativo ? (
                          <button
                            disabled={ocupado}
                            onClick={() =>
                              executar(
                                () => apiAuth(`/membros/${m.id}`, { method: "DELETE" }),
                                `${m.nome} não tem mais acesso a esta fazenda. Nada foi apagado.`,
                              )
                            }
                            className="text-sm font-bold text-red-600 disabled:opacity-40"
                          >
                            Remover
                          </button>
                        ) : (
                          <button
                            disabled={ocupado}
                            onClick={() =>
                              executar(
                                () =>
                                  apiAuth(`/membros/${m.id}/reativar`, { method: "POST" }),
                                `${m.nome} voltou a ter acesso.`,
                              )
                            }
                            className="text-sm font-bold text-verde disabled:opacity-40"
                          >
                            Reativar
                          </button>
                        )}
                      </Celula>
                    </Linha>
                  );
                })}
              </Tabela>
            )}
          </>
        )}
      </Cartao>
    </div>
  );
}
