import { useAppStore } from '../stores/appStore';
import { showToast } from './Toast';

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export default function FileTabs() {
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const openFiles = useAppStore(s => activeProjectId ? s.openFiles[activeProjectId] || [] : []);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const setActiveFile = useAppStore(s => s.setActiveFile);
  const closeFile = useAppStore(s => s.closeFile);
  const saveFile = useAppStore(s => s.saveFile);

  if (!activeProjectId || openFiles.length === 0) return null;

  const handleClose = async (filePath: string, isDirty: boolean) => {
    if (isDirty) {
      // Auto-save before closing dirty files
      try {
        await saveFile(activeProjectId, filePath);
      } catch {
        showToast({
          type: 'warning',
          message: `文件 ${getFileName(filePath)} 有未保存的修改`,
          detail: '关闭前保存失败，请手动保存',
        });
        return;
      }
    }
    closeFile(activeProjectId, filePath);
  };

  return (
    <div className="file-tabs">
      {openFiles.map(file => {
        const isActive = file.path === activeFilePath;
        const fileName = getFileName(file.path);
        return (
          <div
            key={file.path}
            className={`file-tab ${isActive ? 'active' : ''}`}
            onClick={() => setActiveFile(activeProjectId, file.path)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                handleClose(file.path, file.isDirty);
              }
            }}
            title={file.path}
          >
            <span className="file-tab-name">{fileName}</span>
            {file.isDirty && <span className="file-tab-dirty">●</span>}
            {file.saveState === 'saving' && <span className="file-tab-saving">…</span>}
            {file.saveState === 'error' && <span className="file-tab-error">!</span>}
            <button
              className="file-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                handleClose(file.path, file.isDirty);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
