const { app, net } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const RECHECK_MS = 4 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15000;
const STALL_MS = 45000;
const HELPER = '/opt/ppf-painel/update-helper';

let busy = false;

function updatesEnabled() {
  return (
    !process.argv.includes('--no-update') &&
    process.env.PPF_PAINEL_UPDATE !== '0'
  );
}

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function githubApiHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': `PPF-Painel/${app.getVersion()}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function latestReleaseUrl() {
  if (process.env.PPF_PAINEL_UPDATE_URL) {
    return process.env.PPF_PAINEL_UPDATE_URL;
  }
  const cfg = loadConfig();
  const owner = cfg.githubOwner || 'Rede-RWP';
  const repo = cfg.githubRepo || 'painel-eletron';
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

function parseVer(v) {
  return String(v || '0')
    .split(/[.-]/)
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVer(remote);
  const b = parseVer(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function send(win, payload) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('update-status', payload);
  } catch (_) {
    // janela já fechou
  }
}

function isAppImage() {
  return Boolean(process.env.APPIMAGE);
}

function isDebInstall() {
  return process.platform === 'linux' && !isAppImage() && fs.existsSync('/opt/ppf-painel/ppf-painel');
}

async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, {
      signal: ac.signal,
      bypassCustomProtocolHandlers: true,
      headers: githubApiHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Feed HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadToFile(url, dest, onProgress) {
  const ac = new AbortController();
  let stallTimer;
  const bumpStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => ac.abort(), STALL_MS);
  };
  bumpStall();

  const res = await net.fetch(url, {
    signal: ac.signal,
    bypassCustomProtocolHandlers: true,
  });
  if (!res.ok) {
    clearTimeout(stallTimer);
    throw new Error(`Download HTTP ${res.status}`);
  }

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const out = fs.createWriteStream(dest);
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bumpStall();
      received += value.length;
      await new Promise((resolve, reject) => {
        out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      if (onProgress) {
        const percent = total ? Math.min(99, Math.round((received / total) * 100)) : 0;
        onProgress({ received, total, percent });
      }
    }
    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    out.destroy();
    try {
      fs.unlinkSync(dest);
    } catch (_) {
      // ignore
    }
    throw err;
  } finally {
    clearTimeout(stallTimer);
  }
}

function shaFromAsset(asset) {
  const digest = String((asset && asset.digest) || '');
  const m = digest.match(/sha256:([a-fA-F0-9]{64})/i);
  return m ? m[1] : null;
}

function releaseVersion(release) {
  return String(release.tag_name || release.name || '')
    .trim()
    .replace(/^v/i, '');
}

function findAsset(assets, test) {
  return (assets || []).find((a) => a && a.browser_download_url && test(a.name || ''));
}

function pickAsset(release) {
  const assets = release.assets || [];
  const deb = findAsset(
    assets,
    (n) => /\.deb$/i.test(n) && !/arm64/i.test(n) && /ppf-painel/i.test(n)
  );
  const appimage = findAsset(
    assets,
    (n) => /\.AppImage$/i.test(n) && !/arm64/i.test(n)
  );

  if (isAppImage() && appimage) {
    return { kind: 'appimage', url: appimage.browser_download_url, sha256: shaFromAsset(appimage) };
  }
  if (deb && (isDebInstall() || process.platform === 'linux')) {
    return { kind: 'deb', url: deb.browser_download_url, sha256: shaFromAsset(deb) };
  }
  if (appimage) {
    return { kind: 'appimage', url: appimage.browser_download_url, sha256: shaFromAsset(appimage) };
  }
  return null;
}

