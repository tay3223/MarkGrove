/**
 * Bridge: ViewTree → MindmapNode (MindElixir data format).
 *
 * This is the final step in the pipeline:
 *   Source → Semantic Tree → View Tree → MindmapNode (render)
 *
 * The ViewTree is the projection; MindElixir is only a rendering engine.
 * All semantic decisions are made upstream — this module only maps
 * ViewNode fields to MindElixir's expected data shape.
 *
 * NodeContainer slot HTML (spec 002 §3): each node's `dangerouslySetInnerHTML`
 * carries the unified slot structure (Surface/Accent/Leading/Body/Trailing/
 * ChildrenToggle). MindElixir handles layout; the HTML provides semantic
 * content and CSS hooks. ChildrenToggle is wired via event delegation.
 */

import type { ViewNode, SemanticType } from './types';
import type { MindmapNode } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// HTML helpers
// ─────────────────────────────────────────────────────────────────────────

/** Escape text for safe inclusion in HTML. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize an image src to a safe protocol allow-list (spec 002 §13.3).
 * `dangerouslySetInnerHTML` is otherwise built from `esc`-escaped strings, but
 * `img src` can still carry a `javascript:`/`data:` payload — so we restrict it
 * here rather than relying solely on escaping.
 */
function safeSrc(src: string): string {
  const trimmed = src.trim();
  const lowered = trimmed.toLowerCase();
  if (
    lowered.startsWith('javascript:')
    || lowered.startsWith('vbscript:')
    || lowered.startsWith('data:')
  ) {
    return '';
  }
  return esc(trimmed);
}

/** Build the ChildrenToggle HTML button (spec 002 §3.1). */
function childrenToggleHtml(
  nodeId: string | null,
  expanded: boolean,
  childCount: number,
): string {
  if (childCount === 0 || !nodeId) return '';
  return `<button class="nc-children-toggle" data-node-id="${esc(nodeId)}" data-expanded="${expanded}" aria-label="${expanded ? '折叠子节点' : '展开子节点'}" aria-expanded="${expanded}">${expanded ? '−' : '+'}<span class="nc-child-count">${childCount}</span></button>`;
}

/** Build content indicator badges (spec 001 §27.3). */
function contentIndicatorHtml(indicators: ViewNode['contentIndicators']): string {
  if (indicators.length === 0) return '';
  const labels: Record<string, string> = {
    paragraph: '段正文',
    code: '代码',
    table: '表格',
    image: '图片',
    html: 'HTML',
    math: '公式',
    diagram: '图表',
    metadata: '元数据',
    footnote: '脚注',
  };
  const parts = indicators.map(i => {
    const label = labels[i.type] || i.type;
    return `<span class="nc-indicator">${i.count} ${label}</span>`;
  });
  return parts.join(' · ');
}

/**
 * Build the NodeContainer slot HTML for a ViewNode (spec 002 §3).
 *
 * Structure:
 *   nc-surface
 *     nc-accent-bar
 *     nc-leading (icon/checkbox/bullet)
 *     nc-body
 *       nc-eyebrow (type/level/lang)
 *       nc-title
 *       nc-summary
 *       nc-preview (code/table/image)
 *     nc-trailing (indicators + children-toggle)
 */
