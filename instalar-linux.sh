#!/usr/bin/env bash
# Instala o PPF Painel Multitask no Linux (AppImage ou tar.gz).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$DIR/dist"
INSTALL_DIR="${PPF_PAINEL_DIR:-$HOME/.local/share/ppf-painel}"
BIN_DIR="$HOME/.local/bin"
BIN_LINK="$BIN_DIR/ppf-painel"

APPIMAGE="$(ls -1 "$DIST"/PPF\ Painel\ Multitask-*.AppImage 2>/dev/null | grep -v arm64 | tail -1 || true)"
TARBALL="$(ls -1 "$DIST"/ppf-painel-multitask-*.tar.gz 2>/dev/null | grep -v arm64 | tail -1 || true)"
DEB="$(ls -1 "$DIST"/ppf-painel-multitask_*_amd64.deb 2>/dev/null | tail -1 || true)"

# Recusa .deb corrompido do electron-builder no Mac (< 1MB)
if [[ -n "$DEB" ]]; then
  DEB_SIZE="$(wc -c < "$DEB" | tr -d ' ')"
  if [[ "$DEB_SIZE" -lt 1000000 ]]; then
    echo "Aviso: $DEB está corrompido (${DEB_SIZE} bytes). Ignorando." >&2
    DEB=""
  fi
fi

mkdir -p "$BIN_DIR" "$HOME/.config/autostart" "$HOME/.local/share/applications"

if [[ -n "$DEB" ]] && command -v dpkg >/dev/null 2>&1; then
  echo "Instalando via .deb: $DEB"
  sudo dpkg -i "$DEB" || sudo apt-get install -f -y
  BIN_LINK="$(command -v ppf-painel 2>/dev/null || echo /usr/bin/ppf-painel)"
elif [[ -n "$APPIMAGE" ]]; then
  echo "Instalando AppImage: $APPIMAGE"
  mkdir -p "$INSTALL_DIR"
  cp "$APPIMAGE" "$INSTALL_DIR/ppf-painel.AppImage"
  chmod +x "$INSTALL_DIR/ppf-painel.AppImage"
  ln -sfn "$INSTALL_DIR/ppf-painel.AppImage" "$BIN_LINK"
elif [[ -n "$TARBALL" ]]; then
  echo "Instalando tar.gz: $TARBALL"
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TARBALL" -C "$INSTALL_DIR" --strip-components=1
  ln -sfn "$INSTALL_DIR/ppf-painel" "$BIN_LINK"
  chmod +x "$INSTALL_DIR/ppf-painel"
else
  echo "Nenhum pacote válido encontrado em $DIST" >&2
  echo "No Mac, gere com: npm run dist:linux" >&2
  exit 1
fi

# Só cria atalhos locais se não instalou via dpkg (já traz .desktop)
if [[ -z "${DEB:-}" ]] || ! command -v dpkg >/dev/null 2>&1; then
cat > "$HOME/.config/autostart/ppf-painel-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=PPF Painel Multitask
Exec=$BIN_LINK
X-GNOME-Autostart-enabled=true
X-KDE-autostart-after=panel
Terminal=false
StartupNotify=false
EOF

cat > "$HOME/.local/share/applications/ppf-painel.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=PPF Painel Multitask
Comment=Cardápio Web, iFood, Gestão e RWP (tela cheia / kiosk)
Exec=$BIN_LINK
Icon=utilities-terminal
Terminal=false
Categories=Office;
EOF
fi

echo
echo "Instalado."
echo "  Comando:       ppf-painel          (abre em tela cheia / kiosk)"
echo "  Janela normal: ppf-painel --no-kiosk"
echo "  Autostart:     ~/.config/autostart/ppf-painel-kiosk.desktop"
echo "  Sair do kiosk: Ctrl+Shift+Q"
echo
echo "Se o PATH não achar o comando, use: $BIN_LINK"
