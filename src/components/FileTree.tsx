import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { FileNode } from '../types';

function isMarkdown(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

function TreeNode({ node, projectId, depth, collapseSignal }: {
  node: FileNode;
  projectId: string;
  depth: number;
  collapseSignal: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    setExpanded(false);
  }, [collapseSignal]);

  const isActive = useAppStore(s => node.type === 'file' && s.activeFilePath[projectId] === node.path);
  const isDirty = useAppStore(s => {
    if (node.type !== 'file') return false;
    return s.openFiles[projectId]?.find(f => f.path === node.path)?.isDirty ?? false;
  });
  const openFile = useAppStore(s => s.openFile);
  const setActiveFile = useAppStore(s => s.setActiveFile);

  if (node.type === 'directory') {
    return (
      <div>
        <div
          className="tree-node folder"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span className="tree-chevron">{expanded ? '▾' : '▸'}</span>
          <span className="tree-folder-icon">{expanded ? '📂' : '📁'}</span>
          <span className="tree-label">{node.name}</span>
        </div>
        {node.children && node.children.length > 0 && (
          <div className={`tree-children ${expanded ? 'expanded' : 'collapsed'}`} aria-hidden={!expanded}>
            {node.children.map(child => (
              <TreeNode key={child.path} node={child} projectId={projectId} depth={depth + 1} collapseSignal={collapseSignal} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`tree-node ${isActive ? 'active' : ''}`}
      onClick={() => {
        openFile(projectId, node.path);
        setActiveFile(projectId, node.path);
      }}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      {isMarkdown(node.name) ? (
        <span className="tree-md">md</span>
      ) : (
        <span className="tree-icon">📄</span>
      )}
      <span className="tree-label">{node.name}</span>
      {isDirty && <span className="tree-dirty" />}
    </div>
  );
}

/** Pure function: deduplicate nodes without mutating the original tree */
function deduplicateNodes(nodes: FileNode[]): FileNode[] {
  const seen = new Set<string>();
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.path)) continue;
    seen.add(node.path);
    if (node.children) {
      result.push({ ...node, children: deduplicateNodes(node.children) });
    } else {
      result.push(node);
    }
  }
  return result;
}

export default function FileTree() {
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const projects = useAppStore(s => s.projects);
  const project = projects.find(p => p.id === activeProjectId);
  const [collapseSignal, setCollapseSignal] = useState(0);

  if (!project) {
    return (
      <div className="file-tree">
        <div className="file-tree-header">文件</div>
        <div className="empty-state" style={{ padding: '24px 12px' }}>
          <div className="empty-text">打开一个项目开始</div>
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>{project.name}</span>
        <span style={{ fontWeight: 400 }}>{project.fileTree.length}</span>
      </div>
      <div className="file-tree-toolbar">
        <button
          className="tree-tool-btn"
          onClick={() => setCollapseSignal(s => s + 1)}
          title="折叠所有目录"
        >
          折叠全部
        </button>
      </div>
      <div className="file-tree-content">
        {deduplicateNodes(project.fileTree).map(node => (
          <TreeNode key={node.path} node={node} projectId={project.id} depth={0} collapseSignal={collapseSignal} />
        ))}
      </div>
    </div>
  );
}
