import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { showToast } from './Toast';
import type { SearchResult } from '../types';

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function getRelativePath(filePath: string, projectPath: string): string {
  if (filePath.startsWith(projectPath)) {
    return filePath.slice(projectPath.length).replace(/^[/\\]/, '');
  }
  return filePath;
}

interface SearchPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function SearchPanel({ visible, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProjectId = useAppStore(s => s.activeProjectId);
  const projects = useAppStore(s => s.projects);
  const openFile = useAppStore(s => s.openFile);
  const requestSourcePosition = useAppStore(s => s.requestSourcePosition);
  const setActiveTab = useAppStore(s => s.setActiveTab);

  const project = projects.find(p => p.id === activeProjectId);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  const performSearch = useCallback(async () => {
    if (!project || !query.trim() || query.trim().length < 2) return;
    setSearching(true);
    try {
      const result = await window.api.searchInFiles(project.path, query.trim());
      if (result.error) {
        showToast({ type: 'error', message: '搜索失败', detail: result.error });
        setResults([]);
      } else {
        setResults(result.results || []);
        // Auto-expand all files with results
        setExpandedFiles(new Set((result.results || []).map(r => r.filePath)));
      }
    } catch (err: any) {
      showToast({ type: 'error', message: '搜索失败', detail: err?.message });
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [project, query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      performSearch();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [performSearch, onClose]);

  const handleResultClick = useCallback((filePath: string, line: number) => {
    if (!activeProjectId) return;
    openFile(activeProjectId, filePath);
    requestSourcePosition({
      filePath,
      projectId: activeProjectId,
      startLine: line,
      endLine: line,
    });
    setActiveTab('source');
    onClose();
  }, [activeProjectId, openFile, requestSourcePosition, setActiveTab, onClose]);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  if (!visible) return null;

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: '80vw', maxWidth: '700px', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dialog-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>全文搜索</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: '8px 0' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="搜索文件内容..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '4px 0' }}>
          {searching ? '搜索中...' : results.length > 0 ? `${results.length} 个文件，${totalMatches} 处匹配` : query.trim().length >= 2 ? '无结果' : '输入至少 2 个字符'}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {results.map(result => (
            <div key={result.filePath} style={{ marginBottom: '4px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  fontWeight: 500,
                }}
                onClick={() => toggleFile(result.filePath)}
              >
                <span style={{ marginRight: '6px', fontSize: '11px' }}>
                  {expandedFiles.has(result.filePath) ? '▾' : '▸'}
                </span>
                <span style={{ flex: 1 }}>
                  {project ? getRelativePath(result.filePath, project.path) : getFileName(result.filePath)}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {result.matches.length} 处
                </span>
              </div>
              {expandedFiles.has(result.filePath) && (
                <div style={{ paddingLeft: '24px' }}>
                  {result.matches.map((match, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '4px 8px',
                        cursor: 'pointer',
                        borderRadius: '3px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        display: 'flex',
                        gap: '8px',
                      }}
                      onClick={() => handleResultClick(result.filePath, match.line)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: 'var(--text-muted)', minWidth: '32px', textAlign: 'right' }}>
                        {match.line}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {match.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
