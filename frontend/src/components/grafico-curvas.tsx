"use client";

import { useId, useState } from "react";

/**
 * Gráfico de várias linhas em SVG, escrito à mão — irmão do `GraficoDeLinha`,
 * mas com **eixo X numérico** (dias) e mais de uma série.
 *
 * É o que a aba "Por idade / acompanhamento" usa: cada animal é uma linha, e o
 * eixo horizontal são dias (de acompanhamento ou de vida), não datas. As cores
 * das séries são fixas — a marca da fazenda pinta o resto da tela, mas linhas
 * que precisam se distinguir entre si não podem depender de uma cor só.
 */

export type Serie = {
  rotulo: string;
  cor: string;
  grossa?: boolean;
  pontos: { x: number; y: number }[];
};

const L = 900;
const A = 340;
const M = { topo: 20, direita: 20, baixo: 46, esquerda: 64 };

/** Paleta de séries. O verde da marca abre a lista; o resto distingue. */
export const CORES_SERIE = [
  "#1E4B3B",
  "#C6A21E",
  "#3E8E7E",
  "#8A5A2B",
  "#7A5BA6",
  "#C24A4A",
  "#2C7BB6",
  "#5B7A1E",
];

export function GraficoCurvas({
  series,
  unidadeX = "dias",
  passoX = 15,
  altura = "h-64 sm:h-72",
}: {
  series: Serie[];
  unidadeX?: string;
  passoX?: number;
  altura?: string;
}) {
  const id = useId();
  const [ativo, setAtivo] = useState<string | null>(null);

  const todos = series.flatMap((s) => s.pontos);
  if (todos.length === 0) {
    return (
      <p className="rounded-xl bg-verde/4 px-4 py-10 text-center text-sm text-verde/50">
        Sem dados para desenhar as curvas.
      </p>
    );
  }

  const xs = todos.map((p) => p.x);
  const ys = todos.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs) || 1;
  const folga = (Math.max(...ys) - Math.min(...ys)) * 0.08 || Math.max(Math.max(...ys) * 0.05, 1);
  const ymin = Math.min(...ys) - folga;
  const ymax = Math.max(...ys) + folga;

  const larg = L - M.esquerda - M.direita;
  const alt = A - M.topo - M.baixo;
  const px = (v: number) => M.esquerda + (xmax === xmin ? larg / 2 : ((v - xmin) / (xmax - xmin)) * larg);
  const py = (v: number) => M.topo + alt - ((v - ymin) / (ymax - ymin)) * alt;

  const marcasX: number[] = [];
  for (let v = Math.ceil(xmin / passoX) * passoX; v <= xmax; v += passoX) marcasX.push(v);

  const passosY = 4;
  const marcasY = Array.from({ length: passosY + 1 }, (_, i) => ymin + ((ymax - ymin) * i) / passosY);

  return (
    <figure className="m-0">
      <div className={`relative w-full ${altura}`}>
        <svg viewBox={`0 0 ${L} ${A}`} className="h-full w-full" role="img" aria-label="Curvas de peso por dia">
          {marcasY.map((v, i) => (
            <g key={`y${i}`}>
              <line x1={M.esquerda} y1={py(v)} x2={L - M.direita} y2={py(v)} stroke="rgb(var(--cor-borda))" strokeWidth={1} />
              <text x={M.esquerda - 8} y={py(v) + 4} textAnchor="end" fontSize={13} fill="rgb(var(--cor-verde)/0.45)">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {marcasX.map((v) => (
            <text key={`x${v}`} x={px(v)} y={A - M.baixo + 20} textAnchor="middle" fontSize={13} fill="rgb(var(--cor-verde)/0.45)">
              {v}
            </text>
          ))}
          <text x={L - M.direita} y={A - 6} textAnchor="end" fontSize={12} fill="rgb(var(--cor-verde)/0.4)">
            {unidadeX}
          </text>

          {series.map((s) => {
            const d = s.pontos
              .map((p, i) => `${i === 0 ? "M" : "L"} ${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`)
              .join(" ");
            const apagado = ativo !== null && ativo !== s.rotulo;
            return (
              <g key={s.rotulo} opacity={apagado ? 0.2 : 1}>
                <path d={d} fill="none" stroke={s.cor} strokeWidth={s.grossa ? 3.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
                {s.pontos.map((p, i) => (
                  <circle key={`${id}-${s.rotulo}-${i}`} cx={px(p.x)} cy={py(p.y)} r={s.grossa ? 3.5 : 2.5} fill={s.cor} />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <button
            key={s.rotulo}
            type="button"
            onMouseEnter={() => setAtivo(s.rotulo)}
            onMouseLeave={() => setAtivo(null)}
            onFocus={() => setAtivo(s.rotulo)}
            onBlur={() => setAtivo(null)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-verde/70"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.cor }} aria-hidden />
            {s.rotulo}
          </button>
        ))}
      </figcaption>
    </figure>
  );
}
