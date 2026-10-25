const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reelsidianDesktop', {
  getStatus: () => ipcRenderer.invoke('setup:get-status'),
  retryBackend: () => ipcRenderer.invoke('setup:retry-backend'),
  openDashboard: () => ipcRenderer.invoke('setup:open-dashboard'),
  startOllama: () => ipcRenderer.invoke('setup:start-ollama'),
  pullOllamaModel: () => ipcRenderer.invoke('setup:pull-ollama-model'),
  cancelOllamaModel: () => ipcRenderer.invoke('setup:cancel-ollama-model'),
  prepareWhisperEnvironment: () => ipcRenderer.invoke('setup:prepare-whisper-environment'),
  prepareWhisperModel: () => ipcRenderer.invoke('setup:prepare-whisper-model'),
  cancelProcess: () => ipcRenderer.invoke('setup:cancel-process'),
  openOllamaDownload: () => ipcRenderer.invoke('setup:open-ollama-download'),
  onProgress(callback) {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('setup-progress', listener);
    return () => ipcRenderer.removeListener('setup-progress', listener);
  },
  onReady(callback) {
    ipcRenderer.once('setup:ready', callback);
  },
  onBackendError(callback) {
    ipcRenderer.on('backend-error', (_event, message) => callback(message));
  }
});
