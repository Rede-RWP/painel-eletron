#!/usr/bin/env bash
# Publica a versão atual (package.json) como GitHub Release.
# Uso: ./scripts/publish-github.sh "Notas da versão"
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "Instale o GitHub CLI: https://cli.github.com/" >&2
  echo "Depois: gh auth login" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
DEB="$DIR/dist/ppf-painel-multitask_${VERSION}_amd64.deb"
NOTES="${1:-}"

if [[ ! -f "$DEB" ]]; then
  echo "Não achei $DEB" >&2
  echo "Rode antes: npm run dist:linux" >&2
  exit 1
fi

SIZE="$(wc -c < "$DEB" | tr -d ' ')"
if [[ "$SIZE" -lt 1000000 ]]; then
  echo "O .deb está pequeno demais (${SIZE} bytes) — provavelmente corrompido." >&2
  exit 1
fi

FILES=("$DEB")
while IFS= read -r img; do
  FILES+=("$img")
done < <(ls -1 "$DIR"/dist/*.AppImage 2>/dev/null | grep -v arm64 || true)

echo "Tag:    $TAG"
echo "Arquivos:"
printf '  %s\n' "${FILES[@]}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG já existe localmente."
else
  git tag "$TAG"
fi

git push origin HEAD
git push origin "$TAG"

ARGS=(release create "$TAG" --title "$TAG" --latest)
if [[ -n "$NOTES" ]]; then
  ARGS+=(--notes "$NOTES")
else
  ARGS+=(--generate-notes)
fi
ARGS+=("${FILES[@]}")

gh "${ARGS[@]}"

echo
echo "OK. As lojas consultam:"
echo "  https://github.com/Rede-RWP/painel-eletron/releases/latest"
