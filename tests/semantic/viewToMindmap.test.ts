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
