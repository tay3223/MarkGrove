/**
 * Deterministic Markdown → SemanticTree parser (spec 001 §20).
 *
 * Algorithm (four steps):
 *   1. Parse and preserve: produce mdast with positions, record raw slices
 *   2. Section attribution: heading stack determines parent
 *   3. Container recursion: lists/quotes/callouts recurse locally
 *   4. Display projection: (separate module, does not modify semantic tree)
 *
 * Key rules:
 *   - Structure syntax (headings, lists, quotes) creates nodes and determines hierarchy
 *   - Block content syntax creates leaf nodes, parent from context
 *   - Inline syntax stays in node content, never creates nodes
 *   - "First content promotion" for containers (§3.1)
 *   - Unknown extensions preserved as-is (§16, §18.4)
 *   - Setext headings distinguished from thematic breaks (§20.2)
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { Code, Heading, Image, Paragraph, Table, Html, YAML, FootnoteDefinition, List, ListItem, Blockquote } from 'mdast';
import type {
  SemanticNode,
  SemanticRoot,
  SemanticType,
  NodeRole,
  NodeContent,
  SyntaxMetadata,
  SourceRange,
  SourcePoint,
  InlineNode,
  LinkDefinition,
  FootnoteDefinition as SemFootnoteDef,
  ParseResult,
  ParseWarning,
  NodeCapabilities,
  ListItemSyntax,
} from './types';
import {
  generateRuntimeId,
  computeSemanticKey,
  getCapabilities,
  OccurrenceCounter,
} from './identity';
import { isExtension, getExtension } from './extensions';

// ─────────────────────────────────────────────────────────────────────────
// Source utilities
// ─────────────────────────────────────────────────────────────────────────

/** Pre-compute character offsets for each line start (1-based line → offset). */
function computeLineOffsets(source: string): number[] {
  const offsets = [0, 0]; // line 0 unused, line 1 starts at offset 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/** Convert a mdast position (1-based line/column) to a SourcePoint with offset. */
function toSourcePoint(
  pos: { line: number; column: number; offset?: number },
  lineOffsets: number[],
  source: string,
): SourcePoint {
  const offset = pos.offset ?? (pos.line < lineOffsets.length ? lineOffsets[pos.line] + pos.column - 1 : source.length);
  return { offset, line: pos.line, column: pos.column };
}

/** Extract the raw source text for a given mdast position range. */
function extractRaw(source: string, start: SourcePoint, end: SourcePoint): string {
  return source.slice(start.offset, end.offset);
}

/** Extract leading whitespace (blank lines before this block). */
function extractLeadingWhitespace(source: string, startOffset: number, prevEndOffset: number): string {
  if (prevEndOffset < 0 || startOffset <= prevEndOffset) return '';
  return source.slice(prevEndOffset, startOffset);
}

/** Extract trailing whitespace (blank lines after this block). */
function extractTrailingWhitespace(source: string, endOffset: number, nextStartOffset: number | null): string {
  if (nextStartOffset === null || nextStartOffset <= endOffset) return '';
  return source.slice(endOffset, nextStartOffset);
}

/** Build a SourceRange from mdast position and surrounding context. */
function buildSourceRange(
  mdastNode: { position?: { start: { line: number; column: number; offset?: number }; end: { line: number; column: number; offset?: number } } },
  source: string,
  lineOffsets: number[],
  prevEndOffset: number,
  nextStartOffset: number | null,
): SourceRange | null {
  if (!mdastNode.position) return null;
  const start = toSourcePoint(mdastNode.position.start, lineOffsets, source);
  const end = toSourcePoint(mdastNode.position.end, lineOffsets, source);
  return {
    start,
    end,
    raw: extractRaw(source, start, end),
    leadingWhitespace: extractLeadingWhitespace(source, start.offset, prevEndOffset),
    trailingWhitespace: extractTrailingWhitespace(source, end.offset, nextStartOffset),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Inline node extraction (preserves all inline syntax)
// ─────────────────────────────────────────────────────────────────────────

function extractInlineNodes(mdastInline: ReadonlyArray<any> | undefined): InlineNode[] {
  if (!mdastInline || mdastInline.length === 0) return [];
  const result: InlineNode[] = [];

  for (const node of mdastInline) {
    switch (node.type) {
      case 'text':
        result.push({ type: 'text', value: node.value });
        break;
      case 'strong':
        result.push({ type: 'strong', children: extractInlineNodes(node.children) });
        break;
      case 'emphasis':
        result.push({ type: 'emphasis', children: extractInlineNodes(node.children) });
        break;
      case 'delete':
        result.push({ type: 'delete', children: extractInlineNodes(node.children) });
        break;
      case 'inlineCode':
        result.push({ type: 'inlineCode', value: node.value });
        break;
      case 'link':
        result.push({
          type: 'link',
          url: node.url || '',
          title: node.title ?? null,
          children: extractInlineNodes(node.children),
        });
        break;
      case 'linkReference':
        // Preserve reference link semantics (spec 001 §18.2): keep identifier,
        // label and referenceType so the serializer can emit the original form
        // instead of downgrading to an inline link with an empty URL.
        result.push({
          type: 'linkReference',
          identifier: node.identifier || '',
          label: node.label ?? null,
          referenceType: (node.referenceType as 'full' | 'collapsed' | 'shortcut') ?? 'full',
          children: extractInlineNodes(node.children),
        });
        break;
      case 'image':
        result.push({
          type: 'image',
          url: node.url || '',
          alt: node.alt || '',
          title: node.title ?? null,
        });
        break;
      case 'imageReference':
        result.push({
          type: 'imageReference',
          identifier: node.identifier || '',
          label: node.label ?? null,
          referenceType: (node.referenceType as 'full' | 'collapsed' | 'shortcut') ?? 'full',
          alt: node.alt || '',
        });
        break;
      case 'break':
        result.push({ type: 'break' });
        break;
      case 'html':
        result.push({ type: 'html', value: node.value });
        break;
      case 'footnoteReference':
        result.push({ type: 'footnoteReference', identifier: node.identifier || '' });
        break;
      default:
        // Preserve unknown inline nodes as raw
        result.push({ type: 'raw', value: JSON.stringify(node) });
        break;
    }
  }

  return result;
}

/** Check if inline nodes contain any non-text nodes (rich inline content). */
function hasRichInline(nodes: ReadonlyArray<InlineNode> | null): boolean {
  if (!nodes || nodes.length === 0) return false;
  return nodes.some(n => n.type !== 'text');
}

/** Extract plain text from an mdast node (for display/ID purposes). */
function extractText(mdastNode: any): string {
  if (!mdastNode) return '';
  if (mdastNode.type === 'text') return mdastNode.value;
  if (mdastNode.type === 'inlineCode') return mdastNode.value;
  if (mdastNode.children) {
    return mdastNode.children.map(extractText).join('');
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────
// Content builder
// ─────────────────────────────────────────────────────────────────────────

function buildContent(
  text: string,
  mdastNode: any,
  source: string,
  lineOffsets: number[],
): NodeContent {
  const inlineNodes = extractInlineNodes(mdastNode.children ?? mdastNode.value);
  // Set inline to null for pure-text content (optimization), preserve rich inline
  const inline = hasRichInline(inlineNodes) ? inlineNodes : null;
  let raw = text;
  if (mdastNode.position) {
    const start = toSourcePoint(mdastNode.position.start, lineOffsets, source);
    const end = toSourcePoint(mdastNode.position.end, lineOffsets, source);
    raw = source.slice(start.offset, end.offset);
  }
  return { text, inline, raw };
}

// ─────────────────────────────────────────────────────────────────────────
// Node factory
// ─────────────────────────────────────────────────────────────────────────

interface ParseContext {
  source: string;
  lineOffsets: number[];
  occurrence: OccurrenceCounter;
  warnings: ParseWarning[];
}

function createNode(
  ctx: ParseContext,
  type: SemanticType,
  role: NodeRole,
  content: NodeContent,
  syntax: SyntaxMetadata,
  source: SourceRange | null,
  ancestorKey: string,
  depth: number,
  children: SemanticNode[] = [],
): SemanticNode {
  const occurrence = ctx.occurrence.next(ancestorKey, type, content.text);
  const semanticKey = computeSemanticKey(type, content.text, ancestorKey, occurrence);
  const capabilities: NodeCapabilities = getCapabilities(type);
  return {
    id: generateRuntimeId(),
    semanticKey,
    type,
    role,
    content,
    syntax,
    children,
    source,
    capabilities,
    depth,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main parser entry point
// ─────────────────────────────────────────────────────────────────────────

/** Parse a Markdown string into a SemanticRoot tree. */
export function parseMarkdown(source: string, fileName: string): ParseResult {
  const ast = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, [
      'yaml',
      'toml',
      // JSON front matter uses `;;;` fences (spec 001 §18.4: YAML/TOML/JSON).
      // remark-frontmatter has no `json` preset, so we register a custom matter.
      { type: 'json', fence: ';;;' },
    ])
    .use(remarkGfm)
    .parse(source);

  const lineOffsets = computeLineOffsets(source);
  const ctx: ParseContext = {
    source,
    lineOffsets,
    occurrence: new OccurrenceCounter(),
    warnings: [],
  };

  // Collect document-level metadata: link definitions and footnote definitions
  const linkDefs: LinkDefinition[] = [];
  const footnoteDefs: SemFootnoteDef[] = [];
  const topLevelBlocks = ast.children as any[];

  // Pre-scan for definitions (spec 001 §12: link defs are document-level)
  for (const block of topLevelBlocks) {
    if (block.type === 'definition') {
      const src = buildSourceRange(block, source, lineOffsets, 0, null);
      linkDefs.push({
        identifier: block.identifier,
        url: block.url,
        title: block.title ?? null,
        source: src,
      });
    } else if (block.type === 'footnoteDefinition') {
      const src = buildSourceRange(block, source, lineOffsets, 0, null);
      footnoteDefs.push({
        identifier: block.identifier,
        content: extractText(block),
        source: src,
      });
    }
  }

  // Build the semantic root
  const baseName = fileName.replace(/\.(md|markdown|mdown|mkd)$/i, '');
  const rootContent: NodeContent = {
    text: baseName,
    inline: null,
    raw: baseName,
  };

  const root: SemanticRoot = {
    id: generateRuntimeId(),
    semanticKey: computeSemanticKey('root', baseName, '', 0),
    type: 'root',
    role: 'document-root',
    content: rootContent,
    syntax: { kind: 'none' },
    children: [],
    source: null,
    capabilities: getCapabilities('root'),
    depth: 0,
    fileName: baseName,
    linkDefinitions: linkDefs,
    footnoteDefinitions: footnoteDefs,
    fidelityItems: [],
  };

  // Process top-level blocks
  buildTopLevelBlocks(ctx, topLevelBlocks, root, source, lineOffsets);

  return { root, warnings: ctx.warnings };
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level block processing (spec 001 §20 step 2: section attribution)
// ─────────────────────────────────────────────────────────────────────────

function buildTopLevelBlocks(
  ctx: ParseContext,
  blocks: any[],
  root: SemanticRoot,
  source: string,
  lineOffsets: number[],
): void {
  // Heading stack for section attribution (spec 001 §20 step 2)
  const headingStack: Array<{ level: number; node: SemanticNode }> = [];

  /** Get the ancestor key from the current heading stack + root. */
  function ancestorKey(): string {
    if (headingStack.length === 0) return root.semanticKey;
    return headingStack[headingStack.length - 1].node.semanticKey;
  }

  /** Current parent for non-heading blocks. */
  function currentParent(): SemanticNode {
    if (headingStack.length > 0) {
      return headingStack[headingStack.length - 1].node;
    }
    return root;
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const prevBlock = i > 0 ? blocks[i - 1] : null;
    const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : null;

    const prevEndOffset = prevBlock?.position?.end?.offset ?? 0;
    const nextStartOffset = nextBlock?.position?.start?.offset ?? null;
    const srcRange = buildSourceRange(block, source, lineOffsets, prevEndOffset, nextStartOffset);

    switch (block.type) {
      case 'heading':
        processHeading(ctx, block, headingStack, root, srcRange, source, lineOffsets);
        break;
      case 'list':
        processList(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'blockquote':
        processBlockquote(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'paragraph':
        processParagraph(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'code':
        processCode(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'table':
        processTable(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'html':
        processHtml(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'yaml':
        processFrontmatter(ctx, block, root, srcRange, source, lineOffsets, 'yaml');
        break;
      case 'toml':
        processFrontmatter(ctx, block, root, srcRange, source, lineOffsets, 'toml');
        break;
      case 'json':
        processFrontmatter(ctx, block, root, srcRange, source, lineOffsets, 'json');
        break;
      case 'footnoteDefinition':
        processFootnoteDef(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
      case 'thematicBreak':
        // Spec 001 §12, §18.1: thematic breaks don't create nodes, but must
        // enter the fidelity layer anchored in source order for lossless
        // round-trips. Dropping them silently corrupts the document.
        if (srcRange) {
          root.fidelityItems.push({ kind: 'thematic-break', source: srcRange });
        }
        break;
      case 'definition':
        // Already collected as document-level metadata
        break;
      default:
        // Unknown extension: preserve as-is (spec 001 §16, §18.4)
        processUnknown(ctx, block, currentParent(), ancestorKey(), srcRange, source, lineOffsets);
        break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Heading processing (spec 001 §5)
// ─────────────────────────────────────────────────────────────────────────

function processHeading(
  ctx: ParseContext,
  block: Heading,
  headingStack: Array<{ level: number; node: SemanticNode }>,
  root: SemanticRoot,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const text = extractText(block);
  const level = block.depth as 1 | 2 | 3 | 4 | 5 | 6;

  // Pop headings of equal or deeper level (spec 001 §20 step 2.1)
  while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
    headingStack.pop();
  }

  // Parent is stack top, or root if empty
  const parent = headingStack.length > 0
    ? headingStack[headingStack.length - 1].node
    : root;

  // Determine variant: setext headings have a underline child or are detected
  // by remark-parse as heading with depth 1 or 2 when source has === or ---
  const variant: 'atx' | 'setext' = detectHeadingVariant(block, source, lineOffsets);

  const content = buildContent(text, block, source, lineOffsets);
  const syntax: SyntaxMetadata = { kind: 'heading', level, variant };

  const ancestorKey = headingStack.length > 0
    ? headingStack[headingStack.length - 1].node.semanticKey
    : root.semanticKey;

  const node = createNode(
    ctx,
    'heading',
    'section-container',
    content,
    syntax,
    srcRange,
    ancestorKey,
    parent.depth + 1,
  );

  parent.children.push(node);
  headingStack.push({ level, node });
}

/** Detect whether a heading is ATX (#) or Setext (===/--- underline). */
function detectHeadingVariant(block: Heading, source: string, lineOffsets: number[]): 'atx' | 'setext' {
  if (!block.position) return 'atx';
  const startLine = block.position.start.line;
  if (startLine >= lineOffsets.length) return 'atx';
  const lineStart = lineOffsets[startLine];
  const lineEnd = startLine + 1 < lineOffsets.length ? lineOffsets[startLine + 1] - 1 : source.length;
  const firstLine = source.slice(lineStart, lineEnd);
  // ATX headings start with #
  if (/^#{1,6}\s/.test(firstLine)) return 'atx';
  // Setext headings: the heading spans 2 lines where the 2nd is === or ---
  if (block.position.end.line > startLine) {
    return 'setext';
  }
  return 'atx';
}

// ─────────────────────────────────────────────────────────────────────────
// Container children builder with local heading stack (spec 001 §20 step 3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract the first paragraph from a list of blocks as promoted content
 * (spec 001 §3.1). Returns null if no paragraph is found.
 */
function extractPromotedContent(
  blocks: any[],
  source: string,
  lineOffsets: number[],
): NodeContent | null {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      return buildContent(extractText(block), block, source, lineOffsets);
    }
  }
  return null;
}

/**
 * Build children for a container (list-item, quote, callout) using a local
 * heading stack (spec 001 §20 step 3, §20.1 rule 3).
 *
 * Headings inside a container establish a local section hierarchy scoped to
 * that container. When the container is left, the outer heading stack is
 * restored — container headings never pollute the document's global section
 * attribution.
 *
 * If `skipFirstParagraph` is true, the first paragraph encountered is skipped
 * (it was already promoted as the container's own content per spec 001 §3.1).
 *
 * `listNestingDepth` is the nesting depth to use for lists directly inside
 * this container (1 = top-level list, regardless of the container's tree
 * depth). Nested lists inside list-items increment this by 1.
 */
function buildContainerChildren(
  ctx: ParseContext,
  blocks: any[],
  container: SemanticNode,
  source: string,
  lineOffsets: number[],
  skipFirstParagraph: boolean,
  listNestingDepth: number,
): void {
  let promotedParagraphSkipped = !skipFirstParagraph;

  // Local heading stack (spec 001 §20 step 3, §20.1 rule 3)
  const localHeadingStack: Array<{ level: number; node: SemanticNode }> = [];

  const localAncestorKey = (): string => {
    if (localHeadingStack.length === 0) return container.semanticKey;
    return localHeadingStack[localHeadingStack.length - 1].node.semanticKey;
  };

  const localParent = (): SemanticNode => {
    if (localHeadingStack.length > 0) {
      return localHeadingStack[localHeadingStack.length - 1].node;
    }
    return container;
  };

  for (let i = 0; i < blocks.length; i++) {
    const sub = blocks[i];
    const prevSub = i > 0 ? blocks[i - 1] : null;
    const nextSub = i < blocks.length - 1 ? blocks[i + 1] : null;
    const prevEndOffset = prevSub?.position?.end?.offset ?? 0;
    const nextStartOffset = nextSub?.position?.start?.offset ?? null;
    const subSrc = buildSourceRange(sub, source, lineOffsets, prevEndOffset, nextStartOffset);

    if (sub.type === 'paragraph' && !promotedParagraphSkipped) {
      // Skip the promoted paragraph (already used as container content)
      promotedParagraphSkipped = true;
      continue;
    }

    switch (sub.type) {
      case 'heading': {
        const level = sub.depth as 1 | 2 | 3 | 4 | 5 | 6;
        // Pop headings of equal or deeper level (local scope)
        while (
          localHeadingStack.length > 0 &&
          localHeadingStack[localHeadingStack.length - 1].level >= level
        ) {
          localHeadingStack.pop();
        }
        const parent = localParent();
        const headingNode = makeHeadingNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(headingNode);
        localHeadingStack.push({ level, node: headingNode });
        break;
      }
      case 'list': {
        const parent = localParent();
        for (const item of sub.children) {
          if (item.type !== 'listItem') continue;
          const itemNode = processListItem(
            ctx, item, sub, localAncestorKey(), parent.depth + 1, listNestingDepth, source, lineOffsets,
          );
          if (itemNode) parent.children.push(itemNode);
        }
        break;
      }
      case 'blockquote': {
        const parent = localParent();
        const quoteNode = makeBlockquoteNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(quoteNode);
        break;
      }
      case 'code': {
        const parent = localParent();
        const codeNode = makeCodeOrExtensionNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(codeNode);
        break;
      }
      case 'table': {
        const parent = localParent();
        const tableNode = makeTableNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(tableNode);
        break;
      }
      case 'html': {
        const parent = localParent();
        const htmlNode = makeHtmlNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(htmlNode);
        break;
      }
      case 'paragraph': {
        const parent = localParent();
        const paraNode = makeParagraphNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(paraNode);
        break;
      }
      default: {
        const parent = localParent();
        const unknownNode = makeUnknownNode(
          ctx, sub, localAncestorKey(), subSrc, source, lineOffsets, parent.depth + 1,
        );
        parent.children.push(unknownNode);
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// List processing (spec 001 §6)
// ─────────────────────────────────────────────────────────────────────────

function processList(
  ctx: ParseContext,
  block: List,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  // Tree (display) depth = parent.depth + 1 — derives from the parent, never
  // a fixed constant (spec 001 §19, §26: `node.depth` is display depth).
  // List nesting depth = 1 for a top-level list block. Nested lists are
  // handled recursively: buildContainerChildren receives listNestingDepth + 1,
  // so each level of indentation increments `syntax.depth` exactly once.
  // These two depths are distinct (§19): display depth vs list nesting depth
  // vs heading level never share a constant.
  const treeDepth = parent.depth + 1;
  const listNestingDepth = 1;
  for (const item of block.children) {
    if (item.type !== 'listItem') continue;
    const itemNode = processListItem(
      ctx, item, block, ancestorKey, treeDepth, listNestingDepth, source, lineOffsets,
    );
    if (itemNode) parent.children.push(itemNode);
  }
}

function processListItem(
  ctx: ParseContext,
  item: ListItem,
  list: List,
  ancestorKey: string,
  treeDepth: number,
  listNestingDepth: number,
  source: string,
  lineOffsets: number[],
): SemanticNode | null {
  // Determine list item syntax
  const ordered = list.ordered ?? false;
  const start = list.start ?? 1;
  const marker: ListItemSyntax['marker'] = ordered ? 'ordered' : '-';

  // Check for task list checkbox (GFM)
  let checked: boolean | 'unchecked' | undefined;
  if (item.checked === true) checked = true;
  else if (item.checked === false) checked = 'unchecked';

  const itemChildren = item.children as any[];

  // Extract promoted content (first paragraph) before creating the node,
  // so the semanticKey is computed from the real content (spec 001 §3.1, §21)
  const hasFirstParagraph = itemChildren.some((b: any) => b.type === 'paragraph');
  const promotedContent = hasFirstParagraph
    ? extractPromotedContent(itemChildren, source, lineOffsets)
    : null;
  const effectiveContent: NodeContent = promotedContent ?? { text: '', inline: null, raw: '' };

  // Build source range for this list item
  const itemSrcRange = buildSourceRange(item, source, lineOffsets, 0, null);

  const syntax: SyntaxMetadata = {
    kind: 'list-item',
    marker,
    ordered,
    start: ordered ? start : undefined,
    checked,
    depth: listNestingDepth, // list nesting depth (1 = top-level)
  };

  // Create the list-item node first (consumes occurrence, computes semanticKey)
  const itemNode = createNode(
    ctx,
    'list-item',
    'block-container',
    effectiveContent,
    syntax,
    itemSrcRange,
    ancestorKey,
    treeDepth,
    [],
  );

  // Build children using local heading stack (spec 001 §20 step 3).
  // Nested lists inside this item get listNestingDepth + 1.
  buildContainerChildren(
    ctx, itemChildren, itemNode, source, lineOffsets, hasFirstParagraph, listNestingDepth + 1,
  );

  return itemNode;
}

// ─────────────────────────────────────────────────────────────────────────
// Blockquote processing (spec 001 §8)
// ─────────────────────────────────────────────────────────────────────────

function processBlockquote(
  ctx: ParseContext,
  block: Blockquote,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const quoteNode = makeBlockquoteNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
  parent.children.push(quoteNode);
}

function makeBlockquoteNode(
  ctx: ParseContext,
  block: Blockquote,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const blockChildren = block.children as any[];

  // Extract promoted content (first paragraph) before creating the node,
  // so the semanticKey is computed from the real content (spec 001 §3.1, §21)
  const hasFirstParagraph = blockChildren.some((b: any) => b.type === 'paragraph');
  const promotedContent = hasFirstParagraph
    ? extractPromotedContent(blockChildren, source, lineOffsets)
    : null;
  const effectiveContent: NodeContent = promotedContent ?? { text: '引用', inline: null, raw: '' };

  // Create the quote node first (consumes occurrence, computes semanticKey)
  const quoteNode = createNode(
    ctx,
    'quote',
    'block-container',
    effectiveContent,
    { kind: 'none' },
    srcRange,
    ancestorKey,
    depth,
    [],
  );

  // Build children using local heading stack (spec 001 §20 step 3).
  // Lists inside a quote are top-level (nesting depth 1).
  buildContainerChildren(
    ctx, blockChildren, quoteNode, source, lineOffsets, hasFirstParagraph, 1,
  );

  return quoteNode;
}

// ─────────────────────────────────────────────────────────────────────────
// Paragraph processing (spec 001 §7)
// ─────────────────────────────────────────────────────────────────────────

function processParagraph(
  ctx: ParseContext,
  block: Paragraph,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  // Check for standalone image (spec 001 §11.1)
  const inline = block.children as any[];
  const nonWhitespaceChildren = inline.filter(
    c => c.type !== 'text' || c.value.trim() !== '',
  );

  if (nonWhitespaceChildren.length === 1 && nonWhitespaceChildren[0].type === 'image') {
    // Standalone image: create image node
    const imgNode = makeImageNode(ctx, nonWhitespaceChildren[0], ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
    parent.children.push(imgNode);
    return;
  }

  const paraNode = makeParagraphNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
  parent.children.push(paraNode);
}

function makeParagraphNode(
  ctx: ParseContext,
  block: any,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const text = extractText(block);
  const content = buildContent(text, block, source, lineOffsets);
  return createNode(
    ctx,
    'paragraph',
    'block-leaf',
    content,
    { kind: 'none' },
    srcRange,
    ancestorKey,
    depth,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Code processing (spec 001 §9, §18.4)
// ─────────────────────────────────────────────────────────────────────────

/** Language identifiers that indicate a math block (spec 001 §18.4). */
const MATH_LANGS = new Set(['math', 'tex', 'latex', 'katex', 'mathjax']);

/** Language identifiers that indicate a diagram block (spec 001 §18.4). */
const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'flowchart']);

function processCode(
  ctx: ParseContext,
  block: Code,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const codeNode = makeCodeOrExtensionNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
  parent.children.push(codeNode);
}

/**
 * Dispatch a code block to the appropriate node type based on its language
 * (spec 001 §18.4, §20.1 rule 5: explicit extension registration > unknown).
 *
 * - Math languages (math, tex, latex, katex, mathjax) → `math` node
 * - Diagram languages (mermaid, plantuml, flowchart) → `diagram` node
 * - All other languages → `code` node
 */
function makeCodeOrExtensionNode(
  ctx: ParseContext,
  block: Code,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const lang = (block.lang || '').toLowerCase();

  if (MATH_LANGS.has(lang)) {
    return makeMathNode(ctx, block, ancestorKey, srcRange, depth);
  }
  if (DIAGRAM_LANGS.has(lang)) {
    return makeDiagramNode(ctx, block, ancestorKey, srcRange, depth, lang);
  }

  return makeCodeNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, depth);
}

/** Create a math node from a fenced code block (spec 001 §18.4). */
function makeMathNode(
  ctx: ParseContext,
  block: Code,
  ancestorKey: string,
  srcRange: SourceRange | null,
  depth: number,
): SemanticNode {
  const value = block.value || '';
  const content: NodeContent = {
    text: value,
    inline: null,
    raw: srcRange?.raw ?? value,
  };
  const syntax: SyntaxMetadata = {
    kind: 'math',
    display: true,
  };
  return createNode(
    ctx,
    'math',
    'block-leaf',
    content,
    syntax,
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}

/** Create a diagram node from a fenced code block (spec 001 §18.4). */
function makeDiagramNode(
  ctx: ParseContext,
  block: Code,
  ancestorKey: string,
  srcRange: SourceRange | null,
  depth: number,
  engine: string,
): SemanticNode {
  const value = block.value || '';
  const content: NodeContent = {
    text: value,
    inline: null,
    raw: srcRange?.raw ?? value,
  };
  const syntax: SyntaxMetadata = {
    kind: 'diagram',
    engine,
  };
  return createNode(
    ctx,
    'diagram',
    'block-leaf',
    content,
    syntax,
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}

function makeCodeNode(
  ctx: ParseContext,
  block: Code,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const value = block.value || '';
  const lang = block.lang || '';
  const meta = block.meta || '';

  // Detect fence style from source
  const fenceInfo = detectCodeFence(block, source, lineOffsets);

  const content: NodeContent = {
    text: value,
    inline: null,
    raw: srcRange?.raw ?? value,
  };

  const syntax: SyntaxMetadata = {
    kind: 'code',
    fenceChar: fenceInfo.char,
    fenceLength: fenceInfo.length,
    lang,
    meta,
  };

  return createNode(
    ctx,
    'code',
    'block-leaf',
    content,
    syntax,
    srcRange,
    ancestorKey,
    depth,
  );
}

function detectCodeFence(block: Code, source: string, lineOffsets: number[]): { char: '`' | '~' | null; length: number } {
  if (!block.position) return { char: '`', length: 3 };
  const startLine = block.position.start.line;
  if (startLine >= lineOffsets.length) return { char: '`', length: 3 };
  const lineStart = lineOffsets[startLine];
  const lineEnd = startLine + 1 < lineOffsets.length ? lineOffsets[startLine + 1] - 1 : source.length;
  const firstLine = source.slice(lineStart, lineEnd);
  // Check for fenced code (``` or ~~~)
  const match = /^(`{3,}|~{3,})/.exec(firstLine);
  if (match) {
    const char = match[0][0] as '`' | '~';
    return { char, length: match[0].length };
  }
  // Indented code block
  return { char: null, length: 0 };
}

// ─────────────────────────────────────────────────────────────────────────
// Table processing (spec 001 §10)
// ─────────────────────────────────────────────────────────────────────────

function processTable(
  ctx: ParseContext,
  block: Table,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const tableNode = makeTableNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
  parent.children.push(tableNode);
}

function makeTableNode(
  ctx: ParseContext,
  block: Table,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const rows = (block.children || []) as any[];
  const headerRow = rows[0]?.children?.map((c: any) => extractText(c)) ?? [];
  const dataRows = rows.slice(1).map((r: any) =>
    (r.children || []).map((c: any) => extractText(c)),
  );
  const align = block.align || [];

  const summary = `[表格] ${headerRow.join(' / ')} · ${dataRows.length} 行`;
  const content: NodeContent = {
    text: summary,
    inline: null,
    raw: srcRange?.raw ?? summary,
  };

  const syntax: SyntaxMetadata = {
    kind: 'table',
    align: align as Array<'left' | 'right' | 'center' | null>,
    columns: headerRow.length,
    rows: dataRows.length,
  };

  // Tables are leaf nodes — don't expand rows as children (spec 001 §10)
  return createNode(
    ctx,
    'table',
    'block-leaf',
    content,
    syntax,
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Image processing (spec 001 §11)
// ─────────────────────────────────────────────────────────────────────────

function makeImageNode(
  ctx: ParseContext,
  block: Image,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const alt = block.alt || '';
  const url = block.url || '';
  const title = block.title ?? undefined;

  const content: NodeContent = {
    text: alt || url,
    inline: null,
    raw: srcRange?.raw ?? `![${alt}](${url})`,
  };

  const syntax: SyntaxMetadata = {
    kind: 'image',
    src: url,
    alt,
    title,
  };

  return createNode(
    ctx,
    'image',
    'block-leaf',
    content,
    syntax,
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HTML processing (spec 001 §12)
// ─────────────────────────────────────────────────────────────────────────

function processHtml(
  ctx: ParseContext,
  block: Html,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const htmlNode = makeHtmlNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
  parent.children.push(htmlNode);
}

function makeHtmlNode(
  ctx: ParseContext,
  block: Html,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const value = block.value || '';
  const content: NodeContent = {
    text: '[HTML]',
    inline: null,
    raw: value,
  };

  return createNode(
    ctx,
    'html',
    'block-leaf',
    content,
    { kind: 'none' },
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Front matter processing (spec 001 §12, §18.4)
// ─────────────────────────────────────────────────────────────────────────

function processFrontmatter(
  ctx: ParseContext,
  block: YAML,
  root: SemanticRoot,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  format: 'yaml' | 'toml' | 'json',
): void {
  const value = block.value || '';
  const content: NodeContent = {
    text: '[Front Matter]',
    inline: null,
    raw: value,
  };

  const syntax: SyntaxMetadata = {
    kind: 'metadata',
    format,
  };

  // Front matter is always the first child of root (spec 001 §12)
  const node = createNode(
    ctx,
    'metadata',
    'block-leaf',
    content,
    syntax,
    srcRange,
    root.semanticKey,
    1,
    [],
  );
  root.children.unshift(node);
}

// ─────────────────────────────────────────────────────────────────────────
// Footnote definition processing (spec 001 §12, §18.3)
// ─────────────────────────────────────────────────────────────────────────

function processFootnoteDef(
  ctx: ParseContext,
  block: FootnoteDefinition,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const identifier = block.identifier || '';
  const text = `[^${identifier}]`;
  const content: NodeContent = {
    text,
    inline: null,
    raw: srcRange?.raw ?? text,
  };

  // Footnotes semantically belong to root, but display in their source position
  // (spec 001 §12: "语义上属于文件根并保持源码顺序；展示时可归入'脚注'生成分组")
  const node = createNode(
    ctx,
    'footnote',
    'block-leaf',
    content,
    { kind: 'footnote', identifier },
    srcRange,
    ancestorKey,
    parent.depth + 1,
    [],
  );
  parent.children.push(node);
}

// ─────────────────────────────────────────────────────────────────────────
// Heading node factory (for headings inside containers)
// ─────────────────────────────────────────────────────────────────────────

function makeHeadingNode(
  ctx: ParseContext,
  block: Heading,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const text = extractText(block);
  const level = block.depth as 1 | 2 | 3 | 4 | 5 | 6;
  const variant = detectHeadingVariant(block, source, lineOffsets);
  const content = buildContent(text, block, source, lineOffsets);
  const syntax: SyntaxMetadata = { kind: 'heading', level, variant };

  return createNode(
    ctx,
    'heading',
    'section-container',
    content,
    syntax,
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Unknown/extension processing (spec 001 §16, §18.4, §20.1 rule 5)
// ─────────────────────────────────────────────────────────────────────────

function processUnknown(
  ctx: ParseContext,
  block: any,
  parent: SemanticNode,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
): void {
  const node = makeUnknownNode(ctx, block, ancestorKey, srcRange, source, lineOffsets, parent.depth + 1);
  parent.children.push(node);

  // Only warn for truly unknown types, not recognized extensions
  if (node.type === 'unknown') {
    ctx.warnings.push({
      message: `Unknown block type "${block.type}" preserved as unknown node`,
      source: srcRange,
    });
  }
}

/**
 * Create a node for an unrecognized mdast block.
 *
 * Spec 001 §20.1 rule 5: "显式扩展注册高于 unknown 回退" — if the block type
 * matches a registered extension, create a node with that extension's
 * SemanticType, role, and capabilities. Otherwise, create an `unknown` node
 * that preserves the raw source for lossless round-trips (spec 001 §16).
 */
function makeUnknownNode(
  ctx: ParseContext,
  block: any,
  ancestorKey: string,
  srcRange: SourceRange | null,
  source: string,
  lineOffsets: number[],
  depth: number,
): SemanticNode {
  const rawValue = srcRange?.raw ?? (block.value || JSON.stringify(block));

  // Check if this block type is a registered extension (spec 001 §20.1 rule 5)
  const extType = block.type as SemanticType;
  if (isExtension(extType)) {
    const decl = getExtension(extType)!;
    const content: NodeContent = {
      text: block.value || rawValue,
      inline: null,
      raw: rawValue,
    };
    return createNode(
      ctx,
      extType,
      decl.role,
      content,
      { kind: 'extension', extensionType: block.type, raw: rawValue },
      srcRange,
      ancestorKey,
      depth,
      [],
    );
  }

  // Not a registered extension: create unknown node (spec 001 §16)
  const content: NodeContent = {
    text: `[未知] ${block.type}`,
    inline: null,
    raw: rawValue,
  };

  return createNode(
    ctx,
    'unknown',
    'block-leaf',
    content,
    { kind: 'extension', extensionType: block.type, raw: rawValue },
    srcRange,
    ancestorKey,
    depth,
    [],
  );
}
