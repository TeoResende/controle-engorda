"use client";

import { useCallback, useEffect, useState } from "react";

import { GraficoDeLinha, type Ponto } from "@/components/grafico";
import { CORES_SERIE, GraficoCurvas, type Serie } from "@/components/grafico-curvas";
import { Aviso } from "@/components/ui";
import { apiAuth } from "@/lib/api";
import { mesCurto } from "@/lib/formato";

type PontoData = { data: string; peso_medio: string; animais: number };
type Lote = { id: string; nome: string };
type CurvaAlinhada = {
  eixo: string;
  linhas: { rotulo: string; animal_id: string | null; pontos: { dia: number; peso_kg: string }[] }[];
  sem_nascimento: number;
};

type Aba = "data" | "idade";
type Eixo = "dof" | "idade";

/**
 * O gráfico da visão geral, em abas.
 *
 * - **Por data:** a curva no calendário, com filtro de período. Só o gráfico é
 *   recortado — os KPIs são o agora e não mudam com o filtro.
 * - **Por idade / acompanhamento:** o eixo x vira dias. "Dias de acompanhamento"
 *   (padrão) alinha todo animal no dia 0 da própria entrada, então a janela de
 *   engorda fica comparável entre bichos que entraram em datas diferentes.
 *   "Dias de vida" usa a data de nascimento e avisa quem não tem.
 *
 * A curva inicial (calendário sem recorte) vem pronta na visão geral, para o
 * card não piscar vazio; os recortes e o modo alinhado são buscados sob demanda.
 */
export function CurvaDashboard({ serieInicial }: { serieInicial: PontoData[] }) {
  const [aba, setAba] = useState<Aba>("data");

  // --- Por data ---
  const [desde, setDesde] = useState("");
  const [ate, setAte] = useState("");
  const [serie, setSerie] = useState<PontoData[]>(serieInicial);

  const buscarPeriodo = useCallback(async () => {
    const q = new URLSearchParams();
    if (desde) q.set("desde", desde);
    if (ate) q.set("ate", ate);
    const r = await apiAuth<PontoData[]>(`/metricas/curva-periodo?${q}`);
    setSerie(r);
  }, [desde, ate]);

  useEffect(() => {
    if (aba === "data" && (desde || ate)) void buscarPeriodo();
    if (aba === "data" && !desde && !ate) setSerie(serieInicial);
  }, [aba, desde, ate, buscarPeriodo, serieInicial]);

  // --- Por idade ---
  const [eixo, setEixo] = useState<Eixo>("dof");
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [escopo, setEscopo] = useState<string>("media"); // "media" | lote_id
  const [curva, setCurva] = useState<CurvaAlinhada | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (aba === "idade" && lotes.length === 0) {
      apiAuth<Lote[]>("/lotes").then(setLotes).catch(() => setLotes([]));
    }
  }, [aba, lotes.length]);

  const buscarAlinhada = useCallback(async () => {
    setCarregando(true);
    try {
      const q = new URLSearchParams({ eixo });
      if (escopo === "media") q.set("agregar", "true");
      else q.set("lote_id", escopo);
      setCurva(await apiAuth<CurvaAlinhada>(`/metricas/curva-alinhada?${q}`));
    } finally {
      setCarregando(false);
    }
  }, [eixo, escopo]);

  useEffect(() => {
    if (aba === "idade") void buscarAlinhada();
  }, [aba, buscarAlinhada]);

  const pontos: Ponto[] = serie.map((p) => ({ rotulo: mesCurto(p.data), valor: Number(p.peso_medio), data: p.data }));
  const series: Serie[] = (curva?.linhas ?? []).map((l, i) => ({
    rotulo: l.rotulo,
    cor: escopo === "media" ? CORES_SERIE[0] : CORES_SERIE[i % CORES_SERIE.length],
    grossa: escopo === "media",
    pontos: l.pontos.map((p) => ({ x: p.dia, y: Number(p.peso_kg) })),
  }));

  return (
    <>
      <div role="tablist" className="mb-3 flex gap-1 border-b border-borda print:hidden">
        {(["data", "idade"] as Aba[]).map((v) => (
          <button
            key={v}
            role="tab"
            onClick={() => setAba(v)}
            aria-selected={aba === v}
            className={`-mb-px rounded-t-lg px-3 py-2 text-sm font-bold transition ${
              aba === v ? "border-b-2 border-lima bg-fundo text-verde" : "text-verde/50"
            }`}
          >
            {v === "data" ? "Por data" : "Por idade"}
          </button>
        ))}
      </div>

      {aba === "data" ? (
        <>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-titulo font-extrabold text-verde">Evolução de peso</h2>
              <p className="text-xs text-verde/55">Média do rebanho, em kg</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-verde/60 print:hidden">
              <label className="flex items-center gap-1">
                de
                <input type="date" value={desde} max={ate || undefined} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-borda bg-white px-2 py-1 text-verde" />
              </label>
              <label className="flex items-center gap-1">
                até
                <input type="date" value={ate} min={desde || undefined} onChange={(e) => setAte(e.target.value)} className="rounded-lg border border-borda bg-white px-2 py-1 text-verde" />
              </label>
              {(desde || ate) && (
                <button onClick={() => { setDesde(""); setAte(""); }} className="font-bold text-verde/60 underline">
                  limpar
                </button>
              )}
            </div>
          </div>
          <GraficoDeLinha pontos={pontos} />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-titulo font-extrabold text-verde">Evolução alinhada</h2>
              <p className="text-xs text-verde/55">
                {eixo === "dof" ? "Dia 0 = primeira pesagem de cada animal" : "Eixo = dias de vida"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="inline-flex overflow-hidden rounded-lg border border-borda text-xs font-bold">
                {(["dof", "idade"] as Eixo[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setEixo(v)}
                    className={`px-3 py-1.5 ${eixo === v ? "bg-verde text-fundo" : "text-verde/60"}`}
                  >
                    {v === "dof" ? "Acompanhamento" : "Dias de vida"}
                  </button>
                ))}
              </div>
              <select
                value={escopo}
                onChange={(e) => setEscopo(e.target.value)}
                className="rounded-lg border border-borda bg-white px-2 py-1.5 text-xs font-bold text-verde"
              >
                <option value="media">Todos (média)</option>
                {lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} (animais)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {eixo === "idade" && curva && curva.sem_nascimento > 0 && (
            <div className="mb-3">
              <Aviso tom="atencao">
                {curva.sem_nascimento} animal{curva.sem_nascimento > 1 ? "is" : ""} sem data de
                nascimento ficaram de fora. Preencha a data no cadastro para incluí-los.
              </Aviso>
            </div>
          )}

          {carregando && !curva ? (
            <p className="px-4 py-10 text-center text-sm text-verde/50">Carregando…</p>
          ) : (
            <GraficoCurvas series={series} passoX={eixo === "dof" ? 15 : 30} />
          )}
        </>
      )}
    </>
  );
}
