#!/usr/bin/env python3
"""Cria um .deb Debian válido a partir de dist/linux-unpacked (sem Docker)."""
from __future__ import annotations

import io
import os
import shutil
import stat
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dist" / "linux-unpacked"
OUT = ROOT / "dist" / "ppf-painel-multitask_1.1.1_amd64.deb"
STAGE = ROOT / "dist" / "deb-stage-py"

PKG = "ppf-painel-multitask"
VERSION = "1.1.1"
ARCH = "amd64"


def clean_stage() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)


def copy_app() -> None:
    opt = STAGE / "opt" / "ppf-painel"
    opt.parent.mkdir(parents=True)
    shutil.copytree(
        SRC,
        opt,
        ignore=shutil.ignore_patterns("._*", ".DS_Store", "__MACOSX"),
    )
    bin_path = opt / "ppf-painel"
    bin_path.chmod(bin_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    sandbox = opt / "chrome-sandbox"
    if sandbox.exists():
        sandbox.chmod(0o4755)

    usr_bin = STAGE / "usr" / "bin"
    usr_bin.mkdir(parents=True)
    launcher = usr_bin / "ppf-painel"
    launcher.write_text(
        "#!/bin/bash\n"
        "# X11: fullscreen/kiosk do Electron é instável no Plasma Wayland\n"
        "export ELECTRON_OZONE_PLATFORM_HINT=\"${ELECTRON_OZONE_PLATFORM_HINT:-x11}\"\n"
        "exec /opt/ppf-painel/ppf-painel \"$@\"\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)

    apps = STAGE / "usr" / "share" / "applications"
    apps.mkdir(parents=True)
    (apps / "ppf-painel.desktop").write_text(
        "\n".join(
            [
                "[Desktop Entry]",
                "Type=Application",
                "Name=PPF Painel Multitask",
                "Comment=Cardápio Web, iFood, Gestão e RWP (tela cheia / kiosk)",
                "Exec=ppf-painel %U",
                "TryExec=ppf-painel",
                "Icon=utilities-terminal",
                "Terminal=false",
                "Categories=Office;Network;",
                "Keywords=ppf;cardapio;ifood;kiosk;",
                "",
            ]
        ),
        encoding="utf-8",
    )

    helper_src = ROOT / "linux" / "update-helper.sh"
    helper_dst = opt / "update-helper"
    shutil.copy2(helper_src, helper_dst)
    helper_dst.chmod(0o755)

    sudoers_dir = STAGE / "etc" / "sudoers.d"
    sudoers_dir.mkdir(parents=True)
    sudoers_dst = sudoers_dir / "ppf-painel-update"
    sudoers_dst.write_text(
        (ROOT / "linux" / "ppf-painel-update.sudoers").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    sudoers_dst.chmod(0o440)


def write_control(installed_kb: int) -> Path:
    debain = STAGE / "DEBIAN"
    debain.mkdir(parents=True)
    control = debain / "control"
    control.write_text(
        "\n".join(
            [
                f"Package: {PKG}",
                f"Version: {VERSION}",
                "Section: utils",
                "Priority: optional",
                f"Architecture: {ARCH}",
                "Maintainer: Pizza Pizza Franquias <ti@pizzapizza.com.br>",
                f"Installed-Size: {installed_kb}",
                "Depends: sudo, libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libasound2 | libasound2t64",
                "Homepage: https://www.rederwp.com",
                "Description: Painel multitask para lojas Pizza Pizza Franquias",
                " Abre Cardápio Web, iFood, Gestão e RWP em tela cheia (kiosk).",
                " Use ppf-painel --no-kiosk para janela normal. Sair: Ctrl+Shift+Q.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    postinst = debain / "postinst"
    postinst.write_text(
        "#!/bin/sh\n"
        "set -e\n"
        "if [ -f /opt/ppf-painel/chrome-sandbox ]; then\n"
        "  chmod 4755 /opt/ppf-painel/chrome-sandbox || true\n"
        "fi\n"
        "if [ -f /opt/ppf-painel/update-helper ]; then\n"
        "  chmod 755 /opt/ppf-painel/update-helper || true\n"
        "fi\n"
        "if [ -f /etc/sudoers.d/ppf-painel-update ]; then\n"
        "  chmod 440 /etc/sudoers.d/ppf-painel-update || true\n"
        "  if command -v visudo >/dev/null 2>&1; then\n"
        "    visudo -cf /etc/sudoers.d/ppf-painel-update >/dev/null 2>&1 || rm -f /etc/sudoers.d/ppf-painel-update\n"
        "  fi\n"
        "fi\n"
        "update-desktop-database -q /usr/share/applications 2>/dev/null || true\n"
        "exit 0\n",
        encoding="utf-8",
    )
    postinst.chmod(0o755)
    return debain


def tar_gz_from_dir(base: Path, arcname_root: str = ".") -> bytes:
    buf = io.BytesIO()
    # GNU format + numeric uid/gid 0 for root ownership in package
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:

        def add(path: Path, arcname: str) -> None:
            info = tar.gettarinfo(str(path), arcname=arcname)
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            if path.is_symlink():
                tar.addfile(info)
            elif path.is_dir():
                info.type = tarfile.DIRTYPE
                info.size = 0
                # dirs should be executable
                info.mode = 0o755
                tar.addfile(info)
                for child in sorted(path.iterdir()):
                    if child.name in (".DS_Store",) or child.name.startswith("._"):
                        continue
                    add(child, f"{arcname}/{child.name}" if arcname != "." else child.name)
            else:
                # preserve setuid on chrome-sandbox
                mode = path.stat().st_mode
                info.mode = stat.S_IMODE(mode)
                with path.open("rb") as f:
                    tar.addfile(info, f)

        # For data.tar.gz, members should be ./opt/... ./usr/...
        for child in sorted(base.iterdir()):
            if child.name == "DEBIAN":
                continue
            add(child, f"./{child.name}")
    return buf.getvalue()


def tar_gz_control(control_dir: Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        for child in sorted(control_dir.iterdir()):
            arcname = f"./{child.name}"
            info = tar.gettarinfo(str(child), arcname=arcname)
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            info.mode = stat.S_IMODE(child.stat().st_mode)
            with child.open("rb") as f:
                tar.addfile(info, f)
    return buf.getvalue()


def ar_member(name: str, data: bytes, mtime: int) -> bytes:
    # GNU ar header (60 bytes) + data + pad to even
    name_field = name.encode("ascii")
    if len(name_field) > 16:
        raise ValueError(f"ar member name too long: {name}")
    header = (
        name_field.ljust(16)
        + f"{mtime}".encode("ascii").ljust(12)
        + b"0".ljust(6)
        + b"0".ljust(6)
        + b"100644".ljust(8)
        + f"{len(data)}".encode("ascii").ljust(10)
        + b"`\n"
    )
    assert len(header) == 60
    out = header + data
    if len(data) % 2 == 1:
        out += b"\n"
    return out


def write_deb(control_tar: bytes, data_tar: bytes, dest: Path) -> None:
    mtime = int(time.time())
    debian_binary = b"2.0\n"
    blob = (
        b"!<arch>\n"
        + ar_member("debian-binary", debian_binary, mtime)
        + ar_member("control.tar.gz", control_tar, mtime)
        + ar_member("data.tar.gz", data_tar, mtime)
    )
    dest.write_bytes(blob)


def main() -> None:
    if not (SRC / "ppf-painel").exists():
        raise SystemExit(
            f"Não achei {SRC}/ppf-painel\nRode antes: npm run dist:linux"
        )

    print(f"Fonte: {SRC}")
    clean_stage()
    copy_app()
    installed_kb = sum(
        f.stat().st_size for f in (STAGE / "opt").rglob("*") if f.is_file()
    ) // 1024
    control_dir = write_control(installed_kb)

    print("Gerando control.tar.gz / data.tar.gz...")
    control_tar = tar_gz_control(control_dir)
    data_tar = tar_gz_from_dir(STAGE)

    # Remove DEBIAN from consideration in data (already skipped)
    print(f"Escrevendo {OUT} ...")
    if OUT.exists():
        OUT.unlink()
    write_deb(control_tar, data_tar, OUT)

    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"OK: {OUT} ({size_mb:.1f} MB)")
    # quick sanity
    head = OUT.read_bytes()[:8]
    if head != b"!<arch>\n":
        raise SystemExit("Arquivo .deb inválido (magic)")
    print("Magic !<arch> OK — pode instalar no Debian/Ubuntu com:")
    print(f"  sudo dpkg -i '{OUT.name}' && sudo apt-get install -f -y")


if __name__ == "__main__":
    main()