async function installDeb(debPath) {
  if (!fs.existsSync(HELPER)) {
    const err = new Error(
      'Este PC ainda não tem o atualizador automático. Instale esta versão do .deb uma vez (última instalação manual).'
    );
    err.code = 'NO_HELPER';
    throw err;
  }
  await execFileAsync('sudo', ['-n', HELPER, debPath], {
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function installAppImage(downloadedPath) {
  const dest = process.env.APPIMAGE;
  if (!dest) {
    throw new Error('Instalação AppImage só funciona no pacote AppImage.');
  }
  fs.chmodSync(downloadedPath, 0o755);
  const bak = `${dest}.bak`;
  try {
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    if (fs.existsSync(dest)) fs.renameSync(dest, bak);
    fs.renameSync(downloadedPath, dest);
  } catch (err) {
    if (fs.existsSync(bak) && !fs.existsSync(dest)) {
      fs.renameSync(bak, dest);
    }
    throw err;
  }
}

function relaunchSoon() {
  setTimeout(() => {
    const extra = {
      args: process.argv.slice(1).filter((a) => a !== '.'),
    };
    if (process.env.APPIMAGE) {
      extra.execPath = process.env.APPIMAGE;
    }
    app.relaunch(extra);
    app.exit(0);
  }, 2500);
}

async function runOnce(win) {
  if (!updatesEnabled() || busy) return;

  const linuxPackaged = isDebInstall() || isAppImage();
  const forceTest = process.env.PPF_PAINEL_UPDATE_TEST === '1';
  if (!linuxPackaged && !forceTest) {
    return;
  }

  busy = true;
  let overlayOpen = false;
  try {
    const local = app.getVersion();
    let release;
    try {
      release = await fetchJson(latestReleaseUrl());
    } catch (err) {
      console.error('[ppf-update] GitHub indisponível', err && err.message ? err.message : err);
      return;
    }

    const remote = releaseVersion(release);
    const notes = String(release.body || '').split('\n')[0].trim();
    if (!remote || !isNewer(remote, local)) {
      return;
    }

    if (process.platform !== 'linux') {
      overlayOpen = true;
      send(win, {
        phase: 'info',
        version: remote,
        notes: notes,
        message: `Versão ${remote} disponível. A instalação automática roda nas lojas (Linux).`,
      });
      return;
    }

    const asset = pickAsset(release);
    if (!asset || !asset.url) {
      return;
    }

    overlayOpen = true;
    send(win, {
      phase: 'available',
      version: remote,
      notes,
      message: `Nova versão ${remote} encontrada. Atualizando…`,
      percent: 0,
    });

    const tmpDir = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
    const filename =
      asset.kind === 'deb'
        ? `ppf-painel-multitask_${remote}_amd64.deb`
        : `ppf-painel-multitask_${remote}.AppImage`;
    const dest = path.join(tmpDir, filename);

    await downloadToFile(asset.url, dest, ({ percent }) => {
      send(win, {
        phase: 'downloading',
        version: remote,
        notes,
        message: `Baixando versão ${remote}… ${percent}%`,
        percent,
      });
    });

    if (asset.sha256) {
      send(win, {
        phase: 'verifying',
        version: remote,
        message: 'Verificando o arquivo…',
        percent: 100,
      });
      const hash = await sha256File(dest);
      if (hash.toLowerCase() !== String(asset.sha256).toLowerCase()) {
        try {
          fs.unlinkSync(dest);
        } catch (_) {
          // ignore
        }
        throw new Error('Arquivo da atualização não conferiu (sha256).');
      }
    }

    send(win, {
      phase: 'installing',
      version: remote,
      message: 'Instalando a atualização…',
      percent: 100,
    });

    if (asset.kind === 'deb' && isDebInstall()) {
      await installDeb(dest);
    } else if (asset.kind === 'appimage' && isAppImage()) {
      await installAppImage(dest);
    } else if (asset.kind === 'deb') {
      await installDeb(dest);
    } else {
      throw new Error('Não sei instalar este tipo de pacote neste computador.');
    }

    send(win, {
      phase: 'success',
      version: remote,
      notes,
      message: `Atualizado com sucesso para ${remote}. Reiniciando…`,
      percent: 100,
    });
    relaunchSoon();
  } catch (err) {
    if (overlayOpen) {
      send(win, {
        phase: 'error',
        message: err && err.message ? err.message : 'Falha na atualização. O painel continua nesta versão.',
      });
    }
    console.error('[ppf-update]', err);
  } finally {
    busy = false;
  }
}

function startAutoUpdate(win) {
  if (!updatesEnabled()) return;

  const kick = () => {
    runOnce(win).catch((err) => console.error('[ppf-update]', err));
  };

  setTimeout(kick, 2500);
  setInterval(kick, RECHECK_MS);
}

module.exports = { startAutoUpdate, updatesEnabled };
