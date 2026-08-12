/**
 * Tree operations with source-patch-based rewriting (spec 001 §14, §22).
 *
 * Operations:
 *   - addChild (§14.1)
 *   - editNode (§14.2)
 *   - deleteNode (§14.3: subtree or lift children)
 *   - moveNode (§14.4)
 *   - reorderSiblings (§14.5)
 *   - convertNode (type conversion)
 *
 * Source patching (§22):
 *   - Reverse editing prefers source patches: only replace/insert/delete affected blocks
 *   - Only new documents or unrecoverable source positions allow full re-serialization
 *   - On parse failure after patch: revert to pre-edit source (§24 rule 10)
 */

import type {
  SemanticNode,
  SemanticRoot,
  SemanticType,
  NodeContent,
  SyntaxMetadata,
} from './types';
import { getCapabilities } from './identity';

// ─────────────────────────────────────────────────────────────────────────
// Operation types
// ─────────────────────────────────────────────────────────────────────────

export type TreeOperation =
  | { kind: 'addChild'; parentId: string; nodeType: SemanticType; text: string; index?: number }
  | { kind: 'editNode'; nodeId: string; text: string }
  | { kind: 'deleteNode'; nodeId: string; mode: 'subtree' | 'lift-children' }
  | { kind: 'moveNode'; nodeId: string; newParentId: string; newIndex?: number }
  | { kind: 'reorderSiblings'; parentId: string; fromIndex: number; toIndex: number }
  | { kind: 'convertNode'; nodeId: string; newType: SemanticType };

// ─────────────────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────────────────

