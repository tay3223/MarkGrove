/**
 * Semantic model types — the core data layer of MarkGrove.
 *
 * This module defines the three-layer separation mandated by spec 001:
 *   Source → Semantic Tree → View Tree
 *
 * All types here are pure data; no parsing, rendering, or side effects.
 */

// ─────────────────────────────────────────────────────────────────────────
// Node Roles (spec 001 §19)
// ─────────────────────────────────────────────────────────────────────────

export type NodeRole =
  | 'document-root'
  | 'section-container'
  | 'block-container'
  | 'block-leaf';

// ─────────────────────────────────────────────────────────────────────────
// Node Types (spec 001 §17, §18)
// ─────────────────────────────────────────────────────────────────────────

export type SemanticType =
  | 'root'
  | 'heading'
  | 'list-item'
  | 'quote'
  | 'callout'
  | 'paragraph'
  | 'code'
  | 'table'
  | 'image'
  | 'html'
  | 'metadata'
  | 'footnote'
  | 'math'
  | 'diagram'
  | 'definition-item'
  | 'extension'
  | 'unknown';

// ─────────────────────────────────────────────────────────────────────────
// Source Anchor (spec 001 §21, §22)
// ─────────────────────────────────────────────────────────────────────────

/** A point in the source document identified by both offset and line/column. */
export interface SourcePoint {
  /** Zero-based character offset from the start of the document. */
  offset: number;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

/** Range within source text, preserving the original slice for lossless round-trips. */
export interface SourceRange {
  start: SourcePoint;
  end: SourcePoint;
  /** The exact original source text for this block, for lossless patching. */
  raw: string;
  /** Whitespace/blank lines preceding this block (for faithful reconstruction). */
  leadingWhitespace: string;
  /** Whitespace/blank lines trailing this block. */
  trailingWhitespace: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Syntax Metadata (spec 001 §3)
// ─────────────────────────────────────────────────────────────────────────

export interface HeadingSyntax {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** 'atx' (# heading) or 'setext' (=== / --- underline). */
  variant: 'atx' | 'setext';
}

export interface ListItemSyntax {
  /** '- ', '* ', '+ ' for unordered; '1. ' for ordered. */
  marker: '-' | '*' | '+' | '1.' | 'ordered';
  ordered: boolean;
  /** Start number for ordered lists. */
  start?: number;
  /** Task list checkbox state, if applicable. */
  checked?: boolean | 'unchecked';
  /** Indentation depth for nested lists (1 = top-level). */
  depth: number;
}

export interface CodeSyntax {
  /** Fence character: '`' or '~'. null for indented code. */
  fenceChar: '`' | '~' | null;
  /** Fence length (e.g. 3 for ```). */
  fenceLength: number;
  /** Language identifier (may be empty). */
  lang: string;
  /** Meta string after the language (e.g. ```ts title="foo" → 'title="foo"'). */
  meta: string;
}

export interface TableSyntax {
  /** Column alignments, one per column. */
  align: Array<'left' | 'right' | 'center' | null>;
  /** Number of columns. */
  columns: number;
  /** Number of data rows (excluding header). */
  rows: number;
}

export interface ImageSyntax {
  src: string;
  alt: string;
  title?: string;
}

export interface FootnoteSyntax {
  identifier: string;
}

export interface MetadataSyntax {
  /** Format of front matter: 'yaml', 'toml', 'json'. */
  format: 'yaml' | 'toml' | 'json';
}

export interface CalloutSyntax {
  /** Callout type: note, tip, warning, danger, info, etc. */
  variant: string;
  /** Whether the callout has an explicit title. */
  hasTitle: boolean;
}

export interface MathSyntax {
  /** Display math (block) vs inline math (shouldn't appear here, but reserved). */
  display: boolean;
}

export interface DiagramSyntax {
  /** Diagram engine: 'mermaid', 'plantuml', etc. */
  engine: string;
}

export interface ExtensionSyntax {
  /** Extension type name from the registry. */
  extensionType: string;
  /** Raw source for lossless preservation. */
  raw: string;
}

/** Discriminated union of all syntax metadata types. */
export type SyntaxMetadata =
  | { kind: 'heading' } & HeadingSyntax
  | { kind: 'list-item' } & ListItemSyntax
  | { kind: 'code' } & CodeSyntax
  | { kind: 'table' } & TableSyntax
  | { kind: 'image' } & ImageSyntax
  | { kind: 'footnote' } & FootnoteSyntax
  | { kind: 'metadata' } & MetadataSyntax
  | { kind: 'callout' } & CalloutSyntax
  | { kind: 'math' } & MathSyntax
  | { kind: 'diagram' } & DiagramSyntax
  | { kind: 'extension' } & ExtensionSyntax
  | { kind: 'none' };

// ─────────────────────────────────────────────────────────────────────────
// Node Content (spec 001 §3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A node's own semantic content, excluding descendant content.
 *
 * For containers using the "first content promotion" rule (spec 001 §3.1),
 * the promoted paragraph's full inline content is stored here.
 */
export interface NodeContent {
  /**
   * Primary display text — the promoted content for containers,
   * or the full text for leaf nodes.
   */
  text: string;
  /**
   * Rich inline content as mdast inline nodes, preserving all inline syntax
   * (bold, italic, code, links, images, etc.) for lossless round-trips.
   * null when the content is plain text only.
   */
  inline: ReadonlyArray<InlineNode> | null;
  /**
   * Full source text of the node's own content block(s),
   * for lossless patching. May differ from `text` when inline syntax is present.
   */
  raw: string;
}

/** Minimal inline node representation for lossless content preservation. */
export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'emphasis'; children: InlineNode[] }
  | { type: 'delete'; children: InlineNode[] }
  | { type: 'inlineCode'; value: string }
  | { type: 'link'; url: string; title?: string | null; children: InlineNode[] }
  | { type: 'image'; url: string; alt: string; title?: string | null }
  | { type: 'break' }
  | { type: 'html'; value: string }
  | { type: 'footnoteReference'; identifier: string }
  | { type: 'raw'; value: string };

// ─────────────────────────────────────────────────────────────────────────
// Node Capabilities (spec 001 §23)
// ─────────────────────────────────────────────────────────────────────────

export interface NodeCapabilities {
  inlineEditable: boolean;
  hasSpecialEditor: boolean;
  canHaveChildren: boolean;
  movable: boolean;
  convertible: boolean;
  /** Types this node can be converted to. */
  convertibleTo: readonly SemanticType[];
}

// ─────────────────────────────────────────────────────────────────────────
// SemanticNode (spec 001 §3)
// ─────────────────────────────────────────────────────────────────────────

export interface SemanticNode {
  /** Runtime-unique identifier for rendering. */
  id: string;
  /** Cross-parse-cycle matching key (spec 001 §21). */
  semanticKey: string;
  /** Concrete semantic type. */
  type: SemanticType;
  /** Structural role. */
  role: NodeRole;
  /** This node's own complete semantic content (not descendants'). */
  content: NodeContent;
  /** Syntax metadata. */
  syntax: SyntaxMetadata;
  /** Semantic children in source order. */
  children: SemanticNode[];
  /** Source anchor for lossless patching. */
  source: SourceRange | null;
  /** Capabilities derived from type rules. */
  capabilities: NodeCapabilities;
  /** Display depth in the tree (root = 0). */
  depth: number;
}

/** The root of a semantic tree, corresponding to a single Markdown file. */
export interface SemanticRoot extends SemanticNode {
  type: 'root';
  role: 'document-root';
  /** File name without extension, used as the root node's display title. */
  fileName: string;
  /** Document-level link definitions (spec 001 §12). */
  linkDefinitions: LinkDefinition[];
  /** Document-level footnote definitions in source order. */
  footnoteDefinitions: FootnoteDefinition[];
}

export interface LinkDefinition {
  identifier: string;
  url: string;
  title?: string | null;
  source: SourceRange | null;
}

export interface FootnoteDefinition {
  identifier: string;
  content: string;
  source: SourceRange | null;
}

// ─────────────────────────────────────────────────────────────────────────
// View Tree (spec 001 §3, §27)
// ─────────────────────────────────────────────────────────────────────────

export type ProjectionMode = 'structure' | 'balanced' | 'complete';

export interface ViewNode {
  /** Corresponding semantic node ID; null for generated nodes. */
  semanticNodeId: string | null;
  /** Truncated display text for the mind map node. */
  displayText: string;
  /** Eyebrow label (type, language, level, etc.). */
  eyebrow: string | null;
  /** Summary text (secondary, optional). */
  summary: string | null;
  /** Preview content (code snippet, table preview, image thumbnail, etc.). */
  preview: ViewPreview | null;
  /** Semantic type for the container to pick the right recipe. */
  semanticType: SemanticType;
  /** Visual family for the container's fallback chain. */
  visualFamily: VisualFamily;
  /** Whether this node is expanded. */
  expanded: boolean;
  /** Whether this node is selected. */
  selected: boolean;
  /** Layout cache (position, direction, size). */
  layout: ViewLayout | null;
  /** Whether this is a generated (non-source) node. */
  generated: boolean;
  /** Whether this node is hidden by projection (still in semantic tree, accessible via content drawer). */
  hidden: boolean;
  /** Children in display order. */
  children: ViewNode[];
  /** Content indicator counts (spec 001 §27.3). */
  contentIndicators: ContentIndicator[];
  /** Depth in the view tree. */
  depth: number;
}

export interface ViewLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: 'lhs' | 'rhs';
}

export type ViewPreview =
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'table'; headers: string[]; previewRows: string[][]; totalRows: number }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'text'; text: string };

export interface ContentIndicator {
  type: SemanticType;
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Visual Families (spec 002 §5.10)
// ─────────────────────────────────────────────────────────────────────────

export type VisualFamily =
  | 'structural'
  | 'textual'
  | 'technical'
  | 'media'
  | 'data'
  | 'notice'
  | 'fallback';

// ─────────────────────────────────────────────────────────────────────────
// Parse Result
// ─────────────────────────────────────────────────────────────────────────

export interface ParseResult {
  root: SemanticRoot;
  /** Warnings during parsing (e.g. unknown extensions preserved as-is). */
  warnings: ParseWarning[];
}

export interface ParseWarning {
  message: string;
  source: SourceRange | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Extension Registry (spec 001 §18.4)
// ─────────────────────────────────────────────────────────────────────────

export interface ExtensionDeclaration {
  type: SemanticType;
  visualFamily: VisualFamily;
  role: NodeRole;
  capabilities: NodeCapabilities;
  /** Default visibility in each projection mode. */
  defaultVisibility: {
    structure: 'visible' | 'hidden' | 'indicator';
    balanced: 'visible' | 'hidden' | 'indicator';
    complete: 'visible' | 'hidden' | 'indicator';
  };
}
