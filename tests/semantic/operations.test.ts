/**
 * Tree operations tests (spec 001 §14, §24).
 *
 * Verifies:
 *   - addChild (§14.1): root, heading, list-item; leaf rejection
 *   - editNode (§14.2): heading/list-item text edit preserving syntax
 *   - deleteNode (§14.3): subtree and lift-children modes
 *   - moveNode (§14.4): level adjustment, self/descendant rejection
 *   - reorderSiblings (§14.5)
 *   - convertNode: heading↔paragraph, non-convertible rejection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseMarkdown } from '../../src/semantic/parser';
import { applyOperation, resetOpIdCounter } from '../../src/semantic/operations';
import { resetRuntimeIdCounter } from '../../src/semantic/identity';
import type { SemanticNode, SemanticType } from '../../src/semantic/types';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** DFS search for the first node matching a predicate. */
function findFirst(
  root: SemanticNode,
  predicate: (n: SemanticNode) => boolean,
): SemanticNode | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

/** Find a node by type and optional content text. Returns null if not found. */
function findByType(
  root: SemanticNode,
  type: SemanticType,
  text?: string,
): SemanticNode | null {
  return findFirst(
    root,
    n => n.type === type && (text === undefined || n.content.text === text),
  );
}

/** Require a node to exist; throws if missing. */
function requireNode(
  root: SemanticNode,
  type: SemanticType,
  text?: string,
): SemanticNode {
  const node = findByType(root, type, text);
  if (!node) {
    throw new Error(`Node not found: type=${type}, text=${text ?? '(any)'}`);
  }
  return node;
}

