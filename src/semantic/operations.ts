/**
 * Tree operations with safe writeback transactions (spec 001 §14, §22, §24).
 *
 * Operations:
 *   - addChild (§14.1)
 *   - editNode (§14.2)
 *   - deleteNode (§14.3: subtree or lift children)
 *   - moveNode (§14.4)
 *   - reorderSiblings (§14.5)
 *   - convertNode (type conversion)
 *
 * Safe writeback transaction (spec 001 §22, §24):
 *   1. Pre-validate the original tree (§24).
 *   2. Clone and apply the operation to produce a candidate tree + patched source.
 *   3. Re-parse the patched source into a verification tree.
 *   4. Validate the re-parsed tree (§24).
 *   5. Verify the candidate tree is semantically equivalent to the re-parsed tree (§25.2).
 *   6. On any failure, fall back to full re-serialization; if that also fails,
 *      atomically return the original tree and source with an error (§24 rule 10).
 *
 * Source patching (§22):
 *   - Reverse editing prefers source patches: only replace/insert/delete affected blocks
 *   - Only new documents or unrecoverable source positions allow full re-serialization
 *   - On parse failure after patch: revert to pre-edit source (§24 rule 10)
 *   - Regex must never be used to re-guess Markdown structure; positioning relies on
 *     the source anchors (SourceRange) already recorded on semantic nodes.
 */

