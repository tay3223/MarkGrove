import { create } from 'zustand';
import type { Project, OpenFile, FileNode, ViewTab, SessionState, UndoEntry, FileSnapshot, SourcePositionRequest } from '../types';
import { showToast } from '../components/Toast';

const MAX_UNDO_STEPS = 50;
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_INTERVAL = 30000; // 30 seconds
const UNDO_MERGE_WINDOW = 1000; // 1 second - merge rapid consecutive edits

interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  openFiles: Record<string, OpenFile[]>;
  activeFilePath: Record<string, string | null>;
  activeTab: ViewTab;
  initialized: boolean;
  undoStacks: Record<string, UndoEntry[]>; // keyed by filePath
  redoStacks: Record<string, UndoEntry[]>; // keyed by filePath
  snapshots: FileSnapshot[];
  lastSnapshotTime: number;
  pendingSourcePosition: SourcePositionRequest | null;

  initFromSession: () => Promise<void>;
  addProject: () => Promise<void>;
  openSingleFile: () => Promise<void>;
  removeProject: (projectId: string) => void;
  setActiveProject: (projectId: string) => void;
  openFile: (projectId: string, filePath: string) => Promise<void>;
  closeFile: (projectId: string, filePath: string) => void;
  setActiveFile: (projectId: string, filePath: string | null) => void;
  setActiveTab: (tab: ViewTab) => void;
  updateFileContent: (projectId: string, filePath: string, content: string, source?: 'source' | 'mindmap') => void;
  markFileDirty: (projectId: string, filePath: string, dirty: boolean) => void;
  saveFile: (projectId: string, filePath: string, force?: boolean) => Promise<boolean>;
  saveAllFiles: () => Promise<{ succeeded: number; failed: number }>;
  refreshFileTree: (projectId: string) => Promise<void>;
  handleExternalFileChange: (filePath: string, projectPath: string) => Promise<void>;
  saveSession: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  takeSnapshot: (filePath: string, content: string) => void;
  flushAllSaves: () => Promise<void>;
  resolveConflict: (projectId: string, filePath: string, resolution: 'keep-local' | 'use-external') => Promise<void>;
  requestSourcePosition: (req: SourcePositionRequest) => void;
  clearSourcePosition: () => void;
  restoreSnapshot: (snapshot: FileSnapshot) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  openFiles: {},
  activeFilePath: {},
  activeTab: 'mindmap',
  initialized: false,
  undoStacks: {},
  redoStacks: {},
  snapshots: [],
  lastSnapshotTime: 0,
  pendingSourcePosition: null,

  initFromSession: async () => {
    try {
      const session = await window.api.getSession();
      // Load persisted snapshots
      try {
        const savedSnapshots = await window.api.getSnapshots();
        if (Array.isArray(savedSnapshots)) {
          set({ snapshots: savedSnapshots });
        }
      } catch { /* ignore snapshot load errors */ }

      if (session && session.projects.length > 0) {
        const projects: Project[] = [];
        const failedPaths: string[] = [];
        for (const p of session.projects) {
          try {
            const tree = await window.api.scanDirectory(p.path);
            if (!Array.isArray(tree)) {
              failedPaths.push(p.path);
              continue;
            }
            projects.push({ ...p, fileTree: tree });
            await window.api.startWatching(p.path);
          } catch {
            failedPaths.push(p.path);
          }
        }
        if (failedPaths.length > 0) {
          showToast({
            type: 'warning',
            message: '部分项目路径已失效',
            detail: failedPaths.join(', '),
          });
        }
        set({
          projects,
          activeProjectId: session.activeProjectId || projects[0]?.id || null,
          openFiles: {},
          activeFilePath: session.activeFiles || {},
          activeTab: session.activeTab || 'mindmap',
          initialized: true,
        });
        // Re-open files from session (deduplicate paths)
        const failedFiles: string[] = [];
        for (const [pid, filePaths] of Object.entries(session.openFiles)) {
          const uniquePaths = [...new Set(filePaths)];
          for (const fp of uniquePaths) {
            try {
              await get().openFile(pid, fp);
            } catch {
              failedFiles.push(fp);
            }
          }
        }
        if (failedFiles.length > 0) {
          showToast({
            type: 'warning',
            message: '部分文件无法恢复',
            detail: failedFiles.map(f => getFileName(f)).join(', '),
          });
        }
      } else {
        set({ initialized: true });
      }
    } catch (err) {
      console.error('Failed to restore session:', err);
      set({ initialized: true });
    }
  },

  addProject: async () => {
    try {
      const dirPath = await window.api.openDirectory();
      if (!dirPath) return;
      const existing = get().projects.find(p => p.path === dirPath);
      if (existing) {
        set({ activeProjectId: existing.id });
        return;
      }
      const name = await window.api.getProjectName(dirPath);
      const tree = await window.api.scanDirectory(dirPath);
      if (!Array.isArray(tree)) {
        showToast({ type: 'error', message: '扫描目录失败', detail: String((tree as any)?.error || '') });
        return;
      }
      const project: Project = { id: generateId(), name, path: dirPath, fileTree: tree };
      await window.api.startWatching(dirPath);
      set(s => ({
        projects: [...s.projects, project],
        activeProjectId: project.id,
      }));
      await get().saveSession();
      showToast({ type: 'success', message: `已打开项目: ${name}` });
    } catch (err: any) {
      showToast({ type: 'error', message: '打开项目失败', detail: err?.message });
    }
  },

  openSingleFile: async () => {
    try {
      const filePath = await window.api.openFileDialog();
      if (!filePath) return;
      // Use IPC for platform-independent directory extraction
      const dirPath = await window.api.getDirName(filePath);
      const existing = get().projects.find(p => p.path === dirPath);
      if (existing) {
        await get().openFile(existing.id, filePath);
        return;
      }
      const name = await window.api.getProjectName(dirPath);
      const tree = await window.api.scanDirectory(dirPath);
      if (!Array.isArray(tree)) return;
      const project: Project = { id: generateId(), name, path: dirPath, fileTree: tree };
      await window.api.startWatching(dirPath);
      set(s => ({
        projects: [...s.projects, project],
        activeProjectId: project.id,
      }));
      await get().openFile(project.id, filePath);
      await get().saveSession();
    } catch (err: any) {
      showToast({ type: 'error', message: '打开文件失败', detail: err?.message });
    }
  },

  removeProject: (projectId) => {
    const project = get().projects.find(p => p.id === projectId);
    if (project) {
      window.api.stopWatching(project.path);
    }
    set(s => {
      const projects = s.projects.filter(p => p.id !== projectId);
      const openFiles = { ...s.openFiles };
      const activeFilePath = { ...s.activeFilePath };
      delete openFiles[projectId];
      delete activeFilePath[projectId];
      return {
        projects,
        openFiles,
        activeFilePath,
        activeProjectId: s.activeProjectId === projectId
          ? projects[0]?.id || null
          : s.activeProjectId,
      };
    });
    get().saveSession();
  },

  setActiveProject: (projectId) => {
    set({ activeProjectId: projectId });
    get().saveSession();
  },

  openFile: async (projectId, filePath) => {
    const existing = get().openFiles[projectId]?.find(f => f.path === filePath);
    if (existing) {
      set(s => ({
        activeFilePath: { ...s.activeFilePath, [projectId]: filePath },
      }));
      return;
    }
    try {
      const result = await window.api.readFile(filePath);
      if (result.error) {
        showToast({
          type: 'error',
          message: `无法打开文件: ${getFileName(filePath)}`,
          detail: result.error,
          actions: [{
            label: '打开所在目录',
            onClick: () => window.api.showItemInFolder(filePath),
          }],
        });
        return;
      }
      const file: OpenFile = {
        path: filePath,
        content: result.content!,
        isDirty: false,
        savedContent: result.content!,
        diskMtime: result.mtime,
        saveState: 'saved',
      };
      set(s => {
        // Double-check: avoid adding duplicate file entries
        const currentFiles = s.openFiles[projectId] || [];
        if (currentFiles.some(f => f.path === filePath)) {
          return {
            activeFilePath: { ...s.activeFilePath, [projectId]: filePath },
          };
        }
        return {
          openFiles: {
            ...s.openFiles,
            [projectId]: [...currentFiles, file],
          },
          activeFilePath: { ...s.activeFilePath, [projectId]: filePath },
        };
      });
      get().saveSession();
    } catch (err: any) {
      showToast({ type: 'error', message: '打开文件失败', detail: err?.message });
    }
  },

  closeFile: (projectId, filePath) => {
    set(s => {
      const files = (s.openFiles[projectId] || []).filter(f => f.path !== filePath);
      const activeFile = s.activeFilePath[projectId] === filePath
        ? files[0]?.path || null
        : s.activeFilePath[projectId];
      return {
        openFiles: { ...s.openFiles, [projectId]: files },
        activeFilePath: { ...s.activeFilePath, [projectId]: activeFile },
      };
    });
    get().saveSession();
  },

  setActiveFile: (projectId, filePath) => {
    set(s => ({
      activeFilePath: { ...s.activeFilePath, [projectId]: filePath },
    }));
    get().saveSession();
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    get().saveSession();
  },

  updateFileContent: (projectId, filePath, content, source = 'source') => {
    const file = get().openFiles[projectId]?.find(f => f.path === filePath);
    if (!file) return;

    // Push to per-file undo stack, merging rapid consecutive edits
    if (file.content !== content) {
      set(s => {
        const fileUndoStack = s.undoStacks[filePath] || [];
        const lastEntry = fileUndoStack[fileUndoStack.length - 1];
        const now = Date.now();

        // Merge if last edit was very recent and from same source
        if (lastEntry && (now - lastEntry.timestamp) < UNDO_MERGE_WINDOW && lastEntry.source === source) {
          // Just update the content in the file, don't push new undo entry
          return {
            openFiles: {
              ...s.openFiles,
              [projectId]: (s.openFiles[projectId] || []).map(f =>
                f.path === filePath ? { ...f, content, isDirty: true, saveState: undefined, saveError: undefined, conflictState: undefined } : f
              ),
            },
          };
        }

        return {
          undoStacks: {
            ...s.undoStacks,
            [filePath]: [...fileUndoStack.slice(-MAX_UNDO_STEPS + 1), {
              filePath,
              projectId,
              content: file.content,
              timestamp: now,
              source,
            }],
          },
          redoStacks: { ...s.redoStacks, [filePath]: [] },
          openFiles: {
            ...s.openFiles,
            [projectId]: (s.openFiles[projectId] || []).map(f =>
              f.path === filePath ? { ...f, content, isDirty: true, saveState: undefined, saveError: undefined, conflictState: undefined } : f
            ),
          },
        };
      });
    }

    // Auto-snapshot periodically
    const now = Date.now();
    if (now - get().lastSnapshotTime > SNAPSHOT_INTERVAL) {
      get().takeSnapshot(filePath, content);
      set({ lastSnapshotTime: now });
    }
  },

  markFileDirty: (projectId, filePath, dirty) => {
    set(s => ({
      openFiles: {
        ...s.openFiles,
        [projectId]: (s.openFiles[projectId] || []).map(f =>
          f.path === filePath ? { ...f, isDirty: dirty } : f
        ),
      },
    }));
  },

  saveFile: async (projectId, filePath, force = false) => {
    const file = get().openFiles[projectId]?.find(f => f.path === filePath);
    if (!file) return false;

    // If in conflict state and not forcing, block the save
    if (file.conflictState === 'external-modified' && !force) {
      return false;
    }

    // Check for external modification before saving dirty files
    if (file.isDirty && file.diskMtime && !force) {
      const mtimeResult = await window.api.getFileMtime(filePath);
      if (mtimeResult.mtime && mtimeResult.mtime > file.diskMtime) {
        // External modification detected - enter conflict state
        set(s => ({
          openFiles: {
            ...s.openFiles,
            [projectId]: (s.openFiles[projectId] || []).map(f =>
              f.path === filePath ? { ...f, saveState: 'conflict' as const, conflictState: 'external-modified' as const } : f
            ),
          },
        }));
        showToast({
          type: 'warning',
          message: `文件冲突: ${getFileName(filePath)}`,
          detail: '磁盘上的文件已被外部修改，保存已被阻止',
          actions: [
            {
              label: '强制保存',
              onClick: () => { get().saveFile(projectId, filePath, true); },
            },
            {
              label: '采用磁盘版本',
              onClick: () => { get().resolveConflict(projectId, filePath, 'use-external'); },
            },
          ],
        });
        return false;
      }
    }

    // If not dirty and no external change, just reload
    if (!file.isDirty && file.diskMtime) {
      const mtimeResult = await window.api.getFileMtime(filePath);
      if (mtimeResult.mtime && mtimeResult.mtime > file.diskMtime) {
        const readResult = await window.api.readFile(filePath);
        if (!readResult.error) {
          set(s => ({
            openFiles: {
              ...s.openFiles,
              [projectId]: (s.openFiles[projectId] || []).map(f =>
                f.path === filePath ? { ...f, content: readResult.content!, savedContent: readResult.content!, diskMtime: readResult.mtime } : f
              ),
            },
          }));
          return true;
        }
      }
    }

    // Mark as saving
    set(s => ({
      openFiles: {
        ...s.openFiles,
        [projectId]: (s.openFiles[projectId] || []).map(f =>
          f.path === filePath ? { ...f, saveState: 'saving' as const, conflictState: null } : f
        ),
      },
    }));

    try {
      const result = await window.api.writeFileAtomic(filePath, file.content);
      if (result.error) {
        set(s => ({
          openFiles: {
            ...s.openFiles,
            [projectId]: (s.openFiles[projectId] || []).map(f =>
              f.path === filePath ? { ...f, saveState: 'error' as const, saveError: result.error } : f
            ),
          },
        }));
        showToast({
          type: 'error',
          message: `保存失败: ${getFileName(filePath)}`,
          detail: result.error,
          actions: [
            {
              label: '重试',
              onClick: () => { get().saveFile(projectId, filePath); },
            },
            {
              label: '复制内容',
              onClick: () => { navigator.clipboard.writeText(file.content); },
            },
          ],
        });
        return false;
      }
      set(s => ({
        openFiles: {
          ...s.openFiles,
          [projectId]: (s.openFiles[projectId] || []).map(f =>
            f.path === filePath ? {
              ...f,
              isDirty: false,
              savedContent: f.content,
              lastSavedAt: Date.now(),
              diskMtime: result.mtime,
              saveState: 'saved' as const,
              saveError: undefined,
              conflictState: null,
            } : f
          ),
        },
      }));
      return true;
    } catch (err: any) {
      set(s => ({
        openFiles: {
          ...s.openFiles,
          [projectId]: (s.openFiles[projectId] || []).map(f =>
            f.path === filePath ? { ...f, saveState: 'error' as const, saveError: err?.message } : f
          ),
        },
      }));
      showToast({
        type: 'error',
        message: `保存失败: ${getFileName(filePath)}`,
        detail: err?.message,
        actions: [
          {
            label: '重试',
            onClick: () => { get().saveFile(projectId, filePath); },
          },
          {
            label: '复制内容',
            onClick: () => { navigator.clipboard.writeText(file.content); },
          },
        ],
      });
      return false;
    }
  },

  saveAllFiles: async () => {
    const s = get();
    const promises: Promise<boolean>[] = [];
    for (const [pid, files] of Object.entries(s.openFiles)) {
      for (const f of files) {
        if (f.isDirty) {
          promises.push(get().saveFile(pid, f.path));
        }
      }
    }
    const results = await Promise.all(promises);
    const succeeded = results.filter(Boolean).length;
    const failed = results.filter(r => !r).length;
    if (failed > 0) {
      showToast({
        type: 'warning',
        message: `保存完成: ${succeeded} 成功, ${failed} 失败`,
      });
    }
    return { succeeded, failed };
  },

  refreshFileTree: async (projectId) => {
    const project = get().projects.find(p => p.id === projectId);
    if (!project) return;
    try {
      const tree = await window.api.scanDirectory(project.path);
      if (!Array.isArray(tree)) return;
      set(s => ({
        projects: s.projects.map(p =>
          p.id === projectId ? { ...p, fileTree: tree } : p
        ),
      }));
    } catch {
      // Silently fail for tree refresh
    }
  },

  handleExternalFileChange: async (filePath, projectPath) => {
    const project = get().projects.find(p => p.path === projectPath);
    if (!project) return;
    await get().refreshFileTree(project.id);
    const openFile = get().openFiles[project.id]?.find(f => f.path === filePath);
    if (openFile && !openFile.isDirty) {
      try {
        const result = await window.api.readFile(filePath);
        if (!result.error) {
          set(s => ({
            openFiles: {
              ...s.openFiles,
              [project.id]: (s.openFiles[project.id] || []).map(f =>
                f.path === filePath ? { ...f, content: result.content!, savedContent: result.content!, diskMtime: result.mtime } : f
              ),
            },
          }));
        }
      } catch {
        // Silently fail
      }
    } else if (openFile && openFile.isDirty) {
      // External change detected on dirty file - enter conflict state
      set(s => ({
        openFiles: {
          ...s.openFiles,
          [project.id]: (s.openFiles[project.id] || []).map(f =>
            f.path === filePath ? { ...f, saveState: 'conflict' as const, conflictState: 'external-modified' as const } : f
          ),
        },
      }));
      showToast({
        type: 'warning',
        message: `文件冲突: ${getFileName(filePath)}`,
        detail: '磁盘上的文件已被外部修改，自动保存已暂停',
        actions: [
          {
            label: '保留本地并强制保存',
            onClick: () => { get().resolveConflict(project.id, filePath, 'keep-local'); },
          },
          {
            label: '采用磁盘版本',
            onClick: () => { get().resolveConflict(project.id, filePath, 'use-external'); },
          },
        ],
      });
    }
  },

  resolveConflict: async (projectId, filePath, resolution) => {
    if (resolution === 'use-external') {
      const result = await window.api.readFile(filePath);
      if (!result.error) {
        set(s => ({
          openFiles: {
            ...s.openFiles,
            [projectId]: (s.openFiles[projectId] || []).map(f =>
              f.path === filePath ? {
                ...f,
                content: result.content!,
                savedContent: result.content!,
                isDirty: false,
                diskMtime: result.mtime,
                saveState: 'saved' as const,
                saveError: undefined,
                conflictState: null,
              } : f
            ),
          },
        }));
        showToast({ type: 'info', message: `已加载磁盘版本: ${getFileName(filePath)}` });
      }
    } else {
      // keep-local: force save
      const success = await get().saveFile(projectId, filePath, true);
      if (success) {
        showToast({ type: 'success', message: `已强制保存: ${getFileName(filePath)}` });
      }
    }
  },

  saveSession: async () => {
    const s = get();
    const session: SessionState = {
      projects: s.projects.map(p => ({ id: p.id, name: p.name, path: p.path })),
      activeProjectId: s.activeProjectId,
      openFiles: Object.fromEntries(
        Object.entries(s.openFiles).map(([pid, files]) => [
          pid,
          files.map(f => f.path),
        ])
      ),
      activeFiles: s.activeFilePath,
      activeTab: s.activeTab,
    };
    try {
      await window.api.saveSession(session);
    } catch {
      // Silently fail
    }
  },

  undo: () => {
    const s = get();
    const pid = s.activeProjectId;
    if (!pid) return;
    const fp = s.activeFilePath[pid];
    if (!fp) return;

    const fileUndoStack = s.undoStacks[fp] || [];
    if (fileUndoStack.length === 0) return;
    const entry = fileUndoStack[fileUndoStack.length - 1];
    const currentFile = s.openFiles[entry.projectId]?.find(f => f.path === entry.filePath);
    if (!currentFile) return;

    set(s2 => ({
      undoStacks: { ...s2.undoStacks, [fp]: (s2.undoStacks[fp] || []).slice(0, -1) },
      redoStacks: {
        ...s2.redoStacks,
        [fp]: [...(s2.redoStacks[fp] || []), {
          filePath: entry.filePath,
          projectId: entry.projectId,
          content: currentFile.content,
          timestamp: Date.now(),
          source: entry.source,
        }],
      },
      openFiles: {
        ...s2.openFiles,
        [entry.projectId]: (s2.openFiles[entry.projectId] || []).map(f =>
          f.path === entry.filePath ? { ...f, content: entry.content, isDirty: true } : f
        ),
      },
    }));
  },

  redo: () => {
    const s = get();
    const pid = s.activeProjectId;
    if (!pid) return;
    const fp = s.activeFilePath[pid];
    if (!fp) return;

    const fileRedoStack = s.redoStacks[fp] || [];
    if (fileRedoStack.length === 0) return;
    const entry = fileRedoStack[fileRedoStack.length - 1];
    const currentFile = s.openFiles[entry.projectId]?.find(f => f.path === entry.filePath);
    if (!currentFile) return;

    set(s2 => ({
      redoStacks: { ...s2.redoStacks, [fp]: (s2.redoStacks[fp] || []).slice(0, -1) },
      undoStacks: {
        ...s2.undoStacks,
        [fp]: [...(s2.undoStacks[fp] || []), {
          filePath: entry.filePath,
          projectId: entry.projectId,
          content: currentFile.content,
          timestamp: Date.now(),
          source: entry.source,
        }],
      },
      openFiles: {
        ...s2.openFiles,
        [entry.projectId]: (s2.openFiles[entry.projectId] || []).map(f =>
          f.path === entry.filePath ? { ...f, content: entry.content, isDirty: true } : f
        ),
      },
    }));
  },

  canUndo: () => {
    const s = get();
    const pid = s.activeProjectId;
    if (!pid) return false;
    const fp = s.activeFilePath[pid];
    if (!fp) return false;
    return (s.undoStacks[fp] || []).length > 0;
  },

  canRedo: () => {
    const s = get();
    const pid = s.activeProjectId;
    if (!pid) return false;
    const fp = s.activeFilePath[pid];
    if (!fp) return false;
    return (s.redoStacks[fp] || []).length > 0;
  },

  takeSnapshot: (filePath, content) => {
    set(s => {
      const newSnapshots = [...s.snapshots.slice(-MAX_SNAPSHOTS + 1), {
        filePath,
        content,
        timestamp: Date.now(),
      }];
      // Persist snapshots
      window.api.saveSnapshots(newSnapshots).catch(() => {});
      return { snapshots: newSnapshots };
    });
  },

  restoreSnapshot: (snapshot) => {
    const s = get();
    const pid = s.activeProjectId;
    if (!pid) return;
    // Find the file in open files
    const file = s.openFiles[pid]?.find(f => f.path === snapshot.filePath);
    if (file) {
      get().updateFileContent(pid, snapshot.filePath, snapshot.content, 'source');
      showToast({ type: 'success', message: `已恢复快照: ${getFileName(snapshot.filePath)}` });
    } else {
      showToast({ type: 'warning', message: '文件未打开，无法恢复快照' });
    }
  },

  flushAllSaves: async () => {
    await get().saveAllFiles();
  },

  requestSourcePosition: (req) => {
    set({ pendingSourcePosition: req });
  },

  clearSourcePosition: () => {
    set({ pendingSourcePosition: null });
  },
}));
