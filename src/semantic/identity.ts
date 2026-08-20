/**
 * Node identity and capability utilities (spec 001 §21, §23).
 *
 * Identity uses a "dual-ID" design:
 *   - runtimeId: unique per session, for rendering
 *   - semanticKey: stable across re-parses, for matching nodes after edits
 */

import type {
  NodeCapabilities,
  SemanticNode,
  SemanticRoot,
  SemanticType,
  SourceRange,
  VisualFamily,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Runtime ID generation
// ─────────────────────────────────────────────────────────────────────────

let runtimeCounter = 0;

/** Generate a fresh runtime-unique ID. */
export function generateRuntimeId(): string {
  runtimeCounter += 1;
  return `n${runtimeCounter.toString(36)}`;
}

/** Reset the runtime counter (for tests). */
export function resetRuntimeIdCounter(): void {
  runtimeCounter = 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Semantic key generation (spec 001 §21)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a semanticKey based on type, content fingerprint, ancestor
 * fingerprint, and occurrence index. This survives position shifts caused
 * by insertions/deletions before the node.
 *
 * Matching priority (spec 001 §21):
 *   1. Explicit persistent ID (future)
 *   2. Old source range still matches
 *   3. Type + content fingerprint + nearest ancestor fingerprint
 *   4. Adjacent nodes and occurrence-of-same-name
 *   5. Cannot reliably match → create new identity
 */
export function computeSemanticKey(
  type: SemanticType,
  contentText: string,
  ancestorKey: string,
  occurrence: number,
): string {
  const normalized = normalizeContent(contentText);
  const raw = `${ancestorKey}|${type}|${normalized}|${occurrence}`;
  return hashString(raw);
}

/** Normalize content for fingerprinting: collapse whitespace, truncate. */
function normalizeContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Stable string hash (djb2 variant). */
function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) & 0x7fffffff;
  }
  return `s${hash.toString(36)}`;
}

/**
 * Match old nodes to new nodes after a re-parse, preserving runtime IDs
 * where possible (spec 001 §21, §25.3).
 *
 * This enables incremental rebuilds without losing selection, expansion,
 * or viewport state.
 *
 * Matching priority (spec 001 §21):
 *   1. Exact semanticKey match (type + content + ancestor + occurrence).
 *   2. Source range overlap (position-based).
 *   3. Type + content fingerprint (content-based, ignores ancestor).
 *   4. Same type fallback (positional, weakest).
 *   5. No match → new identity (implicit; no entry in the map).
 */
export function matchNodes(
  oldNodes: ReadonlyArray<SemanticNode>,
  newNodes: ReadonlyArray<SemanticNode>,
): Map<string, string> {
  /** Maps new node ID → old node ID (for ID reuse). */
  const matchMap = new Map<string, string>();
  const usedOld = new Set<string>();

  // Strategy 1: exact semanticKey match (spec 001 §21 priority 1-3).
  const oldByKey = new Map<string, SemanticNode>();
  for (const old of oldNodes) {
    oldByKey.set(old.semanticKey, old);
  }
  for (const newNode of newNodes) {
    const old = oldByKey.get(newNode.semanticKey);
    if (old && !usedOld.has(old.id)) {
      matchMap.set(newNode.id, old.id);
      usedOld.add(old.id);
    }
  }

  // Strategy 2: source range overlap (spec 001 §21 priority 2).
  for (const newNode of newNodes) {
    if (matchMap.has(newNode.id) || !newNode.source) continue;
    for (const old of oldNodes) {
      if (usedOld.has(old.id) || !old.source) continue;
      if (rangesOverlap(newNode.source, old.source)) {
        matchMap.set(newNode.id, old.id);
        usedOld.add(old.id);
        break;
      }
    }
  }

  // Strategy 3: type + content fingerprint (spec 001 §21 priority 3).
  for (const newNode of newNodes) {
    if (matchMap.has(newNode.id)) continue;
    const newNorm = normalizeContent(newNode.content.text);
    for (const old of oldNodes) {
      if (usedOld.has(old.id)) continue;
      if (old.type === newNode.type && normalizeContent(old.content.text) === newNorm) {
        matchMap.set(newNode.id, old.id);
        usedOld.add(old.id);
        break;
      }
    }
  }

  // Strategy 4: same-type positional fallback (spec 001 §21 priority 4).
  for (const newNode of newNodes) {
    if (matchMap.has(newNode.id)) continue;
    for (const old of oldNodes) {
      if (usedOld.has(old.id)) continue;
      if (old.type === newNode.type) {
        matchMap.set(newNode.id, old.id);
        usedOld.add(old.id);
        break;
      }
    }
  }

  // Strategy 5: no match → new identity (implicit, no entry in matchMap).
  return matchMap;
}

/** Check whether two source ranges overlap. */
function rangesOverlap(a: SourceRange, b: SourceRange): boolean {
  return a.start.offset < b.end.offset && b.start.offset < a.end.offset;
}

/**
 * Recursively match two semantic trees, returning a map of new node ID → old
 * node ID for every level of the tree (spec 001 §21, §25.3).
 *
 * This is the tree-level entry point: it matches root, then recurses into
 * children at each matched pair so that descendant matching benefits from
 * the narrowed context.
 */
