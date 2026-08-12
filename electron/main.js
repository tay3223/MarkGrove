const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const Store = require('electron-store');
const chokidar = require('chokidar');

const store = new Store({ name: 'markgrove-session' });

const isDev = process.env.NODE_ENV === 'development';
const watchers = new Map();

let mainWindow = null;
let allowClose = false;

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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 28,
      color: '#11111b',
      symbolColor: '#cdd6f4',
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      mainWindow.webContents.send('before-close-request');
    }
  });

  ipcMain.on('before-close-confirmed', () => {
    allowClose = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

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

const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

function isMarkdownFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MD_EXTENSIONS.has(ext);
}

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
    } else if (isMarkdownFile(entry.name)) {
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
    if (!isMarkdownFile(filePath)) return;
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

// Validate that a file path is within one of the watched project directories
function isPathInProject(filePath) {
  for (const projectPath of watchers.keys()) {
    const resolved = path.resolve(filePath);
    const resolvedProject = path.resolve(projectPath);
    if (resolved.startsWith(resolvedProject + path.sep) || resolved === resolvedProject) {
      return true;
    }
  }
  return false;
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

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: '打开 Markdown 文件',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'All Files', extensions: ['*'] },
    ],
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
    if (!isPathInProject(filePath)) {
      return { error: '文件路径不在已打开的项目目录内' };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    const stat = await fs.stat(filePath);
    return { content, mtime: stat.mtimeMs };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('write-file', async (_event, filePath, content) => {
  try {
    if (!isPathInProject(filePath)) {
      return { error: '文件路径不在已打开的项目目录内' };
    }
    await fs.writeFile(filePath, content, 'utf-8');
    const stat = await fs.stat(filePath);
    return { success: true, mtime: stat.mtimeMs };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('write-file-atomic', async (_event, filePath, content) => {
  try {
    if (!isPathInProject(filePath)) {
      return { error: '文件路径不在已打开的项目目录内' };
    }
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, `.${base}.tmp-${Date.now()}`);
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
    const stat = await fs.stat(filePath);
    return { success: true, mtime: stat.mtimeMs };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-file-mtime', async (_event, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return { mtime: stat.mtimeMs };
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

ipcMain.handle('show-item-in-folder', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});
