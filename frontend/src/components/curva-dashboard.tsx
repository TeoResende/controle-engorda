"use client";

import { useCallback, useEffect, useState } from "react";

import { GraficoDeLinha, type Ponto } from "@/components/grafico";
import { CORES_SERIE, GraficoCurvas, type Serie } from "@/components/grafico-curvas";
import { Aviso } from "@/components/ui";
import { ModalSelecaoAnimais } from "@/components/modal-selecao-animais";
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
  const [escopo, setEscopo] = useState<string>("media"); // "media" | "selecao" | lote_id
  const [curva, setCurva] = useState<CurvaAlinhada | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Seleção de animais específicos (escopo "selecao").
  const [selecionados, setSelecionados] = useState<{ id: string; brinco: string }[]>([]);
  const [buscaAnimal, setBuscaAnimal] = useState("");
  const [resultados, setResultados] = useState<{ id: string; brinco: string }[]>([]);
  const [modalAberta, setModalAberta] = useState(false);
  const TETO_SELECAO = 8;

  // Marca/desmarca um animal na seleção, respeitando o teto.
  const alternarAnimal = (a: { id: string; brinco: string }) =>
    setSelecionados((atual) =>
      atual.some((x) => x.id === a.id)
        ? atual.filter((x) => x.id !== a.id)
        : atual.length >= TETO_SELECAO
          ? atual
          : [...atual, a],
    );

  useEffect(() => {
    if (aba === "idade" && lotes.length === 0) {
      apiAuth<Lote[]>("/lotes").then(setLotes).catch(() => setLotes([]));
    }
  }, [aba, lotes.length]);

  useEffect(() => {
    const termo = buscaAnimal.trim();
    if (escopo !== "selecao" || termo === "") {
      setResultados([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      apiAuth<{ itens: { id: string; brinco: string }[] }>(
        `/animais?status_animal=ativo&brinco=${encodeURIComponent(termo)}&limite=15`,
      )
        .then((r) => vivo && setResultados(r.itens))
        .catch(() => vivo && setResultados([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [buscaAnimal, escopo]);

  const buscarAlinhada = useCallback(async () => {
    // Sem nada escolhido, não há o que buscar — a tela pede a seleção.
    if (escopo === "selecao" && selecionados.length === 0) {
      setCurva({ eixo, linhas: [], sem_nascimento: 0 });
      return;
    }
    setCarregando(true);
    try {
      const q = new URLSearchParams({ eixo });
      if (escopo === "media") q.set("agregar", "true");
      else if (escopo === "selecao") q.set("animais", selecionados.map((a) => a.id).join(","));
      else q.set("lote_id", escopo);
      setCurva(await apiAuth<CurvaAlinhada>(`/metricas/curva-alinhada?${q}`));
    } finally {
      setCarregando(false);
    }
  }, [eixo, escopo, selecionados]);

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
                <option value="selecao">Escolher animais…</option>
                {lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} (animais)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {escopo === "selecao" && (
            <div className="mb-3 rounded-xl border border-borda bg-fundo/60 p-3 print:hidden">
              <div className="flex flex-wrap items-center gap-2">
                {selecionados.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelecionados((s) => s.filter((x) => x.id !== a.id))}
                    className="inline-flex items-center gap-1 rounded-full border border-verde bg-lima/20 px-2.5 py-1 text-xs font-bold text-verde"
                  >
                    {a.brinco} <span aria-hidden>×</span>
                  </button>
                ))}
                <div className="relative">
                  <input
                    value={buscaAnimal}
                    onChange={(e) => setBuscaAnimal(e.target.value)}
                    placeholder={selecionados.length ? "adicionar brinco…" : "buscar brinco…"}
                    disabled={selecionados.length >= TETO_SELECAO}
                    className="w-36 rounded-lg border border-borda bg-white px-2 py-1 text-xs text-verde outline-none focus:border-verde disabled:opacity-40"
                  />
                  {resultados.length > 0 && buscaAnimal.trim() !== "" && (
                    <ul className="absolute z-10 mt-1 max-h-44 w-40 overflow-auto rounded-lg border border-borda bg-white py-1 shadow">
                      {resultados
                        .filter((r) => !selecionados.some((s) => s.id === r.id))
                        .map((r) => (
                          <li key={r.id}>
                            <button
                              onClick={() => {
                                alternarAnimal(r);
                                setBuscaAnimal("");
                                setResultados([]);
                              }}
                              className="block w-full px-3 py-1.5 text-left text-xs text-verde hover:bg-verde/5"
                            >
                              {r.brinco}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setModalAberta(true)}
                  className="rounded-lg border border-verde px-3 py-1 text-xs font-bold text-verde"
                >
                  Ver lista
                </button>
              </div>
              <p className="mt-2 text-[11px] text-verde/50">
                {selecionados.length === 0
                  ? "Busque o brinco, ou toque em “Ver lista” para escolher da lista."
                  : `${selecionados.length}/${TETO_SELECAO} escolhidos — clique num brinco para tirar.`}
              </p>
            </div>
          )}

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
          ) : escopo === "selecao" && selecionados.length === 0 ? (
            <p className="rounded-xl bg-verde/4 px-4 py-10 text-center text-sm text-verde/50">
              Escolha um ou mais animais acima para desenhar as curvas.
            </p>
          ) : (
            <GraficoCurvas series={series} passoX={eixo === "dof" ? 15 : 30} />
          )}

          {modalAberta && (
            <ModalSelecaoAnimais
              selecionados={selecionados}
              onAlternar={alternarAnimal}
              teto={TETO_SELECAO}
              aoFechar={() => setModalAberta(false)}
            />
          )}
        </>
      )}
    </>
  );
}
