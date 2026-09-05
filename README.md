# Engorda — Acompanhamento de Peso de Bezerros

Sistema para acompanhar a evolução de peso de bezerros em engorda, com dois
públicos:

- **Técnico de campo** — registra o peso no curral, pelo celular, **com ou sem
  internet**. Lê o brinco por aproximação (NFC) e pode ditar a observação em vez
  de digitar.
- **Cliente** — acompanha a evolução do rebanho: peso médio, ganho médio diário
  (GMD), desempenho por lote e alertas.

Multi-fazenda desde o primeiro dia, com isolamento em duas camadas.

---

## Começando

Requisitos: Docker e Docker Compose.

```bash
cp .env.example .env
./traefik/gerar-certificados.sh          # certificados de desenvolvimento
docker compose up -d --build
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.seed
```

| | |
|---|---|
| App do técnico | http://app.localhost:8081/tecnico |
| Painel do cliente | http://app.localhost:8081/dashboard |
| API (Swagger) | http://api.localhost:8081/docs |
| MinIO | http://minio.localhost:8081 |
| Traefik | http://localhost:8090 |

**Usuários de teste** (senha `engorda123`):

| E-mail | Papel |
|---|---|
| `master@teste.com` | admin master — alcança todas as fazendas |
| `admin@teste.com` | administrador das duas fazendas |
| `tecnico@teste.com` | técnico das duas fazendas |
| `joao@teste.com` | cliente da Fazenda Boa Vista |
| `marina@teste.com` | cliente da Fazenda Santa Clara |

Numa instalação vazia, a primeira tela cria o administrador e a primeira
fazenda.

---

## Testes

```bash
docker compose exec backend pytest -q      # 174 testes
docker compose exec frontend npm run test  #  31 testes
docker compose exec frontend npx tsc --noEmit
```

A suíte do backend monta o banco pelas **migrations** e conversa com a API pelo
**papel restrito** do Postgres — o mesmo de produção. Com `create_all` e
superusuário, os testes de isolamento passariam sem provar nada.

> Não rode `next build` no container com o servidor de desenvolvimento em pé: os
> dois disputam a pasta `.next`. Para checar tipos use `tsc --noEmit`; para um
> build de verdade, o overlay `docker-compose.pwa.yml`.

---

## Arquitetura

| Camada | Tecnologia |
|---|---|
| Backend | FastAPI · SQLAlchemy async · asyncpg |
| Worker | `arq` sobre Redis — transcrição de áudio |
| Frontend | Next.js 15 · React 19 · Tailwind |
| Banco | PostgreSQL, com Row-Level Security |
| Arquivos | MinIO (S3-compatível) — áudios e logos |
| Proxy | Traefik |

Tudo self-hosted, em Docker Compose.

### Decisões que explicam o resto

**O celular é a fonte da verdade enquanto não há sinal.** A pesagem nasce com um
UUID gerado no aparelho, fica no IndexedDB e só é apagada de lá depois que o
servidor confirmou o recebimento. Reenviar não duplica — a idempotência é o que
torna seguro tentar de novo quantas vezes for preciso.

**Isolamento em duas camadas.** A aplicação injeta o `fazenda_id` a partir do
token, e o Postgres aplica Row-Level Security por baixo. A segunda existe para o
dia em que a primeira falhar: o erro vira "nenhum resultado" em vez de "dados de
outro cliente". A aplicação conecta com um papel **não superusuário** — sem isso
as políticas seriam decorativas.

**Nada é apagado.** Animais, lotes, membros e pesagens são desativados, nunca
removidos. Peso é o produto do sistema e precisa continuar auditável depois de
sair da série.

**Cálculo derivado não é guardado.** O GMD é recalculado por SQL sob demanda;
coluna com valor derivado viraria fonte de divergência assim que alguém
corrigisse uma pesagem.

---

## Documentação

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Documentação técnica completa — modelo de dados, decisões e armadilhas |
| [`docs/modo-offline.md`](docs/modo-offline.md) | Como o modo offline funciona, em linguagem não técnica |

---

## Operação

```bash
./scripts/backup.sh                        # banco + áudios, com verificação
./scripts/restaurar.sh <arquivo.dump>      # restauração, com confirmação
```

O backup confere o dump com `pg_restore --list` antes de aceitá-lo: dump que não
abre não é backup.

No cron:

```
0 3 * * * cd /caminho/do/projeto && ./scripts/backup.sh >> volumes/backup.log 2>&1
```

---

## Segurança

- Segredos ficam no `.env`, que **não** vai para o repositório. Antes de
  produção, troque `SECRET_KEY`, `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD` e
  `MINIO_ROOT_PASSWORD`.
- `traefik/certificados/` também está fora do repositório — recrie com
  `./traefik/gerar-certificados.sh`.
- Senhas passam por SHA-256 e bcrypt; nunca são gravadas em texto.

---

## Estado

Concluídos: infraestrutura, modelagem, autenticação multi-tenant, cadastros,
pesagem idempotente, PWA offline do técnico, NFC, áudio com transcrição,
dashboard, e o hardening (RLS + backup).

Pendente: **deploy em produção** (domínio, HTTPS e senhas próprias) e a
**validação em celular real** do modo offline e da leitura de tag física.

O plano completo, marco a marco, está na seção 8 do [`CLAUDE.md`](CLAUDE.md).
