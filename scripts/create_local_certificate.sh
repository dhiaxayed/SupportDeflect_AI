#!/usr/bin/env bash
# Generate one self-signed TLS certificate/key pair for an isolated demo host.
# Input: first argument is a hostname or IPv4 address, without scheme/port/path.
# Requires Bash/OpenSSL and write access to infra/certs in this checkout.
# Output: a 365-day server.crt, an unencrypted RSA server.key and a client-trust
# reminder. This does not install certificates or enable HTTPS.
# Existing key OR certificate files are preserved; malformed host input or a
# failed OpenSSL command exits nonzero. Partial creation requires operator review.
# The key has no passphrase for unattended use; umask restricts new-file access.
# Distribute only server.crt to demo clients, not the private key.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:?Usage: bash scripts/create_local_certificate.sh HOSTNAME_OR_IP}"
# Allow only simple host characters before passing the value to CN/SAN options;
# OpenSSL remains responsible for rejecting invalid certificate field values.
[[ "$host" =~ ^[a-zA-Z0-9.-]+$ ]] || { printf 'Invalid host\n' >&2; exit 2; }
[[ ! -e infra/certs/server.key && ! -e infra/certs/server.crt ]] || { printf 'Existing certificates preserved\n' >&2; exit 2; }
umask 077
mkdir -p infra/certs
san="DNS:$host"
# SAN type must match an IP address rather than encode that address as DNS text.
[[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && san="IP:$host"
openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes \
  -keyout infra/certs/server.key -out infra/certs/server.crt \
  -subj "/CN=$host" -addext "subjectAltName=$san"
printf 'Certificate created. Trust server.crt on each demo client; never distribute server.key.\n'
