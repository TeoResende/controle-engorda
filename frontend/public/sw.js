/*
 * Service Worker do app do técnico.
 *
 * O que ele resolve: o app inteiro precisa ABRIR offline, não só guardar dados.
 * Sem o app shell em cache, o técnico no curral sem sinal vê a tela de
 * dinossauro.
 *
 * **Escopo `/`, comportamento restrito a `/tecnico`.** O escopo precisa ser a
 * raiz porque quem digita o endereço digita o curto — sem barra nenhuma — e
 * fora do escopo o worker sequer é consultado, então a página não abre offline
 * por mais bem guardada que esteja. Mas só `/` e `/tecnico/**` são servidos do
 * cache: o dashboard do cliente passa direto para a rede, porque lá dado velho
 * é pior que erro de rede.
 */

const VERSAO = "v5";
const CACHE_SHELL = `engorda-shell-${VERSAO}`;

// Rotas do app que precisam abrir sem rede.
const TELAS = [
  // A raiz entra porque é o endereço que as pessoas digitam.
  "/",
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
 * Extrai caminhos de `/_next/static/...` de um texto (HTML ou CSS).
 *
 * A barra invertida está fora da classe de caracteres de propósito: o Next
 * embute esses caminhos em JSON escapado dentro do próprio HTML
 * (`\"/_next/static/…\"`), e sem excluí-la a URL saía com uma barra a mais no
 * fim — virando 404 e deixando o arquivo fora do cache justamente enquanto
 * tudo parecia ter dado certo.
 */
function extrairRecursos(texto) {
  const achados = new Set();
  for (const m of texto.matchAll(/\/_next\/static\/[^"'()\s\\]+/g)) achados.add(m[0]);
  return achados;
}

async function guardar(cache, url) {
  if (await cache.match(url)) return null;
  const resposta = await fetch(url);
  if (!resposta.ok) return null;
  await cache.put(url, resposta.clone());
  return resposta;
}

/**
 * Guardar o HTML de uma tela não basta: sem os scripts que ela referencia, o
 * navegador abre offline e mostra uma página em branco.
 *
 * E não basta varrer o HTML: as **fontes** são declaradas dentro do CSS, não da
 * página. Sem elas o app abre offline com a tipografia do sistema — funciona,
 * mas denuncia. Por isso cada CSS guardado é lido de novo em busca dos seus
 * próprios recursos.
 */
async function guardarTelaComRecursos(cache, tela) {
  const resposta = await fetch(tela, { credentials: "same-origin" });
  if (!resposta.ok) return;
  await cache.put(tela, resposta.clone());

  const recursos = extrairRecursos(await resposta.text());

  await Promise.allSettled(
    [...recursos].map(async (url) => {
      const guardada = await guardar(cache, url);
      if (!guardada || !url.endsWith(".css")) return;

      const dentroDoCss = extrairRecursos(await guardada.text());
      await Promise.allSettled([...dentroDoCss].map((u) => guardar(cache, u)));
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

  // Só o app do técnico e a raiz são servidos do cache. Tudo o mais — o
  // dashboard, acima de tudo — passa direto para a rede.
  const doTecnico = url.pathname === "/" || url.pathname.startsWith("/tecnico");

  // Navegação: **cache primeiro, rede em segundo plano.**
  //
  // Era o contrário — rede primeiro, cache como queda — e isso custava caro
  // justamente onde o app precisa ser bom. Offline até funcionava (o `fetch`
  // falha rápido), mas no curral o normal não é estar sem sinal: é estar com
  // sinal ruim. Aí cada troca de tela ficava esperando uma resposta que
  // demorava segundos, com uma cópia perfeita da tela parada no cache ao lado.
  //
  // Agora a tela abre na hora e a versão nova é buscada em paralelo, para a
  // navegação seguinte. O preço é ver o shell da versão anterior por uma
  // navegação depois de um deploy — barato perto de esperar a rede a cada
  // toque, e o `install` do SW novo já reaquece tudo.
  if (requisicao.mode === "navigate" && doTecnico) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_SHELL);
        const guardada = await cache.match(url.pathname);

        const daRede = fetch(requisicao)
          .then((resposta) => {
            if (resposta.ok) cache.put(url.pathname, resposta.clone());
            return resposta;
          })
          .catch(() => null);

        if (guardada) {
          // Não bloqueia a resposta: a atualização segue depois de entregar.
          evento.waitUntil(daRede);
          return guardada;
        }

        try {
          const resposta = await daRede;
          if (resposta) return resposta;
          throw new Error("sem rede");
        } catch {
          return (
            (await cache.match(url.pathname)) ??
            (await cache.match("/tecnico")) ??
            (await cache.match("/")) ??
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
