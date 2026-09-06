"use client";

import { useId, useState } from "react";

/**
 * Gráfico de linha em SVG, escrito à mão.
 *
 * As cores vêm das variáveis da marca, não de hex fixo: quando a fazenda troca
 * a paleta, o gráfico acompanha em vez de ficar verde no meio de um tema azul.
 *
 * Uma biblioteca custaria ~100 KB de bundle para desenhar uma linha, e o
 * dashboard precisa abrir rápido em conexão de fazenda.
 *
 * O desenho usa um sistema de coordenadas amplo (900×340) e escala por
 * `viewBox`: assim o texto mantém proporção em qualquer largura, em vez de
 * virar rabisco no desktop e letra gigante no celular.
 */

export type Ponto = {
  rotulo: string;
  valor: number;
  /**
   * Data do ponto (ISO). Quando **todos** os pontos têm, o eixo horizontal
   * passa a ser proporcional ao tempo em vez de espaçado por posição.
   *
   * Isso deixou de ser detalhe quando o peso ao nascer entrou na curva do
   * animal: entre nascer e a primeira ida ao curral podem passar oito meses, e
   * espaçamento igual desenharia esse intervalo do mesmo tamanho de duas
   * pesagens feitas com um mês de diferença — uma curva que mente sobre o
   * ritmo de crescimento.
   */
  data?: string;
};

const L = 900;
const A = 340;
const M = { topo: 24, direita: 24, baixo: 48, esquerda: 78 };

function escalas(pontos: Ponto[]) {
  const valores = pontos.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Folga de 8% para a linha não encostar nas bordas; e um piso quando todos os
  // valores são iguais, senão a divisão por zero achata tudo numa linha.
  const folga = (max - min) * 0.08 || Math.max(max * 0.05, 1);
  const baixo = min - folga;
  const alto = max + folga;

  const largura = L - M.esquerda - M.direita;
  const altura = A - M.topo - M.baixo;

  // Fração de 0 a 1 de cada ponto no eixo horizontal.
  const tempos = pontos.map((p) => (p.data ? Date.parse(p.data) : NaN));
  const proporcional = tempos.every((t) => !Number.isNaN(t));
  const inicio = Math.min(...tempos);
  const vao = Math.max(...tempos) - inicio;
  const fracao = (i: number) => {
    if (pontos.length === 1) return 0.5;
    // Sem datas — ou com todas iguais, que dividiria por zero — volta ao
    // espaçamento por posição.
    if (!proporcional || vao === 0) return i / (pontos.length - 1);
    return (tempos[i] - inicio) / vao;
  };

  return {
    baixo,
    alto,
    x: (i: number) => M.esquerda + fracao(i) * largura,
    y: (v: number) => M.topo + altura - ((v - baixo) / (alto - baixo)) * altura,
  };
}

export function GraficoDeLinha({
  pontos,
  unidade = "kg",
  altura = "h-56 sm:h-64",
}: {
  pontos: Ponto[];
  unidade?: string;
  altura?: string;
}) {
  const id = useId();
  const [ativo, setAtivo] = useState<number | null>(null);

  if (pontos.length === 0) {
    return (
      <p className="rounded-xl bg-verde/4 px-4 py-10 text-center text-sm text-verde/50">
        Ainda não há pesagens para desenhar a curva.
      </p>
    );
  }

  const { x, y, baixo, alto } = escalas(pontos);
  const caminho = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.valor)}`).join(" ");
  const area = `${caminho} L ${x(pontos.length - 1)} ${A - M.baixo} L ${x(0)} ${A - M.baixo} Z`;

  // Com muitos pontos os rótulos se sobrepõem: mostra no máximo 6.
  const passo = Math.max(1, Math.ceil(pontos.length / 6));
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  const destaque = ativo !== null ? pontos[ativo] : null;

  return (
    <figure className="m-0">
      <div className={`relative w-full ${altura}`}>
        <svg
          viewBox={`0 0 ${L} ${A}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`Evolução de peso de ${primeiro.valor} a ${ultimo.valor} ${unidade}, ${pontos.length} pontos`}
          onMouseLeave={() => setAtivo(null)}
        >
          <defs>
            <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--cor-lima))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="rgb(var(--cor-lima))" stopOpacity={0.04} />
            </linearGradient>
          </defs>

          {[alto, (alto + baixo) / 2, baixo].map((v) => (
            <g key={v}>
              <line
                x1={M.esquerda}
                x2={L - M.direita}
                y1={y(v)}
                y2={y(v)}
                stroke="rgb(var(--cor-verde))"
                strokeOpacity={0.1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={M.esquerda - 12}
                y={y(v) + 6}
                fontSize={18}
                textAnchor="end"
                fill="rgb(var(--cor-verde))"
                fillOpacity={0.45}
              >
                {Math.round(v)}
              </text>
            </g>
          ))}

          <path d={area} fill={`url(#area-${id})`} />
          <path
            d={caminho}
            fill="none"
            stroke="rgb(var(--cor-verde))"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {pontos.map((p, i) => (
            <g key={`${p.rotulo}-${i}`}>
              <circle
                cx={x(i)}
                cy={y(p.valor)}
                r={ativo === i ? 9 : 5}
                fill={ativo === i ? "rgb(var(--cor-lima))" : "rgb(var(--cor-verde))"}
                stroke="#fff"
                strokeWidth={2}
              />
              {/* Alvo generoso e invisível: acertar o ponto com o dedo. */}
              <rect
                x={x(i) - 28}
                y={M.topo}
                width={56}
                height={A - M.topo - M.baixo}
                fill="transparent"
                onMouseEnter={() => setAtivo(i)}
                onFocus={() => setAtivo(i)}
                onBlur={() => setAtivo(null)}
                tabIndex={0}
                role="button"
                aria-label={`${p.rotulo}: ${p.valor} ${unidade}`}
              />
            </g>
          ))}

          {pontos.map((p, i) =>
            i % passo === 0 || i === pontos.length - 1 ? (
              <text
                key={`r-${p.rotulo}-${i}`}
                x={x(i)}
                y={A - 14}
                fontSize={18}
                fill="rgb(var(--cor-verde))"
                fillOpacity={0.55}
                textAnchor="middle"
              >
                {p.rotulo}
              </text>
            ) : null,
          )}
        </svg>

        {destaque && (
          <div
            className="pointer-events-none absolute -top-1 rounded-lg bg-verde px-2.5 py-1.5 text-xs font-bold text-fundo shadow"
            style={{
              left: `${((x(ativo!) - M.esquerda) / (L - M.esquerda - M.direita)) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            {destaque.rotulo}: {destaque.valor} {unidade}
          </div>
        )}
      </div>

      <figcaption className="mt-2 flex justify-between text-xs text-verde/45">
        <span>
          {primeiro.rotulo}: {primeiro.valor} {unidade}
        </span>
        <span>
          {ultimo.rotulo}: {ultimo.valor} {unidade}
        </span>
      </figcaption>
    </figure>
  );
}
