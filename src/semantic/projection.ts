/**
 * SemanticTree → ViewTree projection (spec 001 §27).
 *
 * Three projection modes:
 *   - structure: root, headings, list-items, quotes, callouts; content nodes → indicators
 *   - balanced:  structure + short paragraphs, code/table/image summaries
 *   - complete:  all visible semantic nodes
 *
 * Key rules:
 *   - Projection NEVER modifies the semantic tree (§27.2)
 *   - Projection can hide, fold, aggregate, or insert generated nodes
 *   - Mode switching doesn't change Markdown, undo history, or node identity
 *   - User's explicit expand/collapse preference overrides mode defaults
 */

import type {
  SemanticNode,
  SemanticRoot,
  ViewNode,
  ProjectionMode,
  ContentIndicator,
  ViewPreview,
  SemanticType,
  VisualFamily,
} from './types';
import { getVisualFamily } from './identity';
import { getExtension } from './extensions';

// ─────────────────────────────────────────────────────────────────────────
// Display text utilities
// ─────────────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

function getDisplayText(node: SemanticNode, mode: ProjectionMode): string {
  switch (node.type) {
    case 'root':
      return node.content.text;
    case 'heading':
      return truncate(node.content.text, mode === 'structure' ? 60 : 120);
    case 'list-item':
      return truncate(node.content.text, mode === 'structure' ? 60 : 120);
    case 'quote':
      return truncate(node.content.text, 80);
    case 'paragraph':
      return truncate(node.content.text, mode === 'structure' ? 40 : 120);
    case 'code': {
      const lang = node.syntax.kind === 'code' ? node.syntax.lang : '';
      const firstLine = (node.content.text.split('\n')[0] || '').trim();
      return `[${lang || 'code'}] ${truncate(firstLine, 40)}`;
    }
    case 'table': {
      if (node.syntax.kind === 'table') {
        return `[表格] · ${node.syntax.rows} 行`;
      }
      return node.content.text;
    }
    case 'image':
      return node.syntax.kind === 'image' ? node.syntax.alt || node.syntax.src : node.content.text;
    case 'html':
      return '[HTML]';
    case 'metadata':
      return '[Front Matter]';
    case 'footnote':
      return node.syntax.kind === 'footnote' ? `[^${node.syntax.identifier}]` : node.content.text;
    case 'math':
      return '[公式]';
    case 'diagram':
      return '[图表]';
    case 'callout':
      return truncate(node.content.text, 80);
    case 'definition-item':
      return truncate(node.content.text, 80);
    case 'extension':
    case 'unknown':
      return `[${node.content.text}]`;
    default:
      return node.content.text;
  }
}

function getEyebrow(node: SemanticNode): string | null {
  switch (node.type) {
    case 'heading':
      return node.syntax.kind === 'heading' ? `H${node.syntax.level}` : null;
    case 'code':
      return node.syntax.kind === 'code' ? node.syntax.lang || 'text' : null;
    case 'list-item':
      if (node.syntax.kind === 'list-item') {
        if (node.syntax.ordered) return '有序';
        if (node.syntax.checked !== undefined) return node.syntax.checked === true ? '✓' : '○';
        return null;
      }
      return null;
    case 'table':
      return '表格';
    default:
      return null;
  }
}