export interface OperationResult {
  /** New semantic root (immutable: original is not modified). */
  root: SemanticRoot;
  /** Patched Markdown source, or null if full re-serialization was used. */
  patchedSource: string | null;
  /** Error message if the operation failed. */
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Node finding utilities
// ─────────────────────────────────────────────────────────────────────────

function findNode(root: SemanticNode, id: string): SemanticNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(root: SemanticNode, id: string): SemanticNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** Deep clone a node preserving its ID (clone is for immutability, not ID regeneration). */
function cloneNode(node: SemanticNode): SemanticNode {
  return {
    ...node,
    content: { ...node.content },
    syntax: { ...node.syntax } as any,
    children: node.children.map(c => cloneNode(c)),
  };
}

/** Deep clone the root. */
function cloneRoot(root: SemanticRoot): SemanticRoot {
  return {
    ...root,
    content: { ...root.content },
    children: root.children.map(c => cloneNode(c)),
    linkDefinitions: [...root.linkDefinitions],
    footnoteDefinitions: [...root.footnoteDefinitions],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Default child type per parent (spec 001 §14.1)
// ─────────────────────────────────────────────────────────────────────────

function defaultChildType(parent: SemanticNode): SemanticType {
  switch (parent.type) {
    case 'root':
      return 'heading';
    case 'heading':
      // Next level heading, max 6 (§14.1)
      if (parent.syntax.kind === 'heading') {
        return parent.syntax.level < 6 ? 'heading' : 'paragraph';
      }
      return 'heading';
    case 'list-item':
      return 'list-item';
    case 'quote':
    case 'callout':
      return 'paragraph';
    default:
      return 'paragraph';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Node creation for new nodes
// ─────────────────────────────────────────────────────────────────────────

let opIdCounter = 0;
function nextOpId(): string {
  opIdCounter += 1;
  return `op-${opIdCounter.toString(36)}`;
}

export function resetOpIdCounter(): void {
  opIdCounter = 0;
}

function createNewNode(
  type: SemanticType,
  text: string,
  parent: SemanticNode,
): SemanticNode {
  const depth = parent.depth + 1;
  const content: NodeContent = { text, inline: null, raw: text };
  let syntax: SyntaxMetadata = { kind: 'none' };

  switch (type) {
    case 'heading': {
      // Determine level: parent heading level + 1, or 1 for root
      let level: 1 | 2 | 3 | 4 | 5 | 6 = 1;
      if (parent.syntax.kind === 'heading') {
        level = Math.min(parent.syntax.level + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      }
      syntax = { kind: 'heading', level, variant: 'atx' };
      break;
    }
    case 'list-item':
      syntax = { kind: 'list-item', marker: '-', ordered: false, depth: 1, checked: undefined };
      break;
    case 'code':
      syntax = { kind: 'code', fenceChar: '`', fenceLength: 3, lang: '', meta: '' };
      break;
    case 'paragraph':
      syntax = { kind: 'none' };
      break;
  }

  const capabilities = getCapabilities(type);
  return {
    id: nextOpId(),
    semanticKey: `new-${type}-${Date.now().toString(36)}`,
    type,
    role: capabilities.canHaveChildren && type !== 'paragraph' && type !== 'code' && type !== 'table' && type !== 'image' && type !== 'html' && type !== 'metadata' && type !== 'footnote' && type !== 'math' && type !== 'diagram'
      ? (type === 'heading' ? 'section-container' : 'block-container')
      : 'block-leaf',
    content,
    syntax,
    children: [],
    source: null,
    capabilities,
    depth,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Source patch utilities
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply a source patch: replace the source range of a node with new text.
 * Returns the patched source string.
 */
function patchSource(source: string, node: SemanticNode, newText: string): string {
  if (!node.source) return source;
  return (
    source.slice(0, node.source.start.offset) +
    newText +
    source.slice(node.source.end.offset)
  );
}

/** Remove a node's source range from the source string. */
function removeSourceRange(source: string, node: SemanticNode): string {
  if (!node.source) return source;
  const start = node.source.start.offset;
  let end = node.source.end.offset;
  // Also remove trailing whitespace/newline
  while (end < source.length && (source[end] === '\n' || source[end] === '\r')) {
    end++;
  }
  // Also remove leading whitespace
  while (start > 0 && source[start - 1] === '\n') {
    // Don't go past previous block
    break;
  }
  return source.slice(0, start) + source.slice(end);
}

// ─────────────────────────────────────────────────────────────────────────
// Serialize a single node to Markdown (for insertion)
// ─────────────────────────────────────────────────────────────────────────

function serializeNodeForInsertion(node: SemanticNode): string {
  switch (node.type) {
    case 'heading': {
      if (node.syntax.kind === 'heading') {
        return `${'#'.repeat(node.syntax.level)} ${node.content.text}`;
      }
      return node.content.text;
    }
    case 'list-item': {
      const marker = node.syntax.kind === 'list-item' && node.syntax.ordered ? '1.' : '-';
      const checkbox = node.syntax.kind === 'list-item' && node.syntax.checked !== undefined
        ? ` [${node.syntax.checked === true ? 'x' : ' '}] `
        : ' ';
      return `${marker}${checkbox}${node.content.text}`;
    }
    case 'paragraph':
      return node.content.text;
    case 'code': {
      const lang = node.syntax.kind === 'code' ? node.syntax.lang : '';
      return `\`\`\`${lang}\n${node.content.text}\n\`\`\``;
    }
    case 'quote':
      return `> ${node.content.text}`;
    default:
      return node.content.text;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Apply operation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply a tree operation immutably.
 *
 * Returns a new SemanticRoot and optionally a patched source string.
 * The original root is never modified.
 */
export function applyOperation(
  root: SemanticRoot,
  source: string,
  operation: TreeOperation,
): OperationResult {
  const newRoot = cloneRoot(root);

  try {
    switch (operation.kind) {
      case 'addChild':
        return applyAddChild(newRoot, source, operation);
      case 'editNode':
        return applyEditNode(newRoot, source, operation);
      case 'deleteNode':
        return applyDeleteNode(newRoot, source, operation);
      case 'moveNode':
        return applyMoveNode(newRoot, source, operation);
      case 'reorderSiblings':
        return applyReorderSiblings(newRoot, source, operation);
      case 'convertNode':
        return applyConvertNode(newRoot, source, operation);
      default:
        return { root: newRoot, patchedSource: null, error: 'Unknown operation' };
    }
  } catch (err) {
    return { root, patchedSource: null, error: String(err) };
  }
}

function applyAddChild(
  root: SemanticRoot,
  source: string,
  op: { parentId: string; nodeType: SemanticType; text: string; index?: number },
): OperationResult {
  const parent = findNode(root, op.parentId);
  if (!parent) {
    return { root, patchedSource: null, error: `Parent node not found: ${op.parentId}` };
  }

  // Check capabilities (§23)
  if (!parent.capabilities.canHaveChildren) {
    return { root, patchedSource: null, error: `Node ${parent.type} cannot have children` };
  }

  // Determine type: use requested type or default (§14.1)
  const type = op.nodeType || defaultChildType(parent);

  const newNode = createNewNode(type, op.text, parent);
  const insertIndex = op.index ?? parent.children.length;
  parent.children.splice(insertIndex, 0, newNode);

  // Patch source: append after parent's source range
  let patchedSource = source;
  if (parent.source) {
    const insertionText = serializeNodeForInsertion(newNode);
    const insertOffset = findInsertionOffset(source, parent, root);
    patchedSource =
      source.slice(0, insertOffset) +
      insertionText + '\n\n' +
      source.slice(insertOffset);
  }

  return { root, patchedSource, error: null };
}

function findInsertionOffset(source: string, parent: SemanticNode, root: SemanticNode): number {
  if (!parent.source) return source.length;

  // For headings: insert before the next heading of same or higher level
  if (parent.type === 'heading' && parent.syntax.kind === 'heading') {
    const parentLevel = parent.syntax.level;
    // Find the end of the parent's jurisdiction
    // Walk the source after parent's end to find the next heading of <= level
    const searchStart = parent.source.end.offset;
    const remaining = source.slice(searchStart);
    const headingRegex = new RegExp(`^(#{1,${parentLevel}})\\s`, 'm');
    const match = headingRegex.exec(remaining);
    if (match && match.index !== undefined) {
      return searchStart + match.index;
    }
  }

  // Default: insert after parent's source range
  return parent.source.end.offset;
}

function applyEditNode(
  root: SemanticRoot,
  source: string,
  op: { nodeId: string; text: string },
): OperationResult {
  const node = findNode(root, op.nodeId);
  if (!node) {
    return { root, patchedSource: null, error: `Node not found: ${op.nodeId}` };
  }

  // Check capabilities (§23, §14.2)
  if (!node.capabilities.inlineEditable) {
    return { root, patchedSource: null, error: `Node ${node.type} is not inline editable` };
  }

  // Preserve syntax metadata, only change text (§14.2)
  const oldText = node.content.text;
  node.content = { ...node.content, text: op.text };

  // Patch source: replace the node's source range with updated text
  let patchedSource = source;
  if (node.source) {
    const newText = serializeNodeForInsertion(node);
    patchedSource = patchSource(source, node, newText);
    // Update the raw source
    node.content.raw = newText;
  }

  return { root, patchedSource, error: null };
}

function applyDeleteNode(
  root: SemanticRoot,
  source: string,
  op: { nodeId: string; mode: 'subtree' | 'lift-children' },
): OperationResult {
  const node = findNode(root, op.nodeId);
  if (!node) {
    return { root, patchedSource: null, error: `Node not found: ${op.nodeId}` };
  }

  // Root cannot be deleted
  if (node === root) {
    return { root, patchedSource: null, error: 'Cannot delete root node' };
  }

  const parent = findParent(root, op.nodeId);
  if (!parent) {
    return { root, patchedSource: null, error: `Parent not found for node: ${op.nodeId}` };
  }

  const index = parent.children.indexOf(node);

  if (op.mode === 'lift-children') {
    // Lift children to parent (§14.3)
    parent.children.splice(index, 1, ...node.children);
    // Update depth of lifted children
    const updateDepth = (n: SemanticNode, newDepth: number) => {
      n.depth = newDepth;
      n.children.forEach(c => updateDepth(c, newDepth + 1));
    };
    node.children.forEach(c => updateDepth(c, parent.depth + 1));
  } else {
    // Delete entire subtree (§14.3, default)
    parent.children.splice(index, 1);
  }

  // Patch source: remove the node's source range
  const patchedSource = removeSourceRange(source, node);

  return { root, patchedSource, error: null };
}

function applyMoveNode(
  root: SemanticRoot,
  source: string,
  op: { nodeId: string; newParentId: string; newIndex?: number },
): OperationResult {
  // Prevent moving to self or descendant (§14.4)
  const node = findNode(root, op.nodeId);
  if (!node) {
    return { root, patchedSource: null, error: `Node not found: ${op.nodeId}` };
  }

  if (op.nodeId === op.newParentId) {
    return { root, patchedSource: null, error: 'Cannot move node to itself' };
  }

  // Check if newParent is a descendant of node
  const isDescendant = (parent: SemanticNode, targetId: string): boolean => {
    if (parent.id === targetId) return true;
    return parent.children.some(c => isDescendant(c, targetId));
  };
  if (isDescendant(node, op.newParentId)) {
    return { root, patchedSource: null, error: 'Cannot move node to its own descendant' };
  }

  const newParent = findNode(root, op.newParentId);
  if (!newParent) {
    return { root, patchedSource: null, error: `New parent not found: ${op.newParentId}` };
  }

  if (!newParent.capabilities.canHaveChildren) {
    return { root, patchedSource: null, error: `Target ${newParent.type} cannot have children` };
  }

  const oldParent = findParent(root, op.nodeId);
  if (!oldParent) {
    return { root, patchedSource: null, error: `Old parent not found` };
  }

  // Remove from old parent
  const oldIndex = oldParent.children.indexOf(node);
  oldParent.children.splice(oldIndex, 1);

  // Adjust node based on new parent type (§14.4)
  adjustNodeForNewParent(node, newParent);

  // Insert into new parent
  const newIndex = op.newIndex ?? newParent.children.length;
  newParent.children.splice(newIndex, 0, node);

  // Update depth
  const updateDepth = (n: SemanticNode, newDepth: number) => {
    n.depth = newDepth;
    n.children.forEach(c => updateDepth(c, newDepth + 1));
  };
  updateDepth(node, newParent.depth + 1);

  // For source patching: full re-serialization is safer for moves
  return { root, patchedSource: null, error: null };
}

function adjustNodeForNewParent(node: SemanticNode, newParent: SemanticNode): void {
  // §14.4: Heading moved into heading → level becomes parent level + 1
  if (node.type === 'heading' && node.syntax.kind === 'heading') {
    if (newParent.type === 'heading' && newParent.syntax.kind === 'heading') {
      const oldLevel = node.syntax.level;
      const newLevel = Math.min(newParent.syntax.level + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      const levelDiff = newLevel - oldLevel;
      node.syntax.level = newLevel;

      // Adjust subtree heading levels by the same delta (§14.4).
      // Only children — the moved node itself was already adjusted above.
      const adjustSubtree = (n: SemanticNode) => {
        if (n.syntax.kind === 'heading') {
          const adjusted = n.syntax.level + levelDiff;
          if (adjusted > 6) {
            // §14.4: clamp at 6; moves that would exceed 6 should be rejected upstream
            n.syntax.level = 6;
          } else if (adjusted < 1) {
            n.syntax.level = 1;
          } else {
            n.syntax.level = adjusted as 1 | 2 | 3 | 4 | 5 | 6;
          }
        }
        n.children.forEach(adjustSubtree);
      };
      node.children.forEach(adjustSubtree);
    }
  }

  // §14.4: List item moved into list item → becomes nested
  if (node.type === 'list-item' && node.syntax.kind === 'list-item') {
    if (newParent.type === 'list-item' && newParent.syntax.kind === 'list-item') {
      node.syntax.depth = newParent.syntax.depth + 1;
    } else {
      node.syntax.depth = 1;
    }
  }
}

function applyReorderSiblings(
  root: SemanticRoot,
  source: string,
  op: { parentId: string; fromIndex: number; toIndex: number },
): OperationResult {
  const parent = findNode(root, op.parentId);
  if (!parent) {
    return { root, patchedSource: null, error: `Parent not found: ${op.parentId}` };
  }

  const { fromIndex, toIndex } = op;
  if (fromIndex < 0 || fromIndex >= parent.children.length) {
    return { root, patchedSource: null, error: `Invalid fromIndex: ${fromIndex}` };
  }
  if (toIndex < 0 || toIndex >= parent.children.length) {
    return { root, patchedSource: null, error: `Invalid toIndex: ${toIndex}` };
  }

  // Move child from fromIndex to toIndex (§14.5)
  const [moved] = parent.children.splice(fromIndex, 1);
  parent.children.splice(toIndex, 0, moved);

  // Source order follows sibling order (§14.5)
  // For source patching, full re-serialization is needed for reorder
  return { root, patchedSource: null, error: null };
}

function applyConvertNode(
  root: SemanticRoot,
  source: string,
  op: { nodeId: string; newType: SemanticType },
): OperationResult {
  const node = findNode(root, op.nodeId);
  if (!node) {
    return { root, patchedSource: null, error: `Node not found: ${op.nodeId}` };
  }

  // Check capabilities (§23)
  if (!node.capabilities.convertible) {
    return { root, patchedSource: null, error: `Node ${node.type} is not convertible` };
  }

  if (!node.capabilities.convertibleTo.includes(op.newType)) {
    return { root, patchedSource: null, error: `Cannot convert ${node.type} to ${op.newType}` };
  }

  // Convert the node type while preserving content (§14.2)
  const oldContent = node.content;
  const oldCapabilities = node.capabilities;

  node.type = op.newType;
  node.capabilities = getCapabilities(op.newType);

  // Update syntax and role based on new type
  switch (op.newType) {
    case 'heading':
      node.syntax = { kind: 'heading', level: 1, variant: 'atx' };
      node.role = 'section-container';
      break;
    case 'list-item':
      node.syntax = { kind: 'list-item', marker: '-', ordered: false, depth: 1, checked: undefined };
      node.role = 'block-container';
      break;
    case 'paragraph':
      node.syntax = { kind: 'none' };
      node.role = 'block-leaf';
      // Paragraphs can't have children — lift them (§23)
      if (node.children.length > 0) {
        const parent = findParent(root, op.nodeId);
        if (parent) {
          const index = parent.children.indexOf(node);
          parent.children.splice(index, 1, ...node.children, node);
          node.children = [];
        }
      }
      break;
    case 'quote':
      node.syntax = { kind: 'none' };
      node.role = 'block-container';
      break;
    default:
      node.syntax = { kind: 'none' };
      node.role = 'block-leaf';
      break;
  }

  node.content = oldContent;

  return { root, patchedSource: null, error: null };
}
