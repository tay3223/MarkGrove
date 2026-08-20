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
import { applyOperation, resetOpIdCounter, type OperationResult } from '../../src/semantic/operations';
import { serializeMarkdown, treesAreEquivalent } from '../../src/semantic/serializer';
import { resetRuntimeIdCounter } from '../../src/semantic/identity';
import type { SemanticNode, SemanticRoot, SemanticType } from '../../src/semantic/types';

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

    // ── No truncation (spec 001 §14.1, §22) ───────────────────────────
    // Adding a child must write the full text to source, not a truncation.
    it('writes full text of new child to source, not a truncated summary', () => {
      const md = '# Title\n\n# Other';
      const { root } = parseMarkdown(md, 'test.md');

      const newText = 'This is a long heading text that should appear in full in the source';
      const result = applyOperation(root, md, {
        kind: 'addChild',
        parentId: root.id,
        nodeType: 'heading',
        text: newText,
      });

      expect(result.error).toBeNull();
      expect(result.patchedSource).toContain(`# ${newText}`);
      // Re-parsed tree has the full text.
      const reparsed = parseMarkdown(result.patchedSource!, 'test.md');
      const newHeading = requireNode(reparsed.root, 'heading', newText);
      expect(newHeading.content.text).toBe(newText);
      // Unedited region preserved.
      expect(result.patchedSource).toContain('# Title');
      expect(result.patchedSource).toContain('# Other');
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

    // ── No truncation (spec 001 §14.2, §22) ───────────────────────────
    // Editing must use the full content.text, never a truncated display
    // summary. The patched source must contain the complete edited text.
    it('writes full text to source, not a truncated display summary', () => {
      const md = '# Short Title\n\nLong paragraph that will be edited.\n\n# Other';
      const { root } = parseMarkdown(md, 'test.md');
      const para = requireNode(root, 'paragraph', 'Long paragraph that will be edited.');

      // Simulate a UI edit that replaces the full text with new full text.
      // The UI retrieves node.content.text (full), not view.displayText (may be truncated).
      const fullText = para.content.text;
      expect(fullText).toBe('Long paragraph that will be edited.');

      const newText = 'This is the complete new text that replaces the old one entirely.';
      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: para.id,
        text: newText,
      });

      expect(result.error).toBeNull();
      // Layer 2: patched source contains the FULL new text, not a truncation.
      expect(result.patchedSource).toContain(newText);
      expect(result.patchedSource).not.toContain('Long paragraph that will be edited.');
      // Layer 3: re-parsed tree has the full text.
      const reparsed = parseMarkdown(result.patchedSource!, 'test.md');
      const reparsedPara = requireNode(reparsed.root, 'paragraph', newText);
      expect(reparsedPara.content.text).toBe(newText);
      // Layer 4: unedited region preserved.
      expect(result.patchedSource).toContain('# Short Title');
      expect(result.patchedSource).toContain('# Other');
    });

    it('preserves children when editing a list-item with nested children', () => {
      const md = '- Parent\n  - Child A\n  - Child B';
      const { root } = parseMarkdown(md, 'test.md');
      const parent = requireNode(root, 'list-item', 'Parent');

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: parent.id,
        text: 'Renamed Parent',
      });

      expect(result.error).toBeNull();
      expect(result.patchedSource).not.toBeNull();
      // Four-layer: re-parsed tree is equivalent to candidate tree.
      const reparsed = parseMarkdown(result.patchedSource!, 'test.md');
      expect(treesAreEquivalent(result.root, reparsed.root)).toBe(true);
      // Children must survive the edit (safe writeback transaction).
      const edited = requireNode(result.root, 'list-item', 'Renamed Parent');
      expect(edited.children.length).toBe(2);
      expect(edited.children.some(c => c.content.text === 'Child A')).toBe(true);
      expect(edited.children.some(c => c.content.text === 'Child B')).toBe(true);
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

  // ── Safe writeback transaction four-layer assertions (§22, §24) ──────

  /**
   * Verify the four layers required by spec 001 §22/§24 for every operation:
   *   1. Candidate tree: the returned root has the expected structural change.
   *   2. Final source:   patchedSource is non-null and re-parses successfully.
   *   3. Re-parsed tree: the re-parsed tree is semantically equivalent to the
   *      candidate tree (treesAreEquivalent).
   *   4. Unedited region: nodes outside the operation's scope keep their
   *      content/type/syntax (checked via the candidate tree).
   */
  function assertFourLayers(
    result: OperationResult,
    originalRoot: SemanticRoot,
  ): void {
    // Layer 1: candidate tree exists and operation succeeded.
    expect(result.error).toBeNull();
    expect(result.root).toBeDefined();

    // Layer 2: patched source is non-null.
    expect(result.patchedSource).not.toBeNull();

    // Layer 3: re-parsed tree is semantically equivalent to candidate tree.
    const reparsed = parseMarkdown(result.patchedSource!, originalRoot.fileName);
    expect(treesAreEquivalent(result.root, reparsed.root)).toBe(true);
  }

  describe('safe writeback transaction (P0/P1)', () => {
    // ── addChild four-layer ─────────────────────────────────────────
    describe('addChild four-layer assertion', () => {
      it('preserves candidate tree, source, re-parse equivalence and unedited region', () => {
        const md = '# Title\n\n## Sub';
        const { root } = parseMarkdown(md, 'test.md');

        const result = applyOperation(root, md, {
          kind: 'addChild',
          parentId: root.id,
          nodeType: 'heading',
          text: 'New Section',
        });

        assertFourLayers(result, root);

        // Layer 1: new heading exists at root level.
        const newHeading = findByType(result.root, 'heading', 'New Section');
        expect(newHeading).not.toBeNull();
        expect(result.root.children).toContain(newHeading);

        // Layer 4: unedited region — original headings preserved.
        const title = findByType(result.root, 'heading', 'Title');
        const sub = findByType(result.root, 'heading', 'Sub');
        expect(title).not.toBeNull();
        expect(sub).not.toBeNull();
        expect(title!.children).toContain(sub);
      });
    });

    // ── editNode four-layer ──────────────────────────────────────────
    describe('editNode four-layer assertion', () => {
      it('preserves syntax, re-parse equivalence and unedited siblings', () => {
        const md = '# A\n\n## B\n\n- item';
        const { root } = parseMarkdown(md, 'test.md');
        const b = requireNode(root, 'heading', 'B');

        const result = applyOperation(root, md, {
          kind: 'editNode',
          nodeId: b.id,
          text: 'Edited B',
        });

        assertFourLayers(result, root);

        // Layer 1: text changed, level preserved.
        const edited = requireNode(result.root, 'heading', 'Edited B');
        expect(edited.syntax.kind).toBe('heading');
        if (edited.syntax.kind === 'heading') {
          expect(edited.syntax.level).toBe(2);
        }

        // Layer 4: unedited region — A and item keep their text.
        expect(findByType(result.root, 'heading', 'A')).not.toBeNull();
        expect(findByType(result.root, 'list-item', 'item')).not.toBeNull();
        // Layer 2 detail: original source text of unedited nodes kept.
        expect(result.patchedSource).toContain('# A');
        expect(result.patchedSource).toContain('- item');
      });
    });

    // ── deleteNode subtree four-layer (jurisdiction fix P0-4) ────────
    describe('deleteNode subtree four-layer assertion (jurisdiction)', () => {
      it('removes the entire subtree jurisdiction, not just the title line', () => {
        const md = '# Title\n\n## Sub\n\n- item\n\n# Other';
        const { root } = parseMarkdown(md, 'test.md');
        const title = requireNode(root, 'heading', 'Title');

        const result = applyOperation(root, md, {
          kind: 'deleteNode',
          nodeId: title.id,
          mode: 'subtree',
        });

        assertFourLayers(result, root);

        // Layer 1: Title, Sub and item all gone.
        const all = collectAll(result.root);
        expect(all.some(n => n.content.text === 'Title')).toBe(false);
        expect(all.some(n => n.content.text === 'Sub')).toBe(false);
        expect(all.some(n => n.content.text === 'item')).toBe(false);

        // Layer 4: unedited region — 'Other' survives.
        expect(findByType(result.root, 'heading', 'Other')).not.toBeNull();

        // Layer 2 detail: source no longer contains the deleted subtree.
        expect(result.patchedSource).not.toContain('# Title');
        expect(result.patchedSource).not.toContain('## Sub');
        expect(result.patchedSource).not.toContain('- item');
        expect(result.patchedSource).toContain('# Other');
      });
    });

    // ── deleteNode lift-children four-layer ─────────────────────────
    describe('deleteNode lift-children four-layer assertion', () => {
      it('lifts children to grandparent and verifies re-parse equivalence', () => {
        const md = '# Title\n\n## Sub';
        const { root } = parseMarkdown(md, 'test.md');
        const title = requireNode(root, 'heading', 'Title');

        const result = applyOperation(root, md, {
          kind: 'deleteNode',
          nodeId: title.id,
          mode: 'lift-children',
        });

        assertFourLayers(result, root);

        // Layer 1: Title removed, Sub lifted to root.
        expect(findByType(result.root, 'heading', 'Title')).toBeNull();
        expect(result.root.children.some(n => n.content.text === 'Sub')).toBe(true);
      });
    });

    // ── moveNode four-layer ──────────────────────────────────────────
    describe('moveNode four-layer assertion', () => {
      it('adjusts heading level and verifies re-parse equivalence', () => {
        const md = '# A\n\n## B\n\n# C';
        const { root } = parseMarkdown(md, 'test.md');
        const a = requireNode(root, 'heading', 'A');
        const c = requireNode(root, 'heading', 'C');

        const result = applyOperation(root, md, {
          kind: 'moveNode',
          nodeId: c.id,
          newParentId: a.id,
        });

        assertFourLayers(result, root);

        // Layer 1: C is now a child of A with level 2.
        const updatedA = requireNode(result.root, 'heading', 'A');
        expect(updatedA.children.some(n => n.content.text === 'C')).toBe(true);
        const movedC = requireNode(result.root, 'heading', 'C');
        if (movedC.syntax.kind === 'heading') {
          expect(movedC.syntax.level).toBe(2);
        }

        // Layer 4: B remains a child of A.
        expect(updatedA.children.some(n => n.content.text === 'B')).toBe(true);
      });

      it('moves into a target (in) and appends at the end', () => {
        const md = '# A\n\n## B\n\n# C';
        const { root } = parseMarkdown(md, 'test.md');
        const a = requireNode(root, 'heading', 'A');
        const c = requireNode(root, 'heading', 'C');
        // Move C into A (last child) — emulates drop "in".
        const result = applyOperation(root, md, {
          kind: 'moveNode',
          nodeId: c.id,
          newParentId: a.id,
          newIndex: a.children.length,
        });
        assertFourLayers(result, root);
        const updatedA = requireNode(result.root, 'heading', 'A');
        expect(updatedA.children.map(n => n.content.text)).toEqual(['B', 'C']);
        const movedC = requireNode(result.root, 'heading', 'C');
        if (movedC.syntax.kind === 'heading') expect(movedC.syntax.level).toBe(2);
      });

      it('moves before a sibling (before) at the exact index', () => {
        const md = '# A\n\n# B\n\n# C';
        const { root } = parseMarkdown(md, 'test.md');
        const a = requireNode(root, 'heading', 'A');
        const c = requireNode(root, 'heading', 'C');
        // Move C before B (index 1 in root) — emulates drop "before".
        const result = applyOperation(root, md, {
          kind: 'moveNode',
          nodeId: c.id,
          newParentId: root.id,
          newIndex: 1,
        });
        assertFourLayers(result, root);
        expect(result.root.children.map(n => n.content.text)).toEqual(['A', 'C', 'B']);
      });

      it('moves after a sibling (after) at the exact index', () => {
        const md = '# A\n\n# B\n\n# C';
        const { root } = parseMarkdown(md, 'test.md');
        const a = requireNode(root, 'heading', 'A');
        const c = requireNode(root, 'heading', 'C');
        // Move C after A (index 1) — emulates drop "after" of A.
        const result = applyOperation(root, md, {
          kind: 'moveNode',
          nodeId: c.id,
          newParentId: root.id,
          newIndex: 1,
        });
        assertFourLayers(result, root);
        expect(result.root.children.map(n => n.content.text)).toEqual(['A', 'C', 'B']);
      });
    });

    // ── reorderSiblings four-layer ───────────────────────────────────
    describe('reorderSiblings four-layer assertion', () => {
      it('reorders in source and verifies re-parse equivalence', () => {
        const md = '# A\n\n# B\n\n# C';
        const { root } = parseMarkdown(md, 'test.md');
        expect(root.children.map(n => n.content.text)).toEqual(['A', 'B', 'C']);

        const result = applyOperation(root, md, {
          kind: 'reorderSiblings',
          parentId: root.id,
          fromIndex: 0,
          toIndex: 2,
        });

        assertFourLayers(result, root);

        // Layer 1: sibling order changed.
        expect(result.root.children.map(n => n.content.text)).toEqual(['B', 'C', 'A']);
        // Layer 4: all three headings still present with original levels.
        for (const text of ['A', 'B', 'C']) {
          const h = requireNode(result.root, 'heading', text);
          if (h.syntax.kind === 'heading') {
            expect(h.syntax.level).toBe(1);
          }
        }
      });
    });

    // ── convertNode four-layer ───────────────────────────────────────
    describe('convertNode four-layer assertion', () => {
      it('converts heading to paragraph and verifies re-parse equivalence', () => {
        const md = '# Title\n\n## Sub';
        const { root } = parseMarkdown(md, 'test.md');
        const heading = requireNode(root, 'heading', 'Title');

        const result = applyOperation(root, md, {
          kind: 'convertNode',
          nodeId: heading.id,
          newType: 'paragraph',
        });

        assertFourLayers(result, root);

        // Layer 1: type changed to paragraph.
        const converted = requireNode(result.root, 'paragraph', 'Title');
        expect(converted.syntax.kind).toBe('none');

        // Layer 4: Sub still exists.
        expect(findByType(result.root, 'heading', 'Sub')).not.toBeNull();
      });
    });

    // ── Failure rollback (§24 rule 10) ──────────────────────────────
    describe('failure rollback (§24 rule 10)', () => {
      it('rejects a move that would push the moved heading beyond H6', () => {
        // A is H6; moving B (H1) under A would make B H7 → reject wholesale.
        const md = '###### A\n\n# B';
        const { root } = parseMarkdown(md, 'test.md');
        const a = requireNode(root, 'heading', 'A');
        const b = requireNode(root, 'heading', 'B');

        const result = applyOperation(root, md, {
          kind: 'moveNode',
          nodeId: b.id,
          newParentId: a.id,
        });

        // Failure: error set, original root and source preserved.
        expect(result.error).not.toBeNull();
        expect(result.error).toMatch(/level/i);
        expect(result.root).toBe(root);
        expect(result.patchedSource).toBeNull();
      });

      it('rejects a move that would push a subtree heading beyond H6', () => {
        // P is H5; A is H1 with child B (H2). Moving A under P makes A H6
        // (ok), but B becomes H7 (out of range) → reject wholesale.
        const md = '##### P\n\n# A\n\n## B';
        const { root } = parseMarkdown(md, 'test.md');
        const p = requireNode(root, 'heading', 'P');
        const a = requireNode(root, 'heading', 'A');

        const result = applyOperation(root, md, {
          kind: 'moveNode',
          nodeId: a.id,
          newParentId: p.id,
        });

        expect(result.error).not.toBeNull();
        expect(result.error).toMatch(/range|level/i);
        expect(result.root).toBe(root);
        expect(result.patchedSource).toBeNull();
      });

      it('rolls back when the node does not exist', () => {
        const md = '# Title';
        const { root } = parseMarkdown(md, 'test.md');

        const result = applyOperation(root, md, {
          kind: 'editNode',
          nodeId: 'nonexistent-id',
          text: 'x',
        });

        expect(result.error).not.toBeNull();
        expect(result.root).toBe(root);
        expect(result.patchedSource).toBeNull();
      });

      it('rolls back when moving a node to its own descendant', () => {
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
        expect(result.root).toBe(root);
        expect(result.patchedSource).toBeNull();
      });

      it('rolls back when deleting the root node', () => {
        const md = '# Title';
        const { root } = parseMarkdown(md, 'test.md');

        const result = applyOperation(root, md, {
          kind: 'deleteNode',
          nodeId: root.id,
          mode: 'subtree',
        });

        expect(result.error).not.toBeNull();
        expect(result.error).toMatch(/root/i);
        expect(result.root).toBe(root);
        expect(result.patchedSource).toBeNull();
      });
    });

    // ── Unedited region source preservation (local patch operations) ─
    describe('unedited region source preservation', () => {
      it('addChild preserves the original source text of existing siblings', () => {
        const md = '# A\n\n## B\n\n- item';
        const { root } = parseMarkdown(md, 'test.md');
        const b = requireNode(root, 'heading', 'B');

        const result = applyOperation(root, md, {
          kind: 'addChild',
          parentId: b.id,
          nodeType: 'paragraph',
          text: 'New para',
        });

        expect(result.error).toBeNull();
        // Unedited blocks keep their exact source text.
        expect(result.patchedSource).toContain('# A');
        expect(result.patchedSource).toContain('## B');
        expect(result.patchedSource).toContain('- item');
      });

      it('deleteNode subtree preserves the exact source of blocks outside the jurisdiction', () => {
        const md = '# Keep\n\n## Delete\n\n- child\n\n# Also Keep';
        const { root } = parseMarkdown(md, 'test.md');
        const del = requireNode(root, 'heading', 'Delete');

        const result = applyOperation(root, md, {
          kind: 'deleteNode',
          nodeId: del.id,
          mode: 'subtree',
        });

        expect(result.error).toBeNull();
        expect(result.patchedSource).toContain('# Keep');
        expect(result.patchedSource).toContain('# Also Keep');
        expect(result.patchedSource).not.toContain('## Delete');
        expect(result.patchedSource).not.toContain('- child');
      });
    });
  });

  // ─── End-to-end fidelity across edit operations ──────────────────────
  // Editing a document in the middle must not corrupt the fidelity layer:
  // thematic breaks, link definitions, footnote definitions, and front matter
  // must survive the safe writeback transaction losslessly (spec 001 §12, §22).
  describe('fidelity layer survives an edit operation end-to-end', () => {
    it('preserves a thematic break when another heading is edited', () => {
      const md = '# A\n\n---\n\n# B';
      const { root } = parseMarkdown(md, 'test.md');
      const b = requireNode(root, 'heading', 'B');

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: b.id,
        text: 'B edited',
      });

      expect(result.error).toBeNull();
      expect(result.patchedSource).toBeTruthy();
      // Thematic break must remain, in source order, losslessly.
      expect(result.patchedSource).toContain('---');
      // Reparse preserves the break (fidelity item round-trips).
      const reparsed = parseMarkdown(result.patchedSource!, 'test.md');
      expect(reparsed.root.fidelityItems.some(f => f.kind === 'thematic-break')).toBe(true);
    });

    it('preserves link definitions and their references when editing elsewhere', () => {
      const md = '[x][id]\n\n[id]: https://example.com "T"\n\n# Heading';
      const { root } = parseMarkdown(md, 'test.md');
      const heading = requireNode(root, 'heading', 'Heading');

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: heading.id,
        text: 'Heading edited',
      });

      expect(result.error).toBeNull();
      expect(result.patchedSource).toBeTruthy();
      // The reference is NOT collapsed to `[x]()`.
      expect(result.patchedSource).toContain('[x][id]');
      // The definition is preserved.
      expect(result.patchedSource).toContain('[id]: https://example.com');
      // Reparse still collects the definition.
      const reparsed = parseMarkdown(result.patchedSource!, 'test.md');
      expect(reparsed.root.linkDefinitions).toHaveLength(1);
      expect(reparsed.root.linkDefinitions[0].identifier).toBe('id');
    });

    it('preserves footnote definitions without duplicating them when editing elsewhere', () => {
      const md = 'Text[^1]\n\n[^1]: Note\n\n# Heading';
      const { root } = parseMarkdown(md, 'test.md');
      const heading = requireNode(root, 'heading', 'Heading');

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: heading.id,
        text: 'Heading edited',
      });

      expect(result.error).toBeNull();
      expect(result.patchedSource).toBeTruthy();
      // No duplicated pseudo-footnote `[^1]: [^1]`.
      expect(result.patchedSource!.split('[^1]:').length - 1).toBe(1);
      // Original definition preserved.
      expect(result.patchedSource).toContain('[^1]: Note');
    });

    it('preserves front matter when editing a heading below it', () => {
      const md = '---\ntitle: Test\n---\n\n# Heading';
      const { root } = parseMarkdown(md, 'test.md');
      const heading = requireNode(root, 'heading', 'Heading');

      const result = applyOperation(root, md, {
        kind: 'editNode',
        nodeId: heading.id,
        text: 'Heading edited',
      });

      expect(result.error).toBeNull();
      expect(result.patchedSource).toBeTruthy();
      // Front matter remains the first block, losslessly.
      expect(result.patchedSource).toContain('title: Test');
      const reparsed = parseMarkdown(result.patchedSource!, 'test.md');
      expect(reparsed.root.children[0].type).toBe('metadata');
    });
  });
});
