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
| **Entrar na área `/tecnico`** | **não** | sim | sim | sim |
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

- `GET /setup/status` → `{"precisa_configuracao": bool}`. Rota **pública**.
  **Toda tela de entrada consulta**, não só a raiz: `/`, `/tecnico/login` e
  `/dashboard/login`. Quem abre `/tecnico` direto num sistema recém-subido
  cairia num login sem caminho nenhum para sair dele.
- Falha ao consultar o status **não** manda ninguém para o cadastro inicial:
  API fora do ar não é prova de sistema vazio, e oferecer a criação de um admin
  num sistema que já tem dono seria pior que mostrar a tela de login.
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

### Onde se gerencia a equipe

`/dashboard/configuracoes`, com conta de **admin** (ou admin master). Ali se
adiciona pessoa, troca o papel, remove e reativa. Cliente e técnico recebem 403
e um aviso explicando de quem é a área.

**Cliente não entra em `/tecnico`.** Ele é somente leitura e o servidor recusaria
a pesagem com 403 — deixá-lo coletar guardaria no aparelho um peso que nunca
poderia subir, falha que parece ter dado certo e só quebra depois, dentro da
fila. A área mostra uma tela explicando e aponta para o dashboard.

Quando a sincronização falha por papel (e não por rede), a tela da fila diz isso
com todas as letras: insistir não resolveria, e o técnico precisa saber que o
caminho é pedir a mudança de papel a um administrador.

### Outras decisões que valem para os próximos marcos

- **Usuário é global, vínculo é por fazenda.** Adicionar membro com e-mail já
  existente vincula a conta existente, sem tocar em nome ou senha — o admin de
  uma fazenda não manda na conta de quem também atende outra.
- **Admin não muda o próprio papel nem se remove**, senão a fazenda fica sem
  ninguém capaz de gerir membros.
- **`GET /animais/por-brinco/{brinco}`** é a rota que a tela de coleta vai usar
  depois da leitura NFC (M6); ela só encontra animal ativo e não desativado.
- A tela de coleta mostra as **últimas pesagens do animal** logo abaixo do
  formulário: é como o técnico confere se o que acabou de registrar entrou, e
  como se pega erro de digitação (um 55 no lugar de 550) antes de salvar. As da
  fila local aparecem primeiro e marcadas — some-las faria parecer que o registro
  se perdeu. Sem sinal, a lista fica vazia com aviso, e isso não é erro.
- Listagem de animais é paginada (`{itens, total, limite, deslocamento}`); lotes
  e membros vêm como lista simples, por serem poucos.

## 8.1.1. Fuso horário — "hoje" é o dia da fazenda

`TZ=America/Sao_Paulo` no `.env`, aplicado a backend, worker, Postgres e
frontend. **Instantes continuam gravados em UTC** (`timestamptz`); o que muda é a
interpretação de "hoje".

Sem isso, com o container em UTC, `date.today()` vira o dia seguinte às 21h do
horário de Brasília: o contador "pesadas hoje" zera com o técnico ainda no
curral, e a validação de data futura fica um dia deslocada.

No cliente vale a mesma regra por outro caminho: `new Date().toISOString()`
devolve a data em **UTC**, então a coleta feita depois das 21h era gravada com a
data de amanhã. Toda data de calendário sai de `hojeLocal()` em
`lib/formato.ts` — e nunca de `toISOString().slice(0, 10)`.

Ao mudar de país ou de fuso, mexer só no `TZ`; o resto acompanha.

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
  são separados; a diferença é quanto tempo o celular ficou sem sinal.
- **Coleta no futuro é recusada**, tanto na data (1 dia de folga) quanto no
  horário (26 horas de folga). Não é preciosismo: `coletado_em` no futuro vence o
  desempate de "última pesagem" contra toda coleta legítima, e o peso atual do
  animal passa a ser um valor que ninguém mediu naquele momento. Foi assim que um
  peso real registrado pelo técnico deixou de aparecer no dashboard — o seed
  gravava as pesagens do dia às 08:00, hora que ainda estava no futuro.
