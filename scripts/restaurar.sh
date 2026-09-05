#!/usr/bin/env bash
#
# Restauração do banco a partir de um dump.
#
# Backup que nunca foi restaurado é hipótese, não backup. Teste este script
# antes de precisar dele.
#
# Uso: ./scripts/restaurar.sh volumes/backups/engorda_2026-09-05_0300.dump
set -euo pipefail

ARQUIVO="${1:?informe o arquivo .dump}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
[ -f .env ] && set -a && . ./.env && set +a

[ -f "$ARQUIVO" ] || { echo "arquivo não encontrado: $ARQUIVO" >&2; exit 1; }

echo "Isto SUBSTITUI o conteúdo do banco '${POSTGRES_DB:-engorda}'."
echo "Arquivo: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"
read -r -p "Digite RESTAURAR para confirmar: " confirmacao
[ "$confirmacao" = "RESTAURAR" ] || { echo "cancelado"; exit 1; }

# O backend precisa sair para não escrever durante a restauração.
docker compose stop backend worker

docker compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER:-engorda}" -d "${POSTGRES_DB:-engorda}" \
  --clean --if-exists --no-owner < "$ARQUIVO"

docker compose start backend worker
echo "Restaurado. Confira em /health e no dashboard antes de liberar o acesso."
