/**
 * Node identity matching tests (spec 001 §21, §25.3).
 *
 * Verifies the multi-level matching strategy:
 *   1. Exact semanticKey match (type + content + ancestor + occurrence)
 *   2. Source range overlap (position-based)
 *   3. Type + content fingerprint (content-based, ignores ancestor)
 *   4. Same-type fallback (positional, weakest)
 *   5. No match → new identity
 *
 * Also tests matchTrees for recursive tree-level matching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseMarkdown } from '../../src/semantic/parser';
import {
  matchNodes,
  matchTrees,
  resetRuntimeIdCounter,
} from '../../src/semantic/identity';
import type { SemanticNode, SemanticRoot } from '../../src/semantic/types';

beforeEach(() => {
  resetRuntimeIdCounter();
});

describe('matchNodes — multi-level matching strategy', () => {
  it('matches nodes by exact semanticKey (strategy 1)', () => {
    const md = '# Title\n\nParagraph.';
    const { root: old1 } = parseMarkdown(md, 'test.md');
    resetRuntimeIdCounter();
    const { root: new1 } = parseMarkdown(md, 'test.md');

    // The heading captures the paragraph as its child (section-container),
    // so root has 1 child (the heading).
    const matchMap = matchNodes(old1.children, new1.children);
    expect(matchMap.size).toBe(1);
    // New heading matches old heading
    const newHeading = new1.children[0];
    const oldHeading = old1.children[0];
    expect(matchMap.get(newHeading.id)).toBe(oldHeading.id);
  });

  it('matches nodes by source range overlap when semanticKey differs (strategy 2)', () => {
    // Same content at same position but different ancestor → different semanticKey
    // but overlapping source ranges should still match
    const oldNodes: SemanticNode[] = [
      {
        id: 'old1',
        semanticKey: 'keyA',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'Hello', inline: null, raw: 'Hello' },
        syntax: { kind: 'none' },
        children: [],
        source: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 5, line: 1, column: 6 }, raw: 'Hello', leadingWhitespace: '', trailingWhitespace: '' },
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];
    const newNodes: SemanticNode[] = [
      {
        id: 'new1',
        semanticKey: 'keyB',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'Hello', inline: null, raw: 'Hello' },
        syntax: { kind: 'none' },
        children: [],
        source: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 5, line: 1, column: 6 }, raw: 'Hello', leadingWhitespace: '', trailingWhitespace: '' },
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];

    const matchMap = matchNodes(oldNodes, newNodes);
    expect(matchMap.get('new1')).toBe('old1');
  });

  it('matches nodes by type + content fingerprint (strategy 3)', () => {
    // No source overlap, different semanticKey, but same type and content
    const oldNodes: SemanticNode[] = [
      {
        id: 'old1',
        semanticKey: 'keyA',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'Same text', inline: null, raw: 'Same text' },
        syntax: { kind: 'none' },
        children: [],
        source: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 9, line: 1, column: 10 }, raw: 'Same text', leadingWhitespace: '', trailingWhitespace: '' },
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];
    const newNodes: SemanticNode[] = [
      {
        id: 'new1',
        semanticKey: 'keyB',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'Same text', inline: null, raw: 'Same text' },
        syntax: { kind: 'none' },
        children: [],
        source: { start: { offset: 100, line: 10, column: 1 }, end: { offset: 109, line: 10, column: 10 }, raw: 'Same text', leadingWhitespace: '', trailingWhitespace: '' },
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];

    const matchMap = matchNodes(oldNodes, newNodes);
    expect(matchMap.get('new1')).toBe('old1');
  });

  it('falls back to same-type positional matching (strategy 4)', () => {
    // Different content, different semanticKey, no source overlap, but same type
    const oldNodes: SemanticNode[] = [
      {
        id: 'old1',
        semanticKey: 'keyA',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'Old text', inline: null, raw: 'Old text' },
        syntax: { kind: 'none' },
        children: [],
        source: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 8, line: 1, column: 9 }, raw: 'Old text', leadingWhitespace: '', trailingWhitespace: '' },
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];
    const newNodes: SemanticNode[] = [
      {
        id: 'new1',
        semanticKey: 'keyB',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'New text', inline: null, raw: 'New text' },
        syntax: { kind: 'none' },
        children: [],
        source: { start: { offset: 100, line: 10, column: 1 }, end: { offset: 108, line: 10, column: 9 }, raw: 'New text', leadingWhitespace: '', trailingWhitespace: '' },
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];

    const matchMap = matchNodes(oldNodes, newNodes);
    expect(matchMap.get('new1')).toBe('old1');
  });

  it('returns no match when there are no old nodes of the same type (strategy 5)', () => {
    const oldNodes: SemanticNode[] = [
      {
        id: 'old1',
        semanticKey: 'keyA',
        type: 'heading',
        role: 'section-container',
        content: { text: 'Heading', inline: null, raw: '# Heading' },
        syntax: { kind: 'heading', level: 1, variant: 'atx' },
        children: [],
        source: null,
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: true, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];
    const newNodes: SemanticNode[] = [
      {
        id: 'new1',
        semanticKey: 'keyB',
        type: 'paragraph',
        role: 'block-leaf',
        content: { text: 'Paragraph', inline: null, raw: 'Paragraph' },
        syntax: { kind: 'none' },
        children: [],
        source: null,
        capabilities: { inlineEditable: true, hasSpecialEditor: false, canHaveChildren: false, movable: true, convertible: true, convertibleTo: [] },
        depth: 1,
      },
    ];

    const matchMap = matchNodes(oldNodes, newNodes);
    expect(matchMap.has('new1')).toBe(false);
  });

  it('handles duplicate headings with occurrence-based matching', () => {
    // Two headings with the same text should get different semanticKeys
    // due to different occurrence indices.
    const md = '# Title\n\n# Title';
    const { root } = parseMarkdown(md, 'test.md');
    const h1 = root.children[0];
    const h2 = root.children[1];
    // Same text but different semanticKeys
    expect(h1.semanticKey).not.toBe(h2.semanticKey);
  });
});

describe('matchTrees — recursive tree-level matching', () => {
  it('matches root and recurses into children', () => {
    const md = '# Title\n\nParagraph\n\n## Sub';
    const { root: oldRoot } = parseMarkdown(md, 'test.md');
    resetRuntimeIdCounter();
    const { root: newRoot } = parseMarkdown(md, 'test.md');

    const matchMap = matchTrees(oldRoot, newRoot);
    // Root matches
    expect(matchMap.get(newRoot.id)).toBe(oldRoot.id);
    // All children match
    for (const newChild of newRoot.children) {
      expect(matchMap.has(newChild.id)).toBe(true);
    }
  });

  it('preserves matching when a node is inserted before others', () => {
    // Parse original, then parse with an insertion at the front.
    // Existing nodes should still match via semanticKey or source overlap.
    const md1 = '# B\n\n# C';
    const md2 = '# A\n\n# B\n\n# C';

    const { root: oldRoot } = parseMarkdown(md1, 'test.md');
    resetRuntimeIdCounter();
    const { root: newRoot } = parseMarkdown(md2, 'test.md');

    const matchMap = matchTrees(oldRoot, newRoot);

    // "B" in new tree should match "B" in old tree
    const newB = newRoot.children[1];
    const oldB = oldRoot.children[0];
    expect(newB.content.text).toBe('B');
    expect(oldB.content.text).toBe('B');
    expect(matchMap.get(newB.id)).toBe(oldB.id);

    // "C" in new tree should match "C" in old tree
    const newC = newRoot.children[2];
    const oldC = oldRoot.children[1];
    expect(newC.content.text).toBe('C');
    expect(oldC.content.text).toBe('C');
    expect(matchMap.get(newC.id)).toBe(oldC.id);
  });

  it('matches nested children recursively', () => {
    const md = '# Title\n\n- item1\n  - nested\n- item2';
    const { root: oldRoot } = parseMarkdown(md, 'test.md');
    resetRuntimeIdCounter();
    const { root: newRoot } = parseMarkdown(md, 'test.md');

    const matchMap = matchTrees(oldRoot, newRoot);

    // Find the nested item in the new tree
    const newTitle = newRoot.children[0];
    const oldTitle = oldRoot.children[0];
    expect(matchMap.get(newTitle.id)).toBe(oldTitle.id);

    // The first list item should match
    const newItem1 = newTitle.children[0];
    const oldItem1 = oldTitle.children[0];
    expect(matchMap.get(newItem1.id)).toBe(oldItem1.id);

    // The nested item should match
    const newNested = newItem1.children[0];
    const oldNested = oldItem1.children[0];
    expect(matchMap.get(newNested.id)).toBe(oldNested.id);
  });
});
