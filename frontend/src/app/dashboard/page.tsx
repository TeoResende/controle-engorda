"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GraficoDeLinha, type Ponto } from "@/components/grafico";
import { Kpi } from "@/components/kpi";
import { Aviso, Cabecalho } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { limparSessao } from "@/lib/sessao";

type Alerta = {
  tipo: "gmd_baixo" | "sem_pesagem" | "perda_de_peso";
  animal_id: string;
  brinco: string;
  mensagem: string;
};

type VisaoGeral = {
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
};

const ROTULO_ALERTA: Record<Alerta["tipo"], string> = {
  perda_de_peso: "Perdendo peso",
  gmd_baixo: "Ganho baixo",
  sem_pesagem: "Sem pesagem",
};

/** Tela 6 — Visão geral. */
export default function Dashboard() {
  const router = useRouter();
  const [dados, setDados] = useState<VisaoGeral | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiAuth<VisaoGeral>("/metricas/visao-geral")
      .then(setDados)
      .catch((e) => {
        if (e instanceof ErroApi && e.status === 401) {
          limparSessao();
          router.replace("/dashboard/login");
          return;
        }
        setErro(e instanceof Error ? e.message : "Não consegui carregar os números");
      });
  }, [router]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!dados) return <p className="py-10 text-center text-sm text-verde/60">Carregando…</p>;

  const pontos: Ponto[] = dados.serie.map((p) => ({
    rotulo: new Date(`${p.data}T12:00:00`).toLocaleDateString("pt-BR", {
      month: "short",
    }),
    valor: Number(p.peso_medio),
  }));

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <Cabecalho
          titulo="Visão geral"
          subtitulo={
            dados.ultima_pesagem
              ? `Última pesagem em ${new Date(`${dados.ultima_pesagem}T12:00:00`).toLocaleDateString("pt-BR")}`
              : "Nenhuma pesagem registrada ainda"
          }
        />
        <button
          onClick={() => {
            limparSessao();
            router.replace("/dashboard/login");
          }}
          className="mt-1 text-sm text-verde/50 underline"
        >
          Sair
        </button>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <Kpi rotulo="Ganho médio diário" valor={dados.gmd_medio} unidade="kg/dia" destaque />
        <Kpi rotulo="Peso médio" valor={dados.peso_medio} unidade="kg" />
        <Kpi rotulo="Animais ativos" valor={dados.animais_ativos} />
        <Kpi rotulo="Ganho total" valor={dados.ganho_total_kg} unidade="kg" />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-titulo text-sm font-bold uppercase tracking-wide text-verde/60">
          Peso médio do rebanho
        </h2>
        <GraficoDeLinha pontos={pontos} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-titulo text-sm font-bold uppercase tracking-wide text-verde/60">
          Lotes
        </h2>
        {dados.lotes.length === 0 ? (
          <Aviso>Nenhum lote com animais ativos.</Aviso>
        ) : (
          <ul className="flex flex-col gap-2">
            {dados.lotes.map((l) => (
              <li
                key={l.lote_id ?? l.nome}
                className="flex items-center justify-between rounded-xl bg-white px-4 py-3"
              >
                <div>
                  <p className="font-titulo font-bold text-verde">{l.nome}</p>
                  <p className="text-xs text-verde/60">{l.animais} animais</p>
                </div>
                <div className="text-right">
                  <p className="font-titulo font-bold text-verde">{l.peso_medio ?? "—"} kg</p>
                  <p className="text-xs text-verde/60">GMD {l.gmd_medio ?? "—"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-titulo text-sm font-bold uppercase tracking-wide text-verde/60">
          Alertas {dados.alertas.length > 0 && `(${dados.alertas.length})`}
        </h2>
        {dados.alertas.length === 0 ? (
          <Aviso tom="sucesso">Nenhum animal fora do esperado.</Aviso>
        ) : (
          <ul className="flex flex-col gap-2">
            {dados.alertas.map((a, i) => (
              <li key={`${a.animal_id}-${a.tipo}-${i}`}>
                <Link
                  href={`/dashboard/animal/${a.animal_id}`}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                    a.tipo === "perda_de_peso" ? "bg-red-50" : "bg-white"
                  }`}
                >
                  <div>
                    <p className="font-titulo font-bold text-verde">Brinco {a.brinco}</p>
                    <p className="text-xs text-verde/70">{a.mensagem}</p>
                  </div>
                  <span className="ml-3 shrink-0 rounded-full bg-verde/10 px-2 py-1 text-[10px] font-bold uppercase text-verde">
                    {ROTULO_ALERTA[a.tipo]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
