/**
 * SemanticTree → Markdown serializer (spec 001 §14, §15).
 *
 * Round-trip guarantees (spec 001 §15.1):
 *   - Semantic content not lost
 *   - Parent-child relationships unchanged
 *   - Sibling order unchanged
 *   - Structure info (heading levels, list types, task states, code langs) not lost
 *   - Unedited complex content preserved as-is
 *
 * Not guaranteed (spec 001 §15.2):
 *   - Exact whitespace
 *   - Exact bullet character (-, *, +)
 *   - Exact table column width/alignment
 */

import type { SemanticNode, SemanticRoot, InlineNode, NodeContent } from './types';

// ─────────────────────────────────────────────────────────────────────────
// Inline serialization
// ─────────────────────────────────────────────────────────────────────────

function serializeInline(nodes: ReadonlyArray<InlineNode> | null, fallbackText: string): string {
  if (!nodes || nodes.length === 0) return fallbackText;
  return nodes.map(serializeInlineNode).join('');
}

function serializeInlineNode(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'strong':
      return `**${node.children.map(serializeInlineNode).join('')}**`;
    case 'emphasis':
      return `*${node.children.map(serializeInlineNode).join('')}*`;
    case 'delete':
      return `~~${node.children.map(serializeInlineNode).join('')}~~`;
    case 'inlineCode':
      return `\`${node.value}\``;
    case 'link':
      return `[${node.children.map(serializeInlineNode).join('')}](${node.url}${node.title ? ` "${node.title}"` : ''})`;
    case 'linkReference': {
      const text = node.children.map(serializeInlineNode).join('');
      // Emit the original reference form (spec 001 §18.2): full `[text][id]`,
      // collapsed `[text][]`, shortcut `[text]`. This preserves the reference
      // semantics instead of downgrading to an inline link with an empty URL.
      if (node.referenceType === 'shortcut') {
        return `[${text}]`;
      }
      if (node.referenceType === 'collapsed') {
        return `[${text}][]`;
      }
      const id = node.label || node.identifier;
      return `[${text}][${id}]`;
    }
    case 'image':
      return `![${node.alt}](${node.url}${node.title ? ` "${node.title}"` : ''})`;
    case 'imageReference': {
      if (node.referenceType === 'shortcut') {
        return `![${node.alt}]`;
      }
      if (node.referenceType === 'collapsed') {
        return `![${node.alt}][]`;
      }
      const id = node.label || node.identifier;
      return `![${node.alt}][${id}]`;
    }
    case 'break':
      return '  \n';
    case 'html':
      return node.value;
    case 'footnoteReference':
      return `[^${node.identifier}]`;
    case 'raw':
      return node.value;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Block serialization
// ─────────────────────────────────────────────────────────────────────────

interface SerializeContext {
  indent: string;
}

function serializeNode(node: SemanticNode, ctx: SerializeContext): string {
  switch (node.type) {
    case 'heading':
      return serializeHeading(node, ctx);
    case 'list-item':
      return serializeListItem(node, ctx);
    case 'quote':
      return serializeQuote(node, ctx);
    case 'paragraph':
      return serializeParagraph(node, ctx);
    case 'code':
      return serializeCode(node, ctx);
    case 'table':
      return serializeTable(node, ctx);
    case 'image':
      return serializeImage(node, ctx);
    case 'html':
      return serializeHtml(node, ctx);
    case 'metadata':
      return serializeMetadata(node, ctx);
    case 'footnote':
      return serializeFootnote(node, ctx);
    case 'callout':
      return serializeCallout(node, ctx);
    case 'math':
      return serializeMath(node, ctx);
    case 'diagram':
      return serializeDiagram(node, ctx);
    case 'definition-item':
      return serializeDefinitionItem(node, ctx);
    case 'extension':
    case 'unknown':
      return serializeUnknown(node, ctx);
    default:
      return node.content.raw || node.content.text;
  }
}

function serializeHeading(node: SemanticNode, ctx: SerializeContext): string {
  if (node.syntax.kind !== 'heading') return node.content.text;
  const { level, variant } = node.syntax;

  const text = serializeInline(node.content.inline, node.content.text);

  let result: string;
  if (variant === 'setext' && (level === 1 || level === 2)) {
    const underline = level === 1 ? '===' : '---';
    result = `${text}\n${underline.repeat(Math.max(3, text.length))}`;
  } else {
    result = `${'#'.repeat(level)} ${text}`;
  }

  // Serialize children (sub-headings and content under this heading)
  const childBlocks = node.children.map(child => serializeNode(child, ctx));
  if (childBlocks.length > 0) {
    result += '\n\n' + childBlocks.join('\n\n');
  }

  return result;
}

function serializeListItem(node: SemanticNode, ctx: SerializeContext): string {
  if (node.syntax.kind !== 'list-item') return node.content.text;
  const { ordered, checked, depth } = node.syntax;

  // Build the marker
  let marker: string;
  if (ordered) {
    // For ordered lists, use sequential numbering (recomputed by position)
    marker = '1.';
  } else if (checked !== undefined) {
    marker = '-';
  } else {
    marker = '-';
  }

  const indent = '  '.repeat(depth - 1);
  let line = `${indent}${marker} `;

  // Task list checkbox
  if (checked !== undefined) {
    line += `[${checked === true ? 'x' : ' '}] `;
  }

  // Own content
  line += serializeInline(node.content.inline, node.content.text);

  // Children
  const childCtx: SerializeContext = { ...ctx };
  const childBlocks = node.children.map(child => serializeNode(child, childCtx));
  if (childBlocks.length > 0) {
    line += '\n' + childBlocks.join('\n\n');
  }

  return line;
}

function serializeQuote(node: SemanticNode, ctx: SerializeContext): string {
  const ownContent = serializeInline(node.content.inline, node.content.text);
  const childBlocks = node.children.map(child => serializeNode(child, ctx));

  const allBlocks = [ownContent, ...childBlocks].filter(b => b.length > 0);
  // Prefix each line with "> "
  return allBlocks
    .join('\n\n')
    .split('\n')
    .map(line => line.length > 0 ? `> ${line}` : '>')
    .join('\n');
}

function serializeParagraph(node: SemanticNode, _ctx: SerializeContext): string {
  return serializeInline(node.content.inline, node.content.text);
}

function serializeCode(node: SemanticNode, _ctx: SerializeContext): string {
  if (node.syntax.kind !== 'code') return node.content.raw;
  const { fenceChar, fenceLength, lang, meta } = node.syntax;
  const fence = (fenceChar ?? '`').repeat(Math.max(fenceLength || 3, 3));
  const langPart = lang || '';
  const metaPart = meta ? ` ${meta}` : '';
  return `${fence}${langPart}${metaPart}\n${node.content.text}\n${fence}`;
}

function serializeTable(node: SemanticNode, _ctx: SerializeContext): string {
  if (node.syntax.kind !== 'table') return node.content.raw;
  const { columns, align } = node.syntax;
  // Parse the raw table back if available, otherwise use the summary
  if (node.content.raw && node.content.raw.includes('|')) {
    return node.content.raw;
  }
  // Fallback: generate a minimal table
  const headers = Array.from({ length: columns }, (_, i) => `Col ${i + 1}`);
  const headerRow = `| ${headers.join(' | ')} |`;
  const alignRow = `| ${align.map(a => {
    if (a === 'left') return ':---';
    if (a === 'right') return '---:';
    if (a === 'center') return ':---:';
    return '---';
  }).join(' | ')} |`;
  return `${headerRow}\n${alignRow}`;
}

function serializeImage(node: SemanticNode, _ctx: SerializeContext): string {
  if (node.syntax.kind === 'image') {
    const { src, alt, title } = node.syntax;
    return `![${alt}](${src}${title ? ` "${title}"` : ''})`;
  }
  return node.content.raw;
}

function serializeHtml(node: SemanticNode, _ctx: SerializeContext): string {
  return node.content.raw;
}

function serializeMetadata(node: SemanticNode, _ctx: SerializeContext): string {
  // Prefer the exact original source (includes delimiters) for lossless round-trip
  if (node.source?.raw) return node.source.raw;
  if (node.syntax.kind === 'metadata') {
    const { format } = node.syntax;
    const delim = format === 'yaml' ? '---' : format === 'toml' ? '+++' : ';;;';
    return `${delim}\n${node.content.raw}\n${delim}`;
  }
  return node.content.raw;
}

function serializeFootnote(node: SemanticNode, _ctx: SerializeContext): string {
  // The footnote node is the single source of truth for a footnote definition
  // (spec 001 §12). Serialize the preserved raw source so multi-paragraph and
  // nested footnote content round-trips losslessly. Never reconstruct from the
  // display identifier — that would duplicate or corrupt the definition.
  if (node.syntax.kind === 'footnote') {
    if (node.source && node.source.raw) {
      return node.source.raw;
    }
    const { identifier } = node.syntax;
    return `[^${identifier}]: ${node.content.text}`;
  }
  return node.content.raw;
}

function serializeCallout(node: SemanticNode, ctx: SerializeContext): string {
  // Basic callout serialization
  const ownContent = serializeInline(node.content.inline, node.content.text);
  const childBlocks = node.children.map(child => serializeNode(child, ctx));
  const allBlocks = [ownContent, ...childBlocks].filter(b => b.length > 0);
  return allBlocks.join('\n\n');
}

function serializeMath(node: SemanticNode, _ctx: SerializeContext): string {
  // Prefer the exact original source for lossless round-trip
  if (node.source?.raw) return node.source.raw;
  // Math blocks are parsed from fenced code with math langs (spec 001 §18.4).
  // Serialize back as a fenced code block so re-parsing produces the same node.
  return `\`\`\`math\n${node.content.text}\n\`\`\``;
}

function serializeDiagram(node: SemanticNode, _ctx: SerializeContext): string {
  // Prefer the exact original source for lossless round-trip
  if (node.source?.raw) return node.source.raw;
  const engine = node.syntax.kind === 'diagram' ? node.syntax.engine : 'mermaid';
  return `\`\`\`${engine}\n${node.content.text}\n\`\`\``;
}

function serializeDefinitionItem(node: SemanticNode, ctx: SerializeContext): string {
  const ownContent = serializeInline(node.content.inline, node.content.text);
  const childBlocks = node.children.map(child => serializeNode(child, ctx));
  const parts = [ownContent, ...childBlocks].filter(b => b.length > 0);
  return parts.join('\n\n');
}

function serializeUnknown(node: SemanticNode, _ctx: SerializeContext): string {
  // Preserve the original raw source for unknown/extension nodes (spec 001 §16)
  return node.content.raw || node.content.text;
}

// ─────────────────────────────────────────────────────────────────────────
// Root serialization
// ─────────────────────────────────────────────────────────────────────────

/**
 * Serialize a SemanticRoot back to Markdown source.
 *
 * The serializer reconstructs the document by interleaving three kinds of
 * top-level source items in their original source order (spec 001 §12, §18.1,
 * §22):
 *   1. Semantic child nodes (headings, paragraphs, footnote nodes, …)
 *   2. Fidelity items (thematic breaks) — non-node blocks that must round-trip
 *   3. Link definitions — document-level metadata serialized at their position
 *
 * Footnote definitions are serialized from their footnote node (the single
 * source of truth, spec 001 §12), never from a separate append, so the same
 * definition is never emitted twice.
 */
/**
 * Serialize a semantic tree back to Markdown.
 *
 * `order` controls how top-level items are laid out (spec 001 §12, §18.1, §22):
 *   - `'source'` (default): interleave nodes, fidelity items and link
 *     definitions by their original source offset — used for lossless
 *     round-trips of unedited documents.
 *   - `'tree'`: serialize nodes in semantic children order, then append
 *     fidelity items and link definitions — used by structural operations
 *     (move/reorder/convert) where the candidate tree's children order has
 *     diverged from the original source offsets. Fidelity items and link
 *     definitions are preserved (content-wise) even though their position
 *     may shift; spec 001 §15.2 allows whitespace/position changes.
 */
export function serializeMarkdown(root: SemanticRoot, order: 'source' | 'tree' = 'source'): string {
  const ctx: SerializeContext = { indent: '' };

  if (order === 'tree') {
    const parts: string[] = [];
    for (const child of root.children) {
      const serialized = serializeNode(child, ctx);
      if (serialized) parts.push(serialized);
    }
    for (const item of root.fidelityItems) {
      if (item.source) parts.push(item.source.raw);
    }
    for (const def of root.linkDefinitions) {
      if (def.source) parts.push(def.source.raw);
    }
    return parts.join('\n\n');
  }

  interface OrderedItem {
    offset: number;
    text: string;
  }
  const items: OrderedItem[] = [];

  // 1. Child nodes (includes footnote definition nodes).
  for (const child of root.children) {
    const serialized = serializeNode(child, ctx);
    if (!serialized) continue;
    // Nodes without a source anchor (e.g. newly added via operations) are
    // placed after all source-anchored items.
    const offset = child.source?.start.offset ?? Number.MAX_SAFE_INTEGER;
    items.push({ offset, text: serialized });
  }

  // 2. Fidelity items (thematic breaks) — preserved at their source position.
  for (const item of root.fidelityItems) {
    if (item.source) {
      items.push({ offset: item.source.start.offset, text: item.source.raw });
    }
  }

  // 3. Link definitions — document-level metadata, serialized at their
  //    original source position for lossless round-trips (spec 001 §12).
  for (const def of root.linkDefinitions) {
    if (def.source) {
      items.push({ offset: def.source.start.offset, text: def.source.raw });
    }
  }

  // Restore original document order by source offset.
  items.sort((a, b) => a.offset - b.offset);

  return items.map(i => i.text).join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Round-trip verification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if two semantic trees are semantically equivalent (spec 001 §25.2).
 *
 * Compares structure, types, content (text + inline), and syntax — not runtime
 * IDs or source ranges. Inline comparison ensures URLs, identifiers and
 * reference types are not silently lost (spec 001 §15.1).
 */
export function treesAreEquivalent(a: SemanticNode, b: SemanticNode): boolean {
  if (a.type !== b.type) return false;
  if (a.role !== b.role) return false;
  if (a.content.text !== b.content.text) return false;
  if (!inlineNodesEqual(a.content.inline, b.content.inline)) return false;
  if (!syntaxEquals(a.syntax, b.syntax)) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!treesAreEquivalent(a.children[i], b.children[i])) return false;
  }
  return true;
}

