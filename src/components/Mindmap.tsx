import { useEffect, useRef, useCallback, useState } from 'react';
import MindElixir from 'mind-elixir';
import type { MainLineParams, MindElixirInstance, SubLineParams } from 'mind-elixir';
import { useAppStore } from '../stores/appStore';
import {
  parseMarkdown as parseSemantic,
  projectTree,
  searchNodes,
  revealSearchPath,
  viewToMindmap,
  createSourceLookup,
  applyOperation,
} from '../semantic';
import type { ProjectionOverrides, TreeOperation, SemanticNode, SemanticType } from '../semantic';
import type { MindmapNode, ProjectionMode } from '../types';
import { showToast } from './Toast';
import { getCurrentSnapshot, getRegisteredThemeIds, getTheme } from '../theme/loader';
import { resolveToken } from '../theme/tokens';
import type { ThemeSnapshot } from '../theme/types';
import type { ThemeMode } from '../types';

const themeSpacing = {
  '--node-gap-x': '36px',
  '--node-gap-y': '6px',
  '--main-gap-x': '64px',
  '--main-gap-y': '4px',
  '--topic-padding': '3px 10px',
  '--map-padding': '20px',
};

// ─────────────────────────────────────────────────────────────────────────
// Theme snapshot → CSS variables (spec 002 §11.4, §15)
//
// Theme switching applies root-level CSS variables only; it does NOT
// re-parse Markdown, rebuild the semantic tree, or regenerate node HTML.
// MindElixir and NodeContainer both consume these variables via CSS cascade.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build MindElixir-compatible CSS variables from a theme snapshot.
 * Maps theme tokens to MindElixir's expected CSS variable names.
 */
function buildMindElixirCssVar(snapshot: ThemeSnapshot): Record<string, string> {
  const r = (name: string) => String(resolveToken(name, snapshot));
  return {
    '--bgcolor': r('color.canvas.background'),
    '--color': r('color.text.primary'),
    '--main-color': r('color.text.primary'),
    '--main-bgcolor': r('color.surface.root'),
    '--main-border': r('color.accent.root'),
    '--main-radius': r('shape.radius.node'),
    '--root-bgcolor': r('color.surface.default'),
    '--root-color': r('color.text.primary'),
    '--root-border-color': r('color.accent.root'),
    '--selected': r('color.state.selected'),
    '--panel-bgcolor': r('color.surface.metadata'),
    '--panel-color': r('color.text.secondary'),
    '--line-color': r('connector.color'),
    '--line-width': r('connector.width'),
  };
}

/**
 * Build NodeContainer CSS variables from a theme snapshot.
 * These are consumed by .nc-* classes in index.css (spec 002 §3, §7).
 */
function buildContainerCssVars(snapshot: ThemeSnapshot): Record<string, string> {
  const r = (name: string) => String(resolveToken(name, snapshot));
  return {
    '--color-surface-default': r('color.surface.default'),
    '--color-surface-root': r('color.surface.root'),
    '--color-surface-code': r('color.surface.code'),
    '--color-surface-quote': r('color.surface.quote'),
    '--color-surface-table': r('color.surface.table'),
    '--color-surface-image': r('color.surface.image'),
    '--color-surface-html': r('color.surface.html'),
    '--color-surface-metadata': r('color.surface.metadata'),
    '--color-surface-technical': r('color.surface.technical'),
    '--color-surface-media': r('color.surface.media'),
    '--color-surface-data': r('color.surface.data'),
    '--color-surface-notice': r('color.surface.notice'),
    '--color-text-primary': r('color.text.primary'),
    '--color-text-secondary': r('color.text.secondary'),
    '--color-text-muted': r('color.text.muted'),
    '--color-border-default': r('color.border.default'),
    '--color-border-strong': r('color.border.strong'),
    '--color-accent-root': r('color.accent.root'),
    '--color-accent-heading-strong': r('color.accent.heading.strong'),
    '--color-accent-heading-medium': r('color.accent.heading.medium'),
    '--color-accent-heading-subtle': r('color.accent.heading.subtle'),
    '--color-accent-text': r('color.accent.text'),
    '--color-accent-code': r('color.accent.code'),
    '--color-accent-quote': r('color.accent.quote'),
    '--color-accent-data': r('color.accent.data'),
    '--color-accent-media': r('color.accent.media'),
    '--color-accent-notice': r('color.accent.notice'),
    '--color-state-selected': r('color.state.selected'),
    '--color-state-error': r('color.state.error'),
    '--color-state-warning': r('color.state.warning'),
    '--shape-radius-node': r('shape.radius.node'),
    '--shape-border-width-default': r('shape.borderWidth.default'),
    '--shape-border-width-accent': r('shape.borderWidth.accent'),
    '--typography-family-sans': r('typography.family.sans'),
    '--typography-family-mono': r('typography.family.mono'),
    '--typography-size-body': r('typography.size.body'),
    '--typography-size-code': r('typography.size.code'),
    '--effect-shadow-default': r('effect.shadow.default'),
    '--connector-color': r('connector.color'),
  };
}

