// Guarda a sessão no navegador. Vai ser substituído no M5, quando o app do
// técnico precisar de token disponível offline dentro do Service Worker.
const CHAVE = "engorda.sessao";

export type Sessao = {
  access_token: string;
  refresh_token: string;
  fazenda_id: string;
  papel: "tecnico" | "cliente" | "admin";
  admin_master: boolean;
};

export function salvarSessao(sessao: Sessao): void {
  localStorage.setItem(CHAVE, JSON.stringify(sessao));
}

export function lerSessao(): Sessao | null {
  const bruto = localStorage.getItem(CHAVE);
  return bruto ? (JSON.parse(bruto) as Sessao) : null;
}

export function limparSessao(): void {
  localStorage.removeItem(CHAVE);
}
