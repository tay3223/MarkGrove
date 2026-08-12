export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  fileTree: FileNode[];
}

export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  savedContent?: string;
  lastSavedAt?: number;
  diskMtime?: number;
  saveState?: 'saved' | 'saving' | 'error';
  saveError?: string;
}

export type ViewTab = 'source' | 'preview' | 'mindmap';

export interface SessionState {
  projects: Array<{ id: string; name: string; path: string }>;
  activeProjectId: string | null;
  openFiles: Record<string, string[]>;
  activeFiles: Record<string, string | null>;
  activeTab?: ViewTab;
}

export interface MindmapNode {
  topic: string;
  id: string;
  children?: MindmapNode[];
  style?: {
    fontSize?: string;
    fontFamily?: string;
    color?: string;
    background?: string;
    fontWeight?: string;
    border?: string;
    textDecoration?: string;
    width?: string;
  };
  data?: {
    sourcePosition?: any;
    codeContent?: string;
    codeLang?: string;
    nodeType?: 'heading' | 'list' | 'code' | 'root' | 'table' | 'image' | 'html' | 'thematicBreak' | 'footnote' | 'unknown';
    headingLevel?: number;
    description?: string;
    firstLine?: string;
    lineRange?: string;
  };
}

export interface FileChangedEvent {
  event: string;
  path: string;
  projectPath: string;
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
  duration?: number;
  actions?: Array<{ label: string; onClick: () => void }>;
}

export interface FileSnapshot {
  filePath: string;
  content: string;
  timestamp: number;
}

export interface UndoEntry {
  filePath: string;
  content: string;
  timestamp: number;
  source: 'source' | 'mindmap';
}

declare global {
  interface Window {
    api: {
      openDirectory: () => Promise<string | null>;
      openFileDialog: () => Promise<string | null>;
      scanDirectory: (path: string) => Promise<FileNode[] | { error: string }>;
      readFile: (path: string) => Promise<{ content?: string; error?: string; mtime?: number }>;
      writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string; mtime?: number }>;
      writeFileAtomic: (path: string, content: string) => Promise<{ success?: boolean; error?: string; mtime?: number }>;
      getFileMtime: (path: string) => Promise<{ mtime?: number; error?: string }>;
      startWatching: (path: string) => Promise<void>;
      stopWatching: (path: string) => Promise<void>;
      getSession: () => Promise<SessionState | null>;
      saveSession: (session: SessionState) => Promise<void>;
      getProjectName: (path: string) => Promise<string>;
      showItemInFolder: (path: string) => Promise<void>;
      onFileChanged: (callback: (data: FileChangedEvent) => void) => void;
      removeFileChangedListener: () => void;
      onBeforeClose: (callback: () => Promise<boolean>) => void;
      confirmClose: () => void;
    };
  }
}
