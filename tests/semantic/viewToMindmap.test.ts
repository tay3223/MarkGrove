/**
 * ViewTree → MindmapNode bridge tests.
 *
 * Verifies that the conversion from the semantic ViewTree to MindElixir's
 * MindmapNode format preserves:
 *   - Node identity (semantic IDs)
 *   - Display text
 *   - Source positions (for source navigation)
 *   - Node types (for AuxPanel)
 *   - Code content and language
 *   - Table data
 *   - Children hierarchy
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown, projectTree, viewToMindmap, createSourceLookup } from '../../src/semantic';
import type { MindmapNode } from '../../src/types';

function findMindNode(root: MindmapNode, topic: string): MindmapNode | null {
  if (root.topic.includes(topic)) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findMindNode(child, topic);
      if (found) return found;
    }
  }
  return null;
}

describe('viewToMindmap bridge', () => {
  it('converts a simple heading tree to MindmapNode', () => {
    const md = '# Title\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'balanced');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    expect(mindNode).toBeDefined();
    expect(mindNode.children).toBeDefined();
    expect(mindNode.children!.length).toBeGreaterThan(0);

    const titleNode = findMindNode(mindNode, 'Title');
    expect(titleNode).not.toBeNull();
    expect(titleNode!.data?.nodeType).toBe('heading');
    expect(titleNode!.data?.headingLevel).toBe(1);
  });

  it('preserves source positions for source navigation', () => {
    const md = '# Title\n\nParagraph.\n\n```js\nconsole.log(1)\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    // Find the heading node
    const findWithSource = (node: MindmapNode): MindmapNode | null => {
      if (node.data?.sourcePosition) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findWithSource(child);
          if (found) return found;
        }
      }
      return null;
    };

    const nodeWithSource = findWithSource(mindNode);
    expect(nodeWithSource).not.toBeNull();
    expect(nodeWithSource!.data?.sourcePosition).toBeDefined();
    expect(nodeWithSource!.data?.sourcePosition.start.line).toBeDefined();
    expect(nodeWithSource!.data?.sourcePosition.end.line).toBeDefined();
  });

  it('preserves code content and language', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    const codeNode = findMindNode(mindNode, 'typescript');
    expect(codeNode).not.toBeNull();
    expect(codeNode!.data?.nodeType).toBe('code');
    expect(codeNode!.data?.codeLang).toBe('typescript');
    expect(codeNode!.data?.codeContent).toContain('const x = 1');
  });

  it('preserves table headers and rows', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    const tableNode = findMindNode(mindNode, '表格');
    expect(tableNode).not.toBeNull();
    expect(tableNode!.data?.nodeType).toBe('table');
    expect(tableNode!.data?.headers).toBeDefined();
    expect(tableNode!.data?.headers).toContain('A');
    expect(tableNode!.data?.headers).toContain('B');
  });

  it('preserves children hierarchy', () => {
    const md = '# Parent\n\n## Child A\n\n## Child B';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'balanced');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    // Root should have children
    expect(mindNode.children).toBeDefined();
    expect(mindNode.children!.length).toBeGreaterThan(0);

    // Find the Parent heading
    const parent = findMindNode(mindNode, 'Parent');
    expect(parent).not.toBeNull();
    expect(parent!.children).toBeDefined();
    expect(parent!.children!.length).toBe(2);

    // Children should be Child A and Child B
    const childTopics = parent!.children!.map(c => c.topic);
    expect(childTopics.some(t => t.includes('Child A'))).toBe(true);
    expect(childTopics.some(t => t.includes('Child B'))).toBe(true);
  });

  it('uses semantic node IDs as MindmapNode IDs', () => {
    const md = '# Title';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'balanced');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    // Root ID should match the semantic root's ID
    expect(mindNode.id).toBe(view.semanticNodeId);

    // Child ID should match the heading's semantic ID
    if (view.children.length > 0 && mindNode.children) {
      expect(mindNode.children[0].id).toBe(view.children[0].semanticNodeId);
    }
  });

  it('handles empty document', () => {
    const md = '';
    const { root } = parseMarkdown(md, 'empty.md');
    const view = projectTree(root, 'balanced');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    expect(mindNode).toBeDefined();
    expect(mindNode.topic).toBeDefined();
  });

  it('line range is computed from source position', () => {
    const md = '# Title\n\nParagraph.\n\n```js\ncode\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    // Find a node with lineRange
    const findWithLineRange = (node: MindmapNode): MindmapNode | null => {
      if (node.data?.lineRange) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findWithLineRange(child);
          if (found) return found;
        }
      }
      return null;
    };

    const nodeWithRange = findWithLineRange(mindNode);
    expect(nodeWithRange).not.toBeNull();
    expect(nodeWithRange!.data?.lineRange).toMatch(/^\d+-\d+$/);
  });

  it('content indicators are appended to topic for leaf nodes', () => {
    const md = '# Title\n\nA paragraph.\n\n```js\ncode\n```';
    const { root } = parseMarkdown(md, 'test.md');
    // Use structure mode so content becomes indicators
    const view = projectTree(root, 'structure');
    const lookup = createSourceLookup(root);
    const mindNode = viewToMindmap(view, lookup);

    // In structure mode, the heading should have content indicators
    const titleNode = findMindNode(mindNode, 'Title');
    expect(titleNode).not.toBeNull();
    // The topic should contain indicator information when there are no visible children
    const childCount = titleNode!.children?.length ?? 0;
    if (childCount === 0) {
      expect(titleNode!.topic).toContain('·');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unified NodeContainer skeleton (spec 002 §3)
//
// All semantic node types MUST share the same slot structure:
//   nc-surface
//     nc-accent-bar
//     nc-leading (icon/checkbox/bullet)
//     nc-body
//       nc-eyebrow (type/level/lang)
//       nc-title
//       nc-summary (optional)
//       nc-preview (optional: code/table/image)
//     nc-trailing (indicators + children-toggle)
//   nc-children-toggle (when has children)
//
// These tests verify the skeleton contract holds across every type.
// ─────────────────────────────────────────────────────────────────────────

describe('NodeContainer unified skeleton (spec 002 §3)', () => {
  /** Collect every MindmapNode in the tree. */
  function collectAll(root: MindmapNode): MindmapNode[] {
    const out: MindmapNode[] = [root];
    if (root.children) {
      for (const c of root.children) out.push(...collectAll(c));
    }
    return out;
  }

  /** Assert the core skeleton slots are present in the HTML. */
  function expectSkeleton(html: string | undefined): void {
    expect(html, 'dangerouslySetInnerHTML must be generated').toBeDefined();
    expect(html!).toContain('class="nc-surface');
    expect(html!).toContain('class="nc-accent-bar"');
    expect(html!).toContain('class="nc-body"');
    expect(html!).toContain('class="nc-title"');
  }

  it('root node uses the unified skeleton', () => {
    const md = '# Doc\n';
    const { root } = parseMarkdown(md, 'doc.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    expectSkeleton(mindNode.dangerouslySetInnerHTML);
    expect(mindNode.dangerouslySetInnerHTML).toContain('nc-type-root');
    expect(mindNode.dangerouslySetInnerHTML).toContain('nc-family-structural');
    expect(mindNode.dangerouslySetInnerHTML).toContain('nc-icon-root');
  });

  it('heading node uses the unified skeleton with H-level eyebrow', () => {
    const md = '# Title\n\n## Sub\n\n### Deep';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const h2 = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-eyebrow">H2'));
    expect(h2, 'H2 eyebrow should exist').toBeDefined();
    expectSkeleton(h2!.dangerouslySetInnerHTML);
    expect(h2!.dangerouslySetInnerHTML).toContain('nc-type-heading');
    expect(h2!.dangerouslySetInnerHTML).toContain('nc-family-structural');
  });

  it('list-item (unordered) uses the unified skeleton with bullet leading', () => {
    const md = '- one\n- two\n- three';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const items = all.filter(n => n.dangerouslySetInnerHTML?.includes('nc-type-list-item'));
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expectSkeleton(it.dangerouslySetInnerHTML);
      expect(it.dangerouslySetInnerHTML).toContain('nc-bullet');
      // list-item belongs to the textual family (see identity.ts VISUAL_FAMILY_TABLE)
      expect(it.dangerouslySetInnerHTML).toContain('nc-family-textual');
    }
  });

  it('list-item (task) uses checkbox leading', () => {
    const md = '- [x] done\n- [ ] todo';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const html = mindNode.dangerouslySetInnerHTML ?? '';
    const all = collectAll(mindNode);
    const checked = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-checked'));
    const unchecked = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-unchecked'));
    expect(checked, 'checked checkbox should exist').toBeDefined();
    expect(unchecked, 'unchecked checkbox should exist').toBeDefined();
    expectSkeleton(checked!.dangerouslySetInnerHTML);
  });

  it('list-item (ordered) uses ordered bullet leading', () => {
    const md = '1. first\n2. second';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const ordered = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-ordered'));
    expect(ordered, 'ordered bullet should exist').toBeDefined();
    expectSkeleton(ordered!.dangerouslySetInnerHTML);
  });

  it('quote node uses the unified skeleton with quote icon', () => {
    const md = '> A quoted paragraph.';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const quote = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-quote'));
    expect(quote, 'quote node should exist').toBeDefined();
    expectSkeleton(quote!.dangerouslySetInnerHTML);
    expect(quote!.dangerouslySetInnerHTML).toContain('nc-icon-quote');
    expect(quote!.dangerouslySetInnerHTML).toContain('nc-family-textual');
  });

  it('code node uses the unified skeleton with code preview', () => {
    const md = '```ts\nconst x = 1;\nconst y = 2;\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const code = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-code'));
    expect(code, 'code node should exist').toBeDefined();
    expectSkeleton(code!.dangerouslySetInnerHTML);
    expect(code!.dangerouslySetInnerHTML).toContain('nc-eyebrow">ts');
    expect(code!.dangerouslySetInnerHTML).toContain('nc-code-preview');
    expect(code!.dangerouslySetInnerHTML).toContain('nc-family-technical');
  });

  it('table node uses the unified skeleton with table preview', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const table = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-table'));
    expect(table, 'table node should exist').toBeDefined();
    expectSkeleton(table!.dangerouslySetInnerHTML);
    expect(table!.dangerouslySetInnerHTML).toContain('nc-icon-table');
    expect(table!.dangerouslySetInnerHTML).toContain('nc-table-preview');
    expect(table!.dangerouslySetInnerHTML).toContain('nc-family-data');
  });

  it('image node uses the unified skeleton with image preview', () => {
    const md = '![alt text](https://example.com/img.png)';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const image = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-image'));
    expect(image, 'image node should exist').toBeDefined();
    expectSkeleton(image!.dangerouslySetInnerHTML);
    expect(image!.dangerouslySetInnerHTML).toContain('nc-image-preview');
    expect(image!.dangerouslySetInnerHTML).toContain('nc-family-media');
  });

  it('sanitizes image src against javascript:/data: protocols (spec 002 §13.3)', () => {
    const md = '![x](javascript:alert(1))';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const image = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-image-preview'));
    expect(image, 'image node should exist').toBeDefined();
    // The javascript: URI must not survive into src.
    expect(image!.dangerouslySetInnerHTML).not.toContain('javascript:');
  });

  it('html node uses the unified skeleton with html icon', () => {
    const md = '# Title\n\n<div class="raw">html</div>';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const htmlNode = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-html'));
    expect(htmlNode, 'html node should exist').toBeDefined();
    expectSkeleton(htmlNode!.dangerouslySetInnerHTML);
    expect(htmlNode!.dangerouslySetInnerHTML).toContain('nc-icon-html');
  });

  it('metadata (frontmatter) node uses the unified skeleton', () => {
    const md = '---\ntitle: Doc\n---\n\n# Body';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const meta = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-metadata'));
    expect(meta, 'metadata node should exist').toBeDefined();
    expectSkeleton(meta!.dangerouslySetInnerHTML);
    expect(meta!.dangerouslySetInnerHTML).toContain('nc-icon-metadata');
  });

  it('footnote node uses the unified skeleton with footnote icon', () => {
    const md = 'Text[^1]\n\n[^1]: note body';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const fn = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-footnote'));
    expect(fn, 'footnote node should exist').toBeDefined();
    expectSkeleton(fn!.dangerouslySetInnerHTML);
    expect(fn!.dangerouslySetInnerHTML).toContain('nc-icon-footnote');
  });

  it('math node uses the unified skeleton with math icon', () => {
    const md = '```math\nE = mc^2\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const math = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-math'));
    expect(math, 'math node should exist').toBeDefined();
    expectSkeleton(math!.dangerouslySetInnerHTML);
    expect(math!.dangerouslySetInnerHTML).toContain('nc-icon-math');
  });

  it('diagram node uses the unified skeleton with diagram icon', () => {
    const md = '```mermaid\ngraph LR\nA-->B\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const diagram = all.find(n => n.dangerouslySetInnerHTML?.includes('nc-type-diagram'));
    expect(diagram, 'diagram node should exist').toBeDefined();
    expectSkeleton(diagram!.dangerouslySetInnerHTML);
    expect(diagram!.dangerouslySetInnerHTML).toContain('nc-icon-diagram');
  });

  it('every node in a mixed document carries the nc-surface skeleton', () => {
    const md = [
      '---',
      'title: Mixed',
      '---',
      '',
      '# Heading',
      '',
      '> Quote text',
      '',
      '- list item',
      '- [x] task',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '![img](https://example.com/x.png)',
      '',
      '<div>html</div>',
      '',
      'Text[^1]',
      '',
      '[^1]: footnote def',
    ].join('\n');

    const { root } = parseMarkdown(md, 'mixed.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    expect(all.length).toBeGreaterThan(5);
    for (const node of all) {
      expectSkeleton(node.dangerouslySetInnerHTML);
    }
  });

  it('slot order: accent → leading → body → trailing inside surface', () => {
    const md = '# Parent\n\n## Child';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const html = mindNode.dangerouslySetInnerHTML!;

    const accentIdx = html.indexOf('nc-accent-bar');
    const bodyIdx = html.indexOf('nc-body');
    expect(accentIdx, 'accent-bar must exist').toBeGreaterThan(-1);
    expect(bodyIdx, 'body must exist').toBeGreaterThan(-1);
    expect(accentIdx).toBeLessThan(bodyIdx);

    const titleIdx = html.indexOf('nc-title');
    expect(titleIdx).toBeGreaterThan(bodyIdx);
  });

  it('ChildrenToggle present when node has children, absent for leaves', () => {
    const md = '# Parent\n\n## Child A\n\n## Child B';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);

    // Parent with children should have the toggle
    const parent = all.find(n => n.topic.includes('Parent'));
    expect(parent, 'parent node should exist').toBeDefined();
    expect(parent!.dangerouslySetInnerHTML).toContain('nc-children-toggle');
    expect(parent!.dangerouslySetInnerHTML).toContain('data-expanded=');

    // Leaf (Child A) should NOT have the toggle
    const leaf = all.find(n => n.topic.includes('Child A'));
    expect(leaf, 'leaf node should exist').toBeDefined();
    expect(leaf!.dangerouslySetInnerHTML).not.toContain('nc-children-toggle');
  });

  it('ChildrenToggle carries node-id and expanded data attributes for delegation', () => {
    const md = '# Root\n\n## Sub';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const html = mindNode.dangerouslySetInnerHTML!;
    expect(html).toContain('data-node-id=');
    expect(html).toMatch(/data-expanded="(true|false)"/);
  });

  it('visual family class is always present on nc-surface', () => {
    const md = '# H\n\n- item\n\n```js\ncode\n```\n\n| a |\n|---|\n| 1 |';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    const families = [
      'nc-family-structural',
      'nc-family-textual',
      'nc-family-technical',
      'nc-family-data',
      'nc-family-media',
      'nc-family-notice',
      'nc-family-fallback',
    ];
    let matched = 0;
    for (const node of all) {
      const html = node.dangerouslySetInnerHTML!;
      const hasFamily = families.some(f => html.includes(f));
      expect(hasFamily, `node missing visual family class: ${html.slice(0, 80)}`).toBe(true);
      if (hasFamily) matched++;
    }
    expect(matched).toBe(all.length);
  });

  it('type class nc-type-{type} is always present on nc-surface', () => {
    const md = '# H\n\n- item\n\n```js\ncode\n```';
    const { root } = parseMarkdown(md, 'test.md');
    const view = projectTree(root, 'complete');
    const mindNode = viewToMindmap(view, createSourceLookup(root));
    const all = collectAll(mindNode);
    for (const node of all) {
      const html = node.dangerouslySetInnerHTML!;
      expect(html, 'nc-type-* class must be present').toMatch(/nc-type-[a-z-]+/);
    }
  });
});
