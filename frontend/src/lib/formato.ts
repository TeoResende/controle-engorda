/** Formatação pt-BR. Vírgula decimal em todo número que o usuário lê. */

export function numero(valor: string | number | null | undefined, casas = 0): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function peso(valor: string | number | null | undefined): string {
  return numero(valor, 0);
}

export function gmd(valor: string | number | null | undefined): string {
  return numero(valor, 2);
}

/** Data ISO (YYYY-MM-DD) em dd/mm/aaaa, sem escorregar de fuso. */
export function data(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function mesCurto(iso: string): string {
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return nomes[Number(iso.slice(5, 7)) - 1] ?? "";
}

export function variacao(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  const n = Number(valor);
  return `${n > 0 ? "+" : ""}${numero(n, 0)} kg`;
}

export function iniciais(nome: string): string {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
