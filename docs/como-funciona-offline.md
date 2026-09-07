# Como o app web funciona offline, como um app nativo — de A a Z

Este documento explica, peça por peça, o que faz o app do técnico abrir e operar
**sem internet** dentro de um navegador, sem ser um app nativo instalado da loja.
Cada tecnologia aqui é padrão da web moderna (o guarda-chuva se chama **PWA** —
*Progressive Web App*), e cada uma resolve um pedaço específico do problema.

A regra que amarra tudo: **um navegador comum não guarda nada entre visitas nem
abre sem rede.** Para se comportar como app nativo, o app precisa, ele mesmo,
guardar o próprio código, guardar os dados, e ter uma lógica de sincronização.
São três problemas diferentes, com três tecnologias diferentes.

---

## 0. O pré-requisito de tudo: HTTPS (contexto seguro)

Antes de qualquer coisa: **nada disto funciona sem HTTPS.** O navegador só libera
as APIs de app offline em "contexto seguro" — na prática, cadeado verde. Fora
dele, elas somem **sem erro**, o que engana:

| Recurso | Sem HTTPS |
|---|---|
| Service Worker (abrir offline) | não registra |
| Instalar como app | indisponível |
| Web NFC (ler brinco) | API inexistente |
| Microfone / gravação | indisponível |
| `crypto.randomUUID` | `undefined` |

No projeto isso é checado em `lib/worker.ts` (`window.isSecureContext`), e a
tela avisa quando está em http (`components/aviso-inseguro.tsx`). Em rede local
usamos uma autoridade certificadora própria; em produção, o proxy da frente
gera o certificado. **Aceitar o aviso de certificado na tela não basta** — o
Chrome continua recusando registrar o Service Worker por baixo. O certificado
precisa ser confiável de verdade.

---

## 1. Service Worker — o que faz o app ABRIR sem rede

**Arquivo:** `frontend/public/sw.js` · **registro:** `frontend/src/lib/worker.ts`

### O que é

Um Service Worker é um **script que o navegador instala e roda em segundo
plano**, separado da página, e que fica **no meio do caminho** entre o app e a
rede. Toda vez que o app pede um arquivo (uma tela, um script, uma fonte), o
pedido passa primeiro pelo Service Worker, que decide: responder do que tem
guardado, ou ir à rede.

É isso que resolve o problema nº 1: sem ele, abrir o app sem internet mostra a
tela do dinossauro. Com ele, o navegador pergunta ao worker "me dá a tela do
técnico", e o worker responde do próprio armazenamento.

### Como funciona aqui

1. **Instalação** (`install`): na primeira visita com rede, o worker baixa e
   guarda o "app shell" — o HTML de cada tela do técnico e todos os scripts,
   CSS e fontes que elas usam. Isso vai para o **Cache Storage** (um armazenamento
   de pares URL→resposta, próprio para isso).

2. **Guardar o HTML não basta.** Uma página sem seus scripts abre em branco; sem
   as fontes — que são declaradas *dentro* do CSS, não do HTML — abre com a
   tipografia do sistema. Por isso o worker lê o HTML, acha os `/_next/static/…`,
   guarda cada um, e relê cada CSS guardado atrás das fontes dele
   (`guardarTelaComRecursos`, `extrairRecursos`).

3. **Servir** (`fetch`): quando o app navega, o worker responde **do cache na
   hora** e revalida em segundo plano (*cache-first*). No curral o problema não
   é estar sem sinal — é estar com sinal ruim; esperar a rede a cada tela
   travaria o app tendo a cópia pronta ao lado.

4. **Escopo `/`, comportamento restrito a `/tecnico`.** O worker é registrado na
   raiz (porque quem digita o endereço digita o curto, sem caminho), mas **só o
   app do técnico é servido do cache**. O dashboard do cliente passa direto para
   a rede — lá, dado velho é pior que erro de rede.

### Uma armadilha que resolvemos

`navigator.serviceWorker.ready` **nunca rejeita**: se o registro é barrado, a
promessa simplesmente não resolve, e quem espera fica preso para sempre — foi o
que travou a tela em "Preparando…". Toda espera por ele tem prazo
(`esperarAtivo`, 15s) e o motivo real da falha chega à tela.

### Por que o cache tem teto

Cada build do frontend gera scripts com nome novo; sem limite, o cache cresce a
cada atualização até estourar a cota do aparelho (foi o `QuotaExceededError`).
Por isso há um teto (`TETO_ESTATICOS`) que descarta as gerações mais antigas.

---

## 2. Web App Manifest — o que faz o app ser INSTALÁVEL

**Arquivo:** `frontend/src/app/manifest.ts`

Um arquivo JSON que descreve o app ao navegador: nome, ícone, cor, tela inicial.
É o que faz o Chrome oferecer **"Instalar app"** e, depois de instalado, abrir
**em tela cheia, com ícone próprio na tela inicial**, sem a barra do navegador —
visualmente idêntico a um app nativo.

