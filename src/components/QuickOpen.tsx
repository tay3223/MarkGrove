import { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import type { FileNode } from '../types';

function flattenFiles(nodes: FileNode[], projectPath: string): Array<{ name: string; path: string; rel: string }> {
  const result: Array<{ name: string; path: string; rel: string }> = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({
        name: node.name,
        path: node.path,
        rel: node.path.replace(projectPath + '/', ''),
      });
    }
    if (node.children) {
      result.push(...flattenFiles(node.children, projectPath));
    }
  }
  return result;
}

export default function QuickOpen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeProjectId = useAppStore(s => s.activeProjectId);
  const projects = useAppStore(s => s.projects);
  const openFile = useAppStore(s => s.openFile);
  const setActiveFile = useAppStore(s => s.setActiveFile);

  const project = projects.find(p => p.id === activeProjectId);
  const allFiles = useMemo(() => {
    if (!project) return [];
    return flattenFiles(project.fileTree, project.path);
  }, [project]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allFiles.slice(0, 20);
    const q = query.toLowerCase();
    return allFiles
      .filter(f => f.name.toLowerCase().includes(q) || f.rel.toLowerCase().includes(q))
      .slice(0, 20);
  }, [allFiles, query]);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const file = filtered[selectedIndex];
        if (file && activeProjectId) {
          openFile(activeProjectId, file.path);
          setActiveFile(activeProjectId, file.path);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, filtered, selectedIndex, activeProjectId, openFile, setActiveFile, onClose]);

  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!visible) return null;

  return (
    <div className="quick-open-overlay" onClick={onClose}>
      <div className="quick-open" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="输入文件名快速打开..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="quick-open-input"
        />
        <div className="quick-open-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="quick-open-empty">没有匹配的文件</div>
          )}
          {filtered.map((file, i) => (
            <div
              key={file.path}
              className={`quick-open-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                if (activeProjectId) {
                  openFile(activeProjectId, file.path);
                  setActiveFile(activeProjectId, file.path);
                  onClose();
                }
              }}
            >
              <span className="quick-open-name">{file.name}</span>
              <span className="quick-open-path">{file.rel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
