#!/bin/bash
# Instalador privilegiado do PPF Painel. Só aceita .deb oficial em /tmp ou /var/tmp.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "update-helper: precisa rodar como root" >&2
  exit 1
fi

DEB="${1:-}"
if [[ -z "${DEB}" || "${DEB}" != /* || "${DEB}" == *..* ]]; then
  echo "update-helper: caminho inválido" >&2
  exit 1
fi

case "${DEB}" in
  /tmp/*|/var/tmp/*) ;;
  *)
    echo "update-helper: o .deb precisa estar em /tmp ou /var/tmp" >&2
    exit 1
    ;;
esac

if [[ ! -f "${DEB}" ]]; then
  echo "update-helper: arquivo não encontrado" >&2
  exit 1
fi

BASE="$(basename "${DEB}")"
if [[ ! "${BASE}" =~ ^ppf-painel-multitask_[0-9][0-9A-Za-z.+~-]*_amd64\.deb$ ]]; then
  echo "update-helper: nome de arquivo não permitido" >&2
  exit 1
fi

PKG="$(dpkg-deb -f "${DEB}" Package 2>/dev/null || true)"
if [[ "${PKG}" != "ppf-painel-multitask" ]]; then
  echo "update-helper: pacote não é ppf-painel-multitask" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if ! dpkg -i "${DEB}"; then
  apt-get update -qq || true
  apt-get install -f -y
fi

if [[ -f /opt/ppf-painel/chrome-sandbox ]]; then
  chmod 4755 /opt/ppf-painel/chrome-sandbox || true
fi
if [[ -f /opt/ppf-painel/update-helper ]]; then
  chmod 755 /opt/ppf-painel/update-helper || true
fi

exit 0
