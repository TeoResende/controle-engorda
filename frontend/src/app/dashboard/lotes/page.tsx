"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Seta } from "@/components/icones";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { Aviso, Botao, Campo, Cartao, Chip, Esqueleto, Kpi, Vazio } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import {
  data as formatarData,
  gmd as formatarGmd,
  hojeLocal,
  peso as formatarPeso,
} from "@/lib/formato";
import { lerSessao } from "@/lib/sessao";

type LoteMetrica = {
  lote_id: string | null;
  nome: string;
  animais: number;
  peso_medio: string | null;
  gmd_medio: string | null;
};

type LoteCadastro = {
  id: string;
  nome: string;
  data_formacao: string | null;
  animais_ativos: number;
  desativado_em: string | null;
};

/** Abaixo disto o lote entra em atenção — mesmo limite do alerta por animal. */
const GMD_META = 0.5;

export default function Lotes() {
  const [metricas, setMetricas] = useState<Map<string, LoteMetrica> | null>(null);
  const [lotes, setLotes] = useState<LoteCadastro[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [incluirInativos, setIncluirInativos] = useState(false);

  const sessao = lerSessao();
  // Cliente é somente leitura: o servidor recusaria, e a tela não oferece.
  const podeEditar = sessao?.papel !== "cliente" || sessao?.admin_master;

  const carregar = useCallback(async () => {
    const [cadastro, visao] = await Promise.all([
      apiAuth<LoteCadastro[]>(`/lotes?incluir_inativos=${incluirInativos}`).catch(() => []),
      apiAuth<{ lotes: LoteMetrica[] }>("/metricas/visao-geral?meses=1").catch(() => ({
        lotes: [] as LoteMetrica[],
      })),
    ]);
    setLotes(cadastro);
    setMetricas(new Map(visao.lotes.map((l) => [l.nome, l])));
  }, [incluirInativos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      await carregar();
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
    await executar(() =>
      apiAuth("/lotes", {
        method: "POST",
        body: JSON.stringify({
          nome: String(campos.get("nome")),
          data_formacao: String(campos.get("data_formacao") || "") || null,
        }),
      }),
    );
    formulario.reset();
    setCriando(false);
  }

  const ativos = (lotes ?? []).filter((l) => !l.desativado_em);
  const totalAnimais = ativos.reduce((soma, l) => soma + l.animais_ativos, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">Lotes</h1>
          <p className="text-sm text-verde/60">
            Agrupam os animais por curral ou pasto para acompanhar o desempenho
          </p>
        </div>
        {podeEditar && (
          <button
            onClick={() => setCriando((v) => !v)}
            className="rounded-xl bg-lima px-4 py-2.5 font-titulo text-sm font-bold text-verde transition hover:brightness-95"
          >
            {criando ? "Cancelar" : "Formar lote"}
          </button>
        )}
      </header>

      {criando && (
        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">Formar novo lote</h2>
          <p className="mt-0.5 text-sm text-verde/60">
            Crie o lote agora e escolha os animais em seguida.
          </p>
          <form onSubmit={criar} className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Campo rotulo="Nome do lote" name="nome" required placeholder="Ex: Lote 04 — Curral B" />
            <Campo
              rotulo="Data de formação"
              name="data_formacao"
              type="date"
              defaultValue={hojeLocal()}
              max={hojeLocal()}
            />
            <Botao type="submit" variante="destaque" carregando={ocupado}>
              Criar lote
            </Botao>
          </form>
        </Cartao>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <section className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Lotes ativos" valor={lotes ? ativos.length : null} />
        <Kpi rotulo="Animais em lote" valor={lotes ? totalAnimais : null} />
        <Kpi
          rotulo="Lotes em atenção"
          valor={
            metricas
              ? ativos.filter((l) => {
                  const m = metricas.get(l.nome);
                  return m?.gmd_medio !== null && Number(m?.gmd_medio) < GMD_META;
                }).length
              : null
          }
          tom="alerta"
        />
      </section>

      <Cartao>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-titulo font-extrabold text-verde">Todos os lotes</h2>
          <label className="flex items-center gap-2 text-xs text-verde/60">
            <input
              type="checkbox"
              checked={incluirInativos}
              onChange={(e) => setIncluirInativos(e.target.checked)}
            />
            mostrar desativados
          </label>
        </div>

        {!lotes ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Esqueleto key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : lotes.length === 0 ? (
          <Vazio
            titulo="Nenhum lote ainda"
            descricao="Formar um lote é agrupar animais por curral ou pasto. Depois disso o dashboard passa a comparar o desempenho entre eles."
            acao={
              podeEditar && (
                <button
                  onClick={() => setCriando(true)}
                  className="rounded-xl bg-lima px-4 py-2.5 font-titulo text-sm font-bold text-verde"
                >
                  Formar o primeiro lote
                </button>
              )
            }
          />
        ) : (
          <Tabela colunas={["Lote", "Formado em", "Animais", "Peso médio", "GMD", "Status", ""]}>
            {lotes.map((l) => {
              const m = metricas?.get(l.nome);
              const atencao = m?.gmd_medio != null && Number(m.gmd_medio) < GMD_META;
              return (
                <Linha key={l.id}>
                  <Celula principal>{l.nome}</Celula>
                  <Celula rotulo="Formado em">{formatarData(l.data_formacao)}</Celula>
                  <Celula rotulo="Animais">{l.animais_ativos}</Celula>
                  <Celula rotulo="Peso médio" className="tabular">
                    {m?.peso_medio == null ? "—" : `${formatarPeso(m.peso_medio)} kg`}
                  </Celula>
                  <Celula rotulo="GMD" className="tabular">
                    {m?.gmd_medio == null ? "—" : `${formatarGmd(m.gmd_medio)} kg/dia`}
                  </Celula>
                  <Celula rotulo="Status">
                    {l.desativado_em ? (
                      <Chip tom="claro">Desativado</Chip>
                    ) : (
                      <Chip tom={atencao ? "atencao" : "lima"}>
                        {atencao ? "Atenção" : "No prazo"}
                      </Chip>
                    )}
                  </Celula>
                  <Celula className="md:text-right">
                    <Link
                      href={`/dashboard/lotes/${l.id}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-verde"
                    >
                      Abrir
                      <Seta className="h-4 w-4" />
                    </Link>
                  </Celula>
                </Linha>
              );
            })}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
