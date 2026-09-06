# Fechar a segurança e subir em produção

Este é o passo a passo para a VPS com **proxy externo** gerando o SSL e
encaminhando para o container (Nginx Proxy Manager, Caddy, Cloudflare — o TLS
termina lá, e aqui dentro o Traefik só roteia em HTTP).

O que liga o "modo produção" é o overlay `docker-compose.proxy.yml`: ele define
`AMBIENTE=producao`, o que faz a aplicação **recusar subir** com segredo de
exemplo e esconder `/api/docs` e `/api/pronto`. A recusa é barulhenta de
propósito — ela imprime exatamente qual variável está errada.

> **Regra de ouro:** a trava de subida barra `SECRET_KEY`, `POSTGRES_PASSWORD`,
> `POSTGRES_APP_PASSWORD` e `MINIO_ROOT_PASSWORD` enquanto forem os valores de
> exemplo (publicados no repositório), e também barra `CORS_ORIGENS=*`. Cada uma
> tem uma forma certa de trocar — três delas são fáceis, **uma tem armadilha**.

## 1. Atualizar o código na VPS

```bash
cd /caminho/do/projeto
git pull
```

## 2. Ver o que ainda é valor de exemplo

```bash
grep -E '^(SECRET_KEY|POSTGRES_PASSWORD|POSTGRES_APP_PASSWORD|MINIO_ROOT_PASSWORD|CORS_ORIGENS)=' .env
```

Compare com os valores de exemplo — se bater, precisa trocar:

| Variável | Valor de exemplo |
|---|---|
| `SECRET_KEY` | `troque-esta-chave-em-producao` |
| `POSTGRES_PASSWORD` | `engorda_dev_senha` |
| `POSTGRES_APP_PASSWORD` | `engorda_app_dev` |
| `MINIO_ROOT_PASSWORD` | `minioadmin_dev` |
| `CORS_ORIGENS` | `*` |

O que **já** for diferente do exemplo, deixe como está — o sistema está rodando,
então esses valores estão consistentes com o banco.

## 3. Gerar os segredos novos

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # cada senha
```

## 4. Trocar cada um — pela forma certa

### `SECRET_KEY` — sempre seguro

É só a chave de assinatura de token. Trocar **desloga todo mundo** (desejado, se
a antiga vazou) e nada mais. Edite no `.env` e pronto.

### `CORS_ORIGENS` — obrigatório

```
CORS_ORIGENS=https://engorda.kurtenet.com.br
```

Sem isto, a trava recusa subir (`CORS_ORIGENS=*` é bloqueado).

### `POSTGRES_APP_PASSWORD` — fácil

A senha do usuário restrito da aplicação é **reaplicada pela migration a cada
subida** (`ALTER ROLE engorda_app ...`). Basta editar o `.env`; ao subir, ela é
ajustada no banco sozinha.

### `MINIO_ROOT_PASSWORD` — fácil

O MinIO lê as credenciais de root do ambiente **a cada start** — não ficam
gravadas no volume. Editar o `.env` e reiniciar já troca, sem afetar os arquivos
já guardados (logos, áudios).

### `POSTGRES_PASSWORD` — ARMADILHA

A senha do **superusuário** do Postgres (`engorda`) só é aplicada na *primeira*
criação do volume. Trocar só no `.env` de um banco que já existe **quebra a
conexão**: o `.env` diz uma senha, o banco continua com a outra, e o backend não
sobe.

A ordem certa, **enquanto o sistema ainda está no ar com a senha antiga**:

```bash
# 1. troca a senha DENTRO do banco (use a senha nova que você gerou)
docker compose exec postgres psql -U engorda -c "ALTER USER engorda PASSWORD 'SENHA_NOVA_AQUI';"
```

Só **depois** disso edite `POSTGRES_PASSWORD=SENHA_NOVA_AQUI` no `.env`, com o
mesmo valor. Assim o `.env` e o banco combinam quando o backend reiniciar.

> Se preferir não mexer na senha do superusuário agora, uma alternativa válida é
> **manter** `POSTGRES_PASSWORD` como está (contanto que já não seja o valor de
> exemplo). Se ele ainda for `engorda_dev_senha`, aí não tem como escapar: é
> preciso fazer o `ALTER USER` acima, senão a trava barra a subida.

## 5. Subir em produção, atrás do proxy

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

Se o backend **recusar subir**, leia o log — ele diz qual variável falta:

```bash
docker compose logs backend --tail 30
```

## 6. Conferir que fechou

```bash
# Swagger e OpenAPI devem sumir (404):
curl -s -o /dev/null -w "docs=%{http_code}\n"    https://engorda.kurtenet.com.br/api/docs
curl -s -o /dev/null -w "openapi=%{http_code}\n" https://engorda.kurtenet.com.br/api/openapi.json

# /pronto deve devolver só o esquema, sem host nem IP — e x_forwarded_proto=https:
curl -s https://engorda.kurtenet.com.br/api/pronto
```

Esperado: `docs=404`, `openapi=404`, e `/api/pronto` mostrando
`"x_forwarded_proto":"https"`. Se o proto vier `http`, o proxy da frente não
está repassando `X-Forwarded-Proto` — sem isso as URLs geradas saem em http e o
navegador barra por conteúdo misto.

## 7. Ainda na infraestrutura (fora do Docker)

Estes não são do `.env`; são do firewall da VPS e da configuração do proxy:

- **Painel do Traefik** (porta `8090`) e **console do MinIO** não podem estar
  abertos à internet. No proxy da frente, exponha **apenas** o domínio do app
  apontando para `http://IP-DA-MAQUINA:8081`. Bloqueie 8090 e 9001 no firewall.
- O único caminho de fora deve ser o proxy → `:8081`. O backend (`:8000`) e o
  Postgres nunca são alcançáveis diretamente.

## Depois de trocar a `SECRET_KEY`

Todos os tokens antigos deixam de valer na hora. Técnicos e clientes precisam
**entrar de novo** — o que, para o técnico, significa fazer isso **com sinal**,
antes de ir para o curral, para o aparelho baixar as sessões offline.
