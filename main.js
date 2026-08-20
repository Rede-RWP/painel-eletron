const { app, BrowserWindow, BrowserView, session, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const { startAutoUpdate } = require('./updater');
const {
  hostNeedsFrameBypass,
  stripFrameHeaders,
  isAllowedPopupUrl,
} = require('./frame-policy');
const { DOCK_RESERVE, PAGES } = require('./pages-config');

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
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  if (wantKiosk) {
    app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
    app.commandLine.appendSwitch('ozone-platform', 'x11');
  }
}

// Storage de terceiros (Firebase) + reCAPTCHA em guest views.
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');

function chromeUserAgent() {
  const ver = process.versions.chrome || '120.0.0.0';
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

/** Remove X-Frame-Options / frame-ancestors (sites + challenge do captcha). */
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

let mainWindow = null;
let activePageId = 'home';
let overlayVisible = false;
const views = new Map();
let lastKioskEnforce = 0;
let kioskStartupRetries = 0;

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

function contentBounds(win) {
  const [width, height] = win.getContentSize();
  return {
    x: 0,
    y: 0,
    width,
    height: Math.max(240, height - DOCK_RESERVE),
  };
}

function attachGuestHandlers(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (!isAllowedPopupUrl(url)) {
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: mainWindow || undefined,
        modal: false,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        width: 520,
        height: 680,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      },
    };
  });

  wc.on('did-create-window', (child) => {
    try {
      child.setMenuBarVisibility(false);
      child.webContents.setUserAgent(chromeUserAgent());
      child.webContents.setWindowOpenHandler(({ url }) =>
        isAllowedPopupUrl(url)
          ? { action: 'allow' }
          : { action: 'deny' }
      );
    } catch (_) {
      // ignore
    }
  });
}

function destroyView(id) {
  const view = views.get(id);
  if (!view) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeBrowserView(view);
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.destroy();
    }
  } catch (_) {
    // ignore
  }
  views.delete(id);
}

function ensureView(id) {
  const conf = PAGES[id];
  if (!conf) return null;

  let view = views.get(id);
  if (view && !view.webContents.isDestroyed()) {
    return view;
  }

  view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  view.webContents.setUserAgent(chromeUserAgent());
  attachGuestHandlers(view.webContents);
  view.webContents.loadURL(conf.url);
  views.set(id, view);
  return view;
}

function hideAllViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const view of views.values()) {
    try {
      mainWindow.removeBrowserView(view);
    } catch (_) {
      // ignore
    }
  }
}

function layoutActiveView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (overlayVisible || activePageId === 'home') return;
  const view = views.get(activePageId);
  if (!view || view.webContents.isDestroyed()) return;
  view.setBounds(contentBounds(mainWindow));
}

function showPage(id) {
  if (!PAGES[id] && id !== 'home') return { ok: false };

  const prev = activePageId;
  activePageId = id;

  hideAllViews();

  // Libera RAM: descarrega abas sem keepAlive ao sair.
  if (prev !== 'home' && prev !== id && PAGES[prev] && !PAGES[prev].keepAlive) {
    destroyView(prev);
  }

  if (id === 'home' || overlayVisible) {
    return { ok: true, id };
  }

  const view = ensureView(id);
  if (!view) return { ok: false };

  mainWindow.setBrowserView(view);
  view.setBounds(contentBounds(mainWindow));
  try {
    view.webContents.focus();
  } catch (_) {
    // ignore
  }
  return { ok: true, id };
}

function setOverlayVisible(visible) {
  overlayVisible = !!visible;
  if (overlayVisible) {
    hideAllViews();
  } else if (activePageId !== 'home') {
    showPage(activePageId);
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
      backgroundThrottling: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow = win;
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'painel.html'));

  win.webContents.setUserAgent(chromeUserAgent());
  attachGuestHandlers(win.webContents);

  win.webContents.once('did-finish-load', () => {
    startAutoUpdate(win);
  });

  win.once('ready-to-show', () => {
    enforceKiosk(win, { force: true });
    win.show();
    scheduleKioskStartup(win);
  });

  const relayout = () => layoutActiveView();
  win.on('resize', relayout);
  win.on('maximize', relayout);
  win.on('unmaximize', relayout);
  win.on('enter-full-screen', relayout);
  win.on('leave-full-screen', relayout);

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

  win.on('closed', () => {
    for (const id of [...views.keys()]) {
      destroyView(id);
    }
    if (mainWindow === win) mainWindow = null;
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
    app.userAgentFallback = chromeUserAgent();
    session.defaultSession.setUserAgent(chromeUserAgent());

    ipcMain.handle('app-version', () => app.getVersion());
    ipcMain.handle('nav-show-page', (_e, id) => showPage(String(id || 'home')));
    ipcMain.handle('nav-set-overlay', (_e, visible) => {
      setOverlayVisible(!!visible);
      return { ok: true };
    });

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
