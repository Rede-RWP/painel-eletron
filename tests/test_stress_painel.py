#!/usr/bin/env python3
"""
Testes de força / regressão do PPF Painel Multitask (1.1.6+).

Foco: Cardápio Web em BrowserView (reCAPTCHA), bypass de hosts, popups,
versões sincronizadas e resistência a carga.

Uso:
  python3 tests/test_stress_painel.py
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import ssl
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "1.1.6"
FRAME_SUFFIXES = (
    "cardapioweb.com",
    "ifood.com.br",
    "rederwp.com",
    "google.com",
    "gstatic.com",
    "recaptcha.net",
    "googleapis.com",
)
CARDAPIO_URL = "https://portal.cardapioweb.com"
SSL_CTX = ssl.create_default_context()


def host_needs_frame_bypass(url: str) -> bool:
    try:
        host = urlparse(url).hostname
        if not host:
            return False
        host = host.lower()
        return any(host == s or host.endswith("." + s) for s in FRAME_SUFFIXES)
    except Exception:
        return False


def is_allowed_popup_url(url: str) -> bool:
    if not url or url == "about:blank":
        return True
    try:
        host = urlparse(url).hostname
        if not host:
            return False
        host = host.lower()
        allow = (
            "google.com",
            "gstatic.com",
            "recaptcha.net",
            "googleapis.com",
            "cardapioweb.com",
            "ifood.com.br",
            "rederwp.com",
        )
        return any(host == s or host.endswith("." + s) for s in allow)
    except Exception:
        return False


def strip_frame_headers(headers: dict[str, list[str]]) -> dict[str, list[str]]:
    out = dict(headers)
    for key in list(out.keys()):
        lower = key.lower()
        if lower == "x-frame-options":
            del out[key]
            continue
        if lower in (
            "content-security-policy",
            "content-security-policy-report-only",
        ):
            cleaned = []
            for value in out[key]:
                v = re.sub(r"frame-ancestors[^;]*;?", "", str(value), flags=re.I)
                v = re.sub(r";\s*;", ";", v)
                v = re.sub(r"^\s*;\s*", "", v)
                v = re.sub(r";\s*$", "", v).strip()
                if v:
                    cleaned.append(v)
            if cleaned:
                out[key] = cleaned
            else:
                del out[key]
    return out


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def http_head(url: str, timeout: float = 12.0) -> tuple[int, dict[str, str]]:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        headers = {k.lower(): v for k, v in resp.headers.items()}
        return resp.status, headers


def http_get(url: str, timeout: float = 15.0) -> tuple[int, bytes]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        return resp.status, resp.read(65536)


class TestVersionSync(unittest.TestCase):
    def test_01_package_json_version(self):
        data = json.loads(read(ROOT / "package.json"))
        self.assertEqual(data["version"], EXPECTED_VERSION)

    def test_02_package_lock_version(self):
        data = json.loads(read(ROOT / "package-lock.json"))
        self.assertEqual(data["version"], EXPECTED_VERSION)
        self.assertEqual(data["packages"][""]["version"], EXPECTED_VERSION)

    def test_03_criar_deb_py_version(self):
        text = read(ROOT / "criar-deb.py")
        self.assertIn(f'VERSION = "{EXPECTED_VERSION}"', text)
        self.assertIn(f"ppf-painel-multitask_{EXPECTED_VERSION}_amd64.deb", text)

    def test_04_criar_deb_sh_version(self):
        text = read(ROOT / "criar-deb.sh")
        self.assertIn(f'VERSION="{EXPECTED_VERSION}"', text)

    def test_05_no_stale_old_versions_in_release_files(self):
        for name in ("package.json", "criar-deb.py", "criar-deb.sh"):
            text = read(ROOT / name)
            self.assertNotRegex(text, r"\b1\.1\.[25]\b", f"{name} versão antiga")


class TestArchitectureBrowserView(unittest.TestCase):
    def test_06_pages_config_exists(self):
        self.assertTrue((ROOT / "pages-config.js").is_file())

    def test_07_main_uses_browserview(self):
        text = read(ROOT / "main.js")
        self.assertIn("BrowserView", text)
        self.assertIn("setWindowOpenHandler", text)
        self.assertIn("chromeUserAgent", text)
        self.assertIn("nav-show-page", text)

    def test_08_package_files_includes_pages_config(self):
        data = json.loads(read(ROOT / "package.json"))
        files = data["build"]["files"]
        self.assertIn("pages-config.js", files)
        self.assertIn("frame-policy.js", files)

    def test_09_painel_has_no_iframes(self):
        html = read(ROOT / "painel.html")
        self.assertNotIn("<iframe", html)
        self.assertIn("painelNav", html)
        self.assertIn("BrowserView", html)

    def test_10_preload_exposes_nav(self):
        text = read(ROOT / "preload.js")
        self.assertIn("painelNav", text)
        self.assertIn("showPage", text)
        self.assertIn("setOverlay", text)

    def test_11_cardweb_keep_alive(self):
        text = read(ROOT / "pages-config.js")
        self.assertIn("portal.cardapioweb.com", text)
        self.assertIn("keepAlive: true", text)

    def test_12_recaptcha_domains_in_policy(self):
        text = read(ROOT / "frame-policy.js")
        for d in ("google.com", "gstatic.com", "recaptcha.net", "isAllowedPopupUrl"):
            self.assertIn(d, text)


class TestHostBypassLogic(unittest.TestCase):
    def test_13_portal_and_subdomains(self):
        for host in (
            "portal.cardapioweb.com",
            "app.cardapioweb.com",
            "api.cardapioweb.com",
        ):
            self.assertTrue(host_needs_frame_bypass(f"https://{host}/"))

    def test_14_recaptcha_hosts(self):
        for url in (
            "https://www.google.com/recaptcha/api.js",
            "https://www.gstatic.com/recaptcha/releases/x/recaptcha__pt.js",
            "https://www.recaptcha.net/recaptcha/enterprise",
        ):
            self.assertTrue(host_needs_frame_bypass(url), url)

    def test_15_popup_allowlist(self):
        self.assertTrue(is_allowed_popup_url("about:blank"))
        self.assertTrue(is_allowed_popup_url("https://www.google.com/recaptcha/challenge"))
        self.assertFalse(is_allowed_popup_url("https://evil.example/phish"))

    def test_16_rejects_unrelated(self):
        self.assertFalse(host_needs_frame_bypass("https://evil-cardapioweb.com.attacker.test"))
        self.assertFalse(host_needs_frame_bypass("not-a-url"))

    def test_17_strip_xfo(self):
        headers = {
            "X-Frame-Options": ["SAMEORIGIN"],
            "Content-Security-Policy": ["default-src 'self'; frame-ancestors 'self'"],
        }
        out = strip_frame_headers(headers)
        self.assertNotIn("X-Frame-Options", out)
        self.assertNotIn("frame-ancestors", out["Content-Security-Policy"][0].lower())


class TestPainelHtml(unittest.TestCase):
    def test_18_dock_buttons(self):
        html = read(ROOT / "painel.html")
        for page_id in ("home", "cardweb", "ifood", "gestao", "rwp"):
            self.assertIn(f"showPage('{page_id}'", html)

    def test_19_overlay_hides_views(self):
        html = read(ROOT / "painel.html")
        self.assertIn("setOverlay", html)


class TestStressForce(unittest.TestCase):
    def test_20_stress_host_match_10k(self):
        samples = [
            "https://portal.cardapioweb.com/",
            "https://www.google.com/recaptcha/api.js",
            "https://www.gstatic.com/recaptcha/x.js",
            "https://gestordepedidos.ifood.com.br/",
            "https://google.com/",
            "https://evil.com/",
        ]
        t0 = time.perf_counter()
        hits = 0
        for i in range(10_000):
            if host_needs_frame_bypass(samples[i % len(samples)]):
                hits += 1
        self.assertGreater(hits, 0)
        self.assertLess(time.perf_counter() - t0, 2.0)

    def test_21_stress_parallel_matching(self):
        urls = [f"https://s{i}.cardapioweb.com/" for i in range(400)] + [
            f"https://n{i}.example.com/" for i in range(400)
        ]

        def batch(chunk):
            return sum(1 for u in chunk if host_needs_frame_bypass(u))

        chunks = [urls[i : i + 100] for i in range(0, len(urls), 100)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            total = sum(pool.map(batch, chunks))
        self.assertEqual(total, 400)

    def test_22_stress_popup_matrix(self):
        for _ in range(1000):
            self.assertTrue(is_allowed_popup_url("about:blank"))
            self.assertTrue(is_allowed_popup_url("https://www.google.com/recaptcha"))
            self.assertFalse(is_allowed_popup_url("https://malware.test/"))

    def test_23_stress_strip_headers(self):
        base = {
            "x-frame-options": ["DENY"],
            "content-security-policy": ["frame-ancestors 'none'; script-src 'self'"],
        }
        for _ in range(2000):
            out = strip_frame_headers(base)
            self.assertNotIn("x-frame-options", out)

    def test_24_pages_config_parse(self):
        text = read(ROOT / "pages-config.js")
        for key in ("cardweb", "ifood", "gestao", "rwp"):
            self.assertIn(key, text)
        urls = re.findall(r"url:\s*'(https://[^']+)'", text)
        self.assertEqual(len(urls), 4)
        self.assertTrue(any("cardapioweb.com" in u for u in urls))

    def test_25_fuzz_suffix_boundary(self):
        for url in (
            "https://cardapioweb.com.evil.test/",
            "https://xcardapioweb.com/",
            "https://google.com.evil.test/",
        ):
            self.assertFalse(host_needs_frame_bypass(url), url)


class TestLiveCardapioHttp(unittest.TestCase):
    def test_26_cardapio_reachable(self):
        try:
            status, _ = http_head(CARDAPIO_URL)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        self.assertIn(status, (200, 301, 302, 303, 307, 308))

    def test_27_cardapio_xfo_present(self):
        try:
            _, headers = http_head(CARDAPIO_URL + "/")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        self.assertIn("SAMEORIGIN", headers.get("x-frame-options", "").upper())

    def test_28_cardapio_html_root(self):
        try:
            status, body = http_get(CARDAPIO_URL + "/")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        self.assertEqual(status, 200)
        self.assertIn(b'id="root"', body)

    def test_29_stress_parallel_heads(self):
        def one(_):
            try:
                status, _h = http_head(CARDAPIO_URL + "/")
                return status
            except Exception as exc:  # noqa: BLE001
                return exc

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(one, range(20)))
        if all(not isinstance(r, int) for r in results):
            self.skipTest(f"rede indisponível: {results[0]}")
        oks = [r for r in results if isinstance(r, int) and r < 400]
        self.assertGreaterEqual(len(oks), 10)

    def test_30_recaptcha_script_reachable(self):
        try:
            status, _ = http_head("https://www.google.com/recaptcha/api.js")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        self.assertLess(status, 400)


class TestReleaseIntegrity(unittest.TestCase):
    def test_31_required_files(self):
        for name in (
            "main.js",
            "frame-policy.js",
            "pages-config.js",
            "painel.html",
            "preload.js",
            "updater.js",
            "config.json",
            "package.json",
            "criar-deb.py",
            "criar-deb.sh",
        ):
            self.assertTrue((ROOT / name).is_file(), name)

    def test_32_config_github(self):
        data = json.loads(read(ROOT / "config.json"))
        self.assertEqual(data.get("githubOwner"), "Rede-RWP")
        self.assertEqual(data.get("githubRepo"), "painel-eletron")

    def test_33_third_party_storage_switch(self):
        self.assertIn("ThirdPartyStoragePartitioning", read(ROOT / "main.js"))


if __name__ == "__main__":
    os.chdir(ROOT)
    suite = unittest.defaultTestLoader.loadTestsFromModule(__import__(__name__))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
