import type { ReactNode } from "react";

/** Tabela do dashboard. Rola no próprio contêiner em tela estreita. */
export function Tabela({
  colunas,
  children,
}: {
  colunas: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-verde/10">
            {colunas.map((c) => (
              <th
                key={c}
                className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-verde/45"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Linha({ children }: { children: ReactNode }) {
  return <tr className="border-b border-verde/6 last:border-0">{children}</tr>;
}

export function Celula({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-3 text-verde ${className}`}>{children}</td>;
}
