"use client";

/**
 * Gráficos em SVG, escritos à mão.
 *
 * Uma biblioteca de gráficos custaria ~100 KB no bundle para desenhar duas
 * linhas — e o dashboard precisa abrir rápido em conexão de fazenda.
 */

export type Ponto = { rotulo: string; valor: number };

const LARGURA = 320;
const ALTURA = 150;
const MARGEM = { topo: 12, direita: 8, baixo: 24, esquerda: 40 };

function escalas(pontos: Ponto[]) {
  const valores = pontos.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Folga de 8% para a linha não encostar nas bordas; e um piso quando todos os
  // valores são iguais, senão a divisão por zero achata tudo numa linha.
  const folga = (max - min) * 0.08 || Math.max(max * 0.05, 1);
  const baixo = min - folga;
  const alto = max + folga;

  const larguraUtil = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.baixo;

  return {
    baixo,
    alto,
    x: (i: number) =>
      MARGEM.esquerda +
      (pontos.length === 1 ? larguraUtil / 2 : (i / (pontos.length - 1)) * larguraUtil),
    y: (v: number) => MARGEM.topo + alturaUtil - ((v - baixo) / (alto - baixo)) * alturaUtil,
  };
}

export function GraficoDeLinha({
  pontos,
  unidade = "kg",
}: {
  pontos: Ponto[];
  unidade?: string;
}) {
  if (pontos.length === 0) {
    return (
      <p className="rounded-xl bg-white px-4 py-8 text-center text-sm text-verde/50">
        Ainda não há pesagens para desenhar a curva.
      </p>
    );
  }

  const { x, y, baixo, alto } = escalas(pontos);
  const caminho = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.valor)}`).join(" ");
  const area = `${caminho} L ${x(pontos.length - 1)} ${ALTURA - MARGEM.baixo} L ${x(0)} ${ALTURA - MARGEM.baixo} Z`;

  return (
    <div className="overflow-x-auto rounded-xl bg-white p-3">
      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Curva de peso: de ${pontos[0].valor} a ${pontos[pontos.length - 1].valor} ${unidade}`}
      >
        {[alto, (alto + baixo) / 2, baixo].map((v) => (
          <g key={v}>
            <line
              x1={MARGEM.esquerda}
              x2={LARGURA - MARGEM.direita}
              y1={y(v)}
              y2={y(v)}
              stroke="#1E4B3B"
              strokeOpacity={0.08}
            />
            <text x={4} y={y(v) + 3} fontSize={8} fill="#1E4B3B" fillOpacity={0.5}>
              {Math.round(v)}
            </text>
          </g>
        ))}

        <path d={area} fill="#C6D400" fillOpacity={0.18} />
        <path d={caminho} fill="none" stroke="#1E4B3B" strokeWidth={2} strokeLinejoin="round" />

        {pontos.map((p, i) => (
          <circle key={p.rotulo + i} cx={x(i)} cy={y(p.valor)} r={3} fill="#1E4B3B" />
        ))}

        {pontos.map((p, i) =>
          // Com muitos pontos os rótulos se sobrepõem; mostra um a cada N.
          i % Math.ceil(pontos.length / 5) === 0 || i === pontos.length - 1 ? (
            <text
              key={`r-${p.rotulo}-${i}`}
              x={x(i)}
              y={ALTURA - 8}
              fontSize={8}
              fill="#1E4B3B"
              fillOpacity={0.6}
              textAnchor="middle"
            >
              {p.rotulo}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
