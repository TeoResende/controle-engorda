# Acompanhamento de Peso — Engorda de Bezerros

## 1. O que é este projeto

Sistema web para acompanhamento da evolução de peso de bezerros em engorda (confinamento/pasto). Dois públicos:

- **Técnico de campo**: usa o celular para ler o brinco do animal (NFC) e registrar peso, direto no curral, com ou sem internet.
- **Cliente (pecuarista/gestor)**: acompanha a evolução do rebanho por um dashboard analítico — peso, ganho médio diário (GMD), alertas.

Cada animal tem um brinco físico de 4 dígitos com um chip NTAG213 embutido. Ao encostar o celular no brinco, o app abre direto na tela de coleta, já com o número do animal identificado.

**MVP:** Android apenas (Web NFC só funciona em Chrome/Android). iOS entra em uma segunda jornada, com QR Code como mecanismo universal de leitura (ver seção 6). Multi-fazenda desde o início (SaaS multi-tenant). Escopo funcional do MVP: só peso/crescimento — saúde, genealogia e venda ficam para depois, mas o modelo de dados não pode bloquear essas extensões.

## 2. Stack e infraestrutura

Self-hosted em VPS própria, Linux + Docker Compose.

| Camada | Tecnologia |
|---|---|
| Backend | FastAPI (Python 3.12), SQLAlchemy async + asyncpg |
| Worker | `arq` sobre Redis — jobs assíncronos (transcrição de áudio, recálculo de GMD/alertas) |
| Frontend | Next.js 15 (App Router, React 19, Tailwind) |
| Banco | PostgreSQL (+ `pgvector` disponível para uso futuro, não usado no MVP) |
| Fila/locks | Redis |
| Armazenamento de arquivos | MinIO (S3-compatível, self-hosted) — áudios de observação |
| Proxy / HTTPS | Traefik — certificado TLS automático (Let's Encrypt) |

**HTTPS não é opcional.** Leitura de NFC, gravação de áudio (`MediaRecorder`) e funcionamento como PWA instalável só operam em contexto seguro (HTTPS). O Traefik entra no docker-compose desde o primeiro dia por isso.

### Estrutura de pastas

```
engorda_leite/
├── docker-compose.yml
├── CLAUDE.md
├── backend/
│   └── app/
│       ├── main.py
│       ├── core/            # config, auth, deps (isolamento multi-tenant)
│       ├── models/          # SQLAlchemy models
│       ├── schemas/         # Pydantic schemas
│       ├── api/             # routers (fazendas, animais, lotes, pesagens, auth)
│       ├── migrations/      # Alembic
│       └── worker.py        # jobs arq (transcrição, recálculo GMD)
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── tecnico/     # PWA offline-first (Service Worker escopado aqui)
│       │   └── dashboard/   # área do cliente, sempre online, sem cache agressivo
│       ├── components/
│       └── lib/             # cliente de API, IndexedDB (Dexie), engine de sync
└── volumes/                 # dados persistentes dos containers (gitignored)
```

## 3. Modelo de dados

```sql
-- Todas as tabelas abaixo têm `desativado_em` (NULL = ativo): nada é apagado.
fazendas(id, nome, proprietario, endereco, plano, criado_em, desativado_em)
usuarios(id, nome, email, senha_hash, admin_master, criado_em, desativado_em)
  -- admin_master: superusuário, opera qualquer fazenda sem vínculo
usuario_fazenda(usuario_id, fazenda_id, papel[tecnico|cliente|admin], desativado_em)
  -- um usuário pode ter papéis diferentes em fazendas diferentes
lotes(id, fazenda_id, nome, data_formacao, criado_em)
animais(id, fazenda_id, brinco, nome, raca, porte, brinco_mae,
        data_nascimento, peso_nascimento, lote_id, status,
        observacoes, criado_em)
  -- índice único parcial em (fazenda_id, brinco)
  -- WHERE status='ativo' AND desativado_em IS NULL
animal_brinco_historico(id, animal_id, brinco, vinculado_em, desvinculado_em)
  -- histórico de troca de brinco, sem perder o rastro do animal
pesagens(id [uuid gerado no celular], fazenda_id, animal_id, data,
         peso_kg, observacao_texto, observacao_audio_url,
         status_transcricao[pendente|processando|concluida|falhou],
         tecnico_id, latitude, longitude,
         coletado_em, sincronizado_em)
```

**Multi-tenant em duas camadas**: (1) toda query no FastAPI passa por uma dependency que injeta `fazenda_id` a partir do token — nunca manual por endpoint; (2) Postgres Row-Level Security como segunda barreira, a ativar antes de colocar fazendas reais em produção (não bloqueia o desenvolvimento do MVP).

## 4. Autenticação

**Como está implementado (M2):** o `fazenda_id` viaja assinado *dentro* do token,
junto com `sub` (usuário) e `papel`. Trocar de fazenda é trocar de token
(`POST /auth/trocar-fazenda`) — nenhum endpoint de dados aceita `fazenda_id` no
corpo ou na query. Quem atende mais de uma fazenda escolhe no login; omitir a
escolha com dois vínculos devolve 409 com a lista das fazendas.

O isolamento não é escrito endpoint a endpoint: a dependency `SessaoDep` entrega
uma `SessaoFazenda` (`app/core/deps.py`) cujo `selecionar()` já aplica o filtro e
cujo `adicionar()` carimba o `fazenda_id`. Endpoint que use a sessão crua é
exceção e precisa de justificativa. Id de outra fazenda responde **404, não 403**
— um 403 confirmaria que o registro existe.

**Limitação conhecida, a resolver no M10:** com access token de 12h, revogar o
acesso de um usuário só surte efeito na renovação — o token já emitido continua
valendo até expirar. O `refresh` relê o vínculo no banco e o usuário desativado
perde acesso na hora (ambos cobertos por teste), mas a revogação imediata de um
access token exigiria uma denylist em Redis. É o preço consciente do token longo,
que existe para o técnico operar horas offline.

JWT (access + refresh). Access token com validade longa (~12h) porque o técnico fica horas sem sinal em campo — o app precisa continuar funcionando offline mesmo com o token "vencendo", já que a renovação só é necessária no momento de sincronizar (quando já há internet de novo).

## 5. Motor de sincronização offline

1. Técnico registra pesagem (e opcionalmente grava áudio) → salvo no IndexedDB do celular com um **UUID gerado no próprio cliente** (evita duplicar registro se a mesma pesagem for reenviada).
2. Sem internet, tudo fica na fila local — inclusive o app inteiro precisa abrir offline (Service Worker com cache do app shell, não só dos dados).
3. Ao detectar conexão: envia a pesagem (JSON) → servidor confirma (idempotente pelo UUID) → envia o áudio, se houver → servidor confirma → só então apaga a cópia local.
4. Se o upload falhar no meio do caminho, o registro continua na fila e tenta de novo automaticamente.
5. Transcrição do áudio acontece **depois** que o dado já está seguro no servidor (job assíncrono no worker `arq`), o técnico não espera por isso.

**Transcrição de áudio:** worker tenta API externa primeiro; se falhar/indisponível, cai automaticamente para Whisper local rodando na VPS (fallback). Limitar duração da observação em áudio (~60s) e usar codec leve (Opus/WebM) para não pesar o armazenamento local em dias longos sem sinal.

## 6. Leitura de tag (NFC → QR Code na Jornada 2)

MVP: Web NFC API (`NDEFReader`), Chrome/Android apenas. A tag NTAG213 é gravada com a URL de coleta contendo o número do brinco (ex: `https://app.dominio.com/tecnico/coleta?brinco=1234`).

Jornada 2 (expansão iOS): Safari/iOS não suporta Web NFC via navegador — vai exigir QR Code lido pela câmera (`getUserMedia` + biblioteca de leitura de QR) como mecanismo universal, sem exigir app nativo. Vale desenhar a URL de coleta já pensando nisso, mas a fabricação do brinco com QR Code físico fica para depois.

## 7. Layout já validado

Canvas de telas (técnico + dashboard do cliente), 7 telas, publicado em: https://claude.ai/code/artifact/dce0550c-8d64-4ae5-90b9-3a865f66fb9b

**Paleta** (referência: Coopervass): verde escuro `#1E4B3B` (primária), lima `#C6D400` (destaque/ações), fundo `#F6F7F2`. Tipografia: Manrope (títulos) + Public Sans (corpo).

Telas do técnico: Início → Leitura NFC → Coleta de peso → Confirmação → Cadastro de animal.
Telas do cliente: Visão geral (KPIs, gráfico agregado, lotes, alertas) → Detalhe do animal (gráfico individual, histórico).

## 8. Plano de construção — passo a passo testável

Cada marco abaixo é pequeno o suficiente para validar sozinho antes de seguir para o próximo. Não pule marcos.

**M0 — Fundação de infraestrutura**
`docker-compose.yml` com postgres, redis, backend, worker, frontend, minio, traefik.
*Teste:* `docker compose up` sobe tudo sem erro; backend responde em `/health`; Postgres aceita conexão.

**M1 — Modelagem de dados**
SQLAlchemy models + Alembic migrations para todas as tabelas da seção 3.
*Teste:* migrations rodam limpo (`alembic upgrade head`); seed de dados de teste funciona.

**M2 — Autenticação e isolamento multi-tenant**
Login JWT, papel por fazenda, dependency de isolamento automático por `fazenda_id`.
*Teste:* login funciona; endpoint protegido nega acesso sem token; teste automatizado confirma que usuário da fazenda A não enxerga dados da fazenda B.

**M3 — API de cadastro**
CRUD de fazendas, usuários, animais, lotes.
*Teste:* suíte de testes automatizados (pytest) cobrindo os CRUDs; Swagger/OpenAPI navegável.

**M4 — API de pesagem + idempotência**
Endpoint de pesagem recebendo UUID gerado no cliente.
*Teste:* enviar a mesma pesagem duas vezes não duplica registro (teste automatizado).

**M5 — App do técnico (PWA offline) — telas 1 a 5**
Next.js `/tecnico`, Service Worker escopado, IndexedDB (Dexie), telas conforme o layout aprovado.
*Teste:* app abre em modo avião; pesagem salva localmente e sincroniza sozinha ao reconectar.

**M6 — Leitura NFC real**
`NDEFReader`, tag física de teste gravada com a URL de coleta.
*Teste:* encostar a tag física no celular abre a tela de coleta com o brinco certo.

**M7 — Upload e transcrição de áudio**
`MediaRecorder`, upload multipart, worker com API externa + fallback Whisper.
*Teste:* gravação feita offline sincroniza depois; texto transcrito aparece na pesagem.

**M8 — Dashboard do cliente — telas 6 e 7**
Next.js `/dashboard`, gráficos, GMD, alertas.
*Teste:* números do dashboard batem com as pesagens de teste inseridas.

**M9 — Deploy real na VPS**
Traefik + Let's Encrypt, deploy em produção.
*Teste:* acesso via HTTPS; PWA instalável em celular Android real; leitura de NFC funciona no aparelho real.

**M10 — Hardening multi-tenant**
Postgres Row-Level Security, backup agendado (`pg_dump`).
*Teste:* tentativa de acesso cross-tenant é bloqueada mesmo simulando uma falha na camada de aplicação.

## 8.1. Acesso, papéis e ciclo de vida dos registros (M3)

| | cliente | técnico | admin | admin master |
|---|---|---|---|---|
| Ler animais, lotes, fazenda | sim | sim | sim | sim |
| Criar/editar animais e lotes | não | sim | sim | sim |
| Editar dados da fazenda | não | não | sim | sim |
| Gerir membros | não | não | sim | sim |
| Ver/operar **todas** as fazendas | não | não | não | sim |
| Desativar/reativar fazenda | não | não | não | sim |

### Admin master (superusuário)

`usuarios.admin_master` — enxerga e opera **qualquer** fazenda ativa, sem
precisar de vínculo, sempre com papel efetivo `admin`. É o dono do SaaS.

- A flag é lida **do banco** a cada requisição, não do claim do token: revogar
  um superusuário tem efeito imediato, sem esperar o token de 12h expirar.
- **Admin master não se rebaixa nem é rebaixado**: admin de fazenda recebe 403 ao
  tentar mudar o papel dele ou removê-lo da fazenda.
- No login sem `fazenda_id`, ele recebe 409 com **todas** as fazendas ativas do
  sistema (a lista é limitada a 100 no retorno).
- `GET /fazendas` (todas do sistema) é exclusivo dele. Usuário comum vê as
  fazendas dele em `GET /auth/eu`.

### Primeiro acesso

Sistema sem nenhum usuário não consegue autenticar ninguém — e portanto não teria
como criar o primeiro administrador. O router `/setup` resolve isso e se fecha
sozinho:

- `GET /setup/status` → `{"precisa_configuracao": bool}`. Rota **pública**; o
  frontend consulta antes da tela de login e manda o visitante para
  `/primeiro-acesso` se o sistema estiver vazio.
- `POST /setup/primeiro-acesso` cria o primeiro **admin master** e a primeira
  fazenda no mesmo passo (sem fazenda ele não conseguiria logar), e já devolve a
  sessão pronta. A partir do primeiro usuário existente, responde 409 para
  sempre.

### Nada é apagado — tudo é desativação

Todo registro relevante tem `desativado_em` (`NULL` = ativo): `fazendas`,
`usuarios`, `usuario_fazenda`, `lotes`, `animais` e `pesagens`. `DELETE` nos
endpoints **desativa**; existe `POST .../reativar` para desfazer.

- Listagens escondem inativos por padrão; `?incluir_inativos=true` mostra o
  histórico. Busca **por id** encontra desativado de propósito — é o que permite
  consultar histórico e reativar.
- `SessaoFazenda.selecionar()` já aplica esse filtro, então esquecê-lo não é
  possível por descuido — mesma lógica do isolamento por fazenda.
- Em `animais`, `status` (vendido/morto/transferido) e `desativado_em` são
  **ortogonais**: `status` diz por que o animal saiu do rebanho, a desativação diz
  que o registro saiu de circulação. O índice parcial do brinco considera os
  dois (`status = 'ativo' AND desativado_em IS NULL`), então brinco de animal
  desativado pode ser reaproveitado — e reativar esse animal devolve 409 se a tag
  já foi para outro.
- Desativar membro **não** apaga o vínculo: some da lista, bloqueia o login
  naquela fazenda, e o registro de que a pessoa trabalhou ali continua
  consultável. Readicionar o mesmo e-mail **reativa** o vínculo antigo.

### Outras decisões que valem para os próximos marcos

- **Usuário é global, vínculo é por fazenda.** Adicionar membro com e-mail já
  existente vincula a conta existente, sem tocar em nome ou senha — o admin de
  uma fazenda não manda na conta de quem também atende outra.
- **Admin não muda o próprio papel nem se remove**, senão a fazenda fica sem
  ninguém capaz de gerir membros.
- **`GET /animais/por-brinco/{brinco}`** é a rota que a tela de coleta vai usar
  depois da leitura NFC (M6); ela só encontra animal ativo e não desativado.
- Listagem de animais é paginada (`{itens, total, limite, deslocamento}`); lotes
  e membros vêm como lista simples, por serem poucos.

## 8.2. Pesagem e idempotência (M4)

`POST /pesagens` recebe o **UUID gerado no celular**. É esse id que torna o envio
idempotente — e a idempotência não é um detalhe de implementação, é o que permite
a fila offline reenviar sem medo.

- **201 se criou agora, 200 se o id já existia.** O app usa o código para saber
  se aquilo era novidade, mas trata os dois como sucesso e apaga a cópia local.
- **Reenvio com conteúdo diferente não sobrescreve**: vale o que chegou primeiro.
  Sobrescrever em silêncio esconderia um bug do cliente. Corrigir peso é
  `PATCH /pesagens/{id}` — não mandar um id novo, que viraria um segundo ponto na
  série de peso do animal.
- **A checagem prévia não basta**: entre o SELECT e o INSERT cabe outro INSERT. A
  barreira real é a PK; quem perde a corrida lê o registro do vencedor em vez de
  estourar 500 (coberto por teste).
- **`POST /pesagens/lote`** descarrega a fila inteira (máx. 500). É processado
  item a item de propósito: uma pesagem inválida no meio não pode travar a
  sincronização do dia. A resposta traz `{criadas, duplicadas, erros}` e o
  resultado de cada item, com o motivo do erro em texto para o app mostrar ao
  técnico.
- **O animal pode vir por `animal_id` ou por `brinco`** — o aparelho pode ter lido
  a tag de um animal cujo UUID ele ainda não sincronizou. `animal_id` tem
  prioridade.
- **A autoria vem do token**, nunca do corpo: o aparelho não escolhe em nome de
  quem a pesagem é assinada.
- **`coletado_em` (relógio do aparelho) e `sincronizado_em` (relógio do servidor)**
  são separados; a diferença é quanto tempo o celular ficou sem sinal. Data de
  coleta no futuro é recusada com 1 dia de folga para fuso horário — só pode ser
  relógio errado.
- Pesagem errada é **desativada**, não apagada: sai da série mas continua
  auditável.

## 8.3. App do técnico e NFC (M5 + M6)

### Telas

`/tecnico` (início) · `/tecnico/ler` (NFC) · `/tecnico/coleta?brinco=` ·
`/tecnico/confirmacao` · `/tecnico/animal/novo` — as 5 do layout. Mais três de
apoio: `/tecnico/login`, `/tecnico/offline` e `/tecnico/gravar` (grava a tag
NTAG213 de um brinco; sem ela não haveria como preparar brinco para testar, e
depender de app de terceiros não escala para centenas de animais).

### O que sobrevive sem sinal, e o que não

| Ação | Offline? |
|---|---|
| Abrir o app | sim — Service Worker com o app shell |
| Ler tag NFC | sim |
| Registrar peso | sim — vai para a fila no IndexedDB |
| Ver de que animal é o brinco | sim — cópia local do rebanho, baixada no login |
| **Cadastrar animal novo** | **não** |
| Primeiro login | não |

O cadastro de animal exige internet de propósito: o animal nasce com id do
servidor. Criar ids locais para animais abriria a porta para dois cadastros do
mesmo bicho vindos de dois aparelhos, e aí o histórico de peso se parte em dois.
A pesagem é o que não pode esperar; o cadastro pode.

### Motor de sincronização

A ordem é: envia → servidor confirma → **só então** apaga a cópia local. Se a
conexão cai no meio, o registro fica na fila e sobe depois; como o id nasce no
celular, reenviar não duplica (M4). Uma pesagem que o servidor **recusa** (brinco
inexistente, por exemplo) fica na fila com o motivo à vista — erro de dado não se
resolve sozinho, e o técnico precisa saber para corrigir.

Dispara sozinho ao abrir o app, ao voltar o sinal (evento `online`) e depois de
cada peso salvo. Envia em blocos de 200, em ordem de coleta.

Coberto por `frontend/testes/sync.test.ts` (Dexie real sobre `fake-indexeddb`, não
dublê). É o código de maior risco do projeto: perder pesagem coletada no curral é
um defeito silencioso — ninguém percebe até procurarem o peso e ele não estar lá.

### NFC

A tag é gravada com a **URL de coleta inteira**, não só com o número. É o que faz
encostar o celular funcionar com o app fechado: o Android abre a URL direto na
tela de coleta. `brincoDoTexto()` aceita a URL ou o número puro.

### HTTPS na rede local

Service Worker, PWA instalável e Web NFC só funcionam em **contexto seguro** —
sem HTTPS, M5 e M6 não são testáveis em celular, só no localhost da máquina de
desenvolvimento. Por isso existe um certificado autoassinado em
`traefik/certificados/` (gerado com `openssl`, SANs para os hosts `.nip.io`, os
`.localhost` e o IP). O navegador avisa que não confia; aceitar a exceção uma vez
basta. No M9 quem emite é o Let's Encrypt e este certificado sai de cena.

### A API responde em `/api`, no mesmo domínio do app

`https://app.<ip>.nip.io:8443/api/...` → Traefik tira o prefixo e manda para o
backend. Isso resolve três coisas de uma vez que atrapalhariam o PWA: conteúdo
misto (app em https não pode chamar API em http), aceitar o certificado duas
vezes (dois hosts) e CORS. `NEXT_PUBLIC_API_URL=/api` no `.env`.

### Como testar no celular Android

1. Suba o frontend em modo produção — em `next dev` os chunks mudam a cada
   compilação e o HMR abre um websocket que falha sem rede, então "abrir em modo
   avião" não prova nada:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.pwa.yml up -d frontend
   ```
2. No Chrome do Android, abra `https://app.192.168.0.130.nip.io:8443/tecnico` e
   aceite o aviso de certificado.
3. Entre com `tecnico@teste.com` / `engorda123` e escolha a fazenda.
4. Menu do Chrome → *Instalar app*. Abra pelo ícone.
5. **Teste offline:** ligue o modo avião, abra o app pelo ícone, registre um
   peso. A faixa do topo mostra a fila. Desligue o modo avião e veja a fila
   zerar sozinha.
6. **Teste NFC:** em *Gravar tag de um brinco*, escreva `1002` numa NTAG213.
   Volte ao início, toque em *Ler brinco* e encoste o celular na tag — a tela de
   coleta abre com o brinco preenchido.

## 9. Fora de escopo no MVP (não implementar ainda)

Suporte iOS/QR Code (Jornada 2), módulo de saúde/vacinação, genealogia completa, controle de venda/abate, integração com balanças eletrônicas, uso de `pgvector`.

## 10. Estado atual da construção

- [x] **M0** — infraestrutura Docker Compose (postgres, redis, minio, traefik, backend, worker, frontend)
- [x] **M1** — models SQLAlchemy + Alembic + seed de teste
- [x] **M2** — login JWT, papel por fazenda, isolamento automático + suíte pytest
- [x] **M3** — CRUD de fazendas, membros, lotes e animais; admin master, primeiro acesso e soft delete (67 testes)
- [x] **M4** — pesagem com idempotência pelo UUID do cliente (88 testes)
- [x] **M5** — PWA offline do técnico (Service Worker, IndexedDB, motor de sync)
- [x] **M6** — leitura e gravação de tag NFC *(falta validar em celular real)*
- [ ] M7 — áudio + transcrição
- [ ] M8 — dashboard
- [ ] M9 — deploy VPS
- [ ] M10 — hardening

### Como rodar em desenvolvimento

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.seed          # --reset recria do zero
```

Rodar os testes:

```bash
docker compose exec backend pytest -q
docker compose exec frontend npm run test
```

A suíte usa um banco Postgres separado (`engorda_test`), recriado a cada
execução — nunca toca o banco de desenvolvimento. Postgres de verdade e não
SQLite porque partes do schema são específicas do Postgres (índice parcial do
brinco, ENUMs nativos).

Usuários do seed (senha `engorda123` em todos): `master@teste.com` (admin master,
sem vínculo — alcança tudo), `admin@teste.com` (admin nas duas fazendas),
`tecnico@teste.com` (técnico nas duas), `joao@teste.com` (cliente da Boa Vista),
`marina@teste.com` (cliente da Santa Clara). Duas fazendas de propósito: o isolamento multi-tenant
do M2 só é testável se existir dado de outro tenant para vazar.

O Traefik roteia **por hostname**, então a porta 8081 com o IP puro precisava de
uma rota explícita — existe o router `padrao`, que manda host desconhecido para o
frontend. Os hosts `*.<IP>.nip.io` funcionam de qualquer aparelho da rede local
(inclusive do celular Android, útil a partir do M5) sem editar `/etc/hosts`.

Da própria máquina:
- API: http://api.localhost:8081/health · http://api.localhost:8081/docs
- Frontend: http://app.localhost:8081
- MinIO console: http://minio.localhost:8081
- Traefik dashboard: http://localhost:8090

Da rede local (IP atual da máquina: 192.168.0.130 — se mudar, ajustar
`traefik/dinamico/rotas.yml` e `NEXT_PUBLIC_API_URL` no `.env`):
- Frontend: http://192.168.0.130:8081 ou http://app.192.168.0.130.nip.io:8081
- API: http://api.192.168.0.130.nip.io:8081/docs
- MinIO console: http://minio.192.168.0.130.nip.io:8081
- Traefik dashboard: http://192.168.0.130:8090

Em produção, `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` ativa Let's Encrypt e redirecionamento HTTPS (M9).

### Decisões de infra tomadas no M0 (afetam o M9)

1. **Traefik usa o file provider, não o provider Docker.** O cliente Docker embutido no Traefik negocia a API 1.24, que o daemon 29.x recusa (mínimo 1.40) — o provider Docker fica em erro permanente e nenhuma rota é criada. As rotas ficam declaradas em `traefik/dinamico/rotas.yml` (dev) e `traefik/dinamico-prod/rotas.yml` (produção, com `certResolver: le`). Serviço novo = nova entrada nesses arquivos, não label no compose.
2. **Portas 80/443 já estão ocupadas nesta máquina** pelo stack `servicedesk-npm-1` (Nginx Proxy Manager). Em dev o Traefik escuta em `TRAEFIK_HTTP_PORT` (8081) / `TRAEFIK_HTTPS_PORT` (8443), configuráveis no `.env`. **No M9 isso precisa ser resolvido**: ou o Traefik assume 80/443 na VPS de produção, ou o app entra atrás do Nginx Proxy Manager existente (e aí o Let's Encrypt fica com o NPM, não com o Traefik).
3. **Backend e worker rodam com o UID/GID do host** (`UID_HOST`/`GID_HOST` no `.env`). Sem isso, todo arquivo gerado dentro do container no bind mount — migration do Alembic, por exemplo — nasce como root e não é editável no host.
4. **`bcrypt` direto, sem `passlib`.** A passlib 1.7.4 está sem manutenção e quebra com bcrypt >= 4.1 (`password cannot be longer than 72 bytes`). Senhas passam por SHA-256 + base64 antes do bcrypt, o que remove o limite de 72 bytes — a mesma transformação é aplicada no hash e na verificação (`app/core/security.py`).
5. **Downgrade de migration precisa derrubar os tipos ENUM na mão.** O autogenerate do Alembic cria os tipos junto com as tabelas mas não os remove; sem o `DROP TYPE` explícito, `downgrade` seguido de `upgrade` falha com "type already exists". Ver o fim do `downgrade()` na migration inicial e repetir o padrão em migrations futuras que criem ENUMs.
6. **Migration que muda índice parcial precisa ser escrita à mão.** O
   autogenerate do Alembic não compara a cláusula `WHERE` de um índice parcial —
   a mudança passa despercebida. Ver `682ebecaeba1`, que dropa e recria o
   `uq_animal_brinco_ativo`. O mesmo vale para coluna `NOT NULL` nova em tabela
   com dados: precisa de `server_default` no `add_column`, removido logo depois.
7. Antes do M9, trocar `SECRET_KEY`, `POSTGRES_PASSWORD` e `MINIO_ROOT_PASSWORD` do `.env` e substituir `SEU-DOMINIO.com` em `traefik/dinamico-prod/rotas.yml`.
