export function Kpi({
  rotulo,
  valor,
  unidade,
  destaque = false,
}: {
  rotulo: string;
  valor: string | number | null;
  unidade?: string;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-xl px-4 py-3 ${destaque ? "bg-lima" : "bg-white"}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-verde/60">{rotulo}</p>
      <p className="font-titulo text-2xl font-extrabold text-verde">
        {valor ?? "—"}
        {valor !== null && unidade && (
          <span className="ml-1 text-sm font-bold text-verde/60">{unidade}</span>
        )}
      </p>
    </div>
  );
}
