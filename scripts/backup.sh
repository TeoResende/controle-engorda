#!/usr/bin/env bash
#
# Backup do banco e dos áudios.
#
# Roda de fora dos containers, pelo docker compose, para não depender de o
# backend estar de pé — backup que só funciona com o sistema saudável não é
# backup.
#
# Uso:      ./scripts/backup.sh [destino]
# No cron:  0 3 * * *  cd /caminho/do/projeto && ./scripts/backup.sh >> volumes/backup.log 2>&1
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="${1:-$RAIZ/volumes/backups}"
DIAS_A_MANTER="${DIAS_A_MANTER:-30}"
CARIMBO="$(date +%Y-%m-%d_%H%M)"

cd "$RAIZ"
[ -f .env ] && set -a && . ./.env && set +a
mkdir -p "$DESTINO"

echo "[$(date '+%F %T')] backup iniciado → $DESTINO"

# --- Banco ---------------------------------------------------------------
# `--clean --if-exists` deixa o arquivo restaurável sobre um banco existente.
# Formato custom (-Fc): comprime e permite restaurar tabela a tabela.
ARQUIVO_BANCO="$DESTINO/engorda_${CARIMBO}.dump"
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-engorda}" -d "${POSTGRES_DB:-engorda}" \
  --clean --if-exists -Fc > "$ARQUIVO_BANCO"

TAMANHO=$(du -h "$ARQUIVO_BANCO" | cut -f1)
echo "  banco: $(basename "$ARQUIVO_BANCO") ($TAMANHO)"

# Um dump que não abre não é backup. A verificação custa segundos e é a
# diferença entre ter cópia e achar que tem.
if ! docker compose exec -T postgres pg_restore --list < "$ARQUIVO_BANCO" > /dev/null 2>&1; then
  echo "  ERRO: o dump gerado está ilegível — backup ABORTADO" >&2
  rm -f "$ARQUIVO_BANCO"
  exit 1
fi
echo "  dump verificado"

# --- Áudios --------------------------------------------------------------
# Ficam no MinIO, fora do banco. Sem eles, restaurar traria as pesagens com a
# observação transcrita mas sem o original — e é o original que resolve
# divergência de transcrição.
if [ -d "$RAIZ/volumes/minio" ]; then
  ARQUIVO_AUDIO="$DESTINO/audios_${CARIMBO}.tar.gz"
  tar -czf "$ARQUIVO_AUDIO" -C "$RAIZ/volumes" minio 2>/dev/null || true
  echo "  áudios: $(basename "$ARQUIVO_AUDIO") ($(du -h "$ARQUIVO_AUDIO" | cut -f1))"
fi

# --- Expurgo -------------------------------------------------------------
APAGADOS=$(find "$DESTINO" -name 'engorda_*.dump' -o -name 'audios_*.tar.gz' \
  | wc -l)
find "$DESTINO" \( -name 'engorda_*.dump' -o -name 'audios_*.tar.gz' \) \
  -mtime +"$DIAS_A_MANTER" -delete
RESTANTES=$(find "$DESTINO" -name 'engorda_*.dump' | wc -l)

echo "  guardando $RESTANTES cópias (retenção: $DIAS_A_MANTER dias)"
echo "[$(date '+%F %T')] backup concluído"
