import { useEffect, useRef, useCallback, useState } from 'react';
import MindElixir from 'mind-elixir';
import { DARK_THEME } from 'mind-elixir';
import type { MainLineParams, MindElixirInstance, SubLineParams } from 'mind-elixir';
import { useAppStore } from '../stores/appStore';
import {
  parseMarkdown as parseSemantic,
  projectTree,
  viewToMindmap,
  createSourceLookup,
} from '../semantic';
import type { MindmapNode } from '../types';
import { showToast } from './Toast';

const themeSpacing = {
  '--node-gap-x': '36px',
  '--node-gap-y': '6px',
  '--main-gap-x': '64px',
  '--main-gap-y': '4px',
  '--topic-padding': '3px 10px',
  '--map-padding': '20px',
};

const orthogonalPath = (x1: number, y1: number, x2: number, y2: number) => {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
};

function orthogonalMainBranch({
  pT, pL, pW, pH, cT, cL, cW, cH, direction,
}: MainLineParams): string {
  const isLeft = direction === 'lhs';
  const x1 = isLeft ? pL : pL + pW;
  const x2 = isLeft ? cL + cW : cL;
  return orthogonalPath(x1, pT + pH / 2, x2, cT + cH / 2);
}

function orthogonalSubBranch(this: MindElixirInstance, {
  pT, pL, pW, pH, cT, cL, cW, cH, direction, isFirst,
}: SubLineParams): string {
  const nodeGap = Number.parseFloat(
    this.container.style.getPropertyValue('--node-gap-x'),
  ) || Number.parseFloat(themeSpacing['--node-gap-x']);
  const isLeft = direction === 'lhs';
  const x1 = isLeft
    ? pL + (isFirst ? 0 : nodeGap)
    : pL + pW - (isFirst ? 0 : nodeGap);
  const x2 = isLeft ? cL + cW - nodeGap : cL + nodeGap;
  return orthogonalPath(x1, pT + pH / 2, x2, cT + cH / 2);
}

function enableLeftButtonPan(me: MindElixirInstance): () => void {
  const { container } = me;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const stopMindElixirPointerHandling = (event: PointerEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (
      event.pointerType !== 'mouse'
      || event.button !== 0
      || event.target !== container
    ) return;

    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    container.setPointerCapture(pointerId);
    stopMindElixirPointerHandling(event);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    me.move(dx, dy);
    stopMindElixirPointerHandling(event);
  };

  const finishPan = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (container.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId);
    }
    pointerId = null;
    stopMindElixirPointerHandling(event);
  };

  container.addEventListener('pointerdown', handlePointerDown, true);
  container.addEventListener('pointermove', handlePointerMove, true);
  container.addEventListener('pointerup', finishPan, true);
  container.addEventListener('pointercancel', finishPan, true);

  return () => {
    container.removeEventListener('pointerdown', handlePointerDown, true);
    container.removeEventListener('pointermove', handlePointerMove, true);
    container.removeEventListener('pointerup', finishPan, true);
    container.removeEventListener('pointercancel', finishPan, true);
  };
}

// Check if content has front matter
function hasFrontMatter(content: string): boolean {
  return content.trimStart().startsWith('---');
}