export function matchTrees(
  oldRoot: SemanticNode | SemanticRoot,
  newRoot: SemanticNode | SemanticRoot,
): Map<string, string> {
  const matchMap = new Map<string, string>();

  const matchLevel = (
    oldNodes: ReadonlyArray<SemanticNode>,
    newNodes: ReadonlyArray<SemanticNode>,
  ): void => {
    const levelMap = matchNodes(oldNodes, newNodes);
    for (const [newId, oldId] of levelMap) {
      matchMap.set(newId, oldId);
    }
    // Recurse into matched children.
    for (const newNode of newNodes) {
      const oldId = levelMap.get(newNode.id);
      if (!oldId) continue;
      const oldNode = oldNodes.find(n => n.id === oldId);
      if (oldNode && oldNode.children.length > 0 && newNode.children.length > 0) {
        matchLevel(oldNode.children, newNode.children);
      }
    }
    // Recurse into unmatched new nodes' children (they may match old nodes
    // from a different branch that lost their parent).
    for (const newNode of newNodes) {
      if (levelMap.has(newNode.id)) continue;
      if (newNode.children.length === 0) continue;
      // Try matching against all remaining unmatched old nodes.
      const remaining = oldNodes.filter(n => !matchMap.has(n.id)).flatMap(n => n.children);
      if (remaining.length > 0) {
        matchLevel(remaining, newNode.children);
      }
    }
  };

  // Match roots directly, then recurse.
  matchMap.set(newRoot.id, oldRoot.id);
  matchLevel(oldRoot.children, newRoot.children);

  return matchMap;
}

// ─────────────────────────────────────────────────────────────────────────
// Capability matrix (spec 001 §23)
// ─────────────────────────────────────────────────────────────────────────

const CAPABILITY_TABLE: Record<SemanticType, NodeCapabilities> = {
  root: {
    inlineEditable: false,
    hasSpecialEditor: false,
    canHaveChildren: true,
    movable: false,
    convertible: false,
    convertibleTo: [],
  },
  heading: {
    inlineEditable: true,
    hasSpecialEditor: false,
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['list-item', 'paragraph'],
  },
  'list-item': {
    inlineEditable: true,
    hasSpecialEditor: true, // task status can be separately edited
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['heading', 'paragraph'],
  },
  quote: {
    inlineEditable: true, // summary can be edited
    hasSpecialEditor: true, // full block editing
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['paragraph', 'callout'],
  },
  callout: {
    inlineEditable: true,
    hasSpecialEditor: true,
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['quote', 'paragraph'],
  },
  paragraph: {
    inlineEditable: true,
    hasSpecialEditor: true, // rich text / source editing
    canHaveChildren: false,
    movable: true,
    convertible: true,
    convertibleTo: ['heading', 'list-item', 'quote'],
  },
  code: {
    inlineEditable: false,
    hasSpecialEditor: true, // code editor
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  table: {
    inlineEditable: false,
    hasSpecialEditor: true, // table editor
    canHaveChildren: false,
    movable: true,
    convertible: true,
    convertibleTo: ['paragraph'],
  },
  image: {
    inlineEditable: true, // alt text
    hasSpecialEditor: true, // resource & property editing
    canHaveChildren: false,
    movable: true,
    convertible: true,
    convertibleTo: ['paragraph'],
  },
  html: {
    inlineEditable: false,
    hasSpecialEditor: true, // source editor
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  metadata: {
    inlineEditable: false,
    hasSpecialEditor: true, // key-value / source editor
    canHaveChildren: false,
    movable: false,
    convertible: false,
    convertibleTo: [],
  },
  footnote: {
    inlineEditable: false,
    hasSpecialEditor: true,
    canHaveChildren: false,
    movable: false,
    convertible: false,
    convertibleTo: [],
  },
  math: {
    inlineEditable: false,
    hasSpecialEditor: true,
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  diagram: {
    inlineEditable: false,
    hasSpecialEditor: true,
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  'definition-item': {
    inlineEditable: true,
    hasSpecialEditor: false,
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['paragraph'],
  },
  extension: {
    inlineEditable: false,
    hasSpecialEditor: true, // raw source editor
    canHaveChildren: false, // overridden by extension declaration
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  unknown: {
    inlineEditable: false,
    hasSpecialEditor: true, // raw source editor
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
};

/** Get the capability set for a node type. */
export function getCapabilities(type: SemanticType): NodeCapabilities {
  return CAPABILITY_TABLE[type];
}

// ─────────────────────────────────────────────────────────────────────────
// Visual family mapping (spec 002 §5.10)
// ─────────────────────────────────────────────────────────────────────────

const VISUAL_FAMILY_TABLE: Record<SemanticType, VisualFamily> = {
  root: 'structural',
  heading: 'structural',
  'list-item': 'textual',
  quote: 'textual',
  callout: 'notice',
  paragraph: 'textual',
  code: 'technical',
  table: 'data',
  image: 'media',
  html: 'technical',
  metadata: 'data',
  footnote: 'data',
  math: 'technical',
  diagram: 'technical',
  'definition-item': 'textual',
  extension: 'fallback',
  unknown: 'fallback',
};

export function getVisualFamily(type: SemanticType): VisualFamily {
  return VISUAL_FAMILY_TABLE[type];
}

// ─────────────────────────────────────────────────────────────────────────
// Occurrence tracking for semanticKey generation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Occurrence counter scoped to a parent path + type + content.
 * Using occurrence-of-same-content instead of a global sibling index
 * keeps IDs stable when unrelated siblings are inserted/removed.
 */
export class OccurrenceCounter {
  private counters = new Map<string, number>();

  reset(): void {
    this.counters.clear();
  }

  next(parentKey: string, type: SemanticType, content: string): number {
    const normalized = content.replace(/\s+/g, ' ').trim().slice(0, 120);
    const key = `${parentKey}|${type}|${normalized}`;
    const idx = this.counters.get(key) ?? 0;
    this.counters.set(key, idx + 1);
    return idx;
  }
}
