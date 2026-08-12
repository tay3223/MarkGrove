const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDirectory: () => ipcRenderer.invoke('open-directory'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  writeFileAtomic: (path, content) => ipcRenderer.invoke('write-file-atomic', path, content),
  getFileMtime: (path) => ipcRenderer.invoke('get-file-mtime', path),
  startWatching: (path) => ipcRenderer.invoke('start-watching', path),
  stopWatching: (path) => ipcRenderer.invoke('stop-watching', path),
  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  getProjectName: (path) => ipcRenderer.invoke('get-project-name', path),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (_event, data) => callback(data));
  },
  removeFileChangedListener: () => {
    ipcRenderer.removeAllListeners('file-changed');
  },
  onBeforeClose: (callback) => {
    ipcRenderer.on('before-close-request', async () => {
      const canClose = await callback();
      if (canClose) {
        ipcRenderer.send('before-close-confirmed');
      }
    });
  },
  confirmClose: () => {
    ipcRenderer.send('before-close-confirmed');
  },
});
