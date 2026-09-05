import { lerSessao, lerSessoes, limparSessao, salvarSessao, type Sessao } from "./sessao";

// Precisa ser um endereço que o NAVEGADOR alcance — nunca "backend:8000", que
// só existe dentro da rede do Docker.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Corpo já decodificado, quando veio JSON. O login lê a lista de fazendas
     *  do 409 daqui. */
    readonly corpo: unknown = null,
  ) {
    super(mensagem);
  }
}

/**
 * Falha de rede: o pedido nem chegou ao servidor.
 *
 * Só isto é "sem conexão". Confundir com resposta inesperada faria toda falha
 * de rota ou de servidor virar "você está sem internet" — mensagem que manda o
 * usuário procurar o problema no lugar errado.
 */
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

/**
 * Lê a resposta com tolerância a corpo não-JSON.
 *
 * Um proxy mal roteado devolve HTML com 200 ou 404, e o `JSON.parse` estoura —
 * o erro chegava no `catch` genérico da tela como se fosse falha de rede.
 */
async function interpretar<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();

  let corpo: unknown = null;
  let decodificou = true;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      decodificou = false;
    }
  }

  if (!resposta.ok) {
    throw new ErroApi(
      resposta.status,
      decodificou
        ? mensagemDoErro(corpo, resposta.status)
        : `Erro ${resposta.status} do servidor`,
      corpo,
    );
  }
  if (!decodificou) {
    throw new ErroApi(
      resposta.status,
      "Resposta inesperada do servidor (não veio JSON). Confira o endereço da API.",
    );
  }
  return corpo as T;
}

/** Chamada pública, sem token (login, status de instalação). */
export async function api<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const resposta = await bruto(caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });
  return interpretar<T>(resposta);
}

async function renovar(sessao: Sessao): Promise<Sessao | null> {
  try {
    const nova = await api<Sessao>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    // Preserva o nome da fazenda, que o /auth/refresh não devolve — sem ele o
    // seletor de fazenda ficaria com um item sem rótulo.
    salvarSessao({ ...nova, nome: sessao.nome });
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
export async function apiAuth<T>(
  caminho: string,
  opcoes: RequestInit = {},
  /** Fala em nome de outra fazenda — a fila envia cada pesagem com o token da
   *  fazenda dela, e não com o da que está aberta na tela. */
  fazendaId?: string,
): Promise<T> {
  let sessao = fazendaId
    ? (lerSessoes().find((s) => s.fazenda_id === fazendaId) ?? null)
    : lerSessao();
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

  return interpretar<T>(resposta);
}