- Pesagem errada é **desativada**, não apagada: sai da série mas continua
  auditável.

## 8.3. App do técnico e NFC (M5 + M6)

### Telas

**Técnico** (navegação inferior: Início · Coleta · Animais · Mais)

`/tecnico` (início) · `/tecnico/ler` (NFC) · `/tecnico/coleta?brinco=` ·
`/tecnico/confirmacao` · `/tecnico/animal/novo` — as 5 do layout. Mais:
`/tecnico/animais` (rebanho no aparelho, lido do IndexedDB), `/tecnico/fila`
(o que ainda não subiu e por quê), `/tecnico/mais`, `/tecnico/login`,
`/tecnico/offline` e `/tecnico/gravar` (grava a tag NTAG213 de um brinco; sem
ela não haveria como preparar brinco para testar, e depender de app de terceiros
não escala para centenas de animais).

Coleta e cadastro rodam **sem a moldura** (barra superior e abas): são telas de
tarefa, e o técnico está com uma mão no celular e outra no animal.

**Cliente** (barra lateral: Visão geral · Animais · Lotes · Configurações)

`/dashboard` · `/dashboard/animais` (busca e paginação) · `/dashboard/lotes` ·
`/dashboard/lotes/[id]` (formação do lote) · `/dashboard/observacoes` ·
`/dashboard/animal/[id]` ·
`/dashboard/configuracoes` (dados da fazenda e equipe; a gestão de membros é área
de admin e o cliente recebe 403 com aviso). *Relatórios* não entrou: não está no
escopo do MVP (seção 9).

### Formar lote

Criar o lote e formá-lo são coisas diferentes. `/dashboard/lotes` cria o
registro; `/dashboard/lotes/[id]` é onde ele vira um grupo: marca-se quem entra
e confirma-se **em bloco**, por `POST /lotes/{id}/animais`. Mover um animal por
vez seria inviável num curral de cem cabeças — e cada chamada, uma chance de
parar no meio.

- Animal que já está em outro lote aparece como candidato e é **remanejado**:
  trocar de curral é rotina, não exceção.
- Tirar do lote deixa o animal **sem lote**; não apaga nada.
- Id de animal de outra fazenda é ignorado em silêncio, não vira erro — quem
  pediu não deveria nem saber que ele existe. A resposta traz `movidos` e
  `ignorados`.
- No cadastro pelo app do técnico dá para já escolher o lote. Animal que nasce
  sem lote fica fora de toda comparação por grupo até alguém lembrar de
  encaixá-lo — e ninguém lembra.

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

### O que http puro desliga em silêncio

Fora de contexto seguro o navegador remove, sem erro visível, quatro coisas de
que este app depende:

| Recurso | Sem HTTPS |
|---|---|
| Service Worker (abrir offline) | não registra |
| Web NFC | API inexistente |
| `MediaRecorder` / microfone | indisponível |
| `crypto.randomUUID` | **`undefined`** |

O último quebrava a coleta inteira: o UUID é a chave de idempotência do envio, e
sem ele não havia como registrar peso. `lib/uuid.ts` monta o UUID v4 a partir de
`crypto.getRandomValues`, que não tem restrição de contexto. **Ao usar qualquer
API de navegador nova, checar antes se ela exige contexto seguro** — a falha é
silenciosa e só aparece no aparelho.

O app avisa quando está em http (`components/aviso-inseguro.tsx`), dizendo o que
funciona e o que não, para ninguém concluir que o sistema está quebrado.

### HTTPS na rede local — e por que autoassinado não serve

Service Worker, PWA instalável e Web NFC só funcionam em **contexto seguro**.

**Certificado autoassinado não resolve.** O Chrome **recusa registrar Service
Worker em página com erro de certificado**, e clicar em "continuar assim mesmo"
não muda isso: o aviso some da tela, mas a origem segue marcada como insegura por
baixo. O sintoma é traiçoeiro — `isSecureContext` responde `true`, o diagnóstico
mostra "HTTPS: sim", e mesmo assim o registro falha. Foi o que travou o primeiro
teste em campo.

