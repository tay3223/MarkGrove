import { create } from 'zustand';
import type { Project, OpenFile, FileNode, ViewTab, SessionState } from '../types';

interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  openFiles: Record<string, OpenFile[]>;
  activeFilePath: Record<string, string | null>;
  activeTab: ViewTab;
  initialized: boolean;

  initFromSession: () => Promise<void>;
  addProject: () => Promise<void>;
  removeProject: (projectId: string) => void;
  setActiveProject: (projectId: string) => void;
  openFile: (projectId: string, filePath: string) => Promise<void>;
  closeFile: (projectId: string, filePath: string) => void;
  setActiveFile: (projectId: string, filePath: string | null) => void;
  setActiveTab: (tab: ViewTab) => void;
  updateFileContent: (projectId: string, filePath: string, content: string) => void;
  markFileDirty: (projectId: string, filePath: string, dirty: boolean) => void;
  saveFile: (projectId: string, filePath: string) => Promise<void>;
  refreshFileTree: (projectId: string) => Promise<void>;
  handleExternalFileChange: (filePath: string, projectPath: string) => Promise<void>;
  saveSession: () => Promise<void>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  openFiles: {},
  activeFilePath: {},
  activeTab: 'mindmap',
  initialized: false,

  initFromSession: async () => {
    const session = await window.api.getSession();
    if (session && session.projects.length > 0) {
      const projects: Project[] = [];
      for (const p of session.projects) {
        const tree = await window.api.scanDirectory(p.path);
        if (!Array.isArray(tree)) continue;
        projects.push({ ...p, fileTree: tree });
        await window.api.startWatching(p.path);
      }
      set({
        projects,
        activeProjectId: session.activeProjectId || projects[0]?.id || null,
        openFiles: {},
        activeFilePath: session.activeFiles || {},
        initialized: true,
      });
      for (const [pid, filePaths] of Object.entries(session.openFiles)) {
        for (const fp of filePaths) {
          await get().openFile(pid, fp);
        }
      }
    } else {
      set({ initialized: true });
    }
  },

  addProject: async () => {
    const dirPath = await window.api.openDirectory();
    if (!dirPath) return;
    const existing = get().projects.find(p => p.path === dirPath);
    if (existing) {
      set({ activeProjectId: existing.id });
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
    await get().saveSession();
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
    const result = await window.api.readFile(filePath);
    if (result.error) return;
    const file: OpenFile = { path: filePath, content: result.content!, isDirty: false };
    set(s => ({
      openFiles: {
        ...s.openFiles,
        [projectId]: [...(s.openFiles[projectId] || []), file],
      },
      activeFilePath: { ...s.activeFilePath, [projectId]: filePath },
    }));
    get().saveSession();
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
  },

  updateFileContent: (projectId, filePath, content) => {
    set(s => ({
      openFiles: {
        ...s.openFiles,
        [projectId]: (s.openFiles[projectId] || []).map(f =>
          f.path === filePath ? { ...f, content, isDirty: true } : f
        ),
      },
    }));
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

  saveFile: async (projectId, filePath) => {
    const file = get().openFiles[projectId]?.find(f => f.path === filePath);
    if (!file) return;
    await window.api.writeFile(filePath, file.content);
    get().markFileDirty(projectId, filePath, false);
  },

  refreshFileTree: async (projectId) => {
    const project = get().projects.find(p => p.id === projectId);
    if (!project) return;
    const tree = await window.api.scanDirectory(project.path);
    if (!Array.isArray(tree)) return;
    set(s => ({
      projects: s.projects.map(p =>
        p.id === projectId ? { ...p, fileTree: tree } : p
      ),
    }));
  },

  handleExternalFileChange: async (filePath, projectPath) => {
    const project = get().projects.find(p => p.path === projectPath);
    if (!project) return;
    await get().refreshFileTree(project.id);
    const openFile = get().openFiles[project.id]?.find(f => f.path === filePath);
    if (openFile && !openFile.isDirty) {
      const result = await window.api.readFile(filePath);
      if (!result.error) {
        set(s => ({
          openFiles: {
            ...s.openFiles,
            [project.id]: (s.openFiles[project.id] || []).map(f =>
              f.path === filePath ? { ...f, content: result.content! } : f
            ),
          },
        }));
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
    };
    await window.api.saveSession(session);
  },
}));
