#!/usr/bin/env python3
"""
Testes de força / regressão do PPF Painel Multitask (1.1.5+).

Foco: Cardápio Web carregar em iframe, bypass de hosts, versões sincronizadas
e resistência a carga (matching / parsing / HTTP).

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
EXPECTED_VERSION = "1.1.5"
FRAME_SUFFIXES = ("cardapioweb.com", "ifood.com.br", "rederwp.com")
CARDAPIO_URL = "https://portal.cardapioweb.com"
SSL_CTX = ssl.create_default_context()


def host_needs_frame_bypass(url: str) -> bool:
    """Espelho de frame-policy.js — hostNeedsFrameBypass."""
    try:
        host = urlparse(url).hostname
        if not host:
            return False
        host = host.lower()
        return any(host == s or host.endswith("." + s) for s in FRAME_SUFFIXES)
    except Exception:
        return False


def strip_frame_headers(headers: dict[str, list[str]]) -> dict[str, list[str]]:
    """Espelho de frame-policy.js — stripFrameHeaders."""
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

    def test_05_no_stale_1_1_2_in_release_files(self):
        for name in ("package.json", "criar-deb.py", "criar-deb.sh"):
            text = read(ROOT / name)
            self.assertNotRegex(
                text,
                r'\b1\.1\.2\b',
                f"{name} ainda cita 1.1.2",
            )


class TestFramePolicySource(unittest.TestCase):
    def test_06_frame_policy_file_exists(self):
        self.assertTrue((ROOT / "frame-policy.js").is_file())

    def test_07_main_requires_frame_policy(self):
        text = read(ROOT / "main.js")
        self.assertIn("require('./frame-policy')", text)
        self.assertIn("hostNeedsFrameBypass", text)
        self.assertIn("stripFrameHeaders", text)

    def test_08_package_files_includes_frame_policy(self):
        data = json.loads(read(ROOT / "package.json"))
        self.assertIn("frame-policy.js", data["build"]["files"])

    def test_09_third_party_storage_switch(self):
        text = read(ROOT / "main.js")
        self.assertIn("ThirdPartyStoragePartitioning", text)

    def test_10_frame_suffixes_cover_cardapioweb(self):
        text = read(ROOT / "frame-policy.js")
        self.assertIn("cardapioweb.com", text)
        self.assertIn("ifood.com.br", text)
        self.assertIn("rederwp.com", text)


class TestHostBypassLogic(unittest.TestCase):
    def test_11_portal_cardapioweb(self):
        self.assertTrue(host_needs_frame_bypass("https://portal.cardapioweb.com/"))

    def test_12_app_and_api_subdomains(self):
        for host in (
            "app.cardapioweb.com",
            "api.cardapioweb.com",
            "dashboard.cardapioweb.com",
            "ifood.cardapioweb.com",
            "ajuda.cardapioweb.com",
        ):
            self.assertTrue(
                host_needs_frame_bypass(f"https://{host}/path"),
                host,
            )

    def test_13_ifood_and_rwp(self):
        self.assertTrue(
            host_needs_frame_bypass("https://gestordepedidos.ifood.com.br/#/login")
        )
        self.assertTrue(host_needs_frame_bypass("https://portal.ifood.com.br"))
        self.assertTrue(
            host_needs_frame_bypass("https://www.rederwp.com/src/login.php")
        )
        self.assertTrue(host_needs_frame_bypass("https://rederwp.com/"))

    def test_14_rejects_unrelated_hosts(self):
        for url in (
            "https://google.com",
            "https://evil-cardapioweb.com.attacker.test",
            "https://notcardapioweb.com",
            "https://ifood.com.br.evil.test",
            "file:///tmp/painel.html",
            "not-a-url",
            "",
        ):
            self.assertFalse(host_needs_frame_bypass(url), url)

    def test_15_strip_xfo_and_frame_ancestors(self):
        headers = {
            "X-Frame-Options": ["SAMEORIGIN"],
            "Content-Security-Policy": [
                "default-src 'self'; frame-ancestors 'self'; img-src *"
            ],
            "Content-Type": ["text/html"],
        }
        out = strip_frame_headers(headers)
        self.assertNotIn("X-Frame-Options", out)
        self.assertIn("Content-Type", out)
        csp = out["Content-Security-Policy"][0].lower()
        self.assertNotIn("frame-ancestors", csp)
        self.assertIn("default-src", csp)


class TestPainelHtml(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = read(ROOT / "painel.html")

    def test_16_cardweb_iframe_data_src(self):
        self.assertIn('id="iframe-cardweb"', self.html)
        self.assertIn('data-src="https://portal.cardapioweb.com"', self.html)

    def test_17_all_page_iframes_present(self):
        for page_id in ("cardweb", "ifood", "gestao", "rwp"):
            self.assertIn(f'id="iframe-{page_id}"', self.html)
            self.assertIn(f"showPage('{page_id}'", self.html)

    def test_18_keep_session_cardweb(self):
        self.assertIn("KEEP_SESSION", self.html)
        self.assertIn("'cardweb'", self.html)

    def test_19_dataset_loaded_gate(self):
        self.assertIn("dataset.loaded", self.html)
        self.assertIn("data-src", self.html)

    def test_20_visibility_hidden_inactive(self):
        self.assertIn("iframe.page-frame:not(.active)", self.html)
        self.assertIn("visibility: hidden", self.html)


class TestStressForce(unittest.TestCase):
    def test_21_stress_host_match_10k(self):
        samples = [
            "https://portal.cardapioweb.com/",
            "https://app.cardapioweb.com/login",
            "https://api.cardapioweb.com/v1",
            "https://gestordepedidos.ifood.com.br/",
            "https://portal.ifood.com.br/",
            "https://www.rederwp.com/src/login.php",
            "https://google.com/",
            "https://evil.com/?q=cardapioweb.com",
        ]
        t0 = time.perf_counter()
        hits = 0
        for i in range(10_000):
            url = samples[i % len(samples)]
            if host_needs_frame_bypass(url):
                hits += 1
        elapsed = time.perf_counter() - t0
        self.assertGreater(hits, 0)
        self.assertLess(elapsed, 2.0, f"matching lento: {elapsed:.3f}s")

    def test_22_stress_parallel_matching(self):
        urls = [
            f"https://shop{i}.cardapioweb.com/page"
            for i in range(500)
        ] + [f"https://noise{i}.example.com/" for i in range(500)]

        def batch(chunk):
            return sum(1 for u in chunk if host_needs_frame_bypass(u))

        chunks = [urls[i : i + 100] for i in range(0, len(urls), 100)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            totals = list(pool.map(batch, chunks))
        self.assertEqual(sum(totals), 500)

    def test_23_stress_strip_headers_repeated(self):
        base = {
            "x-frame-options": ["DENY"],
            "content-security-policy": [
                "frame-ancestors https://evil.com; script-src 'self'"
            ],
        }
        for _ in range(2000):
            out = strip_frame_headers(base)
            self.assertNotIn("x-frame-options", out)
            self.assertNotIn("frame-ancestors", out["content-security-policy"][0].lower())

    def test_24_stress_parse_painel_html(self):
        html = read(ROOT / "painel.html")
        for _ in range(500):
            frames = re.findall(r'id="iframe-([a-z]+)"', html)
            srcs = re.findall(r'data-src="(https://[^"]+)"', html)
            self.assertEqual(len(frames), 4)
            self.assertEqual(len(srcs), 4)
            self.assertIn("cardweb", frames)

    def test_25_fuzz_suffix_boundary(self):
        # Não deve casar host que só contém o sufixo no meio do nome.
        evil = [
            "https://cardapioweb.com.evil.test/",
            "https://xcardapioweb.com/",
            "https://myifood.com.br.fake/",
            "https://rederwp.com.attacker.io/",
        ]
        for url in evil:
            self.assertFalse(host_needs_frame_bypass(url), url)


class TestLiveCardapioHttp(unittest.TestCase):
    """Testes de rede — pulam se offline."""

    def test_26_cardapio_reachable(self):
        try:
            status, headers = http_head(CARDAPIO_URL)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        self.assertIn(status, (200, 301, 302, 303, 307, 308))

    def test_27_cardapio_sends_xfo_sameorigin(self):
        """Prova que o bypass no Electron é necessário."""
        try:
            status, headers = http_head(CARDAPIO_URL + "/")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        xfo = headers.get("x-frame-options", "").upper()
        self.assertIn("SAMEORIGIN", xfo)

    def test_28_cardapio_html_has_root(self):
        try:
            status, body = http_get(CARDAPIO_URL + "/")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.skipTest(f"rede indisponível: {exc}")
        self.assertEqual(status, 200)
        text = body.decode("utf-8", errors="ignore")
        self.assertIn('id="root"', text)

    def test_29_stress_parallel_cardapio_heads(self):
        def one(_):
            try:
                status, _headers = http_head(CARDAPIO_URL + "/")
                return status
            except Exception as exc:  # noqa: BLE001
                return exc

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(one, range(20)))
        errors = [r for r in results if not isinstance(r, int)]
        if len(errors) == 20:
            self.skipTest(f"rede indisponível: {errors[0]}")
        oks = [r for r in results if isinstance(r, int) and r < 400]
        self.assertGreaterEqual(len(oks), 10, results)

    def test_30_subdomains_bypass_matrix_live(self):
        hosts = [
            "https://portal.cardapioweb.com/",
            "https://app.cardapioweb.com/",
        ]
        for url in hosts:
            self.assertTrue(host_needs_frame_bypass(url))
            try:
                http_head(url)
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                self.skipTest(f"rede indisponível ({url}): {exc}")


class TestReleaseIntegrity(unittest.TestCase):
    def test_31_required_source_files(self):
        for name in (
            "main.js",
            "frame-policy.js",
            "painel.html",
            "preload.js",
            "updater.js",
            "config.json",
            "package.json",
            "criar-deb.py",
            "criar-deb.sh",
        ):
            self.assertTrue((ROOT / name).is_file(), name)

    def test_32_config_github_repo(self):
        data = json.loads(read(ROOT / "config.json"))
        self.assertEqual(data.get("githubOwner"), "Rede-RWP")
        self.assertEqual(data.get("githubRepo"), "painel-eletron")

    def test_33_showpage_null_safe(self):
        html = read(ROOT / "painel.html")
        self.assertIn("if (!targetFrame) return", html)


if __name__ == "__main__":
    # Garante cwd independente.
    os.chdir(ROOT)
    suite = unittest.defaultTestLoader.loadTestsFromModule(__import__(__name__))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
