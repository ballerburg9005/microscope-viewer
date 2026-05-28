const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('microscope', {
  list: () => ipcRenderer.invoke('camera:list'),
  start: (options) => ipcRenderer.invoke('camera:start', options),
  stop: () => ipcRenderer.invoke('camera:stop'),
  saveSnapshot: (dataUrl) => ipcRenderer.invoke('snapshot:save', dataUrl),
  onBridgeEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('bridge:event', listener);
    return () => ipcRenderer.removeListener('bridge:event', listener);
  },
});
