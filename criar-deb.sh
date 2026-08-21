#!/usr/bin/env bash
# Gera um .deb Debian válido a partir de dist/linux-unpacked (via Docker).
# O electron-builder no macOS produz .deb corrompido (~96 bytes) — use este script.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/dist/linux-unpacked"
OUT_DIR="$DIR/dist"
PKG_NAME="ppf-painel-multitask"
VERSION="1.1.8"
ARCH="amd64"
OUT_DEB="$OUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"

if [[ ! -x "$SRC/ppf-painel" ]]; then
  echo "Pasta unpack não encontrada: $SRC" >&2
  echo "Rode antes: npm run dist:linux" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker indisponível — usando criar-deb.py"
  exec python3 "$DIR/criar-deb.py"
fi

STAGE="$DIR/dist/deb-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/opt/ppf-painel" \
         "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications" \
         "$STAGE/DEBIAN"

# App files
rsync -a --delete "$SRC/" "$STAGE/opt/ppf-painel/"
chmod +x "$STAGE/opt/ppf-painel/ppf-painel" || true
# Sandbox Electron (Debian): se existir, marca setuid
if [[ -f "$STAGE/opt/ppf-painel/chrome-sandbox" ]]; then
  chmod 4755 "$STAGE/opt/ppf-painel/chrome-sandbox" || true
fi

# Launcher
cat > "$STAGE/usr/bin/ppf-painel" <<'EOF'
#!/bin/bash
# X11: fullscreen/kiosk do Electron é instável no Plasma Wayland
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-x11}"
exec /opt/ppf-painel/ppf-painel "$@"
EOF
chmod 755 "$STAGE/usr/bin/ppf-painel"

# Desktop entry
cat > "$STAGE/usr/share/applications/ppf-painel.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=PPF Painel Multitask
Comment=Cardápio Web, iFood, Gestão e RWP (tela cheia / kiosk)
Exec=ppf-painel %U
TryExec=ppf-painel
Icon=utilities-terminal
Terminal=false
Categories=Office;Network;
Keywords=ppf;cardapio;ifood;kiosk;
EOF

# Auto-update helper (sudo sem senha só para este binário)
install -m 755 "$DIR/linux/update-helper.sh" "$STAGE/opt/ppf-painel/update-helper"
mkdir -p "$STAGE/etc/sudoers.d"
install -m 440 "$DIR/linux/ppf-painel-update.sudoers" "$STAGE/etc/sudoers.d/ppf-painel-update"

INSTALLED_SIZE="$(du -sk "$STAGE/opt" | awk '{print $1}')"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: Pizza Pizza Franquias <ti@pizzapizza.com.br>
Installed-Size: ${INSTALLED_SIZE}
Depends: sudo, libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libasound2 | libasound2t64
Recommends: libfuse2 | libfuse2t64
Homepage: https://www.rederwp.com
Description: Painel multitask para lojas Pizza Pizza Franquias
 Abre Cardápio Web, iFood, Gestão e RWP em tela cheia (kiosk).
 Use ppf-painel --no-kiosk para janela normal. Sair: Ctrl+Shift+Q.
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ -f /opt/ppf-painel/chrome-sandbox ]; then
  chmod 4755 /opt/ppf-painel/chrome-sandbox || true
fi
if [ -f /opt/ppf-painel/update-helper ]; then
  chmod 755 /opt/ppf-painel/update-helper || true
fi
if [ -f /etc/sudoers.d/ppf-painel-update ]; then
  chmod 440 /etc/sudoers.d/ppf-painel-update || true
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf /etc/sudoers.d/ppf-painel-update >/dev/null 2>&1 || rm -f /etc/sudoers.d/ppf-painel-update
  fi
fi
update-desktop-database -q /usr/share/applications 2>/dev/null || true
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/postinst"

echo "Empacotando .deb com dpkg-deb (Docker Debian)..."
docker run --rm \
  -v "$STAGE:/stage:ro" \
  -v "$OUT_DIR:/out" \
  -e OUT_NAME="$(basename "$OUT_DEB")" \
  debian:bookworm-slim \
  bash -c '
    set -e
    apt-get update -qq
    apt-get install -y -qq dpkg-dev >/dev/null
    rm -rf /build
    mkdir -p /build
    cp -a /stage/. /build/
    # remove attrs macOS que quebram dpkg
    find /build -name "._*" -delete 2>/dev/null || true
    find /build -name ".DS_Store" -delete 2>/dev/null || true
    dpkg-deb --root-owner-group --build /build "/out/$OUT_NAME"
    dpkg-deb -I "/out/$OUT_NAME"
  '

echo
echo "OK: $OUT_DEB"
ls -lh "$OUT_DEB"
file "$OUT_DEB"
