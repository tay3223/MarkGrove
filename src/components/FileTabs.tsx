import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { showToast } from './Toast';
import { choiceDialog } from './ConfirmDialog';
import ContextMenu from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

interface ContextMenuState {
  x: number;
  y: number;
  filePath: string;
}

export default function FileTabs() {
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const openFiles = useAppStore(s => activeProjectId ? s.openFiles[activeProjectId] || [] : []);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const setActiveFile = useAppStore(s => s.setActiveFile);
  const closeFile = useAppStore(s => s.closeFile);
  const saveFile = useAppStore(s => s.saveFile);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /** Close a single file, prompting for save if dirty. Returns true if closed. */
  const handleClose = useCallback(async (filePath: string, isDirty: boolean): Promise<boolean> => {
    if (!activeProjectId) return false;
    if (isDirty) {
      const choice = await choiceDialog({
        title: '未保存的修改',
        message: `文件 "${getFileName(filePath)}" 有未保存的修改，关闭前要保存吗？`,
        buttons: [
          { label: '保存并关闭', value: 'save', primary: true },
          { label: '不保存', value: 'discard', danger: true },
          { label: '取消', value: 'cancel' },
        ],
      });
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        const success = await saveFile(activeProjectId, filePath);
        if (!success) {
          showToast({
            type: 'warning',
            message: `文件 ${getFileName(filePath)} 保存失败`,
            detail: '关闭操作已取消',
          });
          return false;
        }
      }
      // 'discard' - just close without saving
    }
    closeFile(activeProjectId, filePath);
    return true;
  }, [activeProjectId, saveFile, closeFile]);

  const handleCloseOthers = useCallback(async (keepPath: string) => {
    if (!activeProjectId) return;
    const others = openFiles.filter(f => f.path !== keepPath);
    const dirtyFiles = others.filter(f => f.isDirty);

    // If there are dirty files, ask user what to do
    if (dirtyFiles.length > 0) {
      const choice = await choiceDialog({
        title: '批量关闭',
        message: `有 ${dirtyFiles.length} 个文件未保存：\n${dirtyFiles.map(f => getFileName(f.path)).join(', ')}\n\n如何处理？`,
        buttons: [
          { label: '全部保存并关闭', value: 'save-all', primary: true },
          { label: '全部不保存', value: 'discard-all', danger: true },
          { label: '取消', value: 'cancel' },
        ],
      });
      if (choice === 'cancel') return;

      if (choice === 'save-all') {
        const failed: string[] = [];
        for (const f of dirtyFiles) {
          const success = await saveFile(activeProjectId, f.path);
          if (!success) failed.push(getFileName(f.path));
        }
        if (failed.length > 0) {
          showToast({
            type: 'warning',
            message: `${failed.length} 个文件保存失败`,
            detail: failed.join(', '),
          });
          // Close only successfully saved files
          const savedPaths = new Set(dirtyFiles.filter(f => !failed.includes(getFileName(f.path))).map(f => f.path));
          for (const f of others) {
            if (!f.isDirty || savedPaths.has(f.path)) {
              closeFile(activeProjectId, f.path);
            }
          }
          return;
        }
      }
      // 'discard-all' - close all without saving
    }

    for (const f of others) {
      closeFile(activeProjectId, f.path);
    }
  }, [activeProjectId, openFiles, saveFile, closeFile]);

  const handleCloseAll = useCallback(async () => {
    if (!activeProjectId) return;
    const dirtyFiles = openFiles.filter(f => f.isDirty);

    if (dirtyFiles.length > 0) {
      const choice = await choiceDialog({
        title: '关闭全部',
        message: `有 ${dirtyFiles.length} 个文件未保存：\n${dirtyFiles.map(f => getFileName(f.path)).join(', ')}\n\n如何处理？`,
        buttons: [
          { label: '全部保存并关闭', value: 'save-all', primary: true },
          { label: '全部不保存', value: 'discard-all', danger: true },
          { label: '取消', value: 'cancel' },
        ],
      });
      if (choice === 'cancel') return;

      if (choice === 'save-all') {
        const failed: string[] = [];
        for (const f of dirtyFiles) {
          const success = await saveFile(activeProjectId, f.path);
          if (!success) failed.push(getFileName(f.path));
        }
        if (failed.length > 0) {
          showToast({
            type: 'warning',
            message: `${failed.length} 个文件保存失败`,
            detail: failed.join(', '),
          });
          // Close only successfully saved files
          const savedPaths = new Set(dirtyFiles.filter(f => !failed.includes(getFileName(f.path))).map(f => f.path));
          for (const f of openFiles) {
            if (!f.isDirty || savedPaths.has(f.path)) {
              closeFile(activeProjectId, f.path);
            }
          }
          return;
        }
      }
    }

    for (const f of openFiles) {
      closeFile(activeProjectId, f.path);
    }
  }, [activeProjectId, openFiles, saveFile, closeFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, filePath });
  }, []);

  const getContextMenuItems = useCallback((filePath: string): ContextMenuItem[] => {
    const file = openFiles.find(f => f.path === filePath);
    const isDirty = file?.isDirty ?? false;
    const isOnlyOne = openFiles.length <= 1;

    return [
      {
        label: '关闭',
        onClick: () => handleClose(filePath, isDirty),
      },
      { label: '', onClick: () => {}, divider: true },
      {
        label: '关闭其它',
        onClick: () => handleCloseOthers(filePath),
        disabled: isOnlyOne,
      },
      {
        label: '关闭全部',
        onClick: () => handleCloseAll(),
        disabled: openFiles.length === 0,
      },
    ];
  }, [openFiles, handleClose, handleCloseOthers, handleCloseAll]);

  if (!activeProjectId || openFiles.length === 0) return null;

  // Defensive deduplicate: ensure no duplicate keys during render
  const seen = new Set<string>();
  const uniqueFiles = openFiles.filter(f => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  return (
    <>
      <div className="file-tabs">
        {uniqueFiles.map(file => {
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
              onContextMenu={(e) => handleContextMenu(e, file.path)}
              title={file.path}
            >
              <span className="file-tab-name">{fileName}</span>
              {file.isDirty && <span className="file-tab-dirty">●</span>}
              {file.saveState === 'saving' && <span className="file-tab-saving">…</span>}
              {file.saveState === 'error' && <span className="file-tab-error">!</span>}
              {file.saveState === 'conflict' && <span className="file-tab-conflict">⚡</span>}
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
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.filePath)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
