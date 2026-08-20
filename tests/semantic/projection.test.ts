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
import { projectTree, searchNodes, revealSearchPath } from '../../src/semantic/projection';
import type { ProjectionOverrides } from '../../src/semantic/projection';
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

  // ── Product-level: mode switching preserves semantic tree (§27.2) ─────

  it('mode switching does not modify the semantic tree (deep equality)', () => {
    const md = '# Title\n\nA paragraph.\n\n```js\nconsole.log(1)\n```\n\n## Sub\n\n- item 1\n- item 2';
    const { root } = parseMarkdown(md, 'test.md');
    const beforeJson = JSON.stringify(root);

    // Project in all three modes with various overrides
    projectTree(root, 'structure');
    projectTree(root, 'balanced');
    projectTree(root, 'complete');
    projectTree(root, 'structure', {
      expanded: new Set(['fake-id']),
      collapsed: new Set(),
      forceVisible: new Set(['fake-id']),
    });

    expect(JSON.stringify(root)).toBe(beforeJson);
  });

  // ── Product-level: force-visible reveals hidden nodes (§27.2) ─────────

  it('forceVisible override reveals hidden nodes in structure mode', () => {
    const md = '# Title\n\nA hidden paragraph.\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');

    // In structure mode, paragraph is hidden by default
    const defaultView = projectTree(root, 'structure');
    const heading = defaultView.children[0];
    expect(heading.semanticType).toBe('heading');

    // Find the paragraph's semantic node ID
    const paragraphNode = root.children[0].children.find(c => c.type === 'paragraph');
    expect(paragraphNode).toBeDefined();
    const paragraphId = paragraphNode!.id;

    // Paragraph should not be in visible children by default
    const defaultParagraphView = heading.children.find(c => c.semanticNodeId === paragraphId);
    expect(defaultParagraphView).toBeUndefined();

    // Now force it visible
    const overrides: ProjectionOverrides = {
      expanded: new Set(),
      collapsed: new Set(),
      forceVisible: new Set([paragraphId]),
    };
    const forcedView = projectTree(root, 'structure', overrides);
    const forcedHeading = forcedView.children[0];
    const forcedParagraphView = forcedHeading.children.find(c => c.semanticNodeId === paragraphId);
    expect(forcedParagraphView).toBeDefined();
    expect(forcedParagraphView!.hidden).toBe(false);
  });

  // ── Product-level: user expanded/collapsed overrides (§27.2) ──────────

  it('user expanded override takes precedence over mode default', () => {
    const md = '# Title\n\n## Sub1\n\n## Sub2\n\n### Deep';
    const { root } = parseMarkdown(md, 'test.md');

    // Default expansion: first 3 levels
    const defaultView = projectTree(root, 'complete');
    const title = defaultView.children[0];
    expect(title.expanded).toBe(true); // depth 0 → expanded

    // Force collapse the title
    const collapsedView = projectTree(root, 'complete', {
      expanded: new Set(),
      collapsed: new Set([title.semanticNodeId!]),
      forceVisible: new Set(),
    });
    const collapsedTitle = collapsedView.children[0];
    expect(collapsedTitle.expanded).toBe(false);

    // Force expand a deep node that would normally be collapsed
    const deepOverrides: ProjectionOverrides = {
      expanded: new Set(),
      collapsed: new Set(),
      forceVisible: new Set(),
    };
    // Find a deep node (depth >= 3) to test expansion override
    const findDeepNode = (view: ViewNode, targetDepth: number): ViewNode | null => {
      if (view.depth >= targetDepth) return view;
      for (const child of view.children) {
        const found = findDeepNode(child, targetDepth);
        if (found) return found;
      }
      return null;
    };
    const deepNode = findDeepNode(defaultView, 3);
    if (deepNode) {
      deepOverrides.expanded = new Set([deepNode.semanticNodeId!]);
      const expandedView = projectTree(root, 'complete', deepOverrides);
      const expandedDeep = findDeepNode(expandedView, 3);
      expect(expandedDeep?.expanded).toBe(true);
    }
  });

  // ── Product-level: search reveals ancestor paths (§27.2) ──────────────

  it('revealSearchPath collects match and all ancestor IDs', () => {
    const md = '# Title\n\n## Sub Heading\n\nA hidden paragraph with keyword.';
    const { root } = parseMarkdown(md, 'test.md');

    const results = searchNodes(root, 'keyword');
    expect(results.length).toBe(1);
    expect(results[0].node.type).toBe('paragraph');

    const revealIds = revealSearchPath(results);

    // The path should include root → heading → sub-heading → paragraph
    const pathIds = results[0].path.map(n => n.id);
    for (const id of pathIds) {
      expect(revealIds.has(id)).toBe(true);
    }
    // The reveal set should include the matched node itself
    expect(revealIds.has(results[0].node.id)).toBe(true);
    // The reveal set should include at least root + heading + sub-heading + paragraph
    expect(revealIds.size).toBe(pathIds.length);
  });

  it('revealSearchPath handles multiple matches with shared ancestors', () => {
    const md = '# Shared Title\n\n## Sub1\n\nkeyword here\n\n## Sub2\n\nanother keyword';
    const { root } = parseMarkdown(md, 'test.md');

    const results = searchNodes(root, 'keyword');
    expect(results.length).toBe(2);

    const revealIds = revealSearchPath(results);

    // Both matches share the root and the title heading as ancestors
    const rootId = root.id;
    const titleId = root.children[0].id;
    expect(revealIds.has(rootId)).toBe(true);
    expect(revealIds.has(titleId)).toBe(true);
    // Both paragraph matches should be included
    expect(revealIds.has(results[0].node.id)).toBe(true);
    expect(revealIds.has(results[1].node.id)).toBe(true);
    // Both sub-headings should be included (they're ancestors of their respective paragraphs)
    const sub1Id = results[0].path[results[0].path.length - 2].id;
    const sub2Id = results[1].path[results[1].path.length - 2].id;
    expect(revealIds.has(sub1Id)).toBe(true);
    expect(revealIds.has(sub2Id)).toBe(true);
  });

  it('forceVisible from revealSearchPath makes search hits visible in structure mode', () => {
    const md = '# Title\n\n## Sub\n\nA hidden paragraph with keyword.';
    const { root } = parseMarkdown(md, 'test.md');

    // Search and compute reveal IDs
    const results = searchNodes(root, 'keyword');
    expect(results.length).toBe(1);
    const revealIds = revealSearchPath(results);

    // Project in structure mode with force-visible
    const view = projectTree(root, 'structure', {
      expanded: new Set(),
      collapsed: new Set(),
      forceVisible: revealIds,
    });

    // The paragraph should now be visible (not hidden)
    const paragraphView = findViewByType(view, 'paragraph');
    expect(paragraphView).not.toBeNull();
    expect(paragraphView!.hidden).toBe(false);
  });

  // ── Product-level: mode switching preserves node identity deeply (§25.1)

  it('mode switching preserves node identity for all nodes, not just the first', () => {
    const md = '# Title\n\n## Sub1\n\nPara1\n\n## Sub2\n\nPara2\n\n### Deep\n\nDeep para';
    const { root } = parseMarkdown(md, 'test.md');

    const vStruct = projectTree(root, 'structure');
    const vBalanced = projectTree(root, 'balanced');
    const vComplete = projectTree(root, 'complete');

    // Collect all (semanticNodeId, type) pairs from each view
    function collectIds(view: ViewNode): Map<string, string> {
      const map = new Map<string, string>();
      const walk = (n: ViewNode) => {
        if (n.semanticNodeId) map.set(n.semanticNodeId, n.semanticType);
        n.children.forEach(walk);
      };
      walk(view);
      return map;
    }

    const idsStruct = collectIds(vStruct);
    const idsBalanced = collectIds(vBalanced);
    const idsComplete = collectIds(vComplete);

    // Complete mode should have all nodes from the semantic tree
    // Balanced should have a subset (some hidden)
    // Structure should have a subset (more hidden)
    // But all IDs that appear in any mode should map to the same type
    for (const [id, type] of idsComplete) {
      if (idsStruct.has(id)) {
        expect(idsStruct.get(id)).toBe(type);
      }
      if (idsBalanced.has(id)) {
        expect(idsBalanced.get(id)).toBe(type);
      }
    }

    // Complete mode should have more visible nodes than structure mode
    expect(idsComplete.size).toBeGreaterThanOrEqual(idsStruct.size);
  });

  // ── Product-level: content indicators update with mode (§27.3) ────────

  it('content indicators reflect hidden children type and count per mode', () => {
    const md = '# Title\n\nPara1\n\n```js\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    const { root } = parseMarkdown(md, 'test.md');

    // Structure mode: paragraph, code, table all hidden → indicators present
    const structView = projectTree(root, 'structure');
    const structHeading = structView.children[0];
    const structIndicators = structHeading.contentIndicators;
    const structTypes = structIndicators.map(i => i.type);
    expect(structTypes).toContain('paragraph');
    expect(structTypes).toContain('code');
    expect(structTypes).toContain('table');

    // Complete mode: nothing hidden → no indicators
    const completeView = projectTree(root, 'complete');
    const completeHeading = completeView.children[0];
    expect(completeHeading.contentIndicators.length).toBe(0);
  });
});
