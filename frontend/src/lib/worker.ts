/**
 * Registro do Service Worker — a peça que faz o app abrir sem internet.
 *
 * Fica separado porque precisa rodar tanto na raiz quanto dentro de `/tecnico`:
 * quem digita o endereço curto cai na raiz, e se o worker só se registrasse
 * depois de entrar no app do técnico, a primeira visita nunca o instalaria.
 */

export type ResultadoRegistro = { ok: true } | { ok: false; motivo: string };

/**
 * Espera o worker ficar ativo, com prazo.
 *
 * `navigator.serviceWorker.ready` **nunca rejeita**: se o registro for barrado
 * ou a instalação falhar, a promessa simplesmente não resolve, e quem espera
 * por ela fica preso para sempre. Foi o que travou a tela em "Preparando…".
 */
async function esperarAtivo(segundos = 15): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), segundos * 1000)),
  ]);
}

function explicar(erro: unknown): string {
  const mensagem = erro instanceof Error ? erro.message : String(erro);

  // Chrome recusa registrar Service Worker em página com erro de certificado —
  // mesmo depois de a pessoa clicar em "continuar assim mesmo". O aviso some da
  // tela, mas a origem continua marcada como insegura por baixo.
  if (/SSL|certificate|SecurityError|insecure/i.test(mensagem)) {
    return "O navegador recusou por causa do certificado. Aceitar o aviso na tela não basta: o certificado precisa ser instalado como confiável no aparelho.";
  }
  if (/unsupported|not supported/i.test(mensagem)) {
    return "Este navegador não suporta funcionamento sem internet.";
  }
  return mensagem;
}

export async function registrarWorker(): Promise<ResultadoRegistro> {
  if (!("serviceWorker" in navigator)) {
    return { ok: false, motivo: "Este navegador não suporta funcionamento sem internet." };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      motivo: "A página não está em conexão segura (https). Sem isso o navegador não deixa o app funcionar sem internet.",
    };
  }

  try {
    // Registros antigos com escopo /tecnico continuariam mandando nas rotas do
    // técnico — escopo mais específico ganha — e a raiz seguiria descoberta.
    for (const antigo of await navigator.serviceWorker.getRegistrations()) {
      if (new URL(antigo.scope).pathname !== "/") await antigo.unregister();
    }

    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const pronto = await esperarAtivo();

    if (!pronto?.active) {
      return {
        ok: false,
        motivo:
          "O registro foi aceito, mas o app não terminou de se preparar. Verifique a conexão e tente de novo.",
      };
    }

    // Reaquece o cache assim que há sinal: telas novas de um deploy recente
    // entram antes de o técnico voltar para o curral.
    if (navigator.onLine) pronto.active.postMessage("reaquecer");
    return { ok: true };
  } catch (erro) {
    return { ok: false, motivo: explicar(erro) };
  }
}
