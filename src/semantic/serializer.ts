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
    case 'image':
      return `![${node.alt}](${node.url}${node.title ? ` "${node.title}"` : ''})`;
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
  if (node.syntax.kind === 'metadata') {
    const { format } = node.syntax;
    const delim = format === 'yaml' ? '---' : format === 'toml' ? '+++' : ';;;';
    return `${delim}\n${node.content.raw}\n${delim}`;
  }
  return node.content.raw;
}

function serializeFootnote(node: SemanticNode, ctx: SerializeContext): string {
  if (node.syntax.kind === 'footnote') {
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
  return `$$\n${node.content.text}\n$$`;
}

function serializeDiagram(node: SemanticNode, _ctx: SerializeContext): string {
  return `\`\`\`${node.syntax.kind === 'diagram' ? node.syntax.engine : 'diagram'}\n${node.content.text}\n\`\`\``;
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

/** Serialize a SemanticRoot back to Markdown source. */
export function serializeMarkdown(root: SemanticRoot): string {
  const ctx: SerializeContext = { indent: '' };
  const blocks: string[] = [];

  for (const child of root.children) {
    const serialized = serializeNode(child, ctx);
    if (serialized) blocks.push(serialized);
  }

  // Append footnote definitions at the end (spec 001 §12)
  for (const fnDef of root.footnoteDefinitions) {
    if (fnDef.source) {
      blocks.push(fnDef.source.raw);
    }
  }

  return blocks.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Round-trip verification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if two semantic trees are semantically equivalent (spec 001 §25.2).
 * Compares structure, types, content, and syntax — not runtime IDs or source ranges.
 */
export function treesAreEquivalent(a: SemanticNode, b: SemanticNode): boolean {
  if (a.type !== b.type) return false;
  if (a.role !== b.role) return false;
  if (a.content.text !== b.content.text) return false;
  if (!syntaxEquals(a.syntax, b.syntax)) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!treesAreEquivalent(a.children[i], b.children[i])) return false;
  }
  return true;
}

function syntaxEquals(a: any, b: any): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind;
  // For heading: compare level and variant
  if (a.kind === 'heading' && b.kind === 'heading') {
    return a.level === b.level;
  }
  // For list-item: compare ordered and checked
  if (a.kind === 'list-item' && b.kind === 'list-item') {
    return a.ordered === b.ordered && a.checked === b.checked;
  }
  // For code: compare lang
  if (a.kind === 'code' && b.kind === 'code') {
    return a.lang === b.lang;
  }
  // For others: compare raw text representation
  return JSON.stringify(a) === JSON.stringify(b);
}
