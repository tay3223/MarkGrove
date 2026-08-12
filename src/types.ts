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
  saveState?: 'saved' | 'saving' | 'error' | 'conflict';
  saveError?: string;
  conflictState?: 'external-modified' | null;
  /** Content hash for detecting external changes when mtime precision is insufficient */
  contentHash?: string;
  /** Conflict details for diff view */
  conflictDetail?: ConflictDetail | null;
}

/** Detailed conflict information for diff view */
export interface ConflictDetail {
  baseContent: string;
  localContent: string;
  externalContent: string;
  localMtime?: number;
  externalMtime?: number;
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
    nodeType?: 'heading' | 'list' | 'code' | 'root' | 'table' | 'image' | 'html' | 'thematicBreak' | 'footnote' | 'frontmatter' | 'unknown';
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
  projectId?: string;
  source?: 'auto' | 'conflict-backup' | 'manual';
  label?: string;
}

export interface UndoEntry {
  filePath: string;
  projectId: string;
  content: string;
  timestamp: number;
  source: 'source' | 'mindmap';
}

/** Pending source position for mindmap→source navigation */
export interface SourcePositionRequest {
  filePath: string;
  projectId: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  nodeId?: string;
}

/** Pending mindmap node for source→mindmap navigation */
export interface MindmapNodeRequest {
  filePath: string;
  projectId: string;
  line: number;
}

/** Full-text search result */
export interface SearchResult {
  filePath: string;
  matches: Array<{
    line: number;
    text: string;
    context: string;
  }>;
}

declare global {
  interface Window {
    api: {
      openDirectory: () => Promise<string | null>;
      openFileDialog: () => Promise<string | null>;
      scanDirectory: (path: string) => Promise<FileNode[] | { error: string }>;
      readFile: (path: string) => Promise<{ content?: string; error?: string; mtime?: number }>;
      writeFileAtomic: (path: string, content: string) => Promise<{ success?: boolean; error?: string; mtime?: number }>;
      getFileMtime: (path: string) => Promise<{ mtime?: number; error?: string }>;
      startWatching: (path: string) => Promise<void>;
      stopWatching: (path: string) => Promise<void>;
      getSession: () => Promise<SessionState | null>;
      saveSession: (session: SessionState) => Promise<void>;
      getProjectName: (path: string) => Promise<string>;
      showItemInFolder: (path: string) => Promise<void>;
      getDirName: (path: string) => Promise<string>;
      resolvePath: (baseDir: string, relativePath: string) => Promise<{ resolved?: string; error?: string }>;
      openExternal: (url: string) => Promise<void>;
      getSnapshots: () => Promise<FileSnapshot[]>;
      saveSnapshots: (snapshots: FileSnapshot[]) => Promise<void>;
      searchInFiles: (projectPath: string, query: string) => Promise<{ results?: SearchResult[]; error?: string }>;
      onFileChanged: (callback: (data: FileChangedEvent) => void) => void;
      removeFileChangedListener: () => void;
      onBeforeClose: (callback: () => Promise<boolean>) => void;
      removeBeforeCloseListener: () => void;
      confirmClose: () => void;
    };
  }
}
