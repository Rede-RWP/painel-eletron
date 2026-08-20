const { app, BrowserWindow, session, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const { startAutoUpdate } = require('./updater');
const { hostNeedsFrameBypass, stripFrameHeaders } = require('./frame-policy');

// Kiosk/tela cheia: nas lojas (Linux) é o padrão.
// No Mac (desenvolvimento) abre em janela.
// Forçar kiosk: --kiosk ou PPF_PAINEL_KIOSK=1. Desligar: --no-kiosk ou PPF_PAINEL_KIOSK=0.
const wantKiosk = (() => {
  if (process.argv.includes('--no-kiosk') || process.env.PPF_PAINEL_KIOSK === '0') {
    return false;
  }
  if (process.platform === 'darwin') {
    return process.argv.includes('--kiosk') || process.env.PPF_PAINEL_KIOSK === '1';
  }
  return true;
})();

if (process.platform === 'linux') {
  // Evita crash/travamento quando /dev/shm é pequeno (comum em PDV).
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  if (wantKiosk) {
    app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
    app.commandLine.appendSwitch('ozone-platform', 'x11');
  }
}

// Cardápio Web / Firebase auth dentro de iframe (pai file://) precisa de storage
// de terceiros — sem isso o portal pode ficar em branco após login/redirect.
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');

/** Remove X-Frame-Options / frame-ancestors nos iframes dos sites parceiros. */
function attachFrameBypass() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      if (
        details.resourceType !== 'subFrame' &&
        details.resourceType !== 'mainFrame'
      ) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      if (!hostNeedsFrameBypass(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({ responseHeaders: stripFrameHeaders(details.responseHeaders) });
    }
  );
}

function primaryBounds() {
  return screen.getPrimaryDisplay().bounds;
}

let lastKioskEnforce = 0;
let kioskStartupRetries = 0;

/** Aplica kiosk com debounce — evita loop infinito com KWin/Plasma. */
function enforceKiosk(win, { force = false } = {}) {
  if (!wantKiosk || win.isDestroyed()) return;

  const now = Date.now();
  if (!force && now - lastKioskEnforce < 3000) return;
  if (!force && win.isFullScreen() && win.isKiosk()) return;

  lastKioskEnforce = now;
  const b = primaryBounds();
  try {
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    if (!win.isMaximized()) win.maximize();
    if (!win.isFullScreen()) win.setFullScreen(true);
    if (!win.isKiosk()) win.setKiosk(true);
    win.focus();
  } catch (_) {
    // race com destroy
  }
}

function scheduleKioskStartup(win) {
  if (!wantKiosk || process.platform !== 'linux') return;
  const delays = [200, 800, 2000];
  delays.forEach((ms) => {
    setTimeout(() => {
      if (win.isDestroyed() || kioskStartupRetries >= 3) return;
      if (win.isFullScreen() && win.isKiosk()) {
        kioskStartupRetries = 3;
        return;
      }
      kioskStartupRetries += 1;
      enforceKiosk(win, { force: true });
    }, ms);
  });
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
      backgroundThrottling: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'painel.html'));

  win.webContents.once('did-finish-load', () => {
    startAutoUpdate(win);
  });

  win.once('ready-to-show', () => {
    enforceKiosk(win, { force: true });
    win.show();
    scheduleKioskStartup(win);
  });

  // Não reagir a leave-full-screen/unmaximize — isso gerava loop com KWin e travava o SO.

  win.webContents.on('before-input-event', (_event, input) => {
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
  console.error('PPF Painel já está aberto. Esta nova janela vai fechar.');
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      enforceKiosk(win, { force: true });
      win.focus();
    }
  });

  app.whenReady().then(() => {
    ipcMain.handle('app-version', () => app.getVersion());
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
