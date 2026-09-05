import { lerSessao, limparSessao, salvarSessao, type Sessao } from "./sessao";

// Precisa ser um endereço que o NAVEGADOR alcance — nunca "backend:8000", que
// só existe dentro da rede do Docker.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Falha de rede: o pedido nem chegou ao servidor. Diferente de erro do servidor. */
export class SemConexao extends Error {
  constructor() {
    super("Sem conexão");
  }
}

function mensagemDoErro(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === "object" && "detail" in corpo) {
    const detail = (corpo as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const primeiro = detail[0] as { msg?: string };
      if (primeiro?.msg) return primeiro.msg;
    }
    if (detail && typeof detail === "object" && "mensagem" in detail) {
      return String((detail as { mensagem: unknown }).mensagem);
    }
  }
  return `Erro ${status}`;
}

async function bruto(caminho: string, opcoes: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${caminho}`, opcoes);
  } catch {
    // fetch só rejeita quando a requisição não chegou: offline, DNS, recusa.
    throw new SemConexao();
  }
}

/** Chamada pública, sem token (login, status de instalação). */
export async function api<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const resposta = await bruto(caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });
  const texto = await resposta.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (!resposta.ok) throw new ErroApi(resposta.status, mensagemDoErro(corpo, resposta.status));
  return corpo as T;
}

async function renovar(sessao: Sessao): Promise<Sessao | null> {
  try {
    const nova = await api<Sessao>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    salvarSessao(nova);
    return nova;
  } catch {
    return null;
  }
}

/**
 * Chamada autenticada. Em 401 tenta renovar uma vez e repete.
 *
 * O access token dura 12h justamente porque o técnico passa o dia offline; a
 * renovação só é possível — e só é necessária — quando já há internet de novo.
 */
export async function apiAuth<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  let sessao = lerSessao();
  if (!sessao) throw new ErroApi(401, "Sessão expirada");

  // FormData define o próprio Content-Type, com o boundary do multipart —
  // sobrescrever quebraria o upload de áudio.
  const ehFormulario = opcoes.body instanceof FormData;

  const chamar = (token: string) =>
    bruto(caminho, {
      ...opcoes,
      headers: {
        ...(ehFormulario ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${token}`,
        ...(opcoes.headers ?? {}),
      },
    });

  let resposta = await chamar(sessao.access_token);

  if (resposta.status === 401) {
    const renovada = await renovar(sessao);
    if (!renovada) {
      limparSessao();
      throw new ErroApi(401, "Sessão expirada");
    }
    sessao = renovada;
    resposta = await chamar(sessao.access_token);
  }

  const texto = await resposta.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (!resposta.ok) throw new ErroApi(resposta.status, mensagemDoErro(corpo, resposta.status));
  return corpo as T;
}
