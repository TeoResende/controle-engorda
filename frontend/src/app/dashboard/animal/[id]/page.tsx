"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { GraficoDeLinha, type Ponto } from "@/components/grafico";
import { Kpi } from "@/components/kpi";
import { Aviso, Cabecalho } from "@/components/ui";
import { apiAuth } from "@/lib/api";

type Pesagem = {
  data: string;
  peso_kg: string;
  observacao_texto: string | null;
  tem_audio: boolean;
};

type Detalhe = {
  brinco: string;
  nome: string | null;
  raca: string | null;
  lote: string | null;
  status: string;
  peso_atual: string | null;
  peso_inicial: string | null;
  ganho_total: string | null;
  gmd: string | null;
  dias_acompanhado: number | null;
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
  if (!dados) return <p className="py-10 text-center text-sm text-verde/60">Carregando…</p>;

  const pontos: Ponto[] = dados.pesagens.map((p) => ({
    rotulo: new Date(`${p.data}T12:00:00`).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    }),
    valor: Number(p.peso_kg),
  }));

  const descricao = [dados.nome, dados.raca, dados.lote].filter(Boolean).join(" · ");

  return (
    <main className="flex flex-col gap-6">
      <Link href="/dashboard" className="text-sm text-verde/60 underline">
        ← Voltar
      </Link>

      <Cabecalho titulo={`Brinco ${dados.brinco}`} subtitulo={descricao || undefined} />

      <section className="grid grid-cols-2 gap-3">
        <Kpi rotulo="Peso atual" valor={dados.peso_atual} unidade="kg" destaque />
        <Kpi rotulo="Ganho médio diário" valor={dados.gmd} unidade="kg/dia" />
        <Kpi rotulo="Ganho total" valor={dados.ganho_total} unidade="kg" />
        <Kpi rotulo="Acompanhado há" valor={dados.dias_acompanhado} unidade="dias" />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-titulo text-sm font-bold uppercase tracking-wide text-verde/60">
          Evolução do peso
        </h2>
        <GraficoDeLinha pontos={pontos} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-titulo text-sm font-bold uppercase tracking-wide text-verde/60">
          Histórico
        </h2>
        {dados.pesagens.length === 0 ? (
          <Aviso>Este animal ainda não foi pesado.</Aviso>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...dados.pesagens].reverse().map((p, i) => (
              <li key={`${p.data}-${i}`} className="rounded-xl bg-white px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-verde/70">
                    {new Date(`${p.data}T12:00:00`).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="font-titulo font-bold text-verde">{p.peso_kg} kg</span>
                </div>
                {p.observacao_texto && (
                  <p className="mt-2 border-t border-verde/10 pt-2 text-sm text-verde/80">
                    {p.tem_audio && <span className="mr-1 text-verde/50">🎙</span>}
                    {p.observacao_texto}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
