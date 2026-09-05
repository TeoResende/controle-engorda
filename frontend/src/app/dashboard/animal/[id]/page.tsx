"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { GraficoDeLinha, type Ponto } from "@/components/grafico";
import { Brinco } from "@/components/icones";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { Aviso, Cartao, Chip, Esqueleto, EsqueletoKpis, Kpi, Vazio } from "@/components/ui";
import { apiAuth } from "@/lib/api";
import {
  data as formatarData,
  gmd as formatarGmd,
  peso as formatarPeso,
  variacao as formatarVariacao,
} from "@/lib/formato";

type Pesagem = {
  data: string;
  peso_kg: string;
  variacao: string | null;
  tecnico_nome: string | null;
  observacao_texto: string | null;
  tem_audio: boolean;
};

type Detalhe = {
  brinco: string;
  nome: string | null;
  raca: string | null;
  porte: string | null;
  brinco_mae: string | null;
  data_nascimento: string | null;
  idade_meses: number | null;
  peso_nascimento: string | null;
  observacoes: string | null;
  lote: string | null;
  status: string;
  peso_atual: string | null;
  gmd: string | null;
  pesagens: Pesagem[];
};

/** Tela 7 — Detalhe do animal. */
export default function DetalheAnimal() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiAuth<Detalhe>(`/metricas/animal/${id}`)
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : "Não consegui carregar"));
  }, [id]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;

  if (!dados) {
    return (
      <div className="flex flex-col gap-5">
        <Esqueleto className="h-4 w-40" />
        <Esqueleto className="h-24 w-full rounded-2xl" />
        <EsqueletoKpis />
        <Esqueleto className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const pontos: Ponto[] = dados.pesagens.map((p) => ({
    rotulo: formatarData(p.data).slice(0, 5),
    valor: Number(p.peso_kg),
  }));

  const informacoes: [string, string][] = [
    ["Raça", dados.raca ?? "—"],
    ["Porte", dados.porte ?? "—"],
    ["Brinco da mãe", dados.brinco_mae ?? "—"],
    [
      "Data de nascimento",
      dados.data_nascimento
        ? `${formatarData(dados.data_nascimento)}${dados.idade_meses !== null ? ` · ${dados.idade_meses} meses` : ""}`
        : "—",
    ],
    ["Lote", dados.lote ?? "—"],
    [
      "Observações",
      dados.observacoes ?? "Nenhuma observação relevante registrada além do histórico de pesagens.",
    ],
  ];

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm text-verde/50">
        <Link href="/dashboard/animais" className="hover:text-verde">
          Animais
        </Link>
        <span> / Brinco {dados.brinco}</span>
      </nav>

      <Cartao className="flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-verde/8">
          <Brinco className="h-7 w-7 text-verde" />
        </span>
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">
            {dados.brinco}
            {dados.nome && <span className="font-bold"> · {dados.nome}</span>}
            <span className="ml-3 align-middle">
              <Chip tom={dados.status === "ativo" ? "lima" : "claro"}>
                {dados.status[0].toUpperCase() + dados.status.slice(1)}
              </Chip>
            </span>
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {dados.raca && <Chip>{dados.raca}</Chip>}
            {dados.porte && <Chip>Porte {dados.porte}</Chip>}
            {dados.lote && <Chip>{dados.lote}</Chip>}
          </div>
        </div>
      </Cartao>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Peso atual" valor={formatarPeso(dados.peso_atual)} unidade="kg" />
        <Kpi rotulo="GMD" valor={formatarGmd(dados.gmd)} unidade="kg/dia" />
        <Kpi rotulo="Idade" valor={dados.idade_meses ?? "—"} unidade="meses" />
        <Kpi
          rotulo="Peso ao nascer"
          valor={formatarPeso(dados.peso_nascimento)}
          unidade="kg"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">Evolução de peso</h2>
          <p className="text-xs text-verde/55">Histórico de pesagens, em kg</p>
          <div className="mt-4">
            <GraficoDeLinha pontos={pontos} />
          </div>
        </Cartao>

        <Cartao>
          <h2 className="font-titulo font-extrabold text-verde">Informações do animal</h2>
          <dl className="mt-3 flex flex-col gap-3">
            {informacoes.map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-xs font-bold uppercase tracking-wider text-verde/45">
                  {rotulo}
                </dt>
                <dd className="text-sm text-verde">{valor}</dd>
              </div>
            ))}
          </dl>
        </Cartao>
      </div>

      <Cartao>
        <h2 className="mb-2 font-titulo font-extrabold text-verde">Histórico de pesagens</h2>
        {dados.pesagens.length === 0 ? (
          <Vazio
            titulo="Este animal ainda não foi pesado"
            descricao="A primeira pesagem aparece aqui assim que o técnico registrar."
          />
        ) : (
          <Tabela colunas={["Data", "Peso", "Variação", "Técnico", "Observação"]}>
            {[...dados.pesagens].reverse().map((p, i) => (
              <Linha key={`${p.data}-${i}`}>
                <Celula principal>{formatarData(p.data)}</Celula>
                <Celula rotulo="Peso" className="tabular font-bold">
                  {formatarPeso(p.peso_kg)} kg
                </Celula>
                <Celula
                  rotulo="Variação"
                  className={`tabular font-bold ${
                    p.variacao === null
                      ? "text-verde/40"
                      : Number(p.variacao) >= 0
                        ? "text-emerald-700"
                        : "text-red-600"
                  }`}
                >
                  {formatarVariacao(p.variacao)}
                </Celula>
                <Celula rotulo="Técnico">{p.tecnico_nome ?? "—"}</Celula>
                <Celula rotulo="Observação" className="text-verde/80">
                  {p.tem_audio && <span className="mr-1 text-verde/45">🎙</span>}
                  {p.observacao_texto ?? "—"}
                </Celula>
              </Linha>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
