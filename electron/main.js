const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const Store = require('electron-store');
const chokidar = require('chokidar');

const store = new Store({ name: 'markgrove-session' });
const snapshotStore = new Store({ name: 'markgrove-snapshots' });

const isDev = process.env.NODE_ENV === 'development';
const watchers = new Map();

// Track files we recently wrote ourselves to suppress watcher events
const recentWrites = new Map(); // filePath -> timestamp
const SELF_WRITE_SUPPRESS_MS = 1500;

let mainWindow = null;
// Per-window close authorization: Map<webContentsId, boolean>
const closeAuthorized = new Map();

// Register IPC listener once at module level, not per-window
ipcMain.on('before-close-confirmed', (event) => {
  const wcId = event.sender.id;
  closeAuthorized.set(wcId, true);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

function createWindow() {
  const win = new BrowserWindow({
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
  mainWindow = win;

  // Initialize close authorization for this window
  closeAuthorized.set(win.webContents.id, false);

  win.once('ready-to-show', () => win.show());

  // Intercept new window requests - open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Intercept navigation to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL();
    if (url !== currentUrl && (url.startsWith('http://') || url.startsWith('https://'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('close', (e) => {
    const wcId = win.webContents.id;
    if (!closeAuthorized.get(wcId)) {
      e.preventDefault();
      win.webContents.send('before-close-request');
    }
  });

  // Clean up when window is destroyed
  win.on('closed', () => {
    closeAuthorized.delete(win.webContents.id);
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
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
    // Suppress events from our own writes
    const writeTime = recentWrites.get(filePath);
    if (writeTime && (Date.now() - writeTime) < SELF_WRITE_SUPPRESS_MS) {
      return;
    }
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

function markSelfWrite(filePath) {
  recentWrites.set(filePath, Date.now());
  // Clean up old entries periodically
  if (recentWrites.size > 100) {
    const now = Date.now();
    for (const [p, t] of recentWrites) {
      if (now - t > SELF_WRITE_SUPPRESS_MS * 2) {
        recentWrites.delete(p);
      }
    }
  }
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


ipcMain.handle('write-file-atomic', async (_event, filePath, content) => {
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${Date.now()}`
  );
  try {
    if (!isPathInProject(filePath)) {
      return { error: '文件路径不在已打开的项目目录内' };
    }
    // Preserve original file permissions
    let mode;
    try {
      const origStat = await fs.stat(filePath);
      mode = origStat.mode;
    } catch { /* file may not exist yet */ }

    markSelfWrite(filePath);
    await fs.writeFile(tmpPath, content, 'utf-8');
    if (mode !== undefined) {
      await fs.chmod(tmpPath, mode);
    }
    await fs.rename(tmpPath, filePath);
    const stat = await fs.stat(filePath);
    return { success: true, mtime: stat.mtimeMs };
  } catch (err) {
    // Clean up temp file on failure
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    return { error: err.message };
  }
});

ipcMain.handle('get-file-mtime', async (_event, filePath) => {
  try {
    if (!isPathInProject(filePath)) {
      return { error: '文件路径不在已打开的项目目录内' };
    }
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

ipcMain.handle('get-dir-name', (_event, filePath) => {
  return path.dirname(filePath);
});

// Resolve a relative path against a base directory, with project boundary check
ipcMain.handle('resolve-path', (_event, baseDir, relativePath) => {
  try {
    const resolved = path.resolve(baseDir, relativePath);
    if (!isPathInProject(resolved)) {
      return { error: '解析后的路径不在已打开的项目目录内' };
    }
    return { resolved };
  } catch (err) {
    return { error: err.message };
  }
});

// Open external URL in system browser
ipcMain.handle('open-external', (_event, url) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url);
  }
});

// Show a native save dialog and return the chosen path (or null if canceled)
ipcMain.handle('show-save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options?.title || '保存',
    defaultPath: options?.defaultPath,
    filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

// Write exported image data to a user-chosen path.
// Path is constrained to image extensions to prevent abuse.
const EXPORT_ALLOWED_EXTS = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);
ipcMain.handle('write-export-file', async (_event, filePath, data) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!EXPORT_ALLOWED_EXTS.has(ext)) {
      return { error: '不支持的导出格式' };
    }
    const buffer = typeof data === 'string' ? data : Buffer.from(data);
    await fs.writeFile(filePath, buffer);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Snapshot persistence
ipcMain.handle('get-snapshots', () => {
  return snapshotStore.get('snapshots', []);
});

ipcMain.handle('save-snapshots', (_event, snapshots) => {
  // Keep only the latest 50 snapshots
  snapshotStore.set('snapshots', snapshots.slice(-50));
});

// Full-text search across project files
ipcMain.handle('search-in-files', async (_event, projectPath, query) => {
  if (!isPathInProject(projectPath)) {
    return { error: '路径不在已打开的项目目录内' };
  }
  if (!query || query.length < 2) {
    return { results: [] };
  }
  const results = [];
  const lowerQuery = query.toLowerCase();

  async function searchDir(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else if (isMarkdownFile(entry.name)) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const matches = [];
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                // Include context: 1 line before and after
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length - 1, i + 1);
                matches.push({
                  line: i + 1,
                  text: lines[i].trim(),
                  context: lines.slice(start, end + 1).join('\n'),
                });
              }
            }
            if (matches.length > 0) {
              results.push({ filePath: fullPath, matches });
            }
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  await searchDir(projectPath);
  return { results };
});
