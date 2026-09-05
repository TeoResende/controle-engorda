/*
 * Service Worker do app do técnico.
 *
 * Escopo /tecnico: o dashboard do cliente é sempre online e não pode herdar
 * cache agressivo. O script mora na raiz porque escopo mais estreito que o
 * diretório do script é permitido — o contrário não seria.
 *
 * O que ele resolve: o app inteiro precisa ABRIR offline, não só guardar dados.
 * Sem o app shell em cache, o técnico no curral sem sinal vê a tela de dinossauro.
 */

const VERSAO = "v1";
const CACHE_SHELL = `engorda-shell-${VERSAO}`;

// Rotas do app que precisam abrir sem rede.
const TELAS = [
  "/tecnico",
  "/tecnico/ler",
  "/tecnico/coleta",
  "/tecnico/animais",
  "/tecnico/fila",
  "/tecnico/mais",
  "/tecnico/animal/novo",
  "/tecnico/gravar",
  "/tecnico/login",
  "/tecnico/offline",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      // Falha em uma tela não pode abortar a instalação inteira do SW.
      await Promise.allSettled(TELAS.map((tela) => cache.add(tela)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((n) => n !== CACHE_SHELL).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return; // API e CDNs passam direto

  // Navegação: tenta a rede, cai no cache. Assim o app abre offline, e online
  // continua pegando a versão nova sem esperar o SW atualizar.
  if (requisicao.mode === "navigate") {
    evento.respondWith(
      (async () => {
        try {
          const resposta = await fetch(requisicao);
          const cache = await caches.open(CACHE_SHELL);
          cache.put(requisicao, resposta.clone());
          return resposta;
        } catch {
          const cache = await caches.open(CACHE_SHELL);
          return (
            (await cache.match(requisicao)) ??
            (await cache.match(url.pathname)) ??
            (await cache.match("/tecnico")) ??
            (await cache.match("/tecnico/offline")) ??
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }
      })(),
    );
    return;
  }

  // Estáticos do Next (JS/CSS com hash no nome): cache primeiro, é imutável.
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icones/")) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_SHELL);
        const guardado = await cache.match(requisicao);
        if (guardado) return guardado;
        const resposta = await fetch(requisicao);
        if (resposta.ok) cache.put(requisicao, resposta.clone());
        return resposta;
      })(),
    );
  }
});