import type {
  SemanticNode,
  SemanticRoot,
  SemanticType,
  NodeContent,
  SyntaxMetadata,
} from './types';
import { getCapabilities } from './identity';
import { parseMarkdown } from './parser';
import { serializeMarkdown, treesAreEquivalent } from './serializer';
import { validateTree } from './validate';

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
    linkDefinitions: root.linkDefinitions.map(d => ({ ...d, source: d.source ? { ...d.source } : null })),
    footnoteDefinitions: root.footnoteDefinitions.map(d => ({ ...d, source: d.source ? { ...d.source } : null })),
    fidelityItems: root.fidelityItems.map(item => ({ ...item, source: { ...item.source } })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Structural jurisdiction (spec 001 §14.3, §22)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute the source offset where a node's structural jurisdiction ends.
 *
 * A node's jurisdiction covers its own source range plus the source ranges of
 * all descendants, because semantic children follow the node in source order
 * (spec 001 §14.3). Deleting a subtree must remove this entire span, not just
 * the node's own line.
 *
 * Returns -1 when the node carries no source anchor.
 */
function getNodeJurisdictionEnd(node: SemanticNode): number {
  if (!node.source) return -1;
  let end = node.source.end.offset;
  for (const child of node.children) {
    const childEnd = getNodeJurisdictionEnd(child);
    if (childEnd > end) end = childEnd;
  }
  return end;
}

/**
 * Compute the [start, end) source span covering a node and all its descendants.
 * Returns null when the node has no source anchor.
 */
function getNodeJurisdictionSpan(node: SemanticNode): { start: number; end: number } | null {
  if (!node.source) return null;
  return { start: node.source.start.offset, end: getNodeJurisdictionEnd(node) };
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
      // Nested depth follows parent list-item depth so the serializer emits
      // the correct indentation (spec 001 §14.1).
      syntax = {
        kind: 'list-item',
        marker: '-',
        ordered: false,
        depth: parent.syntax.kind === 'list-item' ? parent.syntax.depth + 1 : 1,
        checked: undefined,
      };
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

/**
 * Remove a node's structural jurisdiction (node + all descendants) from the
 * source string, including trailing blank lines (spec 001 §14.3, §22).
 */
function removeJurisdictionFromSource(source: string, node: SemanticNode): string {
  const span = getNodeJurisdictionSpan(node);
  if (!span) return source;
  let end = span.end;
  // Also consume trailing newlines so we don't leave a dangling blank line.
  while (end < source.length && (source[end] === '\n' || source[end] === '\r')) {
    end++;
  }
  return source.slice(0, span.start) + source.slice(end);
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
// Heading level preview (spec 001 §14.4)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Preview the heading-level adjustment that would result from moving `node`
 * under `newParent`. Returns { ok: false, reason } if any heading in the moved
 * subtree would land outside [1, 6] — in that case the move must be rejected
 * wholesale and the original source preserved (spec 001 §14.4).
 */
function previewHeadingAdjustment(
  node: SemanticNode,
  newParent: SemanticNode,
): { ok: boolean; reason?: string } {
  if (node.type !== 'heading' || node.syntax.kind !== 'heading') return { ok: true };
  if (newParent.type !== 'heading' || newParent.syntax.kind !== 'heading') return { ok: true };

  const oldLevel = node.syntax.level;
  const newLevel = newParent.syntax.level + 1;
  if (newLevel > 6) {
    return { ok: false, reason: `Move would push heading to level ${newLevel} (max 6)` };
  }

  const levelDiff = newLevel - oldLevel;
  const previewSubtree = (n: SemanticNode): boolean => {
    if (n.syntax.kind === 'heading') {
      const adjusted = n.syntax.level + levelDiff;
      if (adjusted > 6 || adjusted < 1) return false;
    }
    return n.children.every(previewSubtree);
  };

  if (!node.children.every(previewSubtree)) {
    return { ok: false, reason: 'Move would push a subtree heading out of range [1, 6]' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Safe writeback transaction (spec 001 §22, §24)
// ─────────────────────────────────────────────────────────────────────────

interface VerificationResult {
  ok: boolean;
  error?: string;
}

/**
 * Re-parse `patchedSource`, validate the resulting tree, and verify it is
 * semantically equivalent to `candidateRoot` (spec 001 §24 rule 9, §25.2).
 */
function verifyPatchedSource(
  originalRoot: SemanticRoot,
  patchedSource: string,
  candidateRoot: SemanticRoot,
): VerificationResult {
  let reparsedRoot: SemanticRoot;
  try {
    const result = parseMarkdown(patchedSource, originalRoot.fileName);
    reparsedRoot = result.root;
  } catch (err) {
    return { ok: false, error: `Reparse failed: ${String(err)}` };
  }

  const validation = validateTree(reparsedRoot);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Reparsed tree invalid: ${validation.errors.map(e => e.message).join('; ')}`,
    };
  }

  if (!treesAreEquivalent(candidateRoot, reparsedRoot)) {
    return {
      ok: false,
      error: 'Candidate tree not semantically equivalent to reparsed tree',
    };
  }

  return { ok: true };
}

/**
 * Commit a candidate operation result through the safe writeback transaction.
 *
 * Strategy (spec 001 §22):
 *   1. First try the candidate's own `patchedSource` (preferred: minimal patch).
 *   2. If that fails re-parse or equivalence, fall back to a full re-serialization
 *      of the candidate tree — this is allowed when source positions are
 *      unrecoverable (§22) and still guarantees semantic equivalence.
 *   3. If both fail, atomically return the original root and source with an
 *      error (§24 rule 10). No half-applied state is ever returned.
 */
function commitWithFallback(
  originalRoot: SemanticRoot,
  originalSource: string,
  candidate: OperationResult,
): OperationResult {
  // Step 1: try the candidate's patched source (minimal patch preferred).
  if (candidate.patchedSource !== null) {
    const result = verifyPatchedSource(originalRoot, candidate.patchedSource, candidate.root);
    if (result.ok) {
      return { root: candidate.root, patchedSource: candidate.patchedSource, error: null };
    }
    // Minimal patch failed verification — fall through to full re-serialization.
  }

  // Step 2: fall back to full re-serialization of the candidate tree (§22).
  // Use 'tree' order so the output reflects the candidate tree's children
  // order, which may have diverged from the original source offsets.
  const fallbackSource = serializeMarkdown(candidate.root, 'tree');
  const fallbackResult = verifyPatchedSource(originalRoot, fallbackSource, candidate.root);
  if (fallbackResult.ok) {
    return { root: candidate.root, patchedSource: fallbackSource, error: null };
  }

  // Step 3: both paths failed — atomically revert (§24 rule 10).
  return {
    root: originalRoot,
    patchedSource: null,
    error: fallbackResult.error ?? 'Safe writeback transaction failed; original source preserved',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Apply operation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply a tree operation immutably through a safe writeback transaction.
 *
 * Returns a new SemanticRoot and a patched source string. The original root
 * and source are never modified; on any failure the original root is returned
 * with an error message (spec 001 §24 rule 10).
 */
export function applyOperation(
  root: SemanticRoot,
  source: string,
  operation: TreeOperation,
): OperationResult {
  // Step 1: pre-validate the original tree (§24).
  const preValidation = validateTree(root);
  if (!preValidation.valid) {
    return {
      root,
      patchedSource: null,
      error: `Pre-validation failed: ${preValidation.errors.map(e => e.message).join('; ')}`,
    };
  }

  const newRoot = cloneRoot(root);

  let candidate: OperationResult;
  try {
    switch (operation.kind) {
      case 'addChild':
        candidate = applyAddChild(newRoot, source, operation);
        break;
      case 'editNode':
        candidate = applyEditNode(newRoot, source, operation);
        break;
      case 'deleteNode':
        candidate = applyDeleteNode(newRoot, source, operation);
        break;
      case 'moveNode':
        candidate = applyMoveNode(newRoot, source, operation);
        break;
      case 'reorderSiblings':
        candidate = applyReorderSiblings(newRoot, source, operation);
        break;
      case 'convertNode':
        candidate = applyConvertNode(newRoot, source, operation);
        break;
      default:
        return { root: newRoot, patchedSource: null, error: 'Unknown operation' };
    }
  } catch (err) {
    return { root, patchedSource: null, error: String(err) };
  }

  // Operation-level error (e.g. node not found, capability denied): return the
  // original root so callers always receive a pristine tree on failure (§24 rule 10).
  if (candidate.error) {
    return { root, patchedSource: null, error: candidate.error };
  }

  // No patched source (should not happen for committed operations): return as-is.
  if (candidate.patchedSource === null) {
    return candidate;
  }

  // Step 2: commit through the safe writeback transaction.
  return commitWithFallback(root, source, candidate);
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

  // Build a minimal source patch. Positioning relies solely on the source
  // anchors already recorded on sibling/parent nodes — never on regex guessing.
  const insertionText = serializeNodeForInsertion(newNode);
  let insertOffset: number | null = null;

  // Prefer the next sibling's source start (insert before it).
  if (insertIndex < parent.children.length - 1) {
    const nextSibling = parent.children[insertIndex + 1];
    if (nextSibling.source) {
      insertOffset = nextSibling.source.start.offset;
    }
  }

  // Otherwise insert after the previous sibling's jurisdiction end.
  if (insertOffset === null && insertIndex > 0) {
    const prevSibling = parent.children[insertIndex - 1];
    if (prevSibling.source) {
      insertOffset = getNodeJurisdictionEnd(prevSibling);
    }
  }

  // Otherwise fall back to the parent's jurisdiction end.
  if (insertOffset === null && parent.source) {
    insertOffset = getNodeJurisdictionEnd(parent);
  }

  let patchedSource: string;
  if (insertOffset !== null) {
    patchedSource =
      source.slice(0, insertOffset) +
      insertionText + '\n\n' +
      source.slice(insertOffset);
  } else {
    // No usable source anchor (e.g. empty document) — full re-serialization.
    patchedSource = serializeMarkdown(root);
  }

  return { root, patchedSource, error: null };
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
  node.content = { ...node.content, text: op.text };

  // Patch source: replace the node's source range with updated text.
  // The transaction verifier will fall back to full re-serialization if this
  // minimal patch turns out to be lossy (e.g. for list-items whose source span
  // also covers nested children).
  let patchedSource: string;
  if (node.source) {
    const newText = serializeNodeForInsertion(node);
    patchedSource = patchSource(source, node, newText);
    node.content.raw = newText;
  } else {
    patchedSource = serializeMarkdown(root);
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
    // Structure changes (indentation, nesting) are complex — use full
    // re-serialization in tree order; the verifier guarantees semantic equivalence.
    return { root, patchedSource: serializeMarkdown(root, 'tree'), error: null };
  }

  // Delete entire subtree (§14.3, default)
  parent.children.splice(index, 1);

  // Patch source: remove the node's structural jurisdiction (node + all
  // descendants), not just the node's own line (P0-4 fix, §14.3).
  const patchedSource = removeJurisdictionFromSource(source, node);

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

  // Preview heading-level adjustment; reject wholesale if any heading in the
  // moved subtree would exceed H6 (spec 001 §14.4).
  const preview = previewHeadingAdjustment(node, newParent);
  if (!preview.ok) {
    return { root, patchedSource: null, error: preview.reason! };
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

  // Moves restructure source blocks significantly; full re-serialization in
  // tree order is the safe path (§22). The verifier guarantees the result is
  // semantically equivalent to the candidate tree.
  return { root, patchedSource: serializeMarkdown(root, 'tree'), error: null };
}

function adjustNodeForNewParent(node: SemanticNode, newParent: SemanticNode): void {
  // §14.4: Heading moved into heading → level becomes parent level + 1
  if (node.type === 'heading' && node.syntax.kind === 'heading') {
    if (newParent.type === 'heading' && newParent.syntax.kind === 'heading') {
      const oldLevel = node.syntax.level;
      const newLevel = newParent.syntax.level + 1;
      const levelDiff = newLevel - oldLevel;
      // previewHeadingAdjustment already guaranteed newLevel ≤ 6 and all
      // subtree headings stay within [1, 6]; clamp here is defensive only.
      node.syntax.level = Math.min(Math.max(newLevel, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;

      // Adjust subtree heading levels by the same delta (§14.4).
      const adjustSubtree = (n: SemanticNode) => {
        if (n.syntax.kind === 'heading') {
          const adjusted = n.syntax.level + levelDiff;
          n.syntax.level = Math.min(Math.max(adjusted, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
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

  // Source order follows sibling order (§14.5). Reordering interleaves with
  // fidelity items and link definitions, so full re-serialization in tree
  // order is the safe path; the verifier guarantees semantic equivalence.
  return { root, patchedSource: serializeMarkdown(root, 'tree'), error: null };
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
      // Paragraphs can't have children — lift them to the grandparent (§23).
      // The converted node stays in its original position; children follow it
      // so that source order (and thus re-parse structure) is preserved.
      if (node.children.length > 0) {
        const parent = findParent(root, op.nodeId);
        if (parent) {
          const index = parent.children.indexOf(node);
          parent.children.splice(index, 1, node, ...node.children);
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

  // Type conversion changes syntax markers; full re-serialization in tree
  // order is the safe path; the verifier guarantees semantic equivalence.
  return { root, patchedSource: serializeMarkdown(root, 'tree'), error: null };
}