/** Build the MindElixir palette from accent tokens (for branch colors). */
function buildPalette(snapshot: ThemeSnapshot): string[] {
  const r = (name: string) => String(resolveToken(name, snapshot));
  return [
    r('color.accent.heading.strong'),
    r('color.accent.heading.medium'),
    r('color.accent.data'),
    r('color.accent.code'),
    r('color.state.success'),
    r('color.accent.media'),
    r('color.state.error'),
    r('color.accent.root'),
    r('color.accent.quote'),
  ];
}

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
  // Track the last content that was built, to skip unnecessary re-parses when
  // only the projection mode changes (spec 001 §27.2: mode switch ≠ re-parse).
  const lastBuiltContentRef = useRef<string | null>(null);
  // When true, the next content-effect run rebuilds immediately instead of
  // debouncing. Set after a mindmap-originated edit so the tree reflects the
  // safe writeback transaction without delay (spec 001 §22).
  const skipDebounceRef = useRef(false);
  // Inline editing state (spec 001 §14.2): double-click an editable node to
  // edit its text via a safe writeback transaction.
  // mode 'edit': edit existing node text; mode 'add': create a new child node.
  const [editingNode, setEditingNode] = useState<{
    mode: 'edit' | 'add';
    nodeId: string;       // edit: node to edit; add: parent node ID
    text: string;
    nodeType?: SemanticType; // add: type of the new child node
  } | null>(null);

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
  // Projection state (spec 001 §27)
  const projectionMode = useAppStore(s => s.projectionMode);
  const setProjectionMode = useAppStore(s => s.setProjectionMode);
  const projectionExpanded = useAppStore(s => s.projectionExpanded);
  const projectionCollapsed = useAppStore(s => s.projectionCollapsed);
  const projectionForceVisible = useAppStore(s => s.projectionForceVisible);
  const revealNodes = useAppStore(s => s.revealNodes);
  const clearRevealedNodes = useAppStore(s => s.clearRevealedNodes);
  const toggleNodeExpanded = useAppStore(s => s.toggleNodeExpanded);
  // Theme state (spec 002 §11.4): switching only updates CSS variables
  const themeId = useAppStore(s => s.themeId);
  const themeMode = useAppStore(s => s.themeMode);
  const setTheme = useAppStore(s => s.setTheme);
  // Get the current theme snapshot (null until initialized)
  const currentSnapshot = getCurrentSnapshot();
  // Build the list of available themes for the switcher (spec 002 §12)
  const availableThemes = getRegisteredThemeIds().map(id => {
    const pkg = getTheme(id);
    return { id, name: pkg?.manifest.name || id, modes: pkg?.manifest.modes || [] };
  });

  // Active-file override sets (re-computed on each render; cheap)
  const activeExpanded = activeFilePath ? (projectionExpanded[activeFilePath] || new Set<string>()) : new Set<string>();
  const activeCollapsed = activeFilePath ? (projectionCollapsed[activeFilePath] || new Set<string>()) : new Set<string>();
  const activeForceVisible = activeFilePath ? (projectionForceVisible[activeFilePath] || new Set<string>()) : new Set<string>();

  const fileName = activeFilePath ? activeFilePath.split(/[/\\]/).pop() || '' : '';

  // Whether the current file is editable in mindmap (no front matter)
  const isMindmapEditable = activeFile ? !hasFrontMatter(activeFile.content) : false;
  // Latest-value ref so the persistent interaction handlers (captured during
  // rebuild) always read the current front-matter editability.
  const isMindmapEditableRef = useRef(isMindmapEditable);
  isMindmapEditableRef.current = isMindmapEditable;

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

  // Search functionality — uses the semantic tree (spec 001 §27.2) so hidden
  // nodes are also matched. Matched nodes and their ancestors are force-revealed
  // so the user can navigate to them even in structure/balanced mode.
  const performSearch = useCallback((query: string) => {
    if (!query.trim() || !astRef.current) {
      // Clear any previous reveal overrides when search is emptied
      if (activeFilePath) clearRevealedNodes(activeFilePath);
      setSearchResults([]);
      setSearchIndex(0);
      return;
    }
    // Search the semantic tree (includes hidden nodes)
    const semanticResults = searchNodes(astRef.current, query);
    // Reveal ancestor paths so hidden matches become visible (spec 001 §27.2)
    if (activeFilePath) {
      const revealIds = revealSearchPath(semanticResults);
      revealNodes(activeFilePath, [...revealIds]);
    }
    // Map semantic results to mindmap node IDs (projected view may hide some,
    // but force-visible ensures they appear)
    const resultIds = new Set(semanticResults.map(r => r.node.id));
    const results: MindmapNode[] = [];
    const walk = (node: MindmapNode) => {
      if (resultIds.has(node.id)) {
        results.push(node);
      }
      node.children?.forEach(walk);
    };
    if (mindmapRootRef.current) walk(mindmapRootRef.current);
    setSearchResults(results);
    setSearchIndex(0);

    // Highlight first result
    if (results.length > 0 && meRef.current) {
      try {
        meRef.current.selectNode(results[0].id);
      } catch { /* ignore */ }
    }
  }, [activeFilePath, revealNodes, clearRevealedNodes]);

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

  // Trigger search when query changes
  useEffect(() => {
    performSearch(searchQuery);
  }, [searchQuery, performSearch]);

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

  // File content update action (for mindmap-originated edits, spec 001 §22)
  const updateFileContent = useAppStore(s => s.updateFileContent);

  /**
   * Check if a mindmap node is inline-editable (spec 001 §14.2, §23).
   * Looks up the SemanticNode by ID in the cached semantic root and checks
   * its capabilities.inlineEditable flag.
   */
  const isNodeEditable = useCallback((nodeId: string): boolean => {
    const root = astRef.current;
    if (!root) return false;
    const find = (n: SemanticNode): SemanticNode | null => {
      if (n.id === nodeId) return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const node = find(root);
    return node?.capabilities.inlineEditable ?? false;
  }, []);

  /**
   * Get the full text of a semantic node by ID (spec 001 §14.2).
   * Returns the node's content.text — the complete, untruncated text — so the
   * editor never overwrites source with a truncated display summary.
   */
  const getNodeFullText = useCallback((nodeId: string): string => {
    const root = astRef.current;
    if (!root) return '';
    const find = (n: SemanticNode): SemanticNode | null => {
      if (n.id === nodeId) return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    return find(root)?.content.text ?? '';
  }, []);

  /**
   * Commit an inline edit or add through the safe writeback transaction (spec 001 §22, §24).
   *
   * Flow:
   *   1. applyOperation(editNode | addChild) → candidate tree + patchedSource
   *   2. The transaction verifier inside applyOperation re-parses and validates
   *   3. On success: updateFileContent with source='mindmap' + skipDebounce
   *   4. On failure: toast feedback, original source preserved (§24 rule 10)
   */
  const handleCommit = useCallback((edit: { mode: 'edit' | 'add'; nodeId: string; text: string; nodeType?: SemanticType }) => {
    const semanticRoot = astRef.current;
    if (!semanticRoot || !activeProjectId || !activeFilePath || !activeFile) {
      showToast({ type: 'error', message: '操作失败：未找到活动文件' });
      setEditingNode(null);
      return;
    }

    const operation: TreeOperation = edit.mode === 'add'
      ? { kind: 'addChild', parentId: edit.nodeId, nodeType: edit.nodeType || 'paragraph', text: edit.text }
      : { kind: 'editNode', nodeId: edit.nodeId, text: edit.text };

    const result = applyOperation(semanticRoot, activeFile.content, operation);

    if (result.error) {
      // Safe writeback transaction failed — original source is preserved.
      showToast({
        type: 'error',
        message: edit.mode === 'add' ? '添加子节点失败，已保留原始内容' : '节点编辑失败，已保留原始内容',
        detail: result.error,
      });
      return; // keep editor open so user can retry
    }

    // Success: write patched source back to the file store.
    // skipDebounce ensures the mindmap rebuilds immediately (spec 001 §22).
    skipDebounceRef.current = true;
    updateFileContent(activeProjectId, activeFilePath, result.patchedSource!, 'mindmap');
    setEditingNode(null);
  }, [activeProjectId, activeFilePath, activeFile, updateFileContent]);

  /**
   * Delete a node through the safe writeback transaction (spec 001 §14.3, §22, §24).
   * Uses subtree mode by default (removes the node and all its descendants).
   */
  const handleDeleteNode = useCallback((nodeId: string) => {
    const semanticRoot = astRef.current;
    if (!semanticRoot || !activeProjectId || !activeFilePath || !activeFile) {
      showToast({ type: 'error', message: '删除失败：未找到活动文件' });
      return;
    }

    const result = applyOperation(semanticRoot, activeFile.content, {
      kind: 'deleteNode',
      nodeId,
      mode: 'subtree',
    });

    if (result.error) {
      showToast({
        type: 'error',
        message: '删除节点失败，已保留原始内容',
        detail: result.error,
      });
      return;
    }

    skipDebounceRef.current = true;
    updateFileContent(activeProjectId, activeFilePath, result.patchedSource!, 'mindmap');
    setSelectedNode(null);
    onSelectNode?.(null);
  }, [activeProjectId, activeFilePath, activeFile, updateFileContent, onSelectNode]);

  /**
   * Determine the default child type for a parent node (spec 001 §14.1).
   * Mirrors the logic in operations.ts defaultChildType().
   */
  const defaultChildTypeFor = useCallback((nodeId: string): SemanticType => {
    const root = astRef.current;
    if (!root) return 'paragraph';
    const find = (n: SemanticNode): SemanticNode | null => {
      if (n.id === nodeId) return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const parent = find(root);
    if (!parent) return 'paragraph';
    switch (parent.type) {
      case 'root':
        return 'heading';
      case 'heading':
        if (parent.syntax.kind === 'heading') {
          return parent.syntax.level < 6 ? 'heading' : 'paragraph';
        }
        return 'heading';
      case 'list-item':
        return 'list-item';
      default:
        return 'paragraph';
    }
  }, []);

  /**
   * Check if a node can have children (spec 001 §23).
   */
  const canHaveChildren = useCallback((nodeId: string): boolean => {
    const root = astRef.current;
    if (!root) return false;
    const find = (n: SemanticNode): SemanticNode | null => {
      if (n.id === nodeId) return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const node = find(root);
    return node?.capabilities.canHaveChildren ?? false;
  }, []);

  /** Check if a node is the root (cannot be deleted). */
  const isRootNode = useCallback((nodeId: string): boolean => {
    return astRef.current?.id === nodeId;
  }, []);

  /**
   * Get the convertible types for a node (spec 001 §23).
   */
  const getConvertibleTypes = useCallback((nodeId: string): readonly SemanticType[] => {
    const root = astRef.current;
    if (!root) return [];
    const find = (n: SemanticNode): SemanticNode | null => {
      if (n.id === nodeId) return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const node = find(root);
    if (!node || !node.capabilities.convertible) return [];
    return node.capabilities.convertibleTo;
  }, []);

  /**
   * Convert a node's type through the safe writeback transaction (spec 001 §14.2, §22).
   */
  const handleConvertNode = useCallback((nodeId: string, newType: SemanticType) => {
    const semanticRoot = astRef.current;
    if (!semanticRoot || !activeProjectId || !activeFilePath || !activeFile) {
      showToast({ type: 'error', message: '转换失败：未找到活动文件' });
      return;
    }

    const result = applyOperation(semanticRoot, activeFile.content, {
      kind: 'convertNode',
      nodeId,
      newType,
    });

    if (result.error) {
      showToast({
        type: 'error',
        message: '节点类型转换失败，已保留原始内容',
        detail: result.error,
      });
      return;
    }

    skipDebounceRef.current = true;
    updateFileContent(activeProjectId, activeFilePath, result.patchedSource!, 'mindmap');
  }, [activeProjectId, activeFilePath, activeFile, updateFileContent]);

  /**
   * Get the parent node and sibling index for a node (spec 001 §14.5).
   * Returns null if the node is the root or has no parent.
   */
  const getSiblingInfo = useCallback((nodeId: string): { parentId: string; index: number; siblingCount: number } | null => {
    const root = astRef.current;
    if (!root) return null;
    const findParent = (n: SemanticNode, targetId: string): SemanticNode | null => {
      for (const child of n.children) {
        if (child.id === targetId) return n;
        const found = findParent(child, targetId);
        if (found) return found;
      }
      return null;
    };
    const parent = findParent(root, nodeId);
    if (!parent) return null;
    const index = parent.children.findIndex(c => c.id === nodeId);
    if (index < 0) return null;
    return { parentId: parent.id, index, siblingCount: parent.children.length };
  }, []);

  /**
   * Reorder a node among its siblings through the safe writeback transaction (spec 001 §14.5, §22).
   */
  const handleReorderNode = useCallback((nodeId: string, direction: 'up' | 'down') => {
    const semanticRoot = astRef.current;
    if (!semanticRoot || !activeProjectId || !activeFilePath || !activeFile) return;

    const info = getSiblingInfo(nodeId);
    if (!info || info.siblingCount < 2) return;

    const fromIndex = info.index;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= info.siblingCount) return;

    const result = applyOperation(semanticRoot, activeFile.content, {
      kind: 'reorderSiblings',
      parentId: info.parentId,
      fromIndex,
      toIndex,
    });

    if (result.error) {
      showToast({
        type: 'error',
        message: '节点排序失败，已保留原始内容',
        detail: result.error,
      });
      return;
    }

    skipDebounceRef.current = true;
    updateFileContent(activeProjectId, activeFilePath, result.patchedSource!, 'mindmap');
  }, [activeProjectId, activeFilePath, activeFile, updateFileContent, getSiblingInfo]);

  /**
   * Find a semantic node and its parent + child index by ID (spec 001 §14.4).
   * Returns null for the root (no parent) or unknown IDs.
   */
  const findNodeWithParent = useCallback((root: SemanticNode, targetId: string):
    { node: SemanticNode; parent: SemanticNode; index: number } | null => {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i];
      if (child.id === targetId) return { node: child, parent: root, index: i };
      const found = findNodeWithParent(child, targetId);
      if (found) return found;
    }
    return null;
  }, []);

  /**
   * Move a node via drag-and-drop through the safe writeback transaction
   * (spec 001 §14.4, §22). MindElixir's `before` hook vetoes its internal
   * mutation and hands us the drag source + drop target; we resolve the target
   * into {newParentId, newIndex} in the semantic tree and commit via
   * applyOperation(moveNode).
   */
  const handleDragMove = useCallback((
    nodeId: string,
    targetNodeId: string,
    position: 'in' | 'before' | 'after',
  ) => {
    if (!isMindmapEditableRef.current) {
      showToast({ type: 'error', message: '该文档包含 Front Matter，不支持在脑图中移动节点' });
      return;
    }
    const semanticRoot = astRef.current;
    if (!semanticRoot || !activeProjectId || !activeFilePath || !activeFile) {
      showToast({ type: 'error', message: '移动失败：未找到活动文件' });
      return;
    }

    // Resolve newParentId + newIndex from the drop target (spec 001 §14.4).
    const targetInfo = findNodeWithParent(semanticRoot, targetNodeId);
    if (!targetInfo) {
      showToast({ type: 'error', message: '移动失败：目标节点不存在' });
      return;
    }

    let newParentId: string;
    let newIndex: number;
    if (position === 'in') {
      // Drop into the target → becomes the target's last child.
      if (!targetInfo.node.capabilities.canHaveChildren) {
        showToast({ type: 'error', message: '移动失败：目标节点不能包含子节点' });
        return;
      }
      newParentId = targetInfo.node.id;
      newIndex = targetInfo.node.children.length;
    } else {
      // Drop before/after the target → becomes a sibling in the target's parent.
      newParentId = targetInfo.parent.id;
      newIndex = position === 'before' ? targetInfo.index : targetInfo.index + 1;
    }

    const result = applyOperation(semanticRoot, activeFile.content, {
      kind: 'moveNode',
      nodeId,
      newParentId,
      newIndex,
    });

    if (result.error) {
      showToast({
        type: 'error',
        message: '移动节点失败，已保留原始内容',
        detail: result.error,
      });
      return;
    }

    skipDebounceRef.current = true;
    updateFileContent(activeProjectId, activeFilePath, result.patchedSource!, 'mindmap');
  }, [activeProjectId, activeFilePath, activeFile, updateFileContent, findNodeWithParent]);

  // Latest-handler ref so the persistent MindElixir `before` hook (captured at
  // instance creation) always invokes the current closure with fresh store state.
  const dragMoveRef = useRef(handleDragMove);
  dragMoveRef.current = handleDragMove;

  /**
   * Find a rendered MindmapNode by its semantic id (spec 001 §21). The mindmap
   * node id equals the semantic node id (viewToMindmap sets it from
   * `view.semanticNodeId`).
   */
  const findMindmapNodeById = useCallback((nodeId: string): MindmapNode | null => {
    const walk = (n: MindmapNode): MindmapNode | null => {
      if (n.id === nodeId) return n;
      for (const c of n.children || []) {
        const f = walk(c);
        if (f) return f;
      }
      return null;
    };
    return mindmapRootRef.current ? walk(mindmapRootRef.current) : null;
  }, []);

  /**
   * Select a node by id and sync it to the React selection state.
   * MindElixir's `selectNode` requires `event.target === <me-tpc>`, which is
   * NOT satisfied for custom-HTML nodes (our `.nc-*` slot markup lives inside
   * `<me-tpc>`), so we drive selection from React via `data-node-id` instead.
   */
  const selectNodeById = useCallback((nodeId: string) => {
    const node = findMindmapNodeById(nodeId);
    if (!node) return;
    setSelectedNode(node);
    selectedNodeRef.current = node;
    onSelectNode?.(node);
    // Toggle the `nc-selected` class for a non-color selection cue (spec 002 §6).
    const container = containerRef.current;
    if (container) {
      container.querySelectorAll('.nc-surface.nc-selected').forEach(el => el.classList.remove('nc-selected'));
      const el = container.querySelector(`.nc-surface[data-node-id="${nodeId}"]`);
      el?.classList.add('nc-selected');
    }
    // Best-effort: highlight the node in MindElixir too (visual selected ring).
    try {
      meRef.current?.selectNode(nodeId);
    } catch { /* ignore */ }
  }, [findMindmapNodeById, onSelectNode]);

  // Drag-and-drop state for custom-HTML nodes (spec 001 §14.4). We implement
  // pointer-based dragging ourselves because MindElixir's built-in node
  // dragging depends on `event.target === <me-tpc>`, which custom slot HTML
  // never satisfies.
  const dragStateRef = useRef<{
    nodeId: string | null;
    pointerId: number | null;
    startX: number;
    startY: number;
    dragging: boolean;
  }>({ nodeId: null, pointerId: null, startX: 0, startY: 0, dragging: false });

  // Keyboard navigation state (spec 002 §14): roving focus id.
  const focusedNodeIdRef = useRef<string | null>(null);

  /**
   * Build a depth-first list of visible nodes, each with its parent id, from
   * the current mindmap root. Used for Arrow up/down/left/right navigation.
   */
  const flattenVisibleNodes = useCallback((): Array<{ node: MindmapNode; parentId: string | null }> => {
    const out: Array<{ node: MindmapNode; parentId: string | null }> = [];
    const walk = (n: MindmapNode, parentId: string | null) => {
      out.push({ node: n, parentId });
      for (const c of n.children || []) walk(c, n.id);
    };
    if (mindmapRootRef.current) walk(mindmapRootRef.current, null);
    return out;
  }, []);

  /**
   * Move keyboard focus + selection to a node (spec 002 §14): ArrowDown/Up move
   * in document order, ArrowLeft to parent, ArrowRight to first child, Enter
   * triggers inline edit (or source navigation for non-editable nodes).
   */
  const navigateFocusedNode = useCallback((direction: 'down' | 'up' | 'left' | 'right' | 'enter') => {
    const flat = flattenVisibleNodes();
    if (flat.length === 0) return;
    const currentId = focusedNodeIdRef.current ?? flat[0].node.id;
    const idx = flat.findIndex(f => f.node.id === currentId);

    let targetId: string | null = null;
    if (direction === 'down') {
      if (idx >= 0 && idx < flat.length - 1) targetId = flat[idx + 1].node.id;
      else if (idx < 0) targetId = flat[0].node.id;
    } else if (direction === 'up') {
      if (idx > 0) targetId = flat[idx - 1].node.id;
      else if (idx < 0) targetId = flat[0].node.id;
    } else if (direction === 'left') {
      if (idx >= 0 && flat[idx].parentId) targetId = flat[idx].parentId;
    } else if (direction === 'right') {
      if (idx >= 0 && flat[idx].node.children?.length) targetId = flat[idx].node.children[0].id;
    } else if (direction === 'enter') {
      targetId = currentId;
    }

    if (!targetId) return;
    focusedNodeIdRef.current = targetId;
    // Move actual DOM focus to the node's surface for a11y.
    const el = containerRef.current?.querySelector(`.nc-surface[data-node-id="${targetId}"]`) as HTMLElement | null;
    el?.focus?.();
    selectNodeById(targetId);

    if (direction === 'enter') {
      const node = findMindmapNodeById(targetId);
      if (node) {
        if (isMindmapEditableRef.current && isNodeEditable(node.id)) {
          const fullText = getNodeFullText(node.id);
          setEditingNode({ mode: 'edit', nodeId: node.id, text: fullText });
        } else {
          goToSource(node);
        }
      }
    }
  }, [flattenVisibleNodes, selectNodeById, findMindmapNodeById, isNodeEditable, getNodeFullText, goToSource]);

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

  /** Build ProjectionOverrides for the active file from store state. */
  const buildOverrides = useCallback((): ProjectionOverrides => {
    return {
      expanded: activeExpanded,
      collapsed: activeCollapsed,
      forceVisible: activeForceVisible,
    };
  }, [activeExpanded, activeCollapsed, activeForceVisible]);

  // Refs so rebuildMindmap's identity stays stable when only projection state
  // changes. This prevents the content effect from re-parsing Markdown on mode
  // switches (spec 001 §27.2: "模式切换不得改变 Markdown").
  const projectionModeRef = useRef(projectionMode);
  projectionModeRef.current = projectionMode;
  const buildOverridesRef = useRef(buildOverrides);
  buildOverridesRef.current = buildOverrides;

  /**
   * Project the cached semantic root and refresh the mindmap WITHOUT re-parsing.
   *
   * Spec 001 §27.2: "模式切换不得改变 Markdown、撤销历史、节点身份和手工布局数据"
   * This function is called when only the projection mode or overrides change.
   */
  const reproject = useCallback(() => {
    const semanticRoot = astRef.current;
    const me = meRef.current;
    if (!semanticRoot || !me || !containerRef.current) return;

    try {
      const viewTree = projectTree(semanticRoot, projectionModeRef.current, buildOverridesRef.current());
      const sourceLookup = createSourceLookup(semanticRoot);
      const mindmapData = viewToMindmap(viewTree, sourceLookup);

      // Save current state before refresh
      collectExpandedIds();
      if (selectedNodeRef.current) {
        selectedNodeIdRef.current = selectedNodeRef.current.id;
      }
      try {
        const mapEl = me.map;
        if (mapEl) {
          viewStateRef.current = { transform: mapEl.style.transform || '' };
        }
      } catch { /* ignore */ }

      applyExpandedState(mindmapData);
      mindmapRootRef.current = mindmapData;

      me.refresh({ nodeData: mindmapData });
      onMindmapRoot?.(mindmapData);

      // Restore viewport transform (spec 001 §27.2: preserve layout)
      if (viewStateRef.current) {
        try {
          const mapEl = me.map;
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
            me.selectNode(found.id);
            setSelectedNode(found);
            onSelectNode?.(found);
          }
        } catch { /* ignore */ }
      }
      setMindmapReady(true);
    } catch (err) {
      console.error('Failed to reproject mindmap:', err);
      showToast({ type: 'error', message: '投影切换失败', detail: String(err) });
      setMindmapReady(true);
    }
  }, [onMindmapRoot, onSelectNode, collectExpandedIds, applyExpandedState]);

  const rebuildMindmap = useCallback((content: string, shouldAutoFit: boolean) => {
    if (!containerRef.current) return;
    try {
      // New semantic pipeline: Source → Semantic Tree → View Tree → MindmapNode
      // Parsing happens here; projection uses the store's mode + overrides
      // (read via refs so mode switches don't trigger a re-parse).
      const { root: semanticRoot } = parseSemantic(content, fileName || 'untitled.md');
      astRef.current = semanticRoot;
      lastBuiltContentRef.current = content;
      const viewTree = projectTree(semanticRoot, projectionModeRef.current, buildOverridesRef.current());
      const sourceLookup = createSourceLookup(semanticRoot);
      const mindmapData = viewToMindmap(viewTree, sourceLookup);

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
          name: themeId,
          palette: currentSnapshot ? buildPalette(currentSnapshot) : ['#89b4fa', '#cba6f7', '#94e2d5', '#fab387', '#a6e3a1', '#f9e2af', '#f38ba8', '#74c7ec', '#f5c2e7'],
          cssVar: {
            ...(currentSnapshot ? buildMindElixirCssVar(currentSnapshot) : {}),
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

      // Custom-HTML node interaction (spec 001 §14.1–§14.5, spec 002 §3).
      // MindElixir's selectNode/drag depend on `event.target === <me-tpc>`, which
      // is never true for our `.nc-*` slot markup; we drive selection, editing,
      // and dragging from React via `data-node-id` on `.nc-surface`.
      if (containerRef.current) {
        dblclickCleanupRef.current?.();
        const container = containerRef.current;

        // Resolve the nearest node id from a pointer/click event.
        const nodeIdFromEvent = (e: Event): string | null => {
          const surface = (e.target as HTMLElement)?.closest?.('.nc-surface') as HTMLElement | null;
          return surface?.dataset?.nodeId ?? null;
        };

        // Single click → select node.
        const handleClick = (e: MouseEvent) => {
          const nodeId = nodeIdFromEvent(e);
          if (nodeId) selectNodeById(nodeId);
        };

        // Double click → inline edit (editable) or navigate to source.
        const handleDblClick = (e: MouseEvent) => {
          const nodeId = nodeIdFromEvent(e);
          if (!nodeId) return;
          const node = findMindmapNodeById(nodeId);
          if (!node) return;
          if (!isMindmapEditableRef.current) {
            // Front-matter documents cannot be edited in the mindmap; surface a
            // clear message instead of silently doing nothing (spec 001 §12:
            // front matter is read-only in the mindmap).
            showToast({
              type: 'error',
              message: '该文档包含 Front Matter，不支持在脑图中编辑',
              detail: '请切换到「源码」视图进行编辑',
            });
            goToSource(node);
            return;
          }
          if (isNodeEditable(node.id)) {
            const fullText = getNodeFullText(node.id);
            setEditingNode({ mode: 'edit', nodeId: node.id, text: fullText });
          } else {
            goToSource(node);
          }
        };

        // Pointer drag: select on down, track movement, drop on release.
        const DRAG_THRESHOLD = 5;
        const handlePointerDown = (e: PointerEvent) => {
          if (e.button !== 0) return;
          const nodeId = nodeIdFromEvent(e);
          if (!nodeId) return;
          dragStateRef.current = {
            nodeId,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            dragging: false,
          };
          selectNodeById(nodeId);
        };
        const handlePointerMove = (e: PointerEvent) => {
          const s = dragStateRef.current;
          if (s.nodeId === null) return;
          if (s.dragging) return; // already dragging; drop is handled on pointerup
          const dx = e.clientX - s.startX;
          const dy = e.clientY - s.startY;
          if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
            s.dragging = true;
            container.setPointerCapture?.(s.pointerId!);
            // Dim the source node while dragging (spec 002 §6 non-color cue).
            container
              .querySelector(`.nc-surface[data-node-id="${s.nodeId}"]`)
              ?.classList.add('nc-dragging');
          }
        };
        const handlePointerUp = (e: PointerEvent) => {
          const s = dragStateRef.current;
          if (s.nodeId === null) return;
          if (s.dragging && s.pointerId === e.pointerId) {
            // Determine drop target from the element under the cursor.
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const targetSurface = el?.closest?.('.nc-surface') as HTMLElement | null;
            const targetNodeId = targetSurface?.dataset?.nodeId ?? null;
            if (targetNodeId && targetNodeId !== s.nodeId) {
              // Infer before/after/in from the vertical position within the target.
              const rect = targetSurface!.getBoundingClientRect();
              const relY = (e.clientY - rect.top) / rect.height;
              const position: 'in' | 'before' | 'after' =
                relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'in';
              dragMoveRef.current(s.nodeId, targetNodeId, position);
            }
          }
          // Clear dragging cue regardless of outcome.
          container
            .querySelector(`.nc-surface[data-node-id="${s.nodeId}"]`)
            ?.classList.remove('nc-dragging');
          dragStateRef.current = { nodeId: null, pointerId: null, startX: 0, startY: 0, dragging: false };
        };

        container.addEventListener('click', handleClick);
        container.addEventListener('dblclick', handleDblClick);
        container.addEventListener('pointerdown', handlePointerDown);
        container.addEventListener('pointermove', handlePointerMove);
        container.addEventListener('pointerup', handlePointerUp);

        // Keyboard navigation (spec 002 §14): arrows move focus/selection,
        // Enter triggers inline edit (or source navigation).
        const handleKeyDown = (e: KeyboardEvent) => {
          const surface = (e.target as HTMLElement)?.closest?.('.nc-surface') as HTMLElement | null;
          // Only navigate when focus is on a node surface (not inside the input
          // textarea or toolbar).
          if (!surface) return;
          const key = e.key;
          if (key === 'ArrowDown') { e.preventDefault(); navigateFocusedNode('down'); }
          else if (key === 'ArrowUp') { e.preventDefault(); navigateFocusedNode('up'); }
          else if (key === 'ArrowLeft') { e.preventDefault(); navigateFocusedNode('left'); }
          else if (key === 'ArrowRight') { e.preventDefault(); navigateFocusedNode('right'); }
          else if (key === 'Enter') { e.preventDefault(); navigateFocusedNode('enter'); }
          else if (key === ' ') { e.preventDefault(); navigateFocusedNode('enter'); }
        };
        container.addEventListener('keydown', handleKeyDown);

        dblclickCleanupRef.current = () => {
          container.removeEventListener('click', handleClick);
          container.removeEventListener('dblclick', handleDblClick);
          container.removeEventListener('pointerdown', handlePointerDown);
          container.removeEventListener('pointermove', handlePointerMove);
          container.removeEventListener('pointerup', handlePointerUp);
          container.removeEventListener('keydown', handleKeyDown);
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
  }, [fileName, onMindmapRoot, onSelectNode, scheduleFit, ensureReadyTimeout, goToSource, collectExpandedIds, applyExpandedState, isNodeEditable, getNodeFullText, themeId, currentSnapshot, selectNodeById, findMindmapNodeById, navigateFocusedNode]);

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
        setEditingNode(null); // clear inline edit state on file switch
        rebuildMindmap(activeFile.content, true);
      } else if (skipDebounceRef.current) {
        // Mindmap-originated edit (safe writeback transaction): rebuild
        // immediately so the tree reflects the patched source without delay.
        skipDebounceRef.current = false;
        if (rebuildTimerRef.current) {
          clearTimeout(rebuildTimerRef.current);
          rebuildTimerRef.current = null;
        }
        rebuildMindmap(activeFile.content, false);
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

  // Projection mode / override changes: re-project WITHOUT re-parsing.
  // Spec 001 §27.2: "模式切换不得改变 Markdown、撤销历史、节点身份和手工布局数据"
  // This effect fires when the projection mode or per-file overrides change.
  // It skips on initial mount (the content effect handles the first build) and
  // when content is simultaneously changing (the content effect will use the
  // latest projection state via refs).
  useEffect(() => {
    // Skip if no instance or no cached semantic root yet (initial mount)
    if (!meRef.current || !astRef.current) return;
    // Skip if content is simultaneously changing (content effect handles it)
    if (activeFile?.content !== undefined && activeFile.content !== lastBuiltContentRef.current) return;
    reproject();
  }, [projectionMode, activeExpanded, activeCollapsed, activeForceVisible, reproject, activeFile?.content]);

  // Theme switching (spec 002 §11.4): apply CSS variables to the container
  // WITHOUT rebuilding the mindmap or re-parsing Markdown. Only root-level
  // CSS variables are updated; MindElixir and NodeContainer pick up changes
  // via CSS cascade.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const snapshot = getCurrentSnapshot();
    if (!snapshot) return;

    // Apply MindElixir CSS variables
    const meVars = buildMindElixirCssVar(snapshot);
    for (const [name, value] of Object.entries(meVars)) {
      container.style.setProperty(name, value);
    }

    // Apply NodeContainer CSS variables
    const ncVars = buildContainerCssVars(snapshot);
    for (const [name, value] of Object.entries(ncVars)) {
      container.style.setProperty(name, value);
    }
  }, [themeId, themeMode]);

  // ChildrenToggle event delegation (spec 002 §3.1): clicks on .nc-children-toggle
  // are intercepted to toggle node expansion via the store, then reproject.
  // Uses refs so the listener persists across rebuilds and always has latest values.
  const toggleExpandedRef = useRef(toggleNodeExpanded);
  toggleExpandedRef.current = toggleNodeExpanded;
  const activeFilePathRef = useRef(activeFilePath);
  activeFilePathRef.current = activeFilePath;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const toggle = target.closest('.nc-children-toggle') as HTMLElement | null;
      if (!toggle) return;
      e.stopPropagation();
      e.preventDefault();
      const nodeId = toggle.dataset.nodeId;
      const expanded = toggle.dataset.expanded === 'true';
      if (!nodeId) return;
      const fp = activeFilePathRef.current;
      if (fp) toggleExpandedRef.current(fp, nodeId, !expanded);
    };
    container.addEventListener('click', handleClick, true);
    return () => container.removeEventListener('click', handleClick, true);
  }, []);

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
          {isMindmapEditable
            ? '双击可编辑节点修改文本 · 双击不可编辑节点定位源码 · 拖拽节点可移动'
            : '该文档包含 Front Matter，脑图只读 · 双击节点定位源码'}
        </span>
        {/* Node action buttons (spec 001 §14): visible when a node is selected */}
        {selectedNode && !editingNode && isMindmapEditable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
            {canHaveChildren(selectedNode.id) && (
              <button
                onClick={() => {
                  const nodeType = defaultChildTypeFor(selectedNode.id);
                  setEditingNode({ mode: 'add', nodeId: selectedNode.id, text: '', nodeType });
                }}
                title="为当前选中节点添加子节点（安全反写事务）"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                + 子节点
              </button>
            )}
            {!isRootNode(selectedNode.id) && (() => {
              const info = getSiblingInfo(selectedNode.id);
              const canMoveUp = info && info.index > 0;
              const canMoveDown = info && info.index < info.siblingCount - 1;
              return (canMoveUp || canMoveDown) ? (
                <>
                  <button
                    onClick={() => canMoveUp && handleReorderNode(selectedNode.id, 'up')}
                    disabled={!canMoveUp}
                    title="上移节点（安全反写事务）"
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      color: canMoveUp ? 'var(--text-primary)' : 'var(--text-muted)',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      cursor: canMoveUp ? 'pointer' : 'default',
                      opacity: canMoveUp ? 1 : 0.5,
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => canMoveDown && handleReorderNode(selectedNode.id, 'down')}
                    disabled={!canMoveDown}
                    title="下移节点（安全反写事务）"
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      color: canMoveDown ? 'var(--text-primary)' : 'var(--text-muted)',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      cursor: canMoveDown ? 'pointer' : 'default',
                      opacity: canMoveDown ? 1 : 0.5,
                    }}
                  >
                    ↓
                  </button>
                </>
              ) : null;
            })()}
            {getConvertibleTypes(selectedNode.id).length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleConvertNode(selectedNode.id, e.target.value as SemanticType);
                    e.target.value = '';
                  }
                }}
                title="转换节点类型（安全反写事务）"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '3px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="">转换类型</option>
                {getConvertibleTypes(selectedNode.id).map(t => (
                  <option key={t} value={t}>
                    {t === 'heading' ? '标题' : t === 'list-item' ? '列表项' : t === 'paragraph' ? '段落' : t === 'quote' ? '引用' : t === 'callout' ? '标注' : t}
                  </option>
                ))}
              </select>
            )}
            {!isRootNode(selectedNode.id) && (
              <button
                onClick={() => handleDeleteNode(selectedNode.id)}
                title="删除当前选中节点及其子树（安全反写事务）"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                删除
              </button>
            )}
          </div>
        )}
        {/* Projection mode switcher (spec 001 §27) */}
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: '12px', background: 'var(--bg-tertiary)', borderRadius: '4px', border: '1px solid var(--border)' }}>
          {([
            { mode: 'structure' as ProjectionMode, label: '结构', title: '结构视图：只显示标题/列表/引用骨架' },
            { mode: 'balanced' as ProjectionMode, label: '均衡', title: '均衡视图：骨架 + 短段落与摘要' },
            { mode: 'complete' as ProjectionMode, label: '完整', title: '完整视图：显示所有可见语义节点' },
          ]).map(({ mode, label, title }) => (
            <button
              key={mode}
              onClick={() => setProjectionMode(mode)}
              title={title}
              style={{
                background: projectionMode === mode ? 'var(--bg-primary)' : 'transparent',
                color: projectionMode === mode ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                padding: '3px 10px',
                fontSize: '11px',
                cursor: 'pointer',
                borderRadius: '3px',
                fontWeight: projectionMode === mode ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Theme switcher (spec 002 §11.4, §12) */}
        <select
          value={themeId}
          onChange={(e) => {
            const newId = e.target.value;
            const pkg = getTheme(newId);
            // If current mode isn't supported by the new theme, pick the first supported mode
            const newMode = pkg?.manifest.modes.includes(themeMode)
              ? themeMode
              : pkg?.manifest.modes[0] || 'dark';
            setTheme(newId, newMode as ThemeMode);
          }}
          title="切换主题（仅改变外观，不影响数据）"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            padding: '3px 6px',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: 'pointer',
            outline: 'none',
            marginLeft: '8px',
          }}
        >
          {availableThemes.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {/* Mode switcher: light / dark / high-contrast (only show supported modes) */}
        {(() => {
          const currentPkg = getTheme(themeId);
          const supportedModes = currentPkg?.manifest.modes || ['dark'];
          const modeLabels: Record<ThemeMode, string> = {
            'light': '亮色',
            'dark': '暗色',
            'high-contrast': '高对比',
          };
          return supportedModes.length > 1 ? (
            <select
              value={themeMode}
              onChange={(e) => setTheme(themeId, e.target.value as ThemeMode)}
              title="切换模式"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '3px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                outline: 'none',
                marginLeft: '4px',
              }}
            >
              {supportedModes.map(m => (
                <option key={m} value={m}>{modeLabels[m as ThemeMode]}</option>
              ))}
            </select>
          ) : null;
        })()}
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
      {/* Inline edit/add overlay (spec 001 §14.2, §14.1): safe writeback transaction */}
      {editingNode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '6px',
            padding: '6px 10px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingBottom: '4px' }}>
            {editingNode.mode === 'add' ? '添加子节点' : '编辑节点文本'}
          </label>
          {editingNode.mode === 'add' && (
            <select
              value={editingNode.nodeType || 'paragraph'}
              onChange={(e) => setEditingNode({ ...editingNode, nodeType: e.target.value as SemanticType })}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '4px 6px',
                borderRadius: '4px',
                fontSize: '12px',
                outline: 'none',
              }}
            >
              <option value="heading">标题</option>
              <option value="list-item">列表项</option>
              <option value="paragraph">段落</option>
            </select>
          )}
          <textarea
            value={editingNode.text}
            onChange={(e) => setEditingNode({ ...editingNode, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleCommit(editingNode);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditingNode(null);
              }
            }}
            autoFocus
            rows={2}
            placeholder={editingNode.mode === 'add' ? '输入新节点文本（Ctrl+Enter 提交，Esc 取消）' : '输入节点文本（Ctrl+Enter 提交，Esc 取消）'}
            style={{
              flex: 1,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '13px',
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              minHeight: '32px',
              maxHeight: '120px',
            }}
          />
          <button
            onClick={() => handleCommit(editingNode)}
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '4px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            提交
          </button>
          <button
            onClick={() => setEditingNode(null)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              padding: '4px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            取消
          </button>
        </div>
      )}
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
