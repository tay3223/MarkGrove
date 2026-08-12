/**
 * Bridge: ViewTree → MindmapNode (MindElixir data format).
 *
 * This is the final step in the pipeline:
 *   Source → Semantic Tree → View Tree → MindmapNode (render)
 *
 * The ViewTree is the projection; MindElixir is only a rendering engine.
 * All semantic decisions are made upstream — this module only maps
 * ViewNode fields to MindElixir's expected data shape.
 */

import type { ViewNode, SemanticType } from './types';
import type { MindmapNode } from '../types';

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

  return {
    topic,
    id: view.semanticNodeId ?? `gen-${view.depth}-${topic.slice(0, 20)}`,
    children: children.length > 0 ? children : undefined,
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
