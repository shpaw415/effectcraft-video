#!/bin/sh
# effectcraft-video setup — install EffectCraft (deb) if missing. Idempotent, runs as root.
set -e
if command -v effectcraft-cli >/dev/null 2>&1; then
  echo "effectcraft-cli already installed: $(effectcraft-cli --version 2>/dev/null || echo unknown)"
  exit 0
fi
command -v curl >/dev/null 2>&1 || apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates
command -v fc-list >/dev/null 2>&1 || apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core || true
URL=$(curl -s https://api.github.com/repos/storytold/effectcraft/releases/latest \
  | python3 -c "import json,sys;print(next(a['browser_download_url'] for a in json.load(sys.stdin).get('assets',[]) if a['name'].endswith('linux-x86_64.deb')))")
echo "downloading $URL"
curl -sL -o /tmp/effectcraft-install.deb "$URL"
apt-get install -y /tmp/effectcraft-install.deb
rm -f /tmp/effectcraft-install.deb
echo "installed: $(effectcraft-cli --version)"
