const { app, BrowserWindow, session, Menu, screen } = require('electron');
const path = require('path');

// Kiosk/tela cheia por padrão (totem/PDV). Desligar: --no-kiosk ou PPF_PAINEL_KIOSK=0
const wantKiosk =
  !process.argv.includes('--no-kiosk') &&
  process.env.PPF_PAINEL_KIOSK !== '0';

// No Debian/KDE (sobretudo Wayland), fullscreen/kiosk do Electron falha com frequência.
// Forçar backend X11 antes do app ready melhora bastante a confiabilidade.
if (process.platform === 'linux' && wantKiosk) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

/** Remove headers que impedem o Cardápio Web (e similares) de abrir em iframe. */
function attachFrameBypass() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };

    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();

      if (lower === 'x-frame-options') {
        delete headers[key];
        continue;
      }

      if (
        lower === 'content-security-policy' ||
        lower === 'content-security-policy-report-only'
      ) {
        headers[key] = headers[key].map((value) =>
          String(value)
            .replace(/frame-ancestors[^;]*;?/gi, '')
            .replace(/;\s*;/g, ';')
            .replace(/^\s*;\s*/g, '')
            .replace(/;\s*$/g, '')
            .trim()
        );
        // Se a CSP ficou vazia, remove o header
        if (!headers[key].some((v) => v.length > 0)) {
          delete headers[key];
        }
      }
    }

    callback({ responseHeaders: headers });
  });
}

function primaryBounds() {
  const display = screen.getPrimaryDisplay();
  return display.bounds;
}

/** Aplica/reaplica kiosk — o KWin às vezes ignora a 1ª chamada. */
function enforceKiosk(win) {
  if (!wantKiosk || win.isDestroyed()) return;

  const b = primaryBounds();
  try {
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    // Cobre o painel do Plasma enquanto o app estiver ativo
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    win.maximize();
    win.setFullScreen(true);
    win.setKiosk(true);
    win.focus();
  } catch (_) {
    // ignore race com destroy
  }
}

function createWindow() {
  const b = wantKiosk ? primaryBounds() : { x: undefined, y: undefined, width: 1366, height: 768 };

  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width || 1366,
    height: b.height || 768,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    fullscreen: wantKiosk,
    kiosk: wantKiosk,
    frame: !wantKiosk,
    resizable: !wantKiosk,
    skipTaskbar: wantKiosk && process.platform === 'linux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Necessário para áudio/notificações dos portais embutidos
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'painel.html'));

  win.once('ready-to-show', () => {
    enforceKiosk(win);
    win.show();
    enforceKiosk(win);
    // Retentativas: KDE/KWin costuma aplicar fullscreen só depois do map da janela
    if (wantKiosk && process.platform === 'linux') {
      [200, 600, 1500].forEach((ms) => setTimeout(() => enforceKiosk(win), ms));
    }
  });

  if (wantKiosk) {
    win.on('leave-full-screen', () => {
      setTimeout(() => enforceKiosk(win), 50);
    });
    win.on('unmaximize', () => {
      setTimeout(() => enforceKiosk(win), 50);
    });
  }

  // Atalho de saída do kiosk: Ctrl+Shift+Q
  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.control &&
      input.shift &&
      input.key.toLowerCase() === 'q'
    ) {
      app.quit();
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      if (wins[0].isMinimized()) wins[0].restore();
      enforceKiosk(wins[0]);
      wins[0].focus();
    }
  });

  app.whenReady().then(() => {
    attachFrameBypass();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
