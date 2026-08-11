const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDirectory: () => ipcRenderer.invoke('open-directory'),
  scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  startWatching: (path) => ipcRenderer.invoke('start-watching', path),
  stopWatching: (path) => ipcRenderer.invoke('stop-watching', path),
  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  getProjectName: (path) => ipcRenderer.invoke('get-project-name', path),
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (_event, data) => callback(data));
  },
  removeFileChangedListener: () => {
    ipcRenderer.removeAllListeners('file-changed');
  },
});