export default function Mindmap({
  onMindmapRoot,
  onSelectNode,
}: {
  onMindmapRoot?: (root: MindmapNode | null) => void;
  onSelectNode?: (node: MindmapNode | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<any>(null);
  const astRef = useRef<any>(null);
  const mindmapRootRef = useRef<MindmapNode | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation token to invalidate stale async callbacks (StrictMode, hot reload, unmount).
  const generationRef = useRef(0);
  // Explicit ready state: the single source of truth for mindmap visibility.
  const [isMindmapReady, setMindmapReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MindmapNode[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [selectedNode, setSelectedNode] = useState<MindmapNode | null>(null);
  // Use ref to always have the latest selectedNode in DOM event handlers
  const selectedNodeRef = useRef<MindmapNode | null>(null);
  selectedNodeRef.current = selectedNode;
  // Track dblclick listener for cleanup
  const dblclickCleanupRef = useRef<(() => void) | null>(null);
  // Save/restore view state across rebuilds
  const viewStateRef = useRef<{ transform: string } | null>(null);
  // Save/restore expanded node IDs across refreshes
  const expandedNodeIdsRef = useRef<Set<string>>(new Set());
  // Save/restore selected node ID across refreshes
  const selectedNodeIdRef = useRef<string | null>(null);
  // Debounce timer for content changes
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether this is a file switch (immediate rebuild) vs content change (debounced)
  const lastContentFilePathRef = useRef<string | null>(null);

  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const requestSourcePosition = useAppStore(s => s.requestSourcePosition);
  const pendingMindmapNode = useAppStore(s => s.pendingMindmapNode);
  const clearMindmapNode = useAppStore(s => s.clearMindmapNode);

  const fileName = activeFilePath ? activeFilePath.split(/[/\\]/).pop() || '' : '';

  // Whether the current file is editable in mindmap (no front matter)
  const isMindmapEditable = activeFile ? !hasFrontMatter(activeFile.content) : false;

  // Schedule a deferred scaleFit after 2 animation frames so the DOM has time
  // to lay out. Uses a generation token to ignore stale callbacks after
  // cleanup / rebuild / unmount.
  const scheduleFit = useCallback(() => {
    const generation = generationRef.current;
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = requestAnimationFrame(() => {
        fitFrameRef.current = null;
        if (generationRef.current !== generation) return; // stale callback
        try {
          meRef.current?.scaleFit();
        } catch (err) {
          console.warn('Mindmap scaleFit failed:', err);
        }
        setMindmapReady(true);
      });
    });
  }, []);

  // Fallback timeout to guarantee the mindmap becomes visible even if scaleFit
  // never fires (e.g. container has zero size, rAF cancelled, etc.).
  const ensureReadyTimeout = useCallback(() => {
    const generation = generationRef.current;
    if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = setTimeout(() => {
      readyTimeoutRef.current = null;
      if (generationRef.current !== generation) return; // stale callback
      setMindmapReady(true);
    }, 400);
  }, []);

  // Manual "适应" handler: fit now and unconditionally show the mindmap so the
  // user can always recover from a stuck/hidden state.
  const handleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
    if (readyTimeoutRef.current) {
      clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
    const me = meRef.current;
    if (me) {
      try {
        me.scaleFit();
      } catch (err) {
        console.warn('Mindmap scaleFit failed:', err);
      }
    }
    setMindmapReady(true);
  }, []);

  // Search functionality
  const performSearch = useCallback((query: string) => {
    if (!query.trim() || !mindmapRootRef.current) {
      setSearchResults([]);
      setSearchIndex(0);
      return;
    }
    const q = query.toLowerCase();
    const results: MindmapNode[] = [];
    const walk = (node: MindmapNode) => {
      if (node.topic.toLowerCase().includes(q)) {
        results.push(node);
      }
      node.children?.forEach(walk);
    };
    walk(mindmapRootRef.current);
    setSearchResults(results);
    setSearchIndex(0);

    // Highlight first result
    if (results.length > 0 && meRef.current) {
      try {
        meRef.current.selectNode(results[0].id);
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    performSearch(searchQuery);
  }, [searchQuery, performSearch]);

  const navigateSearch = useCallback((direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return;
    const newIndex = direction === 'next'
      ? (searchIndex + 1) % searchResults.length
      : (searchIndex - 1 + searchResults.length) % searchResults.length;
    setSearchIndex(newIndex);
    if (meRef.current) {
      try {
        meRef.current.selectNode(searchResults[newIndex].id);
      } catch { /* ignore */ }
    }
  }, [searchResults, searchIndex]);

  // Navigate to source code for a node - uses store state instead of DOM events
  const goToSource = useCallback((node: MindmapNode) => {
    const pos = node.data?.sourcePosition;
    if (pos && activeProjectId && activeFilePath) {
      // Set the pending source position in the store
      // SourceEditor will consume this when it mounts
      requestSourcePosition({
        filePath: activeFilePath,
        projectId: activeProjectId,
        startLine: pos.start.line,
        endLine: pos.end.line,
        startColumn: pos.start.column,
        endColumn: pos.end.column,
        nodeId: node.id,
      });
      setActiveTab('source');
    }
  }, [setActiveTab, requestSourcePosition, activeProjectId, activeFilePath]);

  /** Collect expanded node IDs from current Mind Elixir instance data */
  const collectExpandedIds = useCallback(() => {
    const me = meRef.current;
    if (!me) return;
    try {
      const data = me.getData();
      const ids = new Set<string>();
      const walk = (node: any) => {
        if (node.expanded !== false && node.children && node.children.length > 0) {
          ids.add(node.id);
        }
        node.children?.forEach(walk);
      };
      if (data?.nodeData) walk(data.nodeData);
      expandedNodeIdsRef.current = ids;
    } catch { /* ignore */ }
  }, []);

  /** Apply expanded state to new mindmap data based on saved IDs */
  const applyExpandedState = useCallback((node: MindmapNode) => {
    const saved = expandedNodeIdsRef.current;
    const walk = (n: MindmapNode) => {
      if (n.children && n.children.length > 0) {
        (n as any).expanded = saved.has(n.id);
        n.children.forEach(walk);
      }
    };
    walk(node);
  }, []);

  const rebuildMindmap = useCallback((content: string, shouldAutoFit: boolean) => {
    if (!containerRef.current) return;
    try {
      // New semantic pipeline: Source → Semantic Tree → View Tree → MindmapNode
      const { root: semanticRoot } = parseSemantic(content, fileName || 'untitled.md');
      const viewTree = projectTree(semanticRoot, 'balanced');
      const sourceLookup = createSourceLookup(semanticRoot);
      const mindmapData = viewToMindmap(viewTree, sourceLookup);
      astRef.current = semanticRoot;

      // If we have an existing instance, use refresh for content updates (no destroy)
      if (meRef.current && !shouldAutoFit) {
        // Save current state before refresh
        collectExpandedIds();
        if (selectedNodeRef.current) {
          selectedNodeIdRef.current = selectedNodeRef.current.id;
        }
        try {
          // Save absolute transform from DOM element
          const mapEl = meRef.current.map;
          if (mapEl) {
            viewStateRef.current = { transform: mapEl.style.transform || '' };
          }
        } catch { /* ignore */ }

        // Apply saved expanded state to new data
        applyExpandedState(mindmapData);
        mindmapRootRef.current = mindmapData;

        // Use refresh instead of destroy+recreate
        meRef.current.refresh({ nodeData: mindmapData });
        onMindmapRoot?.(mindmapData);

        // Restore view state using absolute transform
        if (viewStateRef.current) {
          try {
            const mapEl = meRef.current.map;
            if (mapEl && viewStateRef.current.transform) {
              mapEl.style.transform = viewStateRef.current.transform;
            }
          } catch { /* ignore */ }
        }

        // Restore selected node
        if (selectedNodeIdRef.current) {
          try {
            const findById = (n: MindmapNode): MindmapNode | null => {
              if (n.id === selectedNodeIdRef.current) return n;
              for (const c of n.children || []) {
                const f = findById(c);
                if (f) return f;
              }
              return null;
            };
            const found = findById(mindmapData);
            if (found) {
              meRef.current.selectNode(found.id);
              setSelectedNode(found);
              onSelectNode?.(found);
            }
          } catch { /* ignore */ }
        }
        // Content refresh keeps the instance alive; ensure the mindmap is visible.
        setMindmapReady(true);
        return;
      }

      // Full rebuild: file switch or first render
      setMindmapReady(false);
      mindmapRootRef.current = mindmapData;

      if (meRef.current) {
        meRef.current.destroy();
        meRef.current = null;
      }

      const me = new MindElixir({
        el: containerRef.current,
        direction: MindElixir.RIGHT,
        draggable: false,
        editable: false,
        contextMenu: false,
        toolBar: false,
        keypress: true,
        mouseSelectionButton: 2,
        theme: {
          name: 'MochaDark',
          palette: ['#89b4fa', '#cba6f7', '#94e2d5', '#fab387', '#a6e3a1', '#f9e2af', '#f38ba8', '#74c7ec', '#f5c2e7'],
          cssVar: {
            ...(DARK_THEME as any).cssVar,
            '--bgcolor': '#1e1e2e',
            '--color': '#cdd6f4',
            '--main-color': '#cdd6f4',
            '--main-bgcolor': '#45475a',
            '--main-border': '#89b4fa',
            '--main-radius': '6px',
            '--root-bgcolor': '#313244',
            '--root-color': '#cdd6f4',
            '--root-border-color': '#89b4fa',
            '--selected': '#89b4fa',
            '--panel-bgcolor': '#181825',
            '--panel-color': '#a6adc8',
            ...themeSpacing,
          },
          generateMainBranch: orthogonalMainBranch,
          generateSubBranch: orthogonalSubBranch,
        },
      } as any);

      me.init({ nodeData: mindmapData });
      me.disposable.push(enableLeftButtonPan(me));
      onMindmapRoot?.(mindmapData);

      // Single click: select node only
      me.bus.addListener('selectNodes', (nodes: any[]) => {
        const nodeObj = nodes && nodes[0];
        if (!nodeObj || !mindmapRootRef.current) {
          setSelectedNode(null);
          onSelectNode?.(null);
          return;
        }
        const findById = (n: MindmapNode): MindmapNode | null => {
          if (n.id === nodeObj.id) return n;
          for (const c of n.children || []) {
            const f = findById(c);
            if (f) return f;
          }
          return null;
        };
        const found = findById(mindmapRootRef.current);
        setSelectedNode(found);
        onSelectNode?.(found);
      });

      // Double click: navigate to source (use ref for latest selectedNode)
      if (containerRef.current) {
        dblclickCleanupRef.current?.();
        const container = containerRef.current;
        const handleDblClick = () => {
          const node = selectedNodeRef.current;
          if (node) {
            goToSource(node);
          }
        };
        container.addEventListener('dblclick', handleDblClick);
        dblclickCleanupRef.current = () => {
          container.removeEventListener('dblclick', handleDblClick);
        };
      }

      meRef.current = me;

      if (shouldAutoFit) {
        scheduleFit();
        ensureReadyTimeout();
      } else {
        // Defensive: full-rebuild branch should always auto-fit, but never
        // leave the mindmap permanently hidden.
        setMindmapReady(true);
      }
    } catch (err) {
      console.error('Failed to build mindmap:', err);
      showToast({ type: 'error', message: '脑图构建失败', detail: String(err) });
      // Show whatever state we're in instead of leaving a blank container.
      setMindmapReady(true);
    }
  }, [fileName, onMindmapRoot, onSelectNode, scheduleFit, ensureReadyTimeout, goToSource, collectExpandedIds, applyExpandedState]);

  useEffect(() => {
    if (activeFile?.content !== undefined) {
      // A full (re)build is needed when there is no instance yet, or when the
      // active file has changed. Otherwise it's a content update (debounced).
      // Checking meRef.current is critical for React StrictMode: after cleanup
      // destroys the instance, the second effect run must re-initialize even
      // though lastContentFilePathRef may still hold the same path.
      const needsInitialBuild =
        !meRef.current || activeFilePath !== lastContentFilePathRef.current;
      lastContentFilePathRef.current = activeFilePath || null;

      if (needsInitialBuild) {
        // File switch or first render: rebuild immediately with auto-fit
        if (rebuildTimerRef.current) {
          clearTimeout(rebuildTimerRef.current);
          rebuildTimerRef.current = null;
        }
        rebuildMindmap(activeFile.content, true);
      } else {
        // Content change: debounce rebuild to avoid destroying mindmap during typing
        if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = setTimeout(() => {
          rebuildTimerRef.current = null;
          rebuildMindmap(activeFile.content, false);
        }, 800);
      }
    }
  }, [activeFile?.content, activeFilePath, rebuildMindmap]);

  useEffect(() => {
    return () => {
      // Invalidate all pending async callbacks so stale rAF/timeout callbacks
      // won't write state after the component (or instance) is gone.
      generationRef.current += 1;
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
      // Reset lifecycle ref so the next effect run treats itself as a fresh
      // init instead of a "same-file content update" (critical for StrictMode).
      lastContentFilePathRef.current = null;
      dblclickCleanupRef.current?.();
      dblclickCleanupRef.current = null;
      if (meRef.current) {
        meRef.current.destroy();
        meRef.current = null;
      }
    };
  }, []);

  // Consume pending mindmap node from source editor cursor sync
  useEffect(() => {
    if (!pendingMindmapNode || !meRef.current || !mindmapRootRef.current) return;
    if (pendingMindmapNode.filePath !== activeFilePath) return;

    const targetLine = pendingMindmapNode.line;
    // Find the mindmap node whose sourcePosition contains this line
    const findNodeByLine = (node: MindmapNode): MindmapNode | null => {
      const pos = node.data?.sourcePosition;
      if (pos && pos.start.line <= targetLine && targetLine <= pos.end.line) {
        // Check children first for a more specific match
        if (node.children) {
          for (const child of node.children) {
            const found = findNodeByLine(child);
            if (found) return found;
          }
        }
        return node;
      }
      if (node.children) {
        for (const child of node.children) {
          const found = findNodeByLine(child);
          if (found) return found;
        }
      }
      return null;
    };

    const found = findNodeByLine(mindmapRootRef.current);
    if (found && meRef.current) {
      try {
        meRef.current.selectNode(found.id);
        setSelectedNode(found);
        onSelectNode?.(found);
      } catch { /* ignore */ }
    }
    clearMindmapNode();
  }, [pendingMindmapNode, activeFilePath, clearMindmapNode, onSelectNode]);

  // Export current mindmap as PNG or SVG via native save dialog
  const handleExport = useCallback(async () => {
    const me = meRef.current;
    if (!me) return;
    const baseName = fileName.replace(/\.(md|markdown|mdown|mkd)$/i, '');
    const savePath = await window.api.showSaveDialog({
      title: '导出脑图',
      defaultPath: `${baseName}.png`,
      filters: [
        { name: 'PNG 图片', extensions: ['png'] },
        { name: 'SVG 矢量图', extensions: ['svg'] },
      ],
    });
    if (!savePath) return; // user canceled

    try {
      const ext = savePath.toLowerCase().split('.').pop();
      if (ext === 'svg') {
        const blob = me.exportSvg?.();
        if (!blob) throw new Error('SVG 导出失败');
        const text = await blob.text();
        const res = await window.api.writeExportFile(savePath, text);
        if (res.error) throw new Error(res.error);
      } else {
        const blob = await me.exportPng?.();
        if (!blob) throw new Error('PNG 导出失败');
        const buf = await blob.arrayBuffer();
        const res = await window.api.writeExportFile(savePath, buf);
        if (res.error) throw new Error(res.error);
      }
      showToast({ type: 'success', message: '已导出', detail: savePath, duration: 2500 });
    } catch (err) {
      showToast({ type: 'error', message: '导出失败', detail: String(err) });
    }
  }, [fileName]);

  if (!activeFile) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🧠</div>
        <div className="empty-text">从文件树选择一个文件</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div className="mindmap-toolbar">
        <span className="file-name">{fileName}</span>
        {activeFile.isDirty && <span className="dirty-dot" />}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
          脑图只读 · 双击节点定位源码
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="text"
            placeholder="搜索节点..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? navigateSearch('prev') : navigateSearch('next');
              }
            }}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              width: '140px',
              outline: 'none',
            }}
          />
          {searchResults.length > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {searchIndex + 1}/{searchResults.length}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            const me = meRef.current;
            if (me) me.scale(Math.max(me.scaleVal / 1.2, me.scaleMin));
          }}
          title="缩小"
        >－</button>
        <button
          onClick={() => {
            const me = meRef.current;
            if (me) me.scale(Math.min(me.scaleVal * 1.2, me.scaleMax));
          }}
          title="放大"
        >＋</button>
        <button onClick={handleFit} title="适应窗口">适应</button>
        <button onClick={handleExport} title="导出为 PNG 或 SVG">导出</button>
      </div>
      <div
        className="mindmap-container"
        ref={containerRef}
        style={{
          visibility: isMindmapReady ? 'visible' : 'hidden',
          pointerEvents: isMindmapReady ? 'auto' : 'none',
        }}
      />
    </div>
  );
}