Campos que importam:
- `display: "standalone"` — abre sem a barra de endereço, como app.
- `start_url: "/tecnico"` / `scope: "/tecnico"` — o app é a área do técnico.
- `icons` — o ícone gravado na tela inicial (servido pela API, configurável).

O manifesto é **gerado** em vez de ser arquivo fixo, para o endereço do ícone
acompanhar a configuração (`NEXT_PUBLIC_API_URL`).

> Service Worker + Manifest + HTTPS são o tripé que define um PWA. Um dá o
> funcionamento offline, o outro a instalação, o terceiro é o pré-requisito.

---

## 3. IndexedDB (via Dexie) — onde os DADOS ficam guardados

**Arquivos:** `frontend/src/lib/db.ts` e quem escreve nele
· **biblioteca:** Dexie 4

O Service Worker guarda o *app* (código); os *dados* são outro problema.
**IndexedDB** é o banco de dados que todo navegador tem embutido — guarda
objetos estruturados, no aparelho, e sobrevive a fechar o app. É onde vive tudo
que o técnico precisa sem rede.

Usamos **Dexie**, uma biblioteca fina por cima do IndexedDB (a API crua é
verbosa e cheia de callbacks). Três "tabelas" (object stores):

| Store | O que guarda | Para quê |
|---|---|---|
| `animais` | cópia do rebanho, baixada no login | resolver o brinco e a referência de peso, offline |
| `fila` | pesagens registradas que ainda não subiram | a fila de sincronização — o dado que não pode se perder |
| `meta` | identidade, marca, logo | cabeçalho e tema sem buscar da rede |

Detalhe de projeto: os dados são **separados por fazenda** (índice
`[fazenda_id+brinco]`), porque o mesmo número de brinco pode existir em duas
fazendas — resolver o da errada mandaria a pesagem para o animal errado.

**Por que não `localStorage`?** Ele guarda só texto, é síncrono (trava a tela) e
é minúsculo. Serve para a sessão (ver adiante); não serve para o rebanho nem
para áudio.

---

## 4. UUID gerado no cliente — o que torna o reenvio SEGURO

**Arquivo:** `frontend/src/lib/uuid.ts`

Cada pesagem nasce com um **identificador único gerado no próprio celular**,
antes de existir no servidor. É uma ideia pequena que sustenta a fila inteira:
como o id vem do cliente, **reenviar a mesma pesagem não cria duplicata** — o
servidor reconhece o id e responde "já tenho essa" (idempotência). Sem isso, uma
falha de rede no meio do envio deixaria o técnico sem saber se salvou, e reenviar
duplicaria o peso.

`crypto.randomUUID` não existe fora de contexto seguro, então montamos o UUID a
partir de `crypto.getRandomValues`, que funciona em qualquer contexto.

---

## 5. Motor de sincronização — o que reconcilia o aparelho com o servidor

**Arquivo:** `frontend/src/lib/sync.ts`

É a lógica que um app nativo também teria que escrever à mão. O fluxo:

1. Técnico registra peso (e, opcional, áudio) → vai para a `fila` no IndexedDB,
   com o UUID do cliente. **Fica salvo na hora, sem depender de rede.**
2. Sem sinal, acumula na fila. Com sinal, sobe em blocos, **em ordem de coleta**.
3. A ordem sagrada: **envia → o servidor confirma → só então apaga a cópia
   local.** Se a conexão cai no meio, o registro continua na fila e sobe depois;
   como o id é o mesmo, reenviar não duplica.
4. Dispara sozinho em três momentos: ao abrir o app, quando o sinal volta
   (evento `online` do navegador) e depois de cada peso salvo. Não há botão a
   apertar.
5. Uma pesagem que o servidor **recusa** (brinco inexistente) fica na fila com o
   motivo à vista — erro de dado não se resolve sozinho.

Perder uma pesagem coletada no curral é o pior defeito possível deste sistema, e
é silencioso — ninguém percebe até procurar o peso e ele não estar lá. Por isso
essa é a parte mais testada do projeto (`frontend/testes/sync.test.ts`, com um
IndexedDB real de mentira por baixo).

Detalhe recente: ao salvar, o app também **reflete a pesagem na cópia local do
rebanho na hora**, para a tela de conferência não voltar a mostrar como pendente
um animal que acabou de ser pesado, mesmo depois de a fila esvaziar.

---

## 6. Sessão e login que sobrevivem offline

**Arquivo:** `frontend/src/lib/sessao.ts` · **tecnologia:** JWT + `localStorage`

O técnico passa o dia sem sinal, mas cada pesagem precisa ir assinada em nome de
alguém. A autenticação usa **JWT** (um token assinado que carrega quem é o
usuário, a fazenda e o papel), com validade longa (~12h) justamente para operar
horas offline. O token fica no `localStorage` — que é síncrono e está disponível
já na primeira renderização, antes de qualquer efeito.

