/**
 * Sessões do técnico — uma por fazenda.
 *
 * Guardar **todas** as sessões é o que permite trocar de fazenda sem sinal.
 * Trocar de fazenda é trocar de token, e emitir token exige servidor; sem isto,
 * um técnico que atende duas fazendas ficaria preso na que escolheu de manhã até
 * voltar a ter rede.
 *
 * Fica no localStorage porque precisa estar disponível de forma síncrona na
 * primeira renderização, e sobreviver a fechar o app no meio do curral.
 */
const CHAVE = "engorda.sessoes";
const CHAVE_ANTIGA = "engorda.sessao";

export type Papel = "tecnico" | "cliente" | "admin";

export type Sessao = {
  access_token: string;
  refresh_token: string;
  fazenda_id: string;
  papel: Papel;
  admin_master: boolean;
  /** Nome da fazenda desta sessão — é o que as telas mostram para dizer onde a
   *  pessoa está trabalhando. Opcional porque sessões guardadas antes desta
   *  versão não o têm. */
  fazenda_nome?: string;
};

type Guardado = { sessoes: Sessao[]; ativa: string | null };

function ler(): Guardado {
  // Checa o próprio `localStorage`, e não `window`: é do que a função depende, e
  // é o que falta tanto no servidor quanto no ambiente de teste.
  if (typeof localStorage === "undefined") return { sessoes: [], ativa: null };

  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) return JSON.parse(bruto) as Guardado;

    // Migração do formato antigo (uma sessão só). Sem isto, quem já estava
    // logado seria deslogado por uma mudança interna — no meio do campo.
    const antigo = localStorage.getItem(CHAVE_ANTIGA);
    if (antigo) {
      const sessao = JSON.parse(antigo) as Sessao;
      const migrado = { sessoes: [sessao], ativa: sessao.fazenda_id };
      localStorage.setItem(CHAVE, JSON.stringify(migrado));
      localStorage.removeItem(CHAVE_ANTIGA);
      return migrado;
    }
  } catch {
    // Conteúdo corrompido não pode travar o app: melhor pedir login de novo.
  }
  return { sessoes: [], ativa: null };
}

function gravar(estado: Guardado): void {
  localStorage.setItem(CHAVE, JSON.stringify(estado));
}

/** A sessão da fazenda ativa. */
export function lerSessao(): Sessao | null {
  const { sessoes, ativa } = ler();
  return sessoes.find((s) => s.fazenda_id === ativa) ?? sessoes[0] ?? null;
}

export function lerSessoes(): Sessao[] {
  return ler().sessoes;
}

export function salvarSessao(sessao: Sessao): void {
  const { sessoes } = ler();
  const outras = sessoes.filter((s) => s.fazenda_id !== sessao.fazenda_id);
  gravar({ sessoes: [...outras, sessao], ativa: sessao.fazenda_id });
}

/**
 * Atualiza os tokens de uma fazenda **sem mexer na que está aberta**.
 *
 * `salvarSessao()` marca a fazenda como ativa, o que é certo no login e na
 * troca — e errado na renovação: a fila sobe cada pesagem com o token da
 * fazenda dela, então renovar o token da fazenda B, enquanto o técnico
 * trabalha na A, mudava a fazenda aberta sozinho. O sintoma aparece só na
 * próxima tela, como se a troca de fazenda tivesse enlouquecido.
 */
export function atualizarSessao(sessao: Sessao): void {
  const { sessoes, ativa } = ler();
  const outras = sessoes.filter((s) => s.fazenda_id !== sessao.fazenda_id);
  gravar({ sessoes: [...outras, sessao], ativa });
}

/** Substitui todas as sessões — usado depois de baixá-las do servidor. */
export function salvarSessoes(sessoes: Sessao[], ativa?: string): void {
  const anterior = ler().ativa;
  const escolhida =
    ativa ??
    (sessoes.some((s) => s.fazenda_id === anterior) ? anterior : sessoes[0]?.fazenda_id) ??
    null;
  gravar({ sessoes, ativa: escolhida });
}

/** Troca a fazenda ativa. Só entre as que já estão no aparelho — daí funcionar offline. */
export function trocarFazendaAtiva(fazenda_id: string): boolean {
  const { sessoes } = ler();
  if (!sessoes.some((s) => s.fazenda_id === fazenda_id)) return false;
  gravar({ sessoes, ativa: fazenda_id });
  return true;
}

export function fazendaAtiva(): string | null {
  return lerSessao()?.fazenda_id ?? null;
}

/**
 * Descarta a sessão de **uma** fazenda, mantendo as outras.
 *
 * `limparSessao()` apaga tudo e é para sair do app de propósito. Quando o
 * servidor recusa a credencial de uma fazenda, só ela morre: quem atende duas
 * não pode perder o acesso à segunda — nem os tokens com que a fila pendente
 * ainda vai subir — por causa de um vínculo revogado na primeira.
 */
export function esquecerSessao(fazenda_id: string): void {
  const { sessoes, ativa } = ler();
  const restantes = sessoes.filter((s) => s.fazenda_id !== fazenda_id);
  if (restantes.length === 0) return limparSessao();
  gravar({
    sessoes: restantes,
    ativa: ativa === fazenda_id ? restantes[0].fazenda_id : ativa,
  });
}

export function limparSessao(): void {
  localStorage.removeItem(CHAVE);
  localStorage.removeItem(CHAVE_ANTIGA);
}