A saída é uma **autoridade certificadora própria**, instalada como confiável no
aparelho. `./traefik/gerar-certificados.sh [IP]` cria a CA (10 anos, reaproveitada
entre execuções para não obrigar a reinstalar nos aparelhos) e o certificado do
servidor (825 dias, o teto que os navegadores aceitam). O Traefik serve a cadeia
completa, e a CA fica baixável em `/ca-engorda.crt` — com o tipo MIME que o
Android reconhece.

`traefik/certificados/` está no `.gitignore`: chave privada, mesmo de
desenvolvimento, não entra no repositório.

No M9, com domínio real, quem emite é o Let's Encrypt e nada disso é necessário.

**`navigator.serviceWorker.ready` nunca rejeita.** Se o registro é barrado, a
promessa simplesmente não resolve — quem espera por ela fica preso para sempre.
Foi assim que a tela ficou em "Preparando…" sem nunca terminar. Toda espera por
ela tem prazo, em `lib/worker.ts`, e o motivo real da falha chega à tela.

### A API responde em `/api`, no mesmo domínio do app

`https://app.<ip>.nip.io:8443/api/...` → Traefik tira o prefixo e manda para o
backend. Isso resolve três coisas de uma vez que atrapalhariam o PWA: conteúdo
misto (app em https não pode chamar API em http), aceitar o certificado duas
vezes (dois hosts) e CORS. `NEXT_PUBLIC_API_URL=/api` no `.env`.

**Toda rota de app precisa de uma rota `/api` irmã.** O router `padrao` manda
host desconhecido (o IP puro, por exemplo) para o frontend; sem o `padrao_api`
correspondente, a chamada da API caía no 404 do Next e o app dizia "sem
conexão" — mandando procurar o problema na rede quando ele era de roteamento.
Ao mexer em `traefik/dinamico/rotas.yml`, o par tem que andar junto.

### "Sem conexão" só quando é sem conexão

`SemConexao` é lançado **apenas** quando o `fetch` rejeita, isto é, quando a
requisição não chegou ao servidor. Resposta que chegou mas não é JSON (HTML de
404, página de erro de proxy) vira `ErroApi` com o status e uma mensagem que
aponta para o endereço da API. Confundir os dois transforma qualquer falha de
rota em "você está sem internet", que é o pior diagnóstico possível: manda o
usuário mexer no lugar errado. Coberto por `frontend/testes/api.test.ts`.

### Como testar offline (o que funciona e o que não)

> Explicação em linguagem não técnica, para técnico de campo e gestor:
> [`docs/modo-offline.md`](docs/modo-offline.md). Mantenha os dois em dia — o de
> lá é o que vai parar na mão de quem usa.

| Ação | Sem sinal |
|---|---|
| Abrir o app | **sim** — Service Worker com o app shell |
| Ler tag NFC | sim |
| Digitar o brinco | sim |
| Ver de que animal é o brinco, raça, porte e último peso | sim — cópia local, baixada no login |
| Ver as pesagens que ele mesmo fez hoje | sim — vêm da fila local |
| Registrar peso | sim — vai para a fila no IndexedDB |
| Gravar observação em áudio | sim — o áudio viaja junto na fila |
| Ver as últimas pesagens do servidor | não — a lista avisa e fica vazia |
| **Cadastrar animal novo** | **não** |
| Primeiro login | não |
| Dashboard do cliente | não (sem Service Worker, de propósito) |

**O escopo do worker é a raiz `/`, mas só `/` e `/tecnico/**` saem do cache.** O
escopo precisa ser a raiz porque quem digita o endereço digita o curto, sem
caminho nenhum — e fora do escopo o worker sequer é consultado, então a página
não abre offline por melhor que esteja guardada. O dashboard passa direto para a
rede: lá dado velho é pior que erro de rede.

