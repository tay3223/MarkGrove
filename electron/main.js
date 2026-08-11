const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const Store = require('electron-store');
const chokidar = require('chokidar');

const store = new Store({ name: 'markgrove-session' });

const isDev = process.env.NODE_ENV === 'development';
const watchers = new Map();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'MarkGrove · 墨林',
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.vscode', '.idea', 'dist', 'out',
  '.next', '.nuxt', 'build', 'coverage', '__pycache__',
]);

async function scanDirectory(dirPath, relativePath = '') {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await scanDirectory(fullPath, relPath);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: fullPath, type: 'directory', children });
      }
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')) {
      const stat = await fs.stat(fullPath);
      nodes.push({ name: entry.name, path: fullPath, type: 'file', size: stat.size });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

function startWatcher(projectPath) {
  stopWatcher(projectPath);
  const watcher = chokidar.watch(projectPath, {
    ignored: (filePath) => {
      const parts = filePath.split(path.sep);
      return parts.some(p => IGNORE_DIRS.has(p));
    },
    persistent: true,
    ignoreInitial: true,
    depth: 10,
  });
  watcher.on('all', (event, filePath) => {
    if (!filePath.endsWith('.md') && !filePath.endsWith('.markdown')) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-changed', { event, path: filePath, projectPath });
    }
  });
  watchers.set(projectPath, watcher);
}

function stopWatcher(projectPath) {
  const w = watchers.get(projectPath);
  if (w) { w.close(); watchers.delete(projectPath); }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  watchers.forEach(w => w.close());
  watchers.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC Handlers ----

ipcMain.handle('open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择项目目录',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-directory', async (_event, dirPath) => {
  try {
    return await scanDirectory(dirPath);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('write-file', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('start-watching', (_event, projectPath) => {
  startWatcher(projectPath);
});

ipcMain.handle('stop-watching', (_event, projectPath) => {
  stopWatcher(projectPath);
});

ipcMain.handle('get-session', () => {
  return store.get('session', null);
});

ipcMain.handle('save-session', (_event, session) => {
  store.set('session', session);
});

ipcMain.handle('get-project-name', (_event, projectPath) => {
  return path.basename(projectPath);
});
