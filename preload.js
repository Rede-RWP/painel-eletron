const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('painelUpdates', {
  version: () => ipcRenderer.invoke('app-version'),
  onStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, payload) => callback(payload));
  },
});

contextBridge.exposeInMainWorld('painelNav', {
  showPage: (id) => ipcRenderer.invoke('nav-show-page', id),
  setOverlay: (visible) => ipcRenderer.invoke('nav-set-overlay', visible),
});