function getPreview(node: SemanticNode): ViewPreview | null {
  switch (node.type) {
    case 'code': {
      const lines = node.content.text.split('\n').slice(0, 3);
      const lang = node.syntax.kind === 'code' ? node.syntax.lang : '';
      return { kind: 'code', lang, lines };
    }
    case 'table': {
      if (node.syntax.kind !== 'table') return null;
      // Parse header from raw if available
      const rawLines = node.content.raw.split('\n').filter(l => l.trim().startsWith('|'));
      const headerLine = rawLines[0] || '';
      const headers = headerLine.split('|').map(c => c.trim()).filter(c => c.length > 0);
      const previewRows: string[][] = [];
      for (const line of rawLines.slice(2, 4)) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (cells.length > 0) previewRows.push(cells);
      }
      return { kind: 'table', headers, previewRows, totalRows: node.syntax.rows };
    }
    case 'image': {
      if (node.syntax.kind !== 'image') return null;
      return { kind: 'image', src: node.syntax.src, alt: node.syntax.alt };
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Visibility rules per projection mode (spec 001 §27.1)
// ─────────────────────────────────────────────────────────────────────────

type Visibility = 'visible' | 'hidden' | 'indicator';

function getDefaultVisibility(node: SemanticNode, mode: ProjectionMode): Visibility {
  // Structure nodes are always visible in all modes
  const structuralTypes: SemanticType[] = ['root', 'heading', 'list-item', 'quote', 'callout'];
  if (structuralTypes.includes(node.type)) return 'visible';

  switch (mode) {
    case 'structure':
      // Content nodes become indicators
      if (node.type === 'paragraph') return 'hidden';
      if (node.type === 'code' || node.type === 'table' || node.type === 'image' ||
          node.type === 'html' || node.type === 'math' || node.type === 'diagram') {
        return 'indicator';
      }
      if (node.type === 'metadata' || node.type === 'footnote') return 'hidden';
      return 'indicator';

    case 'balanced':
      // Short paragraphs visible, long ones hidden with indicator
      if (node.type === 'paragraph') {
        return node.content.text.length <= 80 ? 'visible' : 'hidden';
      }
      if (node.type === 'metadata' || node.type === 'footnote') return 'hidden';
      // Code, table, image: show summary
      return 'visible';

    case 'complete':
      // All visible semantic nodes are visible
      return 'visible';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Content indicator computation (spec 001 §27.3)
// ─────────────────────────────────────────────────────────────────────────

function computeContentIndicators(children: ReadonlyArray<ViewNode>): ContentIndicator[] {
  const counts = new Map<SemanticType, number>();
  for (const child of children) {
    counts.set(child.semanticType, (counts.get(child.semanticType) ?? 0) + 1);
  }
  const result: ContentIndicator[] = [];
  for (const [type, count] of counts) {
    result.push({ type, count });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Projection
// ─────────────────────────────────────────────────────────────────────────

/** User override preferences for node visibility. */
export interface ProjectionOverrides {
  /** Node IDs explicitly expanded by the user. */
  expanded: ReadonlySet<string>;
  /** Node IDs explicitly collapsed by the user. */
  collapsed: ReadonlySet<string>;
  /** Node IDs that should be visible regardless of mode default. */
  forceVisible: ReadonlySet<string>;
}

const EMPTY_OVERRIDES: ProjectionOverrides = {
  expanded: new Set(),
  collapsed: new Set(),
  forceVisible: new Set(),
};

/**
 * Project a SemanticRoot into a ViewTree.
 *
 * This is a pure function: same inputs always produce same outputs.
 * The semantic tree is never modified.
 */
export function projectTree(
  root: SemanticRoot,
  mode: ProjectionMode,
  overrides: ProjectionOverrides = EMPTY_OVERRIDES,
): ViewNode {
  return projectNode(root, mode, overrides, 0);
}

function projectNode(
  node: SemanticNode,
  mode: ProjectionMode,
  overrides: ProjectionOverrides,
  depth: number,
): ViewNode {
  const defaultVis = getDefaultVisibility(node, mode);

  // Check extension declaration for custom visibility
  const extDecl = getExtension(node.type);
  let visibility = defaultVis;
  if (extDecl) {
    visibility = extDecl.defaultVisibility[mode];
  }

  // User override: force visible
  if (overrides.forceVisible.has(node.id)) {
    visibility = 'visible';
  }

  // Project children
  const projectedChildren: ViewNode[] = [];
  for (const child of node.children) {
    const childView = projectNode(child, mode, overrides, depth + 1);
    projectedChildren.push(childView);
  }

  // Filter children based on visibility (spec 001 §27.1)
  const visibleChildren = projectedChildren.filter(c => !c.hidden);

  // Content indicators for hidden children (spec 001 §27.3)
  const contentIndicators = computeContentIndicators(
    projectedChildren.filter(c => c.hidden),
  );

  // Expansion state
  const expanded = overrides.expanded.has(node.id)
    ? true
    : overrides.collapsed.has(node.id)
      ? false
      : depth < 3; // default: expand first 3 levels

  return {
    semanticNodeId: node.id,
    displayText: getDisplayText(node, mode),
    eyebrow: getEyebrow(node),
    summary: node.type === 'paragraph' ? truncate(node.content.text, 200) : null,
    preview: getPreview(node),
    semanticType: node.type,
    visualFamily: getVisualFamily(node.type),
    expanded,
    selected: false,
    layout: null,
    generated: false,
    hidden: visibility !== 'visible',
    children: visibleChildren,
    contentIndicators,
    depth,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Search (spec 001 §27.2: search hits in hidden nodes should reveal path)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find semantic nodes matching a query, including hidden ones.
 * Returns the path to each match so the UI can reveal it.
 */
export function searchNodes(
  root: SemanticRoot,
  query: string,
): Array<{ node: SemanticNode; path: SemanticNode[] }> {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: Array<{ node: SemanticNode; path: SemanticNode[] }> = [];

  const walk = (node: SemanticNode, path: SemanticNode[]) => {
    if (node.content.text.toLowerCase().includes(q)) {
      results.push({ node, path: [...path, node] });
    }
    for (const child of node.children) {
      walk(child, [...path, node]);
    }
  };

  walk(root, []);
  return results;
}
