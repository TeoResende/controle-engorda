/*
 * Service Worker do app do técnico.
 *
 * Escopo /tecnico: o dashboard do cliente é sempre online e não pode herdar
 * cache agressivo. O script mora na raiz porque escopo mais estreito que o
 * diretório do script é permitido — o contrário não seria.
 *
 * O que ele resolve: o app inteiro precisa ABRIR offline, não só guardar dados.
 * Sem o app shell em cache, o técnico no curral sem sinal vê a tela de
 * dinossauro.
 */

const VERSAO = "v2";
const CACHE_SHELL = `engorda-shell-${VERSAO}`;

// Rotas do app que precisam abrir sem rede.
const TELAS = [
  "/tecnico",
  "/tecnico/ler",
  "/tecnico/coleta",
  // Aparece logo depois de salvar um peso — é a tela que mais é vista offline.
  "/tecnico/confirmacao",
  "/tecnico/animais",
  "/tecnico/fila",
  "/tecnico/mais",
  "/tecnico/animal/novo",
  "/tecnico/gravar",
  "/tecnico/login",
  "/tecnico/offline",
];

/**
 * Guardar o HTML de uma tela não basta: sem os scripts que ela referencia, o
 * navegador abre offline e mostra uma página em branco. Aqui o HTML é lido, os
 * caminhos de `/_next/static/...` são extraídos e vão para o cache junto.
 */
async function guardarTelaComRecursos(cache, tela) {
  const resposta = await fetch(tela, { credentials: "same-origin" });
  if (!resposta.ok) return;

  await cache.put(tela, resposta.clone());

  const html = await resposta.text();
  const recursos = new Set();
  for (const achado of html.matchAll(/["'(](\/_next\/static\/[^"')\s]+)["')]/g)) {
    recursos.add(achado[1]);
  }

  await Promise.allSettled(
    [...recursos].map(async (url) => {
      if (await cache.match(url)) return;
      const r = await fetch(url);
      if (r.ok) await cache.put(url, r);
    }),
  );
}

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      // Falha em uma tela não pode abortar a instalação inteira do SW.
      await Promise.allSettled(TELAS.map((tela) => guardarTelaComRecursos(cache, tela)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== CACHE_SHELL).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Permite à página pedir uma reciclagem do cache depois de sincronizar.
self.addEventListener("message", (evento) => {
  if (evento.data === "reaquecer") {
    evento.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_SHELL);
        await Promise.allSettled(TELAS.map((tela) => guardarTelaComRecursos(cache, tela)));
      })(),
    );
  }
});

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return; // API e CDNs passam direto
  if (url.pathname.startsWith("/api/")) return; // dados nunca vêm do cache

  // Navegação: tenta a rede, cai no cache. Assim o app abre offline, e online
  // continua pegando a versão nova sem esperar o SW atualizar.
  if (requisicao.mode === "navigate") {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_SHELL);
        try {
          const resposta = await fetch(requisicao);
          cache.put(url.pathname, resposta.clone());
          return resposta;
        } catch {
          return (
            (await cache.match(url.pathname)) ??
            (await cache.match("/tecnico")) ??
            (await cache.match("/tecnico/offline")) ??
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
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
        try {
          const resposta = await fetch(requisicao);
          if (resposta.ok) cache.put(requisicao, resposta.clone());
          return resposta;
        } catch {
          // Recurso não guardado e sem rede: melhor 504 explícito que erro
          // opaco de rede, que o Next interpreta como falha de build.
          return new Response("", { status: 504 });
        }
      })(),
    );
  }
});
