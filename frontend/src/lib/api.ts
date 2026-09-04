// Cliente de API. A URL precisa ser alcançável pelo NAVEGADOR — nunca
// "backend:8000", que só existe dentro da rede do Docker.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

function mensagemDoErro(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === "object" && "detail" in corpo) {
    const detail = (corpo as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      // Erro de validação do FastAPI: mostra a primeira mensagem, que é a útil.
      const primeiro = detail[0] as { msg?: string };
      if (primeiro?.msg) return primeiro.msg;
    }
    if (detail && typeof detail === "object" && "mensagem" in detail) {
      return String((detail as { mensagem: unknown }).mensagem);
    }
  }
  return `Erro ${status}`;
}

export async function api<T>(
  caminho: string,
  opcoes: RequestInit = {},
): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: {
      "Content-Type": "application/json",
      ...(opcoes.headers ?? {}),
    },
  });

  const texto = await resposta.text();
  const corpo = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    throw new ErroApi(resposta.status, mensagemDoErro(corpo, resposta.status));
  }
  return corpo as T;
}
