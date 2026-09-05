/**
 * Registro do Service Worker.
 *
 * Fica separado porque precisa rodar tanto na raiz quanto dentro de `/tecnico`:
 * quem digita o endereço curto cai na raiz, e se o worker só se registrasse
 * depois de entrar no app do técnico, a primeira visita nunca o instalaria.
 */
export async function registrarWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    // Registros antigos com escopo /tecnico continuariam mandando nas rotas do
    // técnico — escopo mais específico ganha — e a raiz seguiria descoberta.
    for (const antigo of await navigator.serviceWorker.getRegistrations()) {
      if (new URL(antigo.scope).pathname !== "/") await antigo.unregister();
    }

    const registro = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    // Reaquece o cache assim que há sinal: telas novas de um deploy recente
    // entram antes de o técnico voltar para o curral.
    if (navigator.onLine) {
      const pronto = await navigator.serviceWorker.ready;
      (pronto.active ?? registro.active)?.postMessage("reaquecer");
    }
  } catch {
    // Sem HTTPS o registro falha; o app segue, só não abre offline.
  }
}
