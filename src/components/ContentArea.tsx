import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import SourceEditor from './SourceEditor';
import Preview from './Preview';
import Mindmap from './Mindmap';
import AuxPanel from './AuxPanel';
import FileTabs from './FileTabs';
import type { MindmapNode } from '../types';

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ContentArea() {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const toggleSnapshotHistory = useAppStore(s => s.toggleSnapshotHistory);
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });
  const [mindmapRoot, setMindmapRoot] = useState<MindmapNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<MindmapNode | null>(null);

  const hasFile = !!activeFile;

  const handleMindmapRoot = useCallback((root: MindmapNode | null) => {
    setMindmapRoot(root);
  }, []);

  const handleSelectNode = useCallback((node: MindmapNode | null) => {
    setSelectedNode(node);
  }, []);

  if (!hasFile) {
    return (
      <div className="content-area">
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <div className="empty-text">从左侧文件树选择一个 Markdown 文件</div>
          <div className="empty-text" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            或使用 Cmd/Ctrl+P 快速打开
          </div>
        </div>
      </div>
    );
  }

  const saveStatusText = activeFile.saveState === 'saving'
    ? '保存中...'
    : activeFile.saveState === 'error'
      ? `保存失败: ${activeFile.saveError || '未知错误'}`
      : activeFile.isDirty
        ? '未保存'
        : activeFile.lastSavedAt
          ? `已保存 ${formatTime(activeFile.lastSavedAt)}`
          : '';

  return (
    <div className="content-area">
      <FileTabs />
      <div className="content-tabs">
        <div
          className={`content-tab ${activeTab === 'source' ? 'active' : ''}`}
          onClick={() => setActiveTab('source')}
        >
          原文
          {activeFile.isDirty && activeTab === 'source' && <span className="dirty-dot" />}
        </div>
        <div
          className={`content-tab ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          预览
        </div>
        <div
          className={`content-tab ${activeTab === 'mindmap' ? 'active' : ''}`}
          onClick={() => setActiveTab('mindmap')}
        >
          脑图
          {activeFile.isDirty && activeTab === 'mindmap' && <span className="dirty-dot" />}
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleSnapshotHistory}
          title="文件历史快照"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 8px',
            alignSelf: 'center',
          }}
        >
          历史
        </button>
        <div className="save-status" style={{
          padding: '4px 12px',
          fontSize: '11px',
          color: activeFile.saveState === 'error' ? 'var(--danger)' : 'var(--text-muted)',
          alignSelf: 'center',
        }}>
          {saveStatusText}
        </div>
        <div style={{
          padding: '4px 12px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          alignSelf: 'center',
        }}>
          {getFileName(activeFile.path)}
          {activeFile.isDirty && <span style={{ color: 'var(--warning)', marginLeft: '4px' }}>●</span>}
        </div>
      </div>
      <div className="content-body">
        <div className={`content-main ${activeTab !== 'mindmap' ? 'full-width' : ''}`}>
          {activeTab === 'source' && <SourceEditor />}
          {activeTab === 'preview' && <Preview />}
          {activeTab === 'mindmap' && (
            <Mindmap onMindmapRoot={handleMindmapRoot} onSelectNode={handleSelectNode} />
          )}
        </div>
        {activeTab === 'mindmap' && <AuxPanel mindmapRoot={mindmapRoot} selectedNode={selectedNode} />}
      </div>
    </div>
  );
}