**Guardar o HTML não basta.** Sem os scripts, o app abre offline em branco; sem
as fontes — que são declaradas dentro do CSS e não da página — abre com a
tipografia do sistema. O `install` varre o HTML, guarda os `/_next/static`, e
relê cada CSS guardado atrás dos recursos dele. O padrão exclui a barra
invertida de propósito: o Next embute esses caminhos em JSON escapado dentro do
próprio HTML, e sem isso a URL saía com uma barra a mais, virava 404 e o arquivo
ficava fora do cache enquanto tudo parecia ter dado certo.

**`/tecnico/mais` tem um diagnóstico de uso offline** que diz qual das quatro
condições falhou — contexto seguro, worker ativo, telas guardadas, rebanho
baixado — e um botão *Preparar para o campo*. "Não funcionou" não é acionável.

**Dois pré-requisitos, e sem eles o teste não prova nada:**

1. **HTTPS.** Sem contexto seguro o Service Worker não registra e o app
   simplesmente não abre offline (ver 8.3).
2. **Modo produção.** Em `next dev` os chunks mudam a cada compilação e o HMR
   abre um websocket que falha sem rede — "abrir em modo avião" não testa o que
   o técnico vai usar.

Ao voltar o sinal, a sincronização dispara **sozinha** em três momentos: no
evento `online`, ao abrir o app e depois de cada peso salvo. Não existe botão a
apertar — o da tela da fila é só para quem quer forçar.

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

## 8.4. Observação em áudio e transcrição (M7)

O técnico segura um botão e fala, em vez de digitar com a mão suja. O texto vem
depois, no servidor.

- **Duas etapas, nesta ordem: pesagem primeiro, áudio depois.** A pesagem é o
  dado que não pode se perder e sobe em JSON pequeno; o áudio é pesado e pode
  falhar no meio sem levar o peso junto. O motor de sync segue essa ordem — se o
  áudio falhar, o registro fica na fila só por causa dele, e reenviar a pesagem
  não duplica (o id é o mesmo).
- **A transcrição nunca roda na requisição.** É job do `arq`, disparado depois
  que a pesagem já está a salvo. Se o Redis estiver fora do ar, o áudio já foi
  guardado e a pesagem fica `pendente` para reprocessar
  (`POST /pesagens/{id}/transcrever`) — falha de infraestrutura não pode
  penalizar o técnico.
- **API externa primeiro, Whisper local como queda.** A externa é rápida e não
  gasta CPU do servidor, mas depende de rede e de crédito; o local não depende
  de nada além da máquina, e é isso que faz dele um fallback de verdade. Sem
  `TRANSCRICAO_API_CHAVE`, vai direto para o local.
- **Transcrição não apaga o que o técnico digitou.** Digitou *e* gravou? Os dois
  entram em `observacao_texto`, o falado marcado com `(áudio)`.
- **Falha preserva o áudio.** Status vira `falhou`, o objeto continua no MinIO, e
  dá para reprocessar sem o técnico perder o que gravou.
- **Opus/WebM, 60s, 2 MB.** O áudio pode passar dias na fila do celular; codec
  pesado enche o armazenamento do aparelho num dia de curral. O gravador corta
  sozinho no limite.
- **O áudio é servido pela API**, não por link direto do MinIO — senão o
  isolamento por fazenda não valeria para os arquivos. A chave é prefixada por
  `fazendas/{id}/`, o que também facilita cota e expurgo por tenant.

O modelo do Whisper fica em `volumes/modelos/` (`HF_HOME`), senão seria baixado
de novo a cada recriação do container — justamente quando a rede já demonstrou
não estar confiável. Vale pré-aquecer no deploy:

```bash
docker compose exec worker python -m app.transcricao
```

Medido nesta máquina: modelo `small` em CPU leva ~90s no primeiro job (inclui o
download) e poucos segundos depois disso, com o modelo em memória.

## 8.5. Dashboard do cliente (M8)

`GET /metricas/visao-geral` e `GET /metricas/animal/{id}` alimentam as telas 6 e 7.

### GMD é calculado, nunca guardado

Ganho médio diário = (último peso − primeiro peso) ÷ dias entre eles, por SQL e
sob demanda. Coluna com valor derivado viraria fonte de divergência no instante
em que alguém corrigisse ou desativasse uma pesagem — e recalcular é barato
nesta escala. Por isso também **não existe job de recálculo** no worker: seria
complexidade sem ganho.

