import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from './stores/appStore';
import ProjectBar from './components/ProjectBar';
import FileTree from './components/FileTree';
import ContentArea from './components/ContentArea';
import ToastContainer, { showToast } from './components/Toast';
import ConfirmDialogContainer from './components/ConfirmDialog';
import QuickOpen from './components/QuickOpen';

export default function App() {
  const initialized = useAppStore(s => s.initialized);
  const initFromSession = useAppStore(s => s.initFromSession);
  const handleExternalFileChange = useAppStore(s => s.handleExternalFileChange);
  const saveAllFiles = useAppStore(s => s.saveAllFiles);
  const flushAllSaves = useAppStore(s => s.flushAllSaves);
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const saveFile = useAppStore(s => s.saveFile);
  const addProject = useAppStore(s => s.addProject);
  const openSingleFile = useAppStore(s => s.openSingleFile);
  const projects = useAppStore(s => s.projects);

  const [quickOpenVisible, setQuickOpenVisible] = useState(false);

  // Initialize from session
  useEffect(() => {
    initFromSession();
  }, [initFromSession]);

  // Listen for external file changes
  useEffect(() => {
    window.api.onFileChanged(({ path, projectPath }) => {
      handleExternalFileChange(path, projectPath);
    });
    return () => {
      window.api.removeFileChangedListener();
    };
  }, [handleExternalFileChange]);

  // Handle before close - flush pending saves
  useEffect(() => {
    window.api.onBeforeClose(async () => {
      await flushAllSaves();
      return true;
    });
  }, [flushAllSaves]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+S - Save
      if (mod && e.key === 's') {
        e.preventDefault();
        if (activeProjectId && activeFilePath) {
          saveFile(activeProjectId, activeFilePath).then(success => {
            if (success) {
              showToast({ type: 'success', message: '已保存', duration: 1500 });
            }
          });
        }
      }

      // Cmd/Ctrl+Shift+S - Save All
      if (mod && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        saveAllFiles().then(() => {
          showToast({ type: 'success', message: '全部已保存', duration: 1500 });
        });
      }

      // Cmd/Ctrl+Z - Undo
      if (mod && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
      }

      // Cmd/Ctrl+Shift+Z - Redo
      if (mod && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        redo();
      }

      // Cmd/Ctrl+P - Quick Open
      if (mod && e.key === 'p') {
        e.preventDefault();
        if (activeProjectId) {
          setQuickOpenVisible(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProjectId, activeFilePath, saveFile, saveAllFiles, undo, redo]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const filePath = (file as any).path as string;
      if (filePath) {
        // Check if it's a markdown file
        if (/\.(md|markdown|mdown|mkd)$/i.test(filePath)) {
          // Open as single file
          const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
          const existing = projects.find(p => p.path === dirPath);
          if (existing) {
            useAppStore.getState().openFile(existing.id, filePath);
          } else {
            showToast({ type: 'info', message: '请先打开包含该文件的项目目录' });
          }
        } else {
          // Try to open as directory
          addProject();
        }
      }
    }
  }, [projects, addProject]);

  if (!initialized) {
    return (
      <div className="app-layout">
        <div className="titlebar" />
        <div className="app-body">
          <div className="empty-state" style={{ width: '100%' }}>
            <div className="empty-icon">⏳</div>
            <div className="empty-text">加载中...</div>
          </div>
        </div>
      </div>
    );
  }

  const hasProjects = projects.length > 0;

  return (
    <div
      className="app-layout"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="titlebar" />
      <div className="app-body">
        {hasProjects ? (
          <>
            <ProjectBar />
            <FileTree />
            <ContentArea />
          </>
        ) : (
          <div className="empty-state" style={{ width: '100%' }}>
            <div className="empty-icon">🌲</div>
            <div className="empty-text" style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
              MarkGrove · 墨林
            </div>
            <div className="empty-text" style={{ marginBottom: '16px' }}>
              本地 Markdown 可视化与编辑工具
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={addProject}>
                打开文件夹
              </button>
              <button onClick={openSingleFile} style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                打开单个文件
              </button>
            </div>
            <div className="empty-text" style={{ fontSize: '12px', marginTop: '16px', color: 'var(--text-muted)' }}>
              也可以直接拖入文件或文件夹
            </div>
          </div>
        )}
      </div>
      <ToastContainer />
      <ConfirmDialogContainer />
      <QuickOpen visible={quickOpenVisible} onClose={() => setQuickOpenVisible(false)} />
    </div>
  );
}
