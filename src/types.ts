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
}

export type ViewTab = 'source' | 'preview' | 'mindmap';

export interface SessionState {
  projects: Array<{ id: string; name: string; path: string }>;
  activeProjectId: string | null;
  openFiles: Record<string, string[]>;
  activeFiles: Record<string, string | null>;
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
    nodeType?: 'heading' | 'list' | 'code' | 'root';
    headingLevel?: number;
    description?: string;
  };
}

export interface FileChangedEvent {
  event: string;
  path: string;
  projectPath: string;
}

declare global {
  interface Window {
    api: {
      openDirectory: () => Promise<string | null>;
      scanDirectory: (path: string) => Promise<FileNode[] | { error: string }>;
      readFile: (path: string) => Promise<{ content?: string; error?: string }>;
      writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string }>;
      startWatching: (path: string) => Promise<void>;
      stopWatching: (path: string) => Promise<void>;
      getSession: () => Promise<SessionState | null>;
      saveSession: (session: SessionState) => Promise<void>;
      getProjectName: (path: string) => Promise<string>;
      onFileChanged: (callback: (data: FileChangedEvent) => void) => void;
      removeFileChangedListener: () => void;
    };
  }
}
