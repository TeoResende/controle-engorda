/**
 * Sessão do técnico.
 *
 * Fica no localStorage porque precisa estar disponível de forma síncrona na
 * primeira renderização, e sobreviver a fechar o app no meio do curral.
 */
const CHAVE = "engorda.sessao";

export type Papel = "tecnico" | "cliente" | "admin";

export type Sessao = {
  access_token: string;
  refresh_token: string;
  fazenda_id: string;
  papel: Papel;
  admin_master: boolean;
};

export function salvarSessao(sessao: Sessao): void {
  localStorage.setItem(CHAVE, JSON.stringify(sessao));
}

export function lerSessao(): Sessao | null {
  if (typeof window === "undefined") return null;
  const bruto = localStorage.getItem(CHAVE);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as Sessao;
  } catch {
    return null;
  }
}

export function limparSessao(): void {
  localStorage.removeItem(CHAVE);
}
