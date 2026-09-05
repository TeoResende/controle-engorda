"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BotaoExportar } from "@/components/exportar";
import { Lupa } from "@/components/icones";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { Aviso, Botao, Campo, Cartao, Chip, Esqueleto, Kpi, Vazio } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { data as formatarData, peso as formatarPeso } from "@/lib/formato";
import { lerSessao } from "@/lib/sessao";

type Lote = {
  id: string;
  nome: string;
  data_formacao: string | null;
  desativado_em: string | null;
};

type Animal = {
  id: string;
  brinco: string;
  nome: string | null;
  raca: string | null;
  lote_id: string | null;
  ultimo_peso: string | null;
  ultima_pesagem: string | null;
};

/**
 * Formação do lote.
 *
 * A tela de cima cria o registro; é aqui que o lote vira um grupo de verdade.
 * Os animais entram e saem em bloco — mover de um em um seria inviável num
 * curral de cem cabeças.
 */
export default function DetalheLote() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [lote, setLote] = useState<Lote | null>(null);
  const [noLote, setNoLote] = useState<Animal[] | null>(null);
  const [disponiveis, setDisponiveis] = useState<Animal[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const sessao = lerSessao();
  const podeEditar = sessao?.papel !== "cliente" || sessao?.admin_master;

  const carregar = useCallback(async () => {
    const [oLote, dentro, todos] = await Promise.all([
      apiAuth<Lote>(`/lotes/${id}`),
      apiAuth<{ itens: Animal[] }>(`/animais?lote_id=${id}&limite=200`),
      apiAuth<{ itens: Animal[] }>("/animais?limite=200"),
    ]);
    setLote(oLote);
    setNoLote(dentro.itens);
    // Candidatos: quem não está neste lote. Inclui animais de outros lotes —
    // remanejar entre lotes é rotina, não exceção.
    setDisponiveis(todos.itens.filter((a) => a.lote_id !== id));
  }, [id]);

  useEffect(() => {
    carregar().catch((e) =>
      setErro(e instanceof ErroApi ? e.message : "Não consegui carregar o lote"),
    );
  }, [carregar]);

  const candidatos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return disponiveis;
    return disponiveis.filter(
      (a) =>
        a.brinco.toLowerCase().includes(termo) || (a.nome ?? "").toLowerCase().includes(termo),
    );
  }, [disponiveis, busca]);

  function alternar(animalId: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(animalId)) novo.delete(animalId);
      else novo.add(animalId);
      return novo;
    });
  }

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      await acao();
      setAviso(mensagem);
      setSelecionados(new Set());
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível concluir");
    } finally {
      setOcupado(false);
    }
  }

  const adicionar = () =>
    executar(
      () =>
        apiAuth(`/lotes/${id}/animais`, {
          method: "POST",
          body: JSON.stringify({ animal_ids: [...selecionados] }),
        }),
      `${selecionados.size} animal(is) entraram no lote.`,
    );

  const remover = (ids: string[]) =>
    executar(
      () =>
        apiAuth(`/lotes/${id}/animais`, {
          method: "DELETE",
          body: JSON.stringify({ animal_ids: ids }),
        }),
      `${ids.length} animal(is) saíram do lote. Nada foi apagado — eles ficam sem lote.`,
    );

  async function salvarDados(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campos = new FormData(evento.currentTarget);
    await executar(
      () =>
        apiAuth(`/lotes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            nome: String(campos.get("nome")),
            data_formacao: String(campos.get("data_formacao") || "") || null,
          }),
        }),
      "Dados do lote atualizados.",
    );
    setEditando(false);
  }

  if (erro && !lote) return <Aviso tom="erro">{erro}</Aviso>;

  if (!lote || !noLote) {
    return (
      <div className="flex flex-col gap-5">
        <Esqueleto className="h-4 w-40" />
        <Esqueleto className="h-20 w-full rounded-2xl" />
        <Esqueleto className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm text-verde/50">
        <Link href="/dashboard/lotes" className="hover:text-verde">
          Lotes
        </Link>
        <span> / {lote.nome}</span>
      </nav>

      <Cartao>
        {editando ? (
          <form onSubmit={salvarDados} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Campo rotulo="Nome do lote" name="nome" defaultValue={lote.nome} required />
            <Campo
              rotulo="Data de formação"
              name="data_formacao"
              type="date"
              defaultValue={lote.data_formacao ?? ""}
            />
            <div className="flex gap-2">
              <Botao type="submit" variante="destaque" carregando={ocupado}>
                Salvar
              </Botao>
              <Botao type="button" variante="neutra" onClick={() => setEditando(false)}>
                Cancelar
              </Botao>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-titulo text-2xl font-extrabold text-verde">
                {lote.nome}
                {lote.desativado_em && (
                  <span className="ml-3 align-middle">
                    <Chip tom="claro">Desativado</Chip>
                  </span>
                )}
              </h1>
              <p className="mt-0.5 text-sm text-verde/60">
                Formado em {formatarData(lote.data_formacao)}
              </p>
            </div>
            {podeEditar && (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditando(true)}
                  className="rounded-xl border border-borda px-4 py-2.5 font-titulo text-sm font-bold text-verde"
                >
                  Editar
                </button>
                {lote.desativado_em ? (
                  <button
                    onClick={() =>
                      executar(
                        () => apiAuth(`/lotes/${id}/reativar`, { method: "POST" }),
                        "Lote reativado.",
                      )
                    }
                    className="rounded-xl border border-borda px-4 py-2.5 font-titulo text-sm font-bold text-verde"
                  >
                    Reativar
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      executar(async () => {
                        await apiAuth(`/lotes/${id}`, { method: "DELETE" });
                        router.push("/dashboard/lotes");
                      }, "Lote desativado.")
                    }
                    className="rounded-xl border border-red-200 px-4 py-2.5 font-titulo text-sm font-bold text-red-700"
                  >
                    Desativar
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Cartao>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {aviso && <Aviso tom="sucesso">{aviso}</Aviso>}

      <section className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Animais no lote" valor={noLote.length} />
        <Kpi
          rotulo="Peso médio"
          valor={
            noLote.filter((a) => a.ultimo_peso).length
              ? formatarPeso(
                  noLote.reduce((s, a) => s + Number(a.ultimo_peso ?? 0), 0) /
                    noLote.filter((a) => a.ultimo_peso).length,
                )
              : null
          }
          unidade="kg"
        />
        <Kpi rotulo="Sem pesagem" valor={noLote.filter((a) => !a.ultimo_peso).length} />
      </section>

      {podeEditar && (
        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">Adicionar animais</h2>
          <p className="mt-0.5 text-sm text-verde/60">
            Marque quem entra e confirme de uma vez. Animal que já está em outro
            lote é remanejado — não some de lugar nenhum.
          </p>

          <div className="relative mt-4">
            <Lupa className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-verde/40" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por brinco ou nome…"
              className="w-full rounded-xl border border-borda bg-white py-2.5 pl-9 pr-3 text-sm text-verde outline-none focus:border-verde placeholder:text-verde/35"
            />
          </div>

          {candidatos.length === 0 ? (
            <p className="mt-4 rounded-xl bg-verde/4 px-4 py-6 text-center text-sm text-verde/55">
              {busca ? "Nenhum animal com esse termo." : "Todos os animais já estão neste lote."}
            </p>
          ) : (
            <ul className="mt-3 grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {candidatos.map((a) => (
                <li key={a.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                      selecionados.has(a.id)
                        ? "border-verde bg-lima/15"
                        : "border-borda bg-white hover:border-verde/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selecionados.has(a.id)}
                      onChange={() => alternar(a.id)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-titulo text-sm font-bold text-verde">
                        {a.brinco}
                        {a.nome && <span className="ml-1.5 font-normal">{a.nome}</span>}
                      </span>
                      <span className="block truncate text-xs text-verde/55">
                        {a.lote_id ? "em outro lote" : "sem lote"}
                        {a.ultimo_peso ? ` · ${formatarPeso(a.ultimo_peso)} kg` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {selecionados.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Botao variante="destaque" onClick={adicionar} carregando={ocupado}>
                Adicionar {selecionados.size} ao lote
              </Botao>
              <button
                onClick={() => setSelecionados(new Set())}
                className="text-sm font-bold text-verde/60"
              >
                Limpar seleção
              </button>
            </div>
          )}
        </Cartao>
      )}

      <Cartao>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-titulo font-extrabold text-verde">
            Animais no lote {noLote.length > 0 && `(${noLote.length})`}
          </h2>
          {noLote.length > 0 && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <BotaoExportar caminho={`/exportar/animais.csv?lote_id=${id}`} rotulo="Rebanho" />
              <BotaoExportar
                caminho={`/exportar/pesagens.csv?lote_id=${id}`}
                rotulo="Pesagens"
              />
            </div>
          )}
        </div>

        {noLote.length === 0 ? (
          <Vazio
            titulo="Lote vazio"
            descricao="Use o quadro acima para escolher os animais que formam este lote."
          />
        ) : (
          <Tabela colunas={["Brinco", "Nome", "Raça", "Último peso", ""]}>
            {noLote.map((a) => (
              <Linha key={a.id}>
                <Celula principal>
                  <Link href={`/dashboard/animal/${a.id}`} className="hover:underline">
                    {a.brinco}
                  </Link>
                </Celula>
                <Celula rotulo="Nome">{a.nome ?? "—"}</Celula>
                <Celula rotulo="Raça">{a.raca ?? "—"}</Celula>
                <Celula rotulo="Último peso" className="tabular">
                  {a.ultimo_peso
                    ? `${formatarPeso(a.ultimo_peso)} kg · ${formatarData(a.ultima_pesagem)}`
                    : "—"}
                </Celula>
                <Celula className="md:text-right">
                  {podeEditar && (
                    <button
                      onClick={() => remover([a.id])}
                      disabled={ocupado}
                      className="text-sm font-bold text-red-600 disabled:opacity-40"
                    >
                      Tirar do lote
                    </button>
                  )}
                </Celula>
              </Linha>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
