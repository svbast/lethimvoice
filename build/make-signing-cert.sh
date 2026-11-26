#!/usr/bin/env bash
# Create a local, self-signed code-signing certificate so the macOS build gets a
# STABLE code-signing identity (not bare ad-hoc). macOS TCC keys the Accessibility
# and Microphone grants to that identity, so with a stable one the permission the
# global hotkey needs actually persists across launches, rebuilds and app updates.
#
# This is NOT an Apple Developer ID — Gatekeeper still asks for a one-time approval
# ("Open Anyway"). It only fixes TCC permission persistence, which is what breaks
# the hotkey on an ad-hoc build.
#
# Run ONCE per machine:   bash build/make-signing-cert.sh
# Then build as usual:    bun run build   (afterPack.ts auto-detects the cert)
#
# The certificate + private key live only in YOUR login keychain. CI signs with the
# same certificate exported as a .p12 (the MAC_SIGNING_P12 secret, see release.yml).
set -euo pipefail

CERT_CN="LetHim Voice Local Signing"          # must match SIGN_IDENTITY in build/afterPack.ts
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$CERT_CN" >/dev/null 2>&1; then
  echo "✓ Certificate '$CERT_CN' already exists — nothing to do."
  echo "  Build with: bun run build"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Use the SYSTEM openssl (LibreSSL at /usr/bin/openssl), not a Homebrew OpenSSL 3
# that may be first in PATH: OpenSSL 3 packs the .p12 with a SHA-256 MAC that
# macOS's legacy `security import` can't verify ("MAC verification failed"). A
# non-empty transport password avoids empty-password edge cases on import.
OPENSSL="/usr/bin/openssl"
[ -x "$OPENSSL" ] || OPENSSL="openssl"
P12PASS="lethim-temp-import"

echo "• Generating a self-signed code-signing certificate…"
cat > "$WORK/cfg" <<EOF
[req]
distinguished_name = dn
x509_extensions    = v3
prompt             = no
[dn]
CN = $CERT_CN
[v3]
keyUsage            = critical, digitalSignature
extendedKeyUsage    = critical, codeSigning
basicConstraints    = critical, CA:false
EOF

"$OPENSSL" req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -config "$WORK/cfg" >/dev/null 2>&1
"$OPENSSL" pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$WORK/cert.p12" -passout pass:"$P12PASS" >/dev/null 2>&1

echo "• Importing it into your login keychain (grants codesign access to the key)…"
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$P12PASS" -T /usr/bin/codesign

echo "• Authorizing codesign to use the key without a prompt each build."
echo "  macOS will ask for your LOGIN password now:"
security set-key-partition-list -S apple-tool:,apple:,codesign: "$KEYCHAIN" >/dev/null

echo
echo "✓ Done. '$CERT_CN' is ready in your login keychain."
echo "  Now build:  bun run build"
echo "  (afterPack.ts will detect the cert and sign with it automatically.)"
