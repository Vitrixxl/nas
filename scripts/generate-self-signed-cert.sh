#!/usr/bin/env sh
set -eu

ip_address="${1:-}"
if [ -z "$ip_address" ]; then
	ip_address="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)"
fi

if [ -z "$ip_address" ]; then
	echo "Usage: $0 <lan-ip>" >&2
	exit 1
fi

mkdir -p certs

openssl req \
	-x509 \
	-newkey rsa:2048 \
	-nodes \
	-days "${CERT_DAYS:-3650}" \
	-keyout certs/nas.key \
	-out certs/nas.crt \
	-subj "/CN=$ip_address" \
	-addext "subjectAltName=IP:$ip_address,IP:127.0.0.1,DNS:localhost" \
	-addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
	-addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" \
	-addext "extendedKeyUsage=serverAuth"

echo "Generated certs/nas.crt for https://$ip_address"
