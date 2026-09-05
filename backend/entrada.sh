#!/bin/sh
# Ponto de entrada do backend e do worker.
#
# Espera o banco aceitar conexão e aplica as migrations pendentes antes de
# iniciar o processo. Assim, instalar em outro servidor é `docker compose up` e
# mais nada — sem um passo manual que, esquecido, faz o produto parecer quebrado
# no primeiro acesso.
#
# MIGRAR_AO_SUBIR=0 desliga, para quem prefere controlar o momento da migration
# num deploy com várias réplicas.
set -e

if [ "${MIGRAR_AO_SUBIR:-1}" = "1" ]; then
  echo "[entrada] aguardando o banco…"
  # O healthcheck do compose já espera o Postgres, mas um container reiniciado
  # sozinho pode chegar antes — e falhar aqui atrasaria a subida inteira.
  tentativas=0
  until python -c "
import socket, os
s = socket.create_connection((os.environ.get('POSTGRES_HOST', 'postgres'), 5432), timeout=2)
s.close()
" 2>/dev/null; do
    tentativas=$((tentativas + 1))
    if [ "$tentativas" -gt 30 ]; then
      echo "[entrada] banco não respondeu em 60s — seguindo mesmo assim" >&2
      break
    fi
    sleep 2
  done

  echo "[entrada] aplicando migrations…"
  python -m app.migrar
fi

exec "$@"