Como o técnico pode atender **várias fazendas** e trocar entre elas no curral
(onde não há servidor para emitir token novo), o app baixa **uma sessão pronta
para cada fazenda** enquanto há rede (`GET /auth/sessoes`) e passa a trocar entre
as que já estão no aparelho. Trocar de fazenda offline é escolher entre sessões
guardadas, não pedir uma nova.

Regra que sustenta isso: **falha de rede nunca desloga.** Se o token vence e a
renovação não chega ao servidor, o app trata como "sem conexão" e mantém a
sessão — deslogar no curral jogaria o técnico para uma tela de login que ele não
tem como completar, e levaria junto os tokens da fila.

---

## 7. Web NFC — ler o brinco encostando o celular

**Arquivo:** `frontend/src/lib/nfc.ts` · **API:** `NDEFReader` (Chrome/Android)

O brinco do animal tem um chip **NTAG213**. A **Web NFC API** deixa o navegador
ler esse chip — sem app nativo, sem plugin. A tag é gravada com a **URL de
coleta inteira** (não só o número), então encostar o celular **com o app fechado**
faz o Android abrir direto na tela de coleta, com o brinco já preenchido.

É a única peça restrita a **Chrome no Android** — Safari/iOS não expõe NFC ao
navegador. Por isso a segunda jornada do produto prevê QR Code como alternativa
universal. Funciona online ou offline: ler a tag é local.

---

## 8. MediaRecorder — a observação falada

**Arquivo:** `frontend/src/lib/audio.ts` · **API:** `MediaRecorder`

O técnico segura um botão e fala, em vez de digitar com a mão suja. A API
`MediaRecorder` grava o microfone em **Opus/WebM** (codec leve — o áudio pode
passar dias na fila do celular sem encher o armazenamento), com limite de ~60s.
O áudio entra na mesma fila da pesagem e sobe junto quando há sinal. A
transcrição em texto acontece **depois**, no servidor — o técnico não espera por
ela.

---

## 9. Fontes que funcionam offline

**Arquivo:** `frontend/src/app/layout.tsx` · **tecnologia:** `next/font`

Detalhe pequeno com efeito grande: as fontes (Manrope, Public Sans) são
**auto-hospedadas no próprio build** pelo `next/font`, não puxadas do Google
Fonts. Um `<link>` para o Google falharia no PWA offline, e ainda entregaria o
texto na fonte do sistema no primeiro instante. Auto-hospedadas, entram no cache
do Service Worker como qualquer outro arquivo.

---

## Juntando tudo: o que sobrevive sem sinal, e o que não

| Ação | Offline? | Graças a |
|---|---|---|
| Abrir o app | **sim** | Service Worker (app shell) |
| Ler o brinco por NFC | sim | Web NFC |
| Ver de que animal é o brinco, raça, último peso | sim | IndexedDB (cópia do rebanho) |
| Registrar peso | sim | IndexedDB (fila) + UUID do cliente |
| Gravar observação em áudio | sim | MediaRecorder (viaja na fila) |
| Trocar de fazenda | sim | sessões pré-baixadas |
| Ver o histórico do servidor daquele animal | não | precisa de rede |
| **Cadastrar animal novo** | **não** | nasce com id do servidor, de propósito |
| Primeiro login | não | precisa emitir o token |
| Dashboard do cliente | não | sem cache, de propósito (dado tem que ser atual) |

O cadastro de animal exige rede de propósito: se o animal nascesse com id local,
dois aparelhos poderiam cadastrar o mesmo bicho e o histórico de peso se partiria
em dois. A pesagem é o que não pode esperar; o cadastro pode.

---

## Resumo em uma frase por tecnologia

- **HTTPS / contexto seguro** — destrava todas as APIs abaixo; sem ele, nada.
- **Service Worker** — guarda o código do app e o serve sem rede; faz *abrir*
  offline.
- **Web App Manifest** — faz *instalar* como app, com ícone e tela cheia.
- **IndexedDB (Dexie)** — o banco no aparelho: rebanho, fila e identidade.
- **UUID no cliente** — torna o reenvio idempotente; a base da fila.
- **Motor de sincronização** — envia, confirma, só então apaga; reconcilia
  quando o sinal volta.
- **JWT + localStorage** — sessão longa e multi-fazenda que opera offline.
- **Web NFC** — ler o brinco encostando o celular, app fechado (Chrome/Android).
- **MediaRecorder** — observação falada, que sobe junto com a pesagem.
- **next/font** — fontes no cache, para a identidade visual não cair offline.

Nenhuma dessas é exótica: são as peças que, somadas sobre HTTPS, transformam uma
página web num app que abre e trabalha no curral como se fosse nativo — sem loja
de aplicativos, sem instalação de pacote, atualizando sozinho a cada visita com
sinal.