/** Collect every node in the tree (DFS order). */
function collectAll(root: SemanticNode): SemanticNode[] {
  const result: SemanticNode[] = [];
  const walk = (n: SemanticNode): void => {
    result.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('operations', () => {
  beforeEach(() => {
    resetOpIdCounter();
    resetRuntimeIdCounter();
  });

  // ── addChild (§14.1) ──────────────────────────────────────────────────

  describe('addChild', () => {
    it('adds a child heading to root', () => {
      const md = '# Title';
      const { root } = parseMarkdown(md, 'test.md');

      const result = applyOperation(root, md, {
        kind: 'addChild',
        parentId: root.id,
        nodeType: 'heading',
        text: 'New Section',
      });

      expect(result.error).toBeNull();
      const newHeading = findByType(result.root, 'heading', 'New Section');
      expect(newHeading).not.toBeNull();
      expect(result.root.children).toContain(newHeading);
    });

    it('adds a child heading to a heading (next level)', () => {
      const md = '# Title';
      const { root } = parseMarkdown(md, 'test.md');
      const title = requireNode(root, 'heading', 'Title');

      const result = applyOperation(root, md, {
        kind: 'addChild',
        parentId: title.id,
        nodeType: 'heading',
        text: 'Subsection',
      });

      expect(result.error).toBeNull();
      const sub = requireNode(result.root, 'heading', 'Subsection');
      expect(sub.syntax.kind).toBe('heading');
      if (sub.syntax.kind === 'heading') {
        // Parent is H1 so child should be H2 (section 14.1)
        expect(sub.syntax.level).toBe(2);
      }
    });

    it('adds a nested list-item to a list-item', () => {
      const md = '- Item';
      const { root } = parseMarkdown(md, 'test.md');
      const item = requireNode(root, 'list-item', 'Item');

      const result = applyOperation(root, md, {
        kind: 'addChild',
        parentId: item.id,
        nodeType: 'list-item',
        text: 'Nested',
      });

      expect(result.error).toBeNull();
      const updatedItem = requireNode(result.root, 'list-item', 'Item');
      const nested = findByType(result.root, 'list-item', 'Nested');
      expect(nested).not.toBeNull();
      expect(updatedItem.children).toContain(nested);
    });

    it('fails when adding a child to a leaf node (paragraph)', () => {
      const md = 'Some text.';
      const { root } = parseMarkdown(md, 'test.md');
      const para = requireNode(root, 'paragraph', 'Some text.');

      const result = applyOperation(root, md, {
        kind: 'addChild',
        parentId: para.id,
        nodeType: 'paragraph',
        text: 'x',
      });

      expect(result.error).not.toBeNull();
      expect(result.error).toMatch(/cannot have children/i);
    });
  });

  // ── editNode (section 14.2) ───────────────────────────────────────────

  describe('editNode', () => {
    it('edits heading text and preserves level', () => {
      const md = '# Title';
      const { root } = parseMarkdown(md, 'test.md');
      const heading = requireNode(root, 'heading', 'Title');
      const originalLevel =
        heading.syntax.kind === 'heading' ? heading.syntax.level : null;

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: heading.id,
        text: 'Edited Title',
      });

      expect(result.error).toBeNull();
      const edited = requireNode(result.root, 'heading', 'Edited Title');
      expect(edited.syntax.kind).toBe('heading');
      if (edited.syntax.kind === 'heading' && originalLevel !== null) {
        expect(edited.syntax.level).toBe(originalLevel);
      }
    });

    it('edits list-item text and preserves list type', () => {
      const md = '- Original';
      const { root } = parseMarkdown(md, 'test.md');
      const item = requireNode(root, 'list-item', 'Original');
      const originalMarker =
        item.syntax.kind === 'list-item' ? item.syntax.marker : null;

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: item.id,
        text: 'Edited',
      });

      expect(result.error).toBeNull();
      const edited = requireNode(result.root, 'list-item', 'Edited');
      expect(edited.syntax.kind).toBe('list-item');
      if (edited.syntax.kind === 'list-item' && originalMarker !== null) {
        expect(edited.syntax.marker).toBe(originalMarker);
      }
    });
  });

  // ── deleteNode (section 14.3) ─────────────────────────────────────────

  describe('deleteNode', () => {
    it('deletes a subtree (node and all descendants)', () => {
      const md = '# Title\n\n## Sub\n\n- item';
      const { root } = parseMarkdown(md, 'test.md');
      const title = requireNode(root, 'heading', 'Title');

      const result = applyOperation(root, md, {
        kind: 'deleteNode',
        nodeId: title.id,
        mode: 'subtree',
      });

      expect(result.error).toBeNull();
      const all = collectAll(result.root);
      expect(all.some(n => n.content.text === 'Title')).toBe(false);
      expect(all.some(n => n.content.text === 'Sub')).toBe(false);
    });

    it('deletes with lift-children (children move to parent)', () => {
      const md = '# Title\n\n## Sub';
      const { root } = parseMarkdown(md, 'test.md');
      const title = requireNode(root, 'heading', 'Title');

      const result = applyOperation(root, md, {
        kind: 'deleteNode',
        nodeId: title.id,
        mode: 'lift-children',
      });

      expect(result.error).toBeNull();
      const all = collectAll(result.root);
      // Title removed
      expect(all.some(n => n.content.text === 'Title')).toBe(false);
      // Sub lifted to root
      expect(result.root.children.some(n => n.content.text === 'Sub')).toBe(true);
    });
  });

  // ── moveNode (section 14.4) ───────────────────────────────────────────

  describe('moveNode', () => {
    it('moves a node to a new parent and adjusts heading level', () => {
      const md = '# A\n\n## B\n\n# C';
      const { root } = parseMarkdown(md, 'test.md');
      const a = requireNode(root, 'heading', 'A');
      const c = requireNode(root, 'heading', 'C');

      const result = applyOperation(root, md, {
        kind: 'moveNode',
        nodeId: c.id,
        newParentId: a.id,
      });

      expect(result.error).toBeNull();
      // C should now be a child of A
      const updatedA = requireNode(result.root, 'heading', 'A');
      expect(updatedA.children.some(n => n.content.text === 'C')).toBe(true);
      // C level should be adjusted to A level + 1 = 2 (section 14.4)
      const movedC = requireNode(result.root, 'heading', 'C');
      expect(movedC.syntax.kind).toBe('heading');
      if (movedC.syntax.kind === 'heading') {
        expect(movedC.syntax.level).toBe(2);
      }
    });

    it('fails when moving a node to itself', () => {
      const md = '# Title';
      const { root } = parseMarkdown(md, 'test.md');
      const heading = requireNode(root, 'heading', 'Title');

      const result = applyOperation(root, md, {
        kind: 'moveNode',
        nodeId: heading.id,
        newParentId: heading.id,
      });

      expect(result.error).not.toBeNull();
      expect(result.error).toMatch(/itself/i);
    });

    it('fails when moving a node to its own descendant', () => {
      const md = '# A\n\n## B';
      const { root } = parseMarkdown(md, 'test.md');
      const a = requireNode(root, 'heading', 'A');
      const b = requireNode(root, 'heading', 'B');

      const result = applyOperation(root, md, {
        kind: 'moveNode',
        nodeId: a.id,
        newParentId: b.id,
      });

      expect(result.error).not.toBeNull();
      expect(result.error).toMatch(/descendant/i);
    });
  });

  // ── reorderSiblings (section 14.5) ────────────────────────────────────

  describe('reorderSiblings', () => {
    it('reorders siblings within a parent', () => {
      const md = '# A\n\n# B\n\n# C';
      const { root } = parseMarkdown(md, 'test.md');
      // All three H1 headings are direct children of root
      expect(root.children.map(n => n.content.text)).toEqual(['A', 'B', 'C']);

      const result = applyOperation(root, md, {
        kind: 'reorderSiblings',
        parentId: root.id,
        fromIndex: 0,
        toIndex: 2,
      });

      expect(result.error).toBeNull();
      expect(result.root.children.map(n => n.content.text)).toEqual(['B', 'C', 'A']);
    });
  });

  // ── convertNode ───────────────────────────────────────────────────────

  describe('convertNode', () => {
    it('converts a heading to a paragraph', () => {
      const md = '# Title';
      const { root } = parseMarkdown(md, 'test.md');
      const heading = requireNode(root, 'heading', 'Title');

      const result = applyOperation(root, md, {
        kind: 'convertNode',
        nodeId: heading.id,
        newType: 'paragraph',
      });

      expect(result.error).toBeNull();
      const converted = requireNode(result.root, 'paragraph', 'Title');
      expect(converted.syntax.kind).toBe('none');
    });

    it('converts a paragraph to a heading', () => {
      const md = 'Some text.';
      const { root } = parseMarkdown(md, 'test.md');
      const para = requireNode(root, 'paragraph', 'Some text.');

      const result = applyOperation(root, md, {
        kind: 'convertNode',
        nodeId: para.id,
        newType: 'heading',
      });

      expect(result.error).toBeNull();
      const converted = requireNode(result.root, 'heading', 'Some text.');
      expect(converted.syntax.kind).toBe('heading');
      if (converted.syntax.kind === 'heading') {
        expect(converted.syntax.level).toBe(1);
      }
    });

    it('fails when converting a non-convertible type (code)', () => {
      const md = '```js\nconsole.log(1)\n```';
      const { root } = parseMarkdown(md, 'test.md');
      const code = requireNode(root, 'code');

      const result = applyOperation(root, md, {
        kind: 'convertNode',
        nodeId: code.id,
        newType: 'paragraph',
      });

      expect(result.error).not.toBeNull();
      expect(result.error).toMatch(/not convertible|cannot convert/i);
    });
  });
});