/** Compare two inline node arrays for semantic equality (URLs, identifiers, etc.). */
function inlineNodesEqual(a: ReadonlyArray<InlineNode> | null, b: ReadonlyArray<InlineNode> | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) {
    // One is null (plain text) and the other is non-null. They are equal only
    // if the non-null one is effectively plain text (all text nodes).
    const nonNull = a ?? b;
    return nonNull!.every(n => n.type === 'text') && nonNull!.map(n => (n as { type: 'text'; value: string }).value).join('') === (a ? (b ?? a)?.map(n => n.type === 'text' ? n.value : '').join('') : (a ?? b)!.map(n => n.type === 'text' ? n.value : '').join(''));
  }
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!inlineNodeEquals(a[i], b[i])) return false;
  }
  return true;
}

function inlineNodeEquals(a: InlineNode, b: InlineNode): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'text':
      return a.value === (b as typeof a).value;
    case 'strong':
    case 'emphasis':
    case 'delete':
      return inlineNodesEqual(a.children, (b as typeof a).children);
    case 'inlineCode':
      return a.value === (b as typeof a).value;
    case 'link':
      return a.url === (b as typeof a).url && (a.title ?? null) === (b as typeof a).title && inlineNodesEqual(a.children, (b as typeof a).children);
    case 'linkReference':
      return a.identifier === (b as typeof a).identifier && a.referenceType === (b as typeof a).referenceType && inlineNodesEqual(a.children, (b as typeof a).children);
    case 'image':
      return a.url === (b as typeof a).url && a.alt === (b as typeof a).alt && (a.title ?? null) === (b as typeof a).title;
    case 'imageReference':
      return a.identifier === (b as typeof a).identifier && a.referenceType === (b as typeof a).referenceType && a.alt === (b as typeof a).alt;
    case 'break':
      return true;
    case 'html':
      return a.value === (b as typeof a).value;
    case 'footnoteReference':
      return a.identifier === (b as typeof a).identifier;
    case 'raw':
      return a.value === (b as typeof a).value;
    default:
      return false;
  }
}

function syntaxEquals(a: any, b: any): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind;
  // For heading: compare level and variant (atx vs setext matters for fidelity)
  if (a.kind === 'heading' && b.kind === 'heading') {
    return a.level === b.level && a.variant === b.variant;
  }
  // For list-item: compare ordered, checked, marker and depth
  if (a.kind === 'list-item' && b.kind === 'list-item') {
    return a.ordered === b.ordered && a.checked === b.checked && a.marker === b.marker && a.depth === b.depth;
  }
  // For code: compare lang, fenceChar and fenceLength
  if (a.kind === 'code' && b.kind === 'code') {
    return a.lang === b.lang && a.fenceChar === b.fenceChar && a.fenceLength === b.fenceLength;
  }
  // For others: compare raw text representation
  return JSON.stringify(a) === JSON.stringify(b);
}
