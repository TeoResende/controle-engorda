#!/usr/bin/env bash
#
# Gera a autoridade certificadora local e o certificado do servidor.
#
# Por que uma CA e não um certificado autoassinado: o Chrome recusa registrar
# Service Worker em página com erro de certificado — clicar em "continuar assim
# mesmo" tira o aviso da tela, mas a origem segue insegura por baixo e o app
# nunca abre sem internet. Com a CA instalada como confiável no aparelho, não há
# erro nenhum.
#
# Uso:  ./traefik/gerar-certificados.sh [IP-DA-MAQUINA]
set -euo pipefail

IP="${1:-192.168.0.130}"
DESTINO="$(dirname "$0")/certificados"
mkdir -p "$DESTINO"
cd "$DESTINO"

echo "Gerando para o IP $IP…"

if [ ! -f ca.crt ]; then
  # A CA dura 10 anos: recriá-la obrigaria a reinstalar em todo aparelho.
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -sha256 \
    -keyout ca.key -out ca.crt \
    -subj "/CN=Engorda Dev CA/O=Engorda" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "  CA criada."
else
  echo "  CA já existe — reaproveitando (não precisa reinstalar nos aparelhos)."
fi

cat > servidor.cnf <<CNF
[req]
distinguished_name = dn
req_extensions = ext
prompt = no
[dn]
CN = app.$IP.nip.io
O = Engorda
[ext]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:app.$IP.nip.io, DNS:api.$IP.nip.io, DNS:minio.$IP.nip.io, DNS:app.localhost, DNS:api.localhost, DNS:minio.localhost, DNS:localhost, IP:$IP, IP:127.0.0.1
CNF

# 825 dias é o teto que navegadores aceitam para certificado de servidor.
openssl req -nodes -newkey rsa:2048 -keyout local.key -out servidor.csr -config servidor.cnf
openssl x509 -req -in servidor.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out local.crt -days 825 -sha256 -extfile servidor.cnf -extensions ext
cat local.crt ca.crt > cadeia.crt
rm -f servidor.csr servidor.cnf

# A CA fica disponível para download, para instalar no celular.
cp ca.crt ../../frontend/public/ca-engorda.crt

echo
echo "Pronto. No celular:"
echo "  1. baixe  http://$IP:8081/ca-engorda.crt"
echo "  2. Configurações > Segurança > Instalar certificado > Certificado CA"
echo "  3. abra    https://app.$IP.nip.io:8443/tecnico"