- **Animal com uma pesagem só tem GMD nulo, não zero.** Zero seria lido como
  "não está ganhando peso", que é uma afirmação diferente de "ainda não dá para
  saber".
- **Desempate explícito** por `data`, `coletado_em`, `id`. Duas pesagens no mesmo
  dia é situação normal (repesagem, correção, duas passagens pelo curral) e sem
  ordem definida o Postgres escolhe uma ao acaso — o mesmo dashboard mostraria
  números diferentes a cada carga. Isso apareceu na conferência contra o SQL
  bruto: 294,02 kg contra 297,94 kg.
- **Pesagem ou animal desativado sai de tudo** — média, GMD e alertas.

### Alertas

| Tipo | Quando | Ordem |
|---|---|---|
| `perda_de_peso` | ganho total negativo | 1º |
| `gmd_baixo` | GMD < 0,500 kg/dia | 2º |
| `sem_pesagem` | mais de 45 dias sem pesar | 3º |

Emagrecer vem antes de ganhar pouco porque é mais grave. Os limites estão em
`app/servicos/metricas.py` (`GMD_MINIMO`, `DIAS_SEM_PESAGEM`) — quando virarem
ajuste por fazenda, é ali que saem para o banco.

### Frontend

`/dashboard` (visão geral) e `/dashboard/animal/[id]` (detalhe), mais
`/dashboard/login`. **Sem Service Worker de propósito**: dado analítico precisa
estar atualizado, e cache agressivo faria o pecuarista decidir com número velho
— o oposto do que o app do técnico precisa.

Os gráficos são SVG escritos à mão (`components/grafico.tsx`) e os ícones também
(`components/icones.tsx`): biblioteca de gráfico custaria ~100 KB de bundle para
desenhar duas linhas, e uma de ícones traria milhares para usar uma dúzia. O
dashboard precisa abrir rápido em conexão de fazenda.

Todo número que o usuário lê passa por `lib/formato.ts` — vírgula decimal e data
`dd/mm/aaaa` montada a partir da string ISO, sem `new Date()`, que escorrega de
fuso e mostra o dia anterior.

## 8.6. Sistema visual e responsividade

### Fontes

Manrope (títulos) e Public Sans (corpo) via `next/font/google`, que as
**auto-hospeda** no build. Não é detalhe: um `<link>` para o Google Fonts falharia
no PWA offline do técnico, e ainda entregaria o layout em `system-ui` no
primeiro paint. As famílias chegam ao Tailwind por variável CSS
(`--fonte-titulo`, `--fonte-corpo`).

### Grades e pontos de quebra

| Tela | Celular | Desktop |
|---|---|---|
| App do técnico | coluna única, `max-w-md` | mesma coluna, centrada |
| Dashboard | gaveta de navegação | barra lateral fixa (`lg:`) |
| Tabelas | cada linha vira cartão | tabela (`md:`) |
| KPIs | 1–2 colunas | 4 colunas (`xl:`) |

**Tabela não rola na horizontal em celular.** Abaixo de `md` cada linha vira um
cartão com o nome da coluna ao lado do valor — rolagem lateral esconde coluna, e
a escondida costuma ser justamente a que importa. Por isso `Celula` recebe
`rotulo` (nome da coluna, visível só no cartão) e `principal` (o valor que
identifica a linha).

**A barra lateral de 240px não cabe num celular de 375px.** Abaixo de `lg` ela
vira gaveta, com fundo clicável, fechamento no Esc e ao navegar.

### Acessibilidade

- **Foco visível** em tudo que recebe teclado (`:focus-visible`, anel de 2px, e
  lima sobre fundo verde para ter contraste). Antes não havia nenhum — navegar
  por teclado era às cegas.
- **Alvo de toque de 56px** nos controles do técnico (o mínimo do WCAG é 44px);
  o dedo é de quem está de luva.
