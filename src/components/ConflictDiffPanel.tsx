import { useAppStore } from '../stores/appStore';
import { choiceDialog } from './ConfirmDialog';

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/** Simple line-based diff display */
function DiffView({ local, external }: { local: string; external: string }) {
  const localLines = local.split('\n');
  const externalLines = external.split('\n');
  const maxLines = Math.max(localLines.length, externalLines.length);

  const rows: Array<{ lineNum: number; local: string; external: string; type: 'same' | 'changed' | 'added' | 'removed' }> = [];

  for (let i = 0; i < maxLines; i++) {
    const l = i < localLines.length ? localLines[i] : undefined;
    const e = i < externalLines.length ? externalLines[i] : undefined;
    if (l === e) {
      rows.push({ lineNum: i + 1, local: l ?? '', external: e ?? '', type: 'same' });
    } else if (l !== undefined && e !== undefined) {
      rows.push({ lineNum: i + 1, local: l, external: e, type: 'changed' });
    } else if (l !== undefined) {
      rows.push({ lineNum: i + 1, local: l, external: '', type: 'removed' });
    } else {
      rows.push({ lineNum: i + 1, local: '', external: e ?? '', type: 'added' });
    }
  }

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.5', overflow: 'auto', maxHeight: '400px' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '4px 0', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
        <div style={{ flex: 1, padding: '0 8px', color: 'var(--text-primary)' }}>本地版本</div>
        <div style={{ flex: 1, padding: '0 8px', color: 'var(--text-primary)' }}>磁盘版本</div>
      </div>
      {rows.map(row => (
        <div
          key={row.lineNum}
          style={{
            display: 'flex',
            background: row.type === 'changed' ? 'rgba(249, 226, 175, 0.1)'
              : row.type === 'added' ? 'rgba(166, 227, 161, 0.1)'
              : row.type === 'removed' ? 'rgba(243, 139, 168, 0.1)'
              : 'transparent',
          }}
        >
          <div style={{ flex: 1, padding: '1px 8px', borderRight: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: row.type === 'removed' || row.type === 'changed' ? 'var(--danger)' : 'var(--text-secondary)' }}>
            {row.local}
          </div>
          <div style={{ flex: 1, padding: '1px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: row.type === 'added' || row.type === 'changed' ? 'var(--success, #a6e3a1)' : 'var(--text-secondary)' }}>
            {row.external}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ConflictDiffPanel() {
  const showConflictDiff = useAppStore(s => s.showConflictDiff);
  const conflictDiffFilePath = useAppStore(s => s.conflictDiffFilePath);
  const closeConflictDiff = useAppStore(s => s.closeConflictDiff);
  const resolveConflict = useAppStore(s => s.resolveConflict);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const file = useAppStore(s => {
    if (!activeProjectId || !conflictDiffFilePath) return null;
    return s.openFiles[activeProjectId]?.find(f => f.path === conflictDiffFilePath) ?? null;
  });

  if (!showConflictDiff || !conflictDiffFilePath || !file?.conflictDetail) return null;

  const { localContent, externalContent } = file.conflictDetail;

  const handleResolve = async () => {
    if (!activeProjectId) return;
    const choice = await choiceDialog({
      title: '解决冲突',
      message: `如何解决 "${getFileName(conflictDiffFilePath)}" 的冲突？`,
      buttons: [
        { label: '保留本地并保存', value: 'keep-local', primary: true },
        { label: '采用磁盘版本', value: 'use-external', danger: true },
        { label: '取消', value: 'cancel' },
      ],
    });
    if (choice === 'cancel') return;
    await resolveConflict(activeProjectId, conflictDiffFilePath, choice as 'keep-local' | 'use-external');
    closeConflictDiff();
  };

  return (
    <div className="dialog-overlay" onClick={closeConflictDiff}>
      <div
        className="dialog"
        style={{ width: '90vw', maxWidth: '900px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dialog-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>冲突对比: {getFileName(conflictDiffFilePath)}</span>
          <button
            onClick={closeConflictDiff}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', margin: '8px 0' }}>
          <DiffView local={localContent} external={externalContent} />
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-cancel" onClick={closeConflictDiff}>
            关闭
          </button>
          <button className="dialog-btn dialog-btn-confirm" onClick={handleResolve}>
            解决冲突
          </button>
        </div>
      </div>
    </div>
  );
}
