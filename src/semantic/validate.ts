/**
 * Tree validation (spec 001 §24).
 *
 * Every mind map operation must pass these checks before committing:
 *   1. Tree must have exactly one root
 *   2. Every node ID is unique in the current document
 *   3. No cycles
 *   4. block-leaf must not have semantic children
 *   5. Heading depth must be 1–6
 *   6. Sibling order must be mappable to contiguous source blocks
 *   7. Every semantic node must have content or a legal empty content representation
 *   8. Unknown nodes must carry original source
 *   9. After any local patch, the entire Markdown must re-parse successfully
 *  10. On parse failure, revert the rewrite and preserve pre-edit source
 */

import type { SemanticNode, SemanticRoot } from './types';

export interface ValidationError {
  code: string;
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Validate a semantic tree against spec 001 §24 rules. */
export function validateTree(root: SemanticRoot): ValidationResult {
  const errors: ValidationError[] = [];

  // Rule 2: Unique IDs
  const ids = new Set<string>();
  const checkIds = (node: SemanticNode) => {
    if (ids.has(node.id)) {
      errors.push({
        code: 'DUPLICATE_ID',
        message: `Duplicate node ID: ${node.id}`,
        nodeId: node.id,
      });
    }
    ids.add(node.id);
    for (const child of node.children) checkIds(child);
  };
  checkIds(root);

  // Rule 3: No cycles (detect via DFS with visited-in-path set)
  const checkCycles = (node: SemanticNode, path: Set<string>) => {
    if (path.has(node.id)) {
      errors.push({
        code: 'CYCLE',
        message: `Cycle detected at node: ${node.id}`,
        nodeId: node.id,
      });
      return;
    }
    const newPath = new Set(path);
    newPath.add(node.id);
    for (const child of node.children) checkCycles(child, newPath);
  };
  checkCycles(root, new Set());

  // Rules 4, 5, 7, 8: per-node checks
  const checkNode = (node: SemanticNode) => {
    // Rule 4: block-leaf must not have semantic children
    if (node.role === 'block-leaf' && node.children.length > 0) {
      errors.push({
        code: 'LEAF_HAS_CHILDREN',
        message: `Block-leaf node ${node.id} (${node.type}) has ${node.children.length} children`,
        nodeId: node.id,
      });
    }

    // Rule 5: heading depth must be 1–6
    if (node.syntax.kind === 'heading') {
      if (node.syntax.level < 1 || node.syntax.level > 6) {
        errors.push({
          code: 'INVALID_HEADING_DEPTH',
          message: `Heading ${node.id} has invalid level: ${node.syntax.level}`,
          nodeId: node.id,
        });
      }
    }

    // Rule 7: every node must have content or legal empty content
    if (node.content.text === undefined || node.content.text === null) {
      errors.push({
        code: 'MISSING_CONTENT',
        message: `Node ${node.id} has no content`,
        nodeId: node.id,
      });
    }

    // Rule 8: unknown nodes must carry original source
    if (node.type === 'unknown' && !node.content.raw) {
      errors.push({
        code: 'UNKNOWN_NO_SOURCE',
        message: `Unknown node ${node.id} has no raw source`,
        nodeId: node.id,
      });
    }

    for (const child of node.children) checkNode(child);
  };
  checkNode(root);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Verify that a Markdown source round-trips successfully (spec 001 §24 rule 9).
 * Returns null if the source re-parses without error, or an error message.
 */
export function verifyRoundTrip(
  source: string,
  reparse: (source: string) => { root: SemanticRoot } | { error: string },
): string | null {
  try {
    const result = reparse(source);
    if ('error' in result) return result.error;
    const validation = validateTree(result.root);
    if (!validation.valid) {
      return validation.errors.map(e => e.message).join('; ');
    }
    return null;
  } catch (err) {
    return String(err);
  }
}