- **Zoom liberado** (`maximumScale: 5`). Travar zoom é barreira que não se paga.
- `prefers-reduced-motion` respeitado.
- Áreas seguras do aparelho (`env(safe-area-inset-*)`): a barra de gestos do
  Android comia o alvo de toque das abas.

### Componentes

`components/ui.tsx` concentra botão, campo, seleção, chip, cartão, KPI,
**esqueleto de carregamento** e **estado vazio**. Esqueleto em vez de
"Carregando…" porque a página não muda de altura quando o dado chega — nada pula
sob o dedo de quem já estava tocando. Estado vazio sempre diz o que houve **e** o
que fazer a seguir.

O `select` desenha a própria seta: `appearance-none` sem seta deixava o campo
com cara de input de texto que não abre nada.

Números que mudam ao vivo usam `.tabular` (`font-variant-numeric: tabular-nums`),
senão a coluna de peso dança a cada atualização.

### Gráfico

`components/grafico.tsx` desenha num sistema de coordenadas amplo (900×340) e
escala por `viewBox`: o texto mantém proporção em qualquer largura, em vez de
virar rabisco no desktop e letra gigante no celular. Tem alvo de toque generoso
por ponto, destaque no hover/foco e legenda de início e fim.

## 8.7. Observações e exportação

### Onde as observações aparecem

Em três lugares, de propósito: no histórico do animal (`/dashboard/animal/[id]`),
na coluna Observação; em `/dashboard/observacoes`, que é o **registro de campo do
rebanho inteiro**; e no CSV. O técnico anota "mancando da pata esquerda" e isso
ficava enterrado no histórico de um animal — é informação de saúde chegando pelo
caminho do peso, e quem cuida do rebanho precisa de um lugar onde ela apareça
sozinha.

Áudio ainda não transcrito também entra na lista, marcado: o gestor precisa saber
que existe observação a caminho, não descobrir depois.

**O áudio original é ouvível** (`components/audio-observacao.tsx`). Não é
redundante com a transcrição: quando o técnico fala "pata **esquerda**" e o
modelo escreve "direita", é o áudio que resolve. O `<audio src>` não aponta para
a API direto — a rota exige cabeçalho de autenticação, então o arquivo é buscado
como blob e tocado de uma URL local, e só quando a pessoa pede.

### Exportação

`GET /exportar/animais.csv`, `/exportar/pesagens.csv` (filtros `animal_id`,
`lote_id`, `desde`, `ate`) e `/exportar/observacoes.csv`.

**O CSV é feito para o Excel em português:** separador `;`, vírgula decimal e BOM
UTF-8. Sem isso a planilha inteira cai numa coluna só e "não" vira "nÃ£o" — o
produto parece quebrado por um detalhe de formato. A variação entre pesagens já
vem calculada, para ninguém precisar montar fórmula.

O download passa por `fetch` e não por `<a href>`: a rota exige token, e um link
simples voltaria 401. O arquivo vira blob e sai por um link temporário.

**PDF sai pelo navegador**, não por biblioteca no servidor. `window.print()` com
folha de estilo de impressão: o motor de PDF do navegador é melhor que
WeasyPrint, não pesa a imagem do backend com Cairo/Pango, e a pessoa escolhe o
papel. No papel, a tabela volta a ser tabela mesmo onde a tela vira cartão.

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
- [x] **M7** — gravação, upload e transcrição de áudio (104 testes)
- [x] **M8** — dashboard do cliente: KPIs, curva, lotes e alertas (116 testes)
- [ ] M9 — deploy VPS
- [ ] M10 — hardening

### Verificar o frontend sem quebrar o servidor de desenvolvimento

**Não rodar `next build` no container com o `next dev` em pé.** Os dois disputam
a mesma pasta `.next`: o build sobrescreve o que o dev está servindo, e o
resultado vai de um falso "Failed to collect page data" a 404 em todas as rotas
até recriar o container. Para checar tipos, use o que não toca no `.next`:

```bash
docker compose exec frontend npx tsc --noEmit
```

Para um build de verdade, suba o overlay de produção (`docker-compose.pwa.yml`),
que roda `npm run build` como comando do container.

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
