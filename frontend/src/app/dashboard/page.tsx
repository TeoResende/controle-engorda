"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GraficoDeLinha, type Ponto } from "@/components/grafico";
import { BotaoExportar, BotaoImprimir } from "@/components/exportar";
import { CabecalhoImpressao } from "@/components/impressao";
import { Lupa, Seta } from "@/components/icones";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { Aviso, Cartao, Chip, Esqueleto, EsqueletoKpis, Kpi, Vazio } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { gmd as formatarGmd, mesCurto, peso as formatarPeso } from "@/lib/formato";

type Alerta = {
  tipo: "gmd_baixo" | "sem_pesagem" | "perda_de_peso";
  animal_id: string;
  brinco: string;
  mensagem: string;
  valor: string | null;
};

type VisaoGeral = {
  gmd_meta: string;
  dias_sem_pesagem: number;
  animais_ativos: number;
  animais_pesados: number;
  peso_medio: string | null;
  gmd_medio: string | null;
  ganho_total_kg: string | null;
  ultima_pesagem: string | null;
  serie: { data: string; peso_medio: string; animais: number }[];
  lotes: {
    lote_id: string | null;
    nome: string;
    animais: number;
    peso_medio: string | null;
    gmd_medio: string | null;
  }[];
  alertas: Alerta[];
  alertas_total: number;
};

/* A meta vem da fazenda: chutar 0,5 aqui faria o dashboard mostrar "no prazo"
   para um lote que o alerta do servidor já considera problema. */

/** Tela 6 — Visão geral. */
export default function Dashboard() {
  const router = useRouter();
  const [dados, setDados] = useState<VisaoGeral | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    apiAuth<VisaoGeral>("/metricas/visao-geral?meses=3")
      .then(setDados)
      .catch((e) => {
        if (e instanceof ErroApi && e.status === 401) {
          // **Não apaga as outras fazendas.** Isto chamava `limparSessao()`,
          // que zera o aparelho inteiro: quem atende duas fazendas perdia as
          // duas — e, no aparelho do técnico, junto com elas os tokens com que
          // a fila pendente ainda ia subir. O descarte da credencial recusada
          // já aconteceu dentro de `apiAuth`, e só para a fazenda dela.
          router.replace("/dashboard/login");
          return;
        }
        setErro(e instanceof Error ? e.message : "Não consegui carregar os números");
      });
  }, [router]);

  function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    const termo = busca.trim();
    if (termo) router.push(`/dashboard/animais?brinco=${encodeURIComponent(termo)}`);
  }

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;

  if (!dados) {
    return (
      <div className="flex flex-col gap-5">
        <Esqueleto className="h-8 w-48" />
        <EsqueletoKpis />
        <Esqueleto className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const pontos: Ponto[] = dados.serie.map((p) => ({
    rotulo: mesCurto(p.data),
    valor: Number(p.peso_medio),
  }));
  const abaixoDaMeta = dados.alertas.filter((a) => a.tipo !== "sem_pesagem");

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoImpressao
        titulo="Visão geral do rebanho"
        recorte={`${dados.animais_ativos} animais ativos`}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">Visão geral</h1>
          <p className="text-sm text-verde/60">
            Acompanhamento da evolução de peso do rebanho
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <BotaoExportar caminho="/exportar/pesagens.csv" rotulo="Exportar pesagens" />
          <BotaoImprimir />
        </div>

        <form onSubmit={buscar} className="relative w-full max-w-xs print:hidden">
          <Lupa className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-verde/40" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar animal por brinco…"
            className="w-full rounded-xl border border-borda bg-white py-2.5 pl-9 pr-3 text-sm text-verde outline-none focus:border-verde placeholder:text-verde/35"
          />
        </form>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Total de animais" valor={dados.animais_ativos} />
        <Kpi
          rotulo="GMD médio do rebanho"
          valor={formatarGmd(dados.gmd_medio)}
          unidade="kg/dia"
        />
        <Kpi rotulo="Peso médio atual" valor={formatarPeso(dados.peso_medio)} unidade="kg" />
        <Kpi
          rotulo="Abaixo da meta"
          // O total, não o que coube na resposta: a lista vem limitada aos mais
          // graves, e mostrar 50 num rebanho com 1.240 problemas mentiria.
          valor={dados.alertas_total}
          unidade="animais"
          tom="alerta"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">
            Evolução de peso — últimos 90 dias
          </h2>
          <p className="text-xs text-verde/55">Média do rebanho, em kg</p>
          <div className="mt-4">
            <GraficoDeLinha pontos={pontos} />
          </div>
        </Cartao>

        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">Animais abaixo da meta</h2>
          {dados.alertas_total > abaixoDaMeta.length && (
            <p className="text-xs text-verde/55">
              Mostrando os {Math.min(8, abaixoDaMeta.length)} mais graves de{" "}
              {dados.alertas_total}.
            </p>
          )}
          {abaixoDaMeta.length === 0 ? (
            <p className="mt-3 rounded-xl bg-lima/15 px-4 py-6 text-center text-sm text-verde/70">
              Nenhum animal fora do esperado.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {abaixoDaMeta.slice(0, 8).map((a, i) => (
                <li key={`${a.animal_id}-${i}`}>
                  <Link
                    href={`/dashboard/animal/${a.animal_id}`}
                    className="block rounded-lg border-l-[3px] border-red-500 bg-red-50/60 px-3 py-2.5"
                  >
                    <p className="font-titulo text-sm font-bold text-verde">
                      {a.brinco}
                      {a.tipo === "perda_de_peso" && " · perdendo peso"}
                    </p>
                    <p className="text-xs text-verde/60">{a.mensagem}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      <Cartao>
        <h2 className="mb-2 font-titulo font-extrabold text-verde">Lotes ativos</h2>
        {dados.lotes.length === 0 ? (
          <Vazio
            titulo="Nenhum lote com animais ativos"
            descricao="Crie lotes para acompanhar o desempenho por grupo."
          />
        ) : (
          <Tabela colunas={["Lote", "Animais", "GMD", "Status", ""]}>
            {dados.lotes.map((l) => {
              const atencao = l.gmd_medio !== null && Number(l.gmd_medio) < Number(dados.gmd_meta);
              return (
                <Linha key={l.lote_id ?? l.nome}>
                  <Celula principal>{l.nome}</Celula>
                  <Celula rotulo="Animais">{l.animais}</Celula>
                  <Celula rotulo="GMD" className="tabular">
                    {l.gmd_medio === null ? "—" : `${formatarGmd(l.gmd_medio)} kg/dia`}
                  </Celula>
                  <Celula rotulo="Status">
                    <Chip tom={atencao ? "atencao" : "lima"}>
                      {atencao ? "Atenção" : "No prazo"}
                    </Chip>
                  </Celula>
                  <Celula className="md:text-right">
                    <Link
                      href={`/dashboard/animais?lote=${l.lote_id ?? ""}`}
                      aria-label={`Ver animais do ${l.nome}`}
                    >
                      <Seta className="ml-auto h-4 w-4 text-verde/30 transition hover:text-verde" />
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
