import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { confirmDialog } from './ConfirmDialog';
import { showToast } from './Toast';
import type { FileSnapshot } from '../types';

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SnapshotHistoryPanel() {
  const showSnapshotHistory = useAppStore(s => s.showSnapshotHistory);
  const toggleSnapshotHistory = useAppStore(s => s.toggleSnapshotHistory);
  const snapshots = useAppStore(s => s.snapshots);
  const restoreSnapshot = useAppStore(s => s.restoreSnapshot);
  const takeSnapshot = useAppStore(s => s.takeSnapshot);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const openFile = useAppStore(s => s.openFile);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!showSnapshotHistory) return null;

  // Filter snapshots for current file, or show all if no file active
  const relevantSnapshots = activeFilePath
    ? snapshots.filter(s => s.filePath === activeFilePath)
    : snapshots;

  const handleRestore = async (snapshot: FileSnapshot) => {
    // Determine target project: prefer snapshot's projectId, fall back to active
    const targetPid = snapshot.projectId || activeProjectId;
    if (!targetPid) {
      showToast({ type: 'error', message: '无法确定快照所属项目' });
      return;
    }

    // Verify the target project still exists
    const targetProject = useAppStore.getState().projects.find(p => p.id === targetPid);
    if (!targetProject) {
      showToast({ type: 'error', message: '快照所属项目已被移除，无法恢复' });
      return;
    }

    // Confirm before doing anything
    const confirmed = await confirmDialog({
      title: '恢复快照',
      message: `确定要恢复 "${getFileName(snapshot.filePath)}" 到 ${formatTime(snapshot.timestamp)} 的版本吗？\n当前内容将在恢复前自动备份为快照。`,
      confirmLabel: '恢复',
      danger: true,
    });
    if (!confirmed) return;

    // If file is not open in the target project, open it first
    const currentFile = useAppStore.getState().openFiles[targetPid]?.find(f => f.path === snapshot.filePath);
    if (!currentFile) {
      try {
        await openFile(targetPid, snapshot.filePath);
        // Verify the file was actually opened
        const opened = useAppStore.getState().openFiles[targetPid]?.find(f => f.path === snapshot.filePath);
        if (!opened) {
          showToast({ type: 'error', message: '无法打开目标文件，恢复已取消' });
          return;
        }
      } catch {
        showToast({ type: 'error', message: '打开目标文件失败，恢复已取消' });
        return;
      }
    }

    // Backup current content AFTER user confirmed, BEFORE actual restore
    const fileToBackup = useAppStore.getState().openFiles[targetPid]?.find(f => f.path === snapshot.filePath);
    if (fileToBackup) {
      takeSnapshot(snapshot.filePath, fileToBackup.content, targetPid, 'conflict-backup', `恢复前备份 ${new Date().toLocaleTimeString()}`);
    }

    // Perform restore and check result
    const success = restoreSnapshot(snapshot);
    if (success) {
      showToast({ type: 'success', message: `已恢复快照: ${getFileName(snapshot.filePath)}` });
    } else {
      showToast({ type: 'error', message: '快照恢复失败', detail: '目标文件可能已被关闭或项目已移除' });
    }
  };

  return (
    <div className="dialog-overlay" onClick={toggleSnapshotHistory}>
      <div
        className="dialog"
        style={{ width: '80vw', maxWidth: '700px', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dialog-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>文件历史快照{activeFilePath ? `: ${getFileName(activeFilePath)}` : ''}</span>
          <button
            onClick={toggleSnapshotHistory}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', margin: '8px 0' }}>
          {relevantSnapshots.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              暂无快照记录
            </div>
          ) : (
            relevantSnapshots.slice().reverse().map((snapshot, idx) => {
              const realIndex = snapshots.length - 1 - idx;
              const isExpanded = expandedIndex === realIndex;
              return (
                <div
                  key={realIndex}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    margin: '4px 0',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: 'var(--bg-tertiary)',
                    }}
                    onClick={() => setExpandedIndex(isExpanded ? null : realIndex)}
                  >
                    <span style={{ flex: 1, fontWeight: 500 }}>
                      {getFileName(snapshot.filePath)}
                    </span>
                    {snapshot.label && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '8px' }}>
                        {snapshot.label}
                      </span>
                    )}
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '8px' }}>
                      {snapshot.source === 'conflict-backup' ? '冲突备份' : snapshot.source === 'manual' ? '手动' : '自动'}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {formatTime(snapshot.timestamp)}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '8px 12px' }}>
                      <pre style={{
                        fontSize: '11px',
                        maxHeight: '200px',
                        overflow: 'auto',
                        background: 'var(--bg-primary)',
                        padding: '8px',
                        borderRadius: '4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        color: 'var(--text-secondary)',
                      }}>
                        {snapshot.content.slice(0, 2000)}
                        {snapshot.content.length > 2000 && '\n... (truncated)'}
                      </pre>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button
                          className="dialog-btn dialog-btn-confirm"
                          style={{ fontSize: '12px', padding: '4px 12px' }}
                          onClick={(e) => { e.stopPropagation(); handleRestore(snapshot); }}
                        >
                          恢复此版本
                        </button>
                        <button
                          className="dialog-btn dialog-btn-cancel"
                          style={{ fontSize: '12px', padding: '4px 12px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(snapshot.content);
                            showToast({ type: 'info', message: '内容已复制到剪贴板', duration: 1500 });
                          }}
                        >
                          复制内容
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
