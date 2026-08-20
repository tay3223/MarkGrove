/**
 * Semantic module public API.
 *
 * Data flow: Source → Semantic Tree → View Tree → Render
 */

// Types
export type {
  NodeRole,
  SemanticType,
  SourcePoint,
  SourceRange,
  HeadingSyntax,
  ListItemSyntax,
  CodeSyntax,
  TableSyntax,
  ImageSyntax,
  FootnoteSyntax,
  MetadataSyntax,
  CalloutSyntax,
  MathSyntax,
  DiagramSyntax,
  ExtensionSyntax,
  SyntaxMetadata,
  NodeContent,
  InlineNode,
  NodeCapabilities,
  SemanticNode,
  SemanticRoot,
  LinkDefinition,
  FootnoteDefinition,
  ViewNode,
  ViewLayout,
  ViewPreview,
  ContentIndicator,
  ProjectionMode,
  VisualFamily,
  ParseResult,
  ParseWarning,
  ExtensionDeclaration,
} from './types';

// Parser
export { parseMarkdown } from './parser';

// Serializer
export { serializeMarkdown, treesAreEquivalent } from './serializer';

// Projection
export { projectTree, searchNodes, revealSearchPath } from './projection';
export type { ProjectionOverrides } from './projection';

// Operations
export { applyOperation, resetOpIdCounter } from './operations';
export type { TreeOperation, OperationResult } from './operations';

// Identity
export {
  generateRuntimeId,
  resetRuntimeIdCounter,
  computeSemanticKey,
  matchNodes,
  matchTrees,
  getCapabilities,
  getVisualFamily,
  OccurrenceCounter,
} from './identity';

// Validation
export { validateTree, verifyRoundTrip } from './validate';
export type { ValidationError, ValidationResult } from './validate';

// Extensions
export { registerExtension, getExtension, isExtension, getAllExtensions } from './extensions';

// View → Mindmap bridge (for MindElixir rendering)
export { viewToMindmap, createSourceLookup } from './viewToMindmap';
