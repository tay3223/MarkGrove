import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { flattenMindmapForOutline } from '../utils/mdastConverter';
import type { MindmapNode } from '../types';

type AuxTab = 'outline' | 'code' | 'props';

export default function AuxPanel({
  mindmapRoot,
  selectedNode,
}: {
  mindmapRoot: MindmapNode | null;
  selectedNode: MindmapNode | null;
}) {
  const [auxTab, setAuxTab] = useState<AuxTab>('outline');
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });

  const outlineItems = mindmapRoot ? flattenMindmapForOutline(mindmapRoot) : [];

  const codeNode = selectedNode?.data?.nodeType === 'code' ? selectedNode : null;

  return (
    <div className="aux-panel">
      <div className="aux-tabs">
        <div
          className={`aux-tab ${auxTab === 'outline' ? 'active' : ''}`}
          onClick={() => setAuxTab('outline')}
        >
          大纲
        </div>
        <div
          className={`aux-tab ${auxTab === 'code' ? 'active' : ''}`}
          onClick={() => setAuxTab('code')}
        >
          代码
        </div>
        <div
          className={`aux-tab ${auxTab === 'props' ? 'active' : ''}`}
          onClick={() => setAuxTab('props')}
        >
          属性
        </div>
      </div>
      <div className="aux-body">
        {auxTab === 'outline' && (
          <div>
            {outlineItems.map(item => (
              <div
                key={item.id}
                className="outline-item"
                style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
                onClick={() => {
                  const el = document.querySelector(`[data-nodeid="${item.id}"]`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
              >
                <span className="outline-depth">
                  {item.nodeType === 'heading' ? 'H' : item.nodeType === 'code' ? '</>' : '•'}
                </span>
                {item.topic}
              </div>
            ))}
          </div>
        )}
        {auxTab === 'code' && (
          <div>
            {codeNode ? (
              <>
                <div className="code-detail-header">
                  <span className="lang-badge">{codeNode.data?.codeLang || 'text'}</span>
                  <button onClick={() => {
                    navigator.clipboard.writeText(codeNode.data?.codeContent || '');
                  }}>复制</button>
                </div>
                <div className="code-detail-body">
                  <pre>{codeNode.data?.codeContent}</pre>
                </div>
              </>
            ) : (
              <div className="code-detail-empty">
                选中代码块节点以查看
              </div>
            )}
          </div>
        )}
        {auxTab === 'props' && (
          <div className="node-props">
            {selectedNode ? (
              <>
                <div className="prop-row">
                  <span className="prop-label">文本</span>
                  <span className="prop-value">{selectedNode.topic}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">类型</span>
                  <span className="prop-value">{selectedNode.data?.nodeType || '—'}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">层级</span>
                  <span className="prop-value">{selectedNode.data?.headingLevel || '—'}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">子节点</span>
                  <span className="prop-value">{selectedNode.children?.length || 0}</span>
                </div>
                {selectedNode.data?.sourcePosition && (
                  <div className="prop-row">
                    <span className="prop-label">行号</span>
                    <span className="prop-value">
                      {selectedNode.data.sourcePosition.start.line}–{selectedNode.data.sourcePosition.end.line}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                点击脑图中的节点查看属性
              </div>
            )}
            {activeFile && (
              <>
                <div style={{ padding: '8px', marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                  文件信息
                </div>
                <div className="prop-row">
                  <span className="prop-label">路径</span>
                  <span className="prop-value" style={{ fontSize: '11px' }}>{activeFile.path}</span>
                </div>
                <div className="prop-row">
                  <span className="prop-label">字数</span>
                  <span className="prop-value">{activeFile.content.length}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