function buildNodeContainerHtml(view: ViewNode): string {
  const nodeId = esc(view.semanticNodeId || '');
  const typeCls = `nc-type-${view.semanticType}`;
  const familyCls = `nc-family-${view.visualFamily}`;

  // Leading content
  let leading = '';
  switch (view.semanticType) {
    case 'root':
      leading = '<span class="nc-icon nc-icon-root">📄</span>';
      break;
    case 'list-item':
      if (view.eyebrow === '✓') {
        leading = '<span class="nc-checkbox nc-checked">☑</span>';
      } else if (view.eyebrow === '○') {
        leading = '<span class="nc-checkbox nc-unchecked">☐</span>';
      } else if (view.eyebrow === '有序') {
        leading = '<span class="nc-bullet nc-ordered">•</span>';
      } else {
        leading = '<span class="nc-bullet nc-unordered">•</span>';
      }
      break;
    case 'quote':
      leading = '<span class="nc-icon nc-icon-quote">❝</span>';
      break;
    case 'table':
      leading = '<span class="nc-icon nc-icon-table">▦</span>';
      break;
    case 'html':
      leading = '<span class="nc-icon nc-icon-html">&lt;/&gt;</span>';
      break;
    case 'metadata':
      leading = '<span class="nc-icon nc-icon-metadata">⚙</span>';
      break;
    case 'footnote':
      leading = '<span class="nc-icon nc-icon-footnote">†</span>';
      break;
    case 'math':
      leading = '<span class="nc-icon nc-icon-math">∑</span>';
      break;
    case 'diagram':
      leading = '<span class="nc-icon nc-icon-diagram">📊</span>';
      break;
    case 'extension':
    case 'unknown':
      leading = '<span class="nc-icon nc-icon-unknown">?</span>';
      break;
  }

  // Eyebrow (suppress for list-item since eyebrow is used for type detection)
  let eyebrow = '';
  if (view.eyebrow && view.semanticType !== 'list-item') {
    eyebrow = `<div class="nc-eyebrow">${esc(view.eyebrow)}</div>`;
  }

  // Title
  const title = `<div class="nc-title">${esc(view.displayText)}</div>`;

  // Summary
  let summary = '';
  if (view.summary) {
    summary = `<div class="nc-summary">${esc(view.summary)}</div>`;
  }

  // Preview
  let preview = '';
  if (view.preview) {
    switch (view.preview.kind) {
      case 'code':
        preview = `<pre class="nc-code-preview"><code>${esc(view.preview.lines.join('\n'))}</code></pre>`;
        break;
      case 'table':
        preview = `<div class="nc-table-preview"><div class="nc-table-headers">${view.preview.headers.map(h => `<span class="nc-table-cell">${esc(h)}</span>`).join('')}</div>${view.preview.previewRows.map(row => `<div class="nc-table-row">${row.map(cell => `<span class="nc-table-cell">${esc(cell)}</span>`).join('')}</div>`).join('')}</div>`;
        break;
      case 'image':
        preview = `<img class="nc-image-preview" src="${safeSrc(view.preview.src)}" alt="${esc(view.preview.alt)}" />`;
        break;
    }
  }

  // Trailing: content indicators + children toggle
  const indicators = contentIndicatorHtml(view.contentIndicators);
  const toggle = childrenToggleHtml(view.semanticNodeId, view.expanded, view.children.length);
  let trailing = '';
  if (indicators || toggle) {
    trailing = `<div class="nc-trailing">${indicators ? `<span class="nc-indicators">${indicators}</span>` : ''}${toggle}</div>`;
  }

  // Accessible tree semantics (spec 002 §14): role treeitem + roving tabindex
  // (only the root starts focusable; focus moves via keyboard navigation).
  const ariaLevel = view.depth + 1;
  const hasChildren = view.children.length > 0;
  const typeLabels: Record<string, string> = {
    root: '文档', heading: '标题', paragraph: '段落', 'list-item': '列表项', quote: '引用',
    code: '代码', table: '表格', image: '图片', html: 'HTML', metadata: '元数据',
    footnote: '脚注', math: '公式', diagram: '图表', callout: '标注', extension: '扩展',
    unknown: '未知',
  };
  const typeLabel = typeLabels[view.semanticType] || view.semanticType;
  const childCountLabel = hasChildren ? `，${view.children.length} 个子节点` : '';
  const ariaLabel = `${typeLabel}：${view.displayText}${childCountLabel}`;
  const tabindex = view.depth === 0 ? '0' : '-1';

  // Assemble
  return `<div class="nc-surface ${typeCls} ${familyCls}" role="treeitem" tabindex="${tabindex}" aria-level="${ariaLevel}"${hasChildren ? ` aria-expanded="${view.expanded}"` : ''} aria-label="${esc(ariaLabel)}" data-node-id="${nodeId}"><div class="nc-accent-bar"></div>${leading ? `<div class="nc-leading">${leading}</div>` : ''}<div class="nc-body">${eyebrow}${title}${summary}${preview}</div>${trailing}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Style mapping per semantic type
// ─────────────────────────────────────────────────────────────────────────

function styleForType(type: SemanticType, eyebrow: string | null): MindmapNode['style'] {
  switch (type) {
    case 'root':
      return { fontSize: '15px', fontWeight: '600' };
    case 'heading': {
      const level = eyebrow ? parseInt(eyebrow.replace('H', ''), 10) || 1 : 1;
      switch (level) {
        case 1: return { fontSize: '16px', fontWeight: '600' };
        case 2: return { fontSize: '14px', fontWeight: '500' };
        case 3: return { fontSize: '13px', fontWeight: '500' };
        default: return { fontSize: '12px' };
      }
    }
    case 'list-item':
      return { fontSize: '12px' };
    case 'quote':
      return { fontSize: '12px', borderLeft: '2px solid #6c7086', paddingLeft: '6px' };
    case 'code':
      return {
        fontFamily: "'Fira Code', 'SF Mono', Menlo, monospace",
        fontSize: '12px',
      };
    case 'table':
      return { fontSize: '12px' };
    case 'image':
      return { fontSize: '12px' };
    case 'html':
      return { fontSize: '12px' };
    case 'metadata':
      return { fontSize: '11px' };
    case 'footnote':
      return { fontSize: '11px' };
    case 'math':
    case 'diagram':
      return { fontSize: '12px' };
    case 'callout':
      return { fontSize: '12px' };
    case 'extension':
    case 'unknown':
      return { fontSize: '12px' };
    default:
      return { fontSize: '12px' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Node type mapping for MindmapNode.data.nodeType
// ─────────────────────────────────────────────────────────────────────────

function nodeTypeForSemanticType(type: SemanticType): MindmapNode['data'] extends infer D
  ? D extends { nodeType?: infer T }
    ? T
    : never
  : never {
  switch (type) {
    case 'root': return 'root';
    case 'heading': return 'heading';
    case 'list-item': return 'list';
    case 'paragraph': return 'paragraph';
    case 'code': return 'code';
    case 'table': return 'table';
    case 'image': return 'image';
    case 'html': return 'html';
    case 'metadata': return 'frontmatter';
    case 'footnote': return 'footnote';
    case 'quote': return 'blockquote';
    case 'callout': return 'unknown';
    case 'math': return 'unknown';
    case 'diagram': return 'unknown';
    case 'definition-item': return 'unknown';
    case 'extension': return 'unknown';
    case 'unknown': return 'unknown';
    default: return 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Conversion
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convert a ViewNode tree to MindElixir's MindmapNode format.
 *
 * This is a pure function — no side effects, no parsing.
 * Source positions are carried through from the semantic tree via
 * the caller-provided sourceLookup.
 */
export function viewToMindmap(
  view: ViewNode,
  sourceLookup: (semanticNodeId: string | null) => {
    sourcePosition?: unknown;
    fullText?: string;
    codeContent?: string;
    codeLang?: string;
    raw?: string;
  },
): MindmapNode {
  const meta = sourceLookup(view.semanticNodeId);
  const data: MindmapNode['data'] = {
    nodeType: nodeTypeForSemanticType(view.semanticType),
    sourcePosition: meta.sourcePosition,
  };

  // Enrich data based on semantic type
  if (view.semanticType === 'heading' && view.eyebrow) {
    const level = parseInt(view.eyebrow.replace('H', ''), 10) || 1;
    data.headingLevel = level;
  }

  if (view.semanticType === 'code') {
    data.codeContent = meta.codeContent ?? meta.raw ?? '';
    data.codeLang = view.eyebrow ?? 'text';
    if (view.preview?.kind === 'code') {
      data.firstLine = view.preview.lines[0] || undefined;
    }
  }

  if (view.summary) {
    data.description = view.summary;
  }

  if (meta.fullText) {
    data.fullText = meta.fullText;
  }

  // Line range from source position
  if (meta.sourcePosition && typeof meta.sourcePosition === 'object') {
    const pos = meta.sourcePosition as { start?: { line?: number }; end?: { line?: number } };
    if (pos.start?.line && pos.end?.line) {
      data.lineRange = `${pos.start.line}-${pos.end.line}`;
    }
  }

  // Table data
  if (view.semanticType === 'table' && view.preview?.kind === 'table') {
    data.headers = view.preview.headers;
    data.rows = view.preview.previewRows;
  }

  // Convert children
  const children: MindmapNode[] = [];
  for (const child of view.children) {
    children.push(viewToMindmap(child, sourceLookup));
  }

  // Content indicators as trailing text (visible in mind map)
  let topic = view.displayText;
  if (view.contentIndicators.length > 0 && children.length === 0) {
    const indicatorStr = view.contentIndicators
      .map(i => `${i.type}:${i.count}`)
      .join(' ');
    if (indicatorStr) {
      topic = `${topic} · ${indicatorStr}`;
    }
  }

  // NodeContainer slot HTML (spec 002 §3) — supersedes plain topic text.
  // MindElixir renders this via dangerouslySetInnerHTML.
  const html = buildNodeContainerHtml(view);

  return {
    topic,
    id: view.semanticNodeId ?? `gen-${view.depth}-${topic.slice(0, 20)}`,
    children: children.length > 0 ? children : undefined,
    dangerouslySetInnerHTML: html,
    style: styleForType(view.semanticType, view.eyebrow),
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SemanticNode source lookup helper
// ─────────────────────────────────────────────────────────────────────────

import type { SemanticNode, SemanticRoot } from './types';

/**
 * Build a source lookup function from a SemanticRoot.
 * Returns source position, full text, and code content for each node.
 */
export function createSourceLookup(root: SemanticRoot): (id: string | null) => {
  sourcePosition?: unknown;
  fullText?: string;
  codeContent?: string;
  codeLang?: string;
  raw?: string;
} {
  const map = new Map<string, SemanticNode>();
  const walk = (node: SemanticNode) => {
    map.set(node.id, node);
    node.children.forEach(walk);
  };
  walk(root);

  return (id: string | null) => {
    if (!id) return {};
    const node = map.get(id);
    if (!node) return {};

    const result: {
      sourcePosition?: unknown;
      fullText?: string;
      codeContent?: string;
      codeLang?: string;
      raw?: string;
    } = {};

    if (node.source) {
      result.sourcePosition = {
        start: {
          line: node.source.start.line,
          column: node.source.start.column,
          offset: node.source.start.offset,
        },
        end: {
          line: node.source.end.line,
          column: node.source.end.column,
          offset: node.source.end.offset,
        },
      };
    }

    result.fullText = node.content.text;
    result.raw = node.content.raw;

    if (node.type === 'code' && node.syntax.kind === 'code') {
      result.codeContent = node.content.raw;
      result.codeLang = node.syntax.lang;
    }

    return result;
  };
}
