import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { MindmapNode } from '../types';

/** Flatten a MindmapNode tree into a linear outline list. */
function flattenMindmapForOutline(root: MindmapNode, depth = 0): Array<{
  id: string;
  topic: string;
  depth: number;
  nodeType?: string;
}> {
  const items: Array<{ id: string; topic: string; depth: number; nodeType?: string }> = [{
    id: root.id,
    topic: root.topic,
    depth,
    nodeType: root.data?.nodeType,
  }];
  if (root.children) {
    for (const child of root.children) {
      items.push(...flattenMindmapForOutline(child, depth + 1));
    }
  }
  return items;
}

type AuxTab = 'outline' | 'code' | 'props';

function getNodeTypeLabel(nodeType?: string): string {
  switch (nodeType) {
    case 'heading': return 'H';
    case 'code': return '</>';
    case 'table': return '⊞';
    case 'tablerow': return '⊞';
    case 'paragraph': return '¶';
    case 'blockquote': return '❝';
    case 'image': return '🖼';
    case 'html': return '<>';
    case 'thematicBreak': return '—';
    case 'footnote': return '[^]';
    case 'frontmatter': return '---';
    case 'list': return '•';
    case 'root': return '●';
    case 'unknown': return '?';
    default: return '•';
  }
}

function getNodeTypeName(nodeType?: string): string {
  switch (nodeType) {
    case 'heading': return '标题';
    case 'code': return '代码块';
    case 'list': return '列表项';
    case 'root': return '根节点';
    case 'table': return '表格';
    case 'tablerow': return '表格行';
    case 'paragraph': return '段落';
    case 'blockquote': return '引用';
    case 'image': return '图片';
    case 'html': return 'HTML';
    case 'thematicBreak': return '分隔线';
    case 'footnote': return '脚注';
    case 'frontmatter': return 'Front Matter';
    case 'unknown': return '未识别';
    default: return nodeType || '—';
  }
}

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
                className={`outline-item ${selectedNode?.id === item.id ? 'outline-item-selected' : ''}`}
                style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
                onClick={() => {
                  // Use Mind Elixir API to select and center node
                  const el = document.querySelector(`[data-nodeid="${item.id}"]`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Simulate click to select
                    (el as HTMLElement).click();
                  }
                }}
              >
                <span className="outline-depth">
                  {getNodeTypeLabel(item.nodeType)}
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
                  <span className="prop-value">{getNodeTypeName(selectedNode.data?.nodeType)}</span>
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
                {selectedNode.data?.description && (
                  <div style={{ padding: '8px', marginTop: '8px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>正文摘要</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {selectedNode.data.description}
                    </div>
                  </div>
                )}
                {selectedNode.data?.codeLang && (
                  <div className="prop-row">
                    <span className="prop-label">语言</span>
                    <span className="prop-value">{selectedNode.data.codeLang}</span>
                  </div>
                )}
                {selectedNode.data?.firstLine && (
                  <div className="prop-row">
                    <span className="prop-label">首行</span>
                    <span className="prop-value" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                      {selectedNode.data.firstLine}
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
                {activeFile.lastSavedAt && (
                  <div className="prop-row">
                    <span className="prop-label">保存时间</span>
                    <span className="prop-value">
                      {new Date(activeFile.lastSavedAt).toLocaleTimeString('zh-CN')}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
