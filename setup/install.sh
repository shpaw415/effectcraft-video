#!/bin/sh
# effectcraft-video setup — install EffectCraft (deb) + post-production deps if missing.
# Idempotent, runs as root, re-run at every desktop boot: safe on fresh desktops with
# empty apt lists (guaranteed `apt-get update` before any install).
#
# EffectCraft is PINNED: the version below is the one this plugin was tested with.
# The deb is checksum-verified against SHA256SUMS.txt of that release before install.
# Bumping the pin (version + sha256 together) is a deliberate plugin release act.
set -e
EC_VERSION="0.11.1"
EC_SHA256="6e12fd3c680777983b73cc84ca3b458b1dad6f36f434511f0af2cea5503176a0"

command -v curl >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y --no-install-recommends curl ca-certificates; }
command -v fc-list >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core; } || true
command -v ffmpeg >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y --no-install-recommends ffmpeg; }
if command -v effectcraft-cli >/dev/null 2>&1; then
  echo "effectcraft-cli already installed: $(effectcraft-cli --version 2>/dev/null || echo unknown)"
  exit 0
fi
DEB="effectcraft-${EC_VERSION}-linux-x86_64.deb"
URL="https://github.com/storytold/effectcraft/releases/download/v${EC_VERSION}/${DEB}"
echo "downloading pinned ${DEB}"
curl -sL -o /tmp/effectcraft-install.deb "$URL"
echo "${EC_SHA256}  /tmp/effectcraft-install.deb" | sha256sum -c - || {
  echo "CHECKSUM MISMATCH — refusing to install"
  rm -f /tmp/effectcraft-install.deb
  exit 1
}
apt-get install -y /tmp/effectcraft-install.deb
rm -f /tmp/effectcraft-install.deb
echo "installed: $(effectcraft-cli --version)"
