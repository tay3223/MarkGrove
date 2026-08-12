/**
 * Projection tests (spec 001 §27, §25.1).
 *
 * Verifies:
 *   - Structure mode hides paragraphs (§27.1)
 *   - Balanced mode: short paragraphs visible, long hidden (§27.1)
 *   - Complete mode: all nodes visible (§27.1)
 *   - Projection does NOT modify the semantic tree (§27.2)
 *   - Content indicators computed for hidden children (§27.3)
 *   - Search finds nodes including hidden ones (§27.2)
 *   - Search returns path to each match (§27.2)
 *   - Mode switching preserves node identity (§25.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseMarkdown } from '../../src/semantic/parser';
import { projectTree, searchNodes } from '../../src/semantic/projection';
import { resetRuntimeIdCounter } from '../../src/semantic/identity';
import type {
  SemanticNode,
  SemanticType,
  ViewNode,
} from '../../src/semantic/types';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Collect all view node types recursively (DFS). */
function collectViewTypes(view: ViewNode): SemanticType[] {
  const types: SemanticType[] = [view.semanticType];
  for (const child of view.children) {
    types.push(...collectViewTypes(child));
  }
  return types;
}

/** Find the first view node of a given semantic type (DFS). */
function findViewByType(view: ViewNode, type: SemanticType): ViewNode | null {
  if (view.semanticType === type) return view;
  for (const child of view.children) {
    const found = findViewByType(child, type);
    if (found) return found;
  }
  return null;
}

/** Collect all view node display texts recursively (DFS). */
function collectViewTexts(view: ViewNode): string[] {
  const texts: string[] = [view.displayText];
  for (const child of view.children) {
    texts.push(...collectViewTexts(child));
  }
  return texts;
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('projection', () => {
  beforeEach(() => {
    resetRuntimeIdCounter();
  });

  // ── Structure mode (§27.1) ────────────────────────────────────────────

  it('structure mode hides paragraphs', () => {
    const md = '# Title\n\nA paragraph.\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'structure');

    // Root first child is the heading
    const heading = view.children[0];
    expect(heading.semanticType).toBe('heading');

    // The paragraph should NOT be visible as a child of the heading
    const childTypes = heading.children.map(c => c.semanticType);
    expect(childTypes).not.toContain('paragraph');
    // The sub-heading should still be visible
    expect(childTypes).toContain('heading');
  });

  it('structure mode: only headings, list-items, quotes visible; paragraphs hidden', () => {
    const md = '# Title\n\nA paragraph.\n\n- list item\n\n> a quote';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'structure');

    // Heading visible at root level
    const heading = view.children[0];
    expect(heading.semanticType).toBe('heading');

    // Collect visible types under the heading
    const visibleTypes = collectViewTypes(heading);
    expect(visibleTypes).toContain('heading');
    expect(visibleTypes).toContain('list-item');
    expect(visibleTypes).toContain('quote');
    // Paragraphs should be hidden
    expect(visibleTypes).not.toContain('paragraph');
  });

  // ── Balanced mode (§27.1) ─────────────────────────────────────────────

  it('balanced mode: short paragraphs visible, long ones hidden', () => {
    const shortText = 'Short.';
    const longText = 'A'.repeat(81); // > 80 chars threshold
    const md = `# Title\n\n${shortText}\n\n${longText}`;
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'balanced');

    const titleView = view.children[0];
    expect(titleView.semanticType).toBe('heading');

    const visibleTexts = titleView.children.map(c => c.displayText);
    // Short paragraph visible
    expect(visibleTexts).toContain(shortText);
    // Long paragraph hidden (not in visible children)
    expect(visibleTexts.some(t => t === longText)).toBe(false);
  });

  // ── Complete mode (§27.1) ─────────────────────────────────────────────

  it('complete mode: all nodes visible', () => {
    const md = '# Title\n\nA paragraph.\n\n```js\nconsole.log(1)\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');

    const allTypes = collectViewTypes(view);
    expect(allTypes).toContain('heading');
    expect(allTypes).toContain('paragraph');
    expect(allTypes).toContain('code');
  });

  // ── Immutability (§27.2) ──────────────────────────────────────────────

  it('does not modify the semantic tree', () => {
    const md = '# Title\n\nContent.';
    const { root } = parseMarkdown(md, 'test.md');
    const beforeJson = JSON.stringify(root);

    projectTree(root, 'structure');
    projectTree(root, 'balanced');
    projectTree(root, 'complete');

    expect(JSON.stringify(root)).toBe(beforeJson);
  });

  // ── Content indicators (§27.3) ────────────────────────────────────────

  it('content indicators computed for hidden children', () => {
    const md = '# Title\n\nA paragraph.\n\n```js\nconsole.log(1)\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'structure');

    const titleView = view.children[0];
    expect(titleView.semanticType).toBe('heading');
    // In structure mode, paragraph and code are hidden/indicators
    expect(titleView.contentIndicators.length).toBeGreaterThan(0);
    const indicatorTypes = titleView.contentIndicators.map(i => i.type);
    expect(indicatorTypes).toContain('paragraph');
    expect(indicatorTypes).toContain('code');
  });

  // ── Search (§27.2) ────────────────────────────────────────────────────

  it('search finds nodes including hidden ones', () => {
    const md = '# Title\n\nA hidden paragraph.\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');

    const results = searchNodes(root, 'hidden');

    expect(results.length).toBe(1);
    expect(results[0].node.type).toBe('paragraph');
    expect(results[0].node.content.text).toContain('hidden');
  });

  it('search returns path to each match', () => {
    const md = '# Title\n\nA hidden paragraph.\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');

    const results = searchNodes(root, 'hidden');

    expect(results.length).toBe(1);
    const path = results[0].path;
    expect(path.length).toBeGreaterThan(0);
    // Path should contain root → heading → paragraph (the match)
    const pathTypes = path.map(n => n.type);
    expect(pathTypes).toContain('root');
    expect(pathTypes).toContain('heading');
    expect(pathTypes).toContain('paragraph');
    // The last element of the path should be the matched node itself
    expect(path[path.length - 1]).toBe(results[0].node);
  });

  // ── Node identity across modes (§25.1) ────────────────────────────────

  it('mode switching does not change node identity (semanticNodeId stays same)', () => {
    const md = '# Title\n\nA paragraph.\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');

    const v1 = projectTree(root, 'structure');
    const v2 = projectTree(root, 'balanced');
    const v3 = projectTree(root, 'complete');

    // Root view node identity
    expect(v1.semanticNodeId).toBe(v2.semanticNodeId);
    expect(v2.semanticNodeId).toBe(v3.semanticNodeId);

    // Heading identity preserved across modes
    const h1 = findViewByType(v1, 'heading');
    const h2 = findViewByType(v2, 'heading');
    const h3 = findViewByType(v3, 'heading');
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    expect(h3).not.toBeNull();
    if (h1 && h2 && h3) {
      expect(h1.semanticNodeId).toBe(h2.semanticNodeId);
      expect(h2.semanticNodeId).toBe(h3.semanticNodeId);
    }
  });
});
