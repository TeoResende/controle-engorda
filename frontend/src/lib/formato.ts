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

/**
 * Data de hoje no fuso do **aparelho**, em YYYY-MM-DD.
 *
 * `new Date().toISOString()` devolve a data em UTC. No Brasil (UTC-3) isso faz
 * o app gravar a data de amanhã em toda coleta feita depois das 21h — bem no
 * horário em que ainda se trabalha no curral.
 */
export function hojeLocal(momento = new Date()): string {
  const ano = momento.getFullYear();
  const mes = String(momento.getMonth() + 1).padStart(2, "0");
  const dia = String(momento.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
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
