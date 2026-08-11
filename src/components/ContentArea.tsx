import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import SourceEditor from './SourceEditor';
import Preview from './Preview';
import Mindmap from './Mindmap';
import AuxPanel from './AuxPanel';
import type { MindmapNode } from '../types';

export default function ContentArea() {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
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
        </div>
      </div>
    );
  }

  return (
    <div className="content-area">
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
        <div style={{
          padding: '4px 12px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          alignSelf: 'center',
        }}>
          {activeFile.path.split('/').pop()}
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
