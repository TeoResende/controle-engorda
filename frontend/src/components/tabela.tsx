import type { ReactNode } from "react";

/**
 * Tabela do dashboard.
 *
 * Em telas largas é tabela de verdade; abaixo de `md` cada linha vira um cartão
 * empilhado, com o nome da coluna ao lado do valor. Rolagem horizontal em
 * celular esconde coluna — e a coluna escondida costuma ser justamente a que
 * importa.
 */
export function Tabela({
  colunas,
  children,
  rotulo,
}: {
  colunas: string[];
  children: ReactNode;
  /** Descrição para leitor de tela, quando o título não estiver colado. */
  rotulo?: string;
}) {
  return (
    <table className="w-full border-collapse text-sm" aria-label={rotulo}>
      <thead className="hidden md:table-header-group">
        <tr className="border-b border-borda">
          {colunas.map((c, i) => (
            <th
              key={`${c}-${i}`}
              scope="col"
              className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-verde/45"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="block md:table-row-group">{children}</tbody>
    </table>
  );
}

export function Linha({ children }: { children: ReactNode }) {
  return (
    <tr className="mb-2 block rounded-xl border border-borda bg-white p-3 last:mb-0 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:border-borda/60 md:p-0 md:transition md:last:border-0 md:hover:bg-verde/3">
      {children}
    </tr>
  );
}

export function Celula({
  children,
  rotulo,
  className = "",
  principal = false,
}: {
  children: ReactNode;
  /** Nome da coluna, mostrado só no formato de cartão (celular). */
  rotulo?: string;
  className?: string;
  /** Valor que identifica a linha — vira o título do cartão no celular. */
  principal?: boolean;
}) {
  return (
    <td
      className={`flex items-baseline justify-between gap-3 py-1 md:table-cell md:px-3 md:py-3 ${
        principal ? "font-titulo text-base font-bold md:text-sm" : ""
      } text-verde ${className}`}
    >
      {rotulo && (
        <span className="text-xs font-bold uppercase tracking-wider text-verde/40 md:hidden">
          {rotulo}
        </span>
      )}
      <span className={principal ? "md:contents" : "text-right md:text-left"}>{children}</span>
    </td>
  );
}
