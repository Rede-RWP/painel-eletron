const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('painelUpdates', {
  version: () => ipcRenderer.invoke('app-version'),
  onStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, payload) => callback(payload));
  },
});
