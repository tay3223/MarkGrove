/**
 * Comprehensive tests for the MarkGrove semantic parser (spec 001 §25.1).
 *
 * These tests exercise the deterministic Markdown → SemanticTree parser,
 * covering: heading stack algorithm, first content promotion, container
 * recursion, inline preservation, and source anchors.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseMarkdown } from '../../src/semantic/parser';
import { resetRuntimeIdCounter } from '../../src/semantic/identity';
import type {
  SemanticRoot,
  SemanticNode,
  SyntaxMetadata,
} from '../../src/semantic/types';

// Reset the runtime ID counter before each test so assertions on IDs and
// semantic keys remain deterministic and independent.
beforeEach(() => {
  resetRuntimeIdCounter();
});

/** Convenience: parse and return root + warnings. */
function parse(md: string, fileName = 'test.md') {
  return parseMarkdown(md, fileName);
}

/** Find first node of a given type via BFS. */
function findFirst(node: SemanticNode, type: string): SemanticNode | undefined {
  if (node.type === type) return node;
  for (const c of node.children) {
    const found = findFirst(c, type);
    if (found) return found;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Empty / trivial documents
// ─────────────────────────────────────────────────────────────────────────

describe('parser — empty and trivial documents', () => {
  it('parses an empty document', () => {
    const { root, warnings } = parse('', 'empty.md');
    expect(root.type).toBe('root');
    expect(root.role).toBe('document-root');
    expect(root.children).toHaveLength(0);
    expect(root.fileName).toBe('empty');
    expect(root.depth).toBe(0);
    expect(root.syntax).toEqual({ kind: 'none' });
    expect(root.content.text).toBe('empty');
    expect(root.linkDefinitions).toEqual([]);
    expect(root.footnoteDefinitions).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('strips markdown extensions from fileName', () => {
    expect(parse('', 'foo.md').root.fileName).toBe('foo');
    expect(parse('', 'foo.markdown').root.fileName).toBe('foo');
    expect(parse('', 'foo.mdown').root.fileName).toBe('foo');
    expect(parse('', 'foo.mkd').root.fileName).toBe('foo');
    expect(parse('', 'bar.txt').root.fileName).toBe('bar.txt');
  });

  it('parses a document without any headings (content attaches to root)', () => {
    const { root } = parse('Just a paragraph.');
    expect(root.children).toHaveLength(1);
    const para = root.children[0];
    expect(para.type).toBe('paragraph');
    expect(para.role).toBe('block-leaf');
    expect(para.depth).toBe(1);
    expect(para.content.text).toBe('Just a paragraph.');
  });

  it('parses a whitespace-only document as empty', () => {
    const { root } = parse('   \n\n  \n');
    expect(root.children).toHaveLength(0);
  });

  it('returns a SemanticRoot with required top-level fields', () => {
    const { root } = parse('# H');
    const r = root as SemanticRoot;
    expect(r.type).toBe('root');
    expect(r.role).toBe('document-root');
    expect(r.fileName).toBe('test');
    expect(r.linkDefinitions).toEqual([]);
    expect(r.footnoteDefinitions).toEqual([]);
    expect(typeof r.id).toBe('string');
    expect(typeof r.semanticKey).toBe('string');
    expect(r.syntax).toEqual({ kind: 'none' });
    expect(r.source).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Heading hierarchy and stack algorithm (spec 001 §5, §20 step 2)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — heading stack algorithm', () => {
  it('parses a simple heading hierarchy', () => {
    const md = '# A\n## B\n### C\n## D\n# E';
    const { root } = parse(md);
    // root.children = [A, E]
    expect(root.children).toHaveLength(2);
    expect(root.children[0].type).toBe('heading');
    expect(root.children[0].content.text).toBe('A');
    expect(root.children[1].content.text).toBe('E');

    // A.children = [B, D]
    const A = root.children[0];
    expect(A.children).toHaveLength(2);
    expect(A.children[0].content.text).toBe('B');
    expect(A.children[1].content.text).toBe('D');

    // B.children = [C]
    const B = A.children[0];
    expect(B.children).toHaveLength(1);
    expect(B.children[0].content.text).toBe('C');

    // C.children = []
    const C = B.children[0];
    expect(C.children).toHaveLength(0);

    // D.children = []
    const D = A.children[1];
    expect(D.children).toHaveLength(0);

    // E.children = []
    const E = root.children[1];
    expect(E.children).toHaveLength(0);
  });

  it('parses all six heading levels as a nested chain', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    let cur: SemanticNode = root.children[0];
    expect(cur.content.text).toBe('H1');
    for (let level = 1; level <= 6; level++) {
      expect(cur.type).toBe('heading');
      expect(cur.role).toBe('section-container');
      const syn = cur.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
      expect(syn.level).toBe(level as 1 | 2 | 3 | 4 | 5 | 6);
      expect(syn.variant).toBe('atx');
      expect(cur.depth).toBe(level);
      if (level < 6) {
        expect(cur.children).toHaveLength(1);
        cur = cur.children[0];
      } else {
        expect(cur.children).toHaveLength(0);
      }
    }
  });

  it('parses same-level headings as siblings', () => {
    const md = '# A\n# B\n# C';
    const { root } = parse(md);
    expect(root.children).toHaveLength(3);
    expect(root.children.map(c => c.content.text)).toEqual(['A', 'B', 'C']);
    for (const h of root.children) {
      expect(h.children).toHaveLength(0);
      const syn = h.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
      expect(syn.level).toBe(1);
    }
  });

  it('handles heading level skipping (e.g. # A, ### C, #### D, ## B)', () => {
    const md = '# A\n### C\n#### D\n## B';
    const { root } = parse(md);
    // root → A
    expect(root.children).toHaveLength(1);
    const A = root.children[0];
    expect(A.content.text).toBe('A');
    // A → [C, B]
    expect(A.children.map(c => c.content.text)).toEqual(['C', 'B']);
    // C → [D]
    const C = A.children[0];
    expect(C.children.map(c => c.content.text)).toEqual(['D']);
    // D → []
    expect(C.children[0].children).toHaveLength(0);
    // B → []
    expect(A.children[1].children).toHaveLength(0);

    // Verify levels
    const lvl = (n: SemanticNode) =>
      (n.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>).level;
    expect(lvl(A)).toBe(1);
    expect(lvl(C)).toBe(3);
    expect(lvl(C.children[0])).toBe(4);
    expect(lvl(A.children[1])).toBe(2);
  });

  it('pops the stack when level >= current (equal level pops)', () => {
    // # A → ## B → ## C: C should be sibling of B (under A), not child of B.
    const md = '# A\n## B\n## C';
    const { root } = parse(md);
    const A = root.children[0];
    expect(A.children.map(c => c.content.text)).toEqual(['B', 'C']);
    expect(A.children[0].children).toHaveLength(0);
    expect(A.children[1].children).toHaveLength(0);
  });

  it('attaches a shallower heading to root after deeper ones', () => {
    const md = '# A\n## B\n### C\n# D';
    const { root } = parse(md);
    expect(root.children.map(c => c.content.text)).toEqual(['A', 'D']);
    const A = root.children[0];
    expect(A.children.map(c => c.content.text)).toEqual(['B']);
    expect(A.children[0].children.map(c => c.content.text)).toEqual(['C']);
    expect(root.children[1].children).toHaveLength(0);
  });

  it('attaches the first heading to root regardless of level', () => {
    // A leading level-3 heading still goes to root (no parent heading).
    const md = '### First';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].content.text).toBe('First');
    const syn = root.children[0].syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
    expect(syn.level).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Setext vs thematic break (spec 001 §20.2)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — setext headings vs thematic breaks', () => {
  it('detects setext H1 (=== underline)', () => {
    const md = 'Title\n===';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const h = root.children[0];
    expect(h.type).toBe('heading');
    const syn = h.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
    expect(syn.level).toBe(1);
    expect(syn.variant).toBe('setext');
    expect(h.content.text).toBe('Title');
  });

  it('detects setext H2 (--- underline) and does NOT treat it as a thematic break', () => {
    const md = 'Title\n---\n\nText';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const h = root.children[0];
    expect(h.type).toBe('heading');
    const syn = h.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
    expect(syn.level).toBe(2);
    expect(syn.variant).toBe('setext');
    // "Text" becomes a child paragraph of the setext heading.
    expect(h.children).toHaveLength(1);
    expect(h.children[0].type).toBe('paragraph');
    expect(h.children[0].content.text).toBe('Text');
  });

  it('does NOT create a node for standalone thematic breaks', () => {
    // Three thematic breaks in a row → no nodes at all.
    const md = '---\n\n***\n\n___';
    const { root } = parse(md);
    expect(root.children).toHaveLength(0);
    // Thematic breaks don't create nodes, but must enter the fidelity layer
    // (spec 001 §12, §18.1) so they round-trip losslessly.
    expect(root.fidelityItems).toHaveLength(3);
    expect(root.fidelityItems.every(i => i.kind === 'thematic-break')).toBe(true);
  });

  it('distinguishes setext heading from a following thematic break', () => {
    // "Title\n===" is setext H1; "---" alone is a thematic break (no node).
    const md = 'Title\n===\n\n---\n\nText';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const h = root.children[0];
    expect(h.type).toBe('heading');
    const syn = h.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
    expect(syn.variant).toBe('setext');
    expect(syn.level).toBe(1);
    // Only the "Text" paragraph becomes a child; the thematic break is not a
    // node but is preserved in the fidelity layer (spec 001 §12).
    expect(h.children).toHaveLength(1);
    expect(h.children[0].content.text).toBe('Text');
    expect(root.fidelityItems).toHaveLength(1);
    expect(root.fidelityItems[0].source.raw).toContain('---');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Lists (spec 001 §6)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — lists', () => {
  it('parses unordered list items with - marker', () => {
    const md = '- a\n- b\n- c';
    const { root } = parse(md);
    expect(root.children).toHaveLength(3);
    for (const item of root.children) {
      expect(item.type).toBe('list-item');
      expect(item.role).toBe('block-container');
      expect(item.depth).toBe(1);
      const syn = item.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
      expect(syn.marker).toBe('-');
      expect(syn.ordered).toBe(false);
      expect(syn.depth).toBe(1);
      expect(syn.checked).toBeUndefined();
      expect(syn.start).toBeUndefined();
    }
    expect(root.children.map(c => c.content.text)).toEqual(['a', 'b', 'c']);
  });

  it('normalizes * and + unordered markers to "-"', () => {
    const md = '* a\n+ b\n- c';
    const { root } = parse(md);
    expect(root.children).toHaveLength(3);
    for (const item of root.children) {
      const syn = item.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
      expect(syn.marker).toBe('-');
      expect(syn.ordered).toBe(false);
    }
  });

  it('parses ordered list items with start number', () => {
    const md = '1. first\n2. second\n3. third';
    const { root } = parse(md);
    expect(root.children).toHaveLength(3);
    for (const item of root.children) {
      expect(item.type).toBe('list-item');
      const syn = item.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
      expect(syn.ordered).toBe(true);
      expect(syn.marker).toBe('ordered');
      // remark reports the list's start (1); each item inherits it.
      expect(syn.start).toBe(1);
      expect(syn.depth).toBe(1);
    }
    expect(root.children.map(c => c.content.text)).toEqual(['first', 'second', 'third']);
  });

  it('parses task list items with checked states', () => {
    const md = '- [ ] todo\n- [x] done\n- plain';
    const { root } = parse(md);
    expect(root.children).toHaveLength(3);
    const [todo, done, plain] = root.children;

    const todoSyn = todo.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(todoSyn.checked).toBe('unchecked');
    expect(todo.content.text).toBe('todo');

    const doneSyn = done.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(doneSyn.checked).toBe(true);
    expect(done.content.text).toBe('done');

    const plainSyn = plain.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(plainSyn.checked).toBeUndefined();
    expect(plain.content.text).toBe('plain');
  });

  it('parses mixed nested lists (unordered → unordered → ordered)', () => {
    const md = '- a\n  - b\n    1. c\n    2. d';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const a = root.children[0];
    expect(a.content.text).toBe('a');
    expect(a.children).toHaveLength(1);
    const b = a.children[0];
    expect(b.content.text).toBe('b');
    expect(b.children).toHaveLength(2);
    const [c, d] = b.children;
    expect(c.content.text).toBe('c');
    expect(d.content.text).toBe('d');

    // Depth tracking
    const aSyn = a.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    const bSyn = b.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    const cSyn = c.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    const dSyn = d.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(aSyn.depth).toBe(1);
    expect(bSyn.depth).toBe(2);
    expect(cSyn.depth).toBe(3);
    expect(dSyn.depth).toBe(3);
    expect(aSyn.ordered).toBe(false);
    expect(bSyn.ordered).toBe(false);
    expect(cSyn.ordered).toBe(true);
    expect(dSyn.ordered).toBe(true);
    expect(a.depth).toBe(1);
    expect(b.depth).toBe(2);
    expect(c.depth).toBe(3);
    expect(d.depth).toBe(3);
  });

  it('parses ordered list nested inside unordered, and vice versa', () => {
    const md = '1. one\n   - sub-a\n   - sub-b';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const one = root.children[0];
    expect(one.content.text).toBe('one');
    const oneSyn = one.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(oneSyn.ordered).toBe(true);
    expect(one.children).toHaveLength(2);
    for (const sub of one.children) {
      const syn = sub.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
      expect(syn.ordered).toBe(false);
      expect(syn.depth).toBe(2);
    }
  });

  it('keeps display depth, list nesting depth, and heading level distinct (spec §19, §26)', () => {
    // A heading (level axis), a top-level list item (display depth + nesting
    // depth both present), and a nested list item (nesting +1) must never
    // collapse the three axes into one constant.
    const md = '# Top\n\n- a\n  - b';
    const { root } = parse(md);

    const heading = root.children[0];
    expect(heading.type).toBe('heading');
    const headingSyn = heading.syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
    expect(headingSyn.level).toBe(1);   // heading level axis
    expect(heading.depth).toBe(1);       // display depth axis

    const a = heading.children[0];
    expect(a.type).toBe('list-item');
    expect(a.depth).toBe(2);              // display depth = heading.depth + 1
    const aSyn = a.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(aSyn.depth).toBe(1);           // list nesting depth (top-level list)

    const b = a.children[0];
    expect(b.type).toBe('list-item');
    expect(b.depth).toBe(3);              // display depth continues from parent
    const bSyn = b.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
    expect(bSyn.depth).toBe(2);           // list nesting depth = a.depth + 1

    // The three values (1/2/3) are reached via independent axes, not a
    // shared constant: heading level stays 1 while display depth is 3 and
    // nesting depth is 2.
    expect(headingSyn.level).toBe(1);
    expect(b.depth).toBe(3);
    expect(bSyn.depth).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// First content promotion (spec 001 §3.1)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — first content promotion (§3.1)', () => {
  it('promotes the first paragraph of a list item to its content.text', () => {
    const md = '- First paragraph';
    const { root } = parse(md);
    const li = root.children[0];
    expect(li.type).toBe('list-item');
    expect(li.content.text).toBe('First paragraph');
    // No additional children — the promoted paragraph is not duplicated.
    expect(li.children).toHaveLength(0);
  });

  it('puts subsequent paragraphs as children (not duplicated in content)', () => {
    const md = '- First\n\n  Second';
    const { root } = parse(md);
    const li = root.children[0];
    expect(li.content.text).toBe('First');
    expect(li.children).toHaveLength(1);
    expect(li.children[0].type).toBe('paragraph');
    expect(li.children[0].content.text).toBe('Second');
    expect(li.children[0].depth).toBe(2);
  });

  it('promotes the first paragraph of a quote to its content.text', () => {
    const md = '> Quote text';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.type).toBe('quote');
    expect(q.role).toBe('block-container');
    expect(q.content.text).toBe('Quote text');
    // First paragraph is not duplicated as a child.
    expect(q.children).toHaveLength(0);
  });

  it('puts subsequent paragraphs in a quote as children', () => {
    const md = '> First\n>\n> Second';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.content.text).toBe('First');
    expect(q.children).toHaveLength(1);
    expect(q.children[0].type).toBe('paragraph');
    expect(q.children[0].content.text).toBe('Second');
    expect(q.children[0].depth).toBe(2);
  });

  it('does not duplicate the promoted paragraph as a child of a quote', () => {
    // Regression: the promoted paragraph must appear ONLY in content.text,
    // never also as the first child.
    const md = '> Promoted\n>\n> Child paragraph';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.content.text).toBe('Promoted');
    expect(q.children).toHaveLength(1);
    expect(q.children[0].content.text).toBe('Child paragraph');
    expect(q.children[0].content.text).not.toBe(q.content.text);
  });

  it('uses placeholder content when a list item has no paragraph', () => {
    // A list item containing only a code block: no paragraph to promote.
    const md = '- ```\n  code\n  ```';
    const { root } = parse(md);
    const li = root.children[0];
    expect(li.type).toBe('list-item');
    expect(li.content.text).toBe('');
    expect(li.children).toHaveLength(1);
    expect(li.children[0].type).toBe('code');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Code blocks (spec 001 §9)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — code blocks', () => {
  it('parses a fenced code block with language', () => {
    const md = '```ts\nconst x = 1;\n```';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const code = root.children[0];
    expect(code.type).toBe('code');
    expect(code.role).toBe('block-leaf');
    expect(code.content.text).toBe('const x = 1;');
    const syn = code.syntax as Extract<SyntaxMetadata, { kind: 'code' }>;
    expect(syn.fenceChar).toBe('`');
    expect(syn.fenceLength).toBe(3);
    expect(syn.lang).toBe('ts');
    expect(syn.meta).toBe('');
  });

  it('parses a tilde-fenced code block', () => {
    const md = '~~~python\nprint(1)\n~~~';
    const { root } = parse(md);
    const code = root.children[0];
    expect(code.type).toBe('code');
    const syn = code.syntax as Extract<SyntaxMetadata, { kind: 'code' }>;
    expect(syn.fenceChar).toBe('~');
    expect(syn.fenceLength).toBe(3);
    expect(syn.lang).toBe('python');
    expect(code.content.text).toBe('print(1)');
  });

  it('parses an indented code block (no fence)', () => {
    const md = '    indented code block';
    const { root } = parse(md);
    const code = root.children[0];
    expect(code.type).toBe('code');
    const syn = code.syntax as Extract<SyntaxMetadata, { kind: 'code' }>;
    expect(syn.fenceChar).toBeNull();
    expect(syn.fenceLength).toBe(0);
    expect(syn.lang).toBe('');
    expect(code.content.text).toBe('indented code block');
  });

  it('preserves code meta string after the language', () => {
    const md = '```ts title="hi"\ncode\n```';
    const { root } = parse(md);
    const code = root.children[0];
    const syn = code.syntax as Extract<SyntaxMetadata, { kind: 'code' }>;
    expect(syn.lang).toBe('ts');
    expect(syn.meta).toBe('title="hi"');
  });

  it('preserves Markdown syntax inside code blocks as literal text', () => {
    const md = '```markdown\n# Not a heading\n- Not a list\n```';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].type).toBe('code');
    expect(root.children[0].content.text).toBe('# Not a heading\n- Not a list');
    // The "# Not a heading" must NOT be parsed into a heading node.
    expect(findFirst(root, 'heading')).toBeUndefined();
  });

  it('embeds code blocks inside list items as children', () => {
    const md = '- item\n  ```ts\n  const x = 1;\n  ```';
    const { root } = parse(md);
    const li = root.children[0];
    expect(li.content.text).toBe('item');
    expect(li.children).toHaveLength(1);
    expect(li.children[0].type).toBe('code');
    expect(li.children[0].content.text).toBe('const x = 1;');
    expect(li.children[0].depth).toBe(2);
    const syn = li.children[0].syntax as Extract<SyntaxMetadata, { kind: 'code' }>;
    expect(syn.lang).toBe('ts');
  });

  it('preserves inline code inside list item content', () => {
    const md = '- item with `code` here';
    const { root } = parse(md);
    const li = root.children[0];
    expect(li.content.text).toBe('item with code here');
    expect(li.content.inline).not.toBeNull();
    expect(li.content.inline!.some(n => n.type === 'inlineCode')).toBe(true);
    const ic = li.content.inline!.find(n => n.type === 'inlineCode')!;
    expect(ic.type === 'inlineCode' && ic.value).toBe('code');
  });

  it('embeds code blocks inside quotes as children', () => {
    const md = '> Quote text\n>\n> ```js\n> code\n> ```';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.content.text).toBe('Quote text');
    expect(q.children).toHaveLength(1);
    expect(q.children[0].type).toBe('code');
    const syn = q.children[0].syntax as Extract<SyntaxMetadata, { kind: 'code' }>;
    expect(syn.lang).toBe('js');
    expect(q.children[0].depth).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Math/Diagram extension detection (spec 001 §18.4, §20.1 rule 5)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — math and diagram extension detection', () => {
  it('detects math blocks from code with lang "math"', () => {
    const md = '```math\nE = mc^2\n```';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const math = root.children[0];
    expect(math.type).toBe('math');
    expect(math.role).toBe('block-leaf');
    expect(math.content.text).toBe('E = mc^2');
    const syn = math.syntax as Extract<SyntaxMetadata, { kind: 'math' }>;
    expect(syn.display).toBe(true);
  });

  it('detects math blocks from code with lang "tex"', () => {
    const md = '```tex\n\\frac{1}{2}\n```';
    const { root } = parse(md);
    expect(root.children[0].type).toBe('math');
    expect(root.children[0].content.text).toBe('\\frac{1}{2}');
  });

  it('detects diagram blocks from code with lang "mermaid"', () => {
    const md = '```mermaid\ngraph TD\n  A --> B\n```';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const diag = root.children[0];
    expect(diag.type).toBe('diagram');
    expect(diag.role).toBe('block-leaf');
    expect(diag.content.text).toBe('graph TD\n  A --> B');
    const syn = diag.syntax as Extract<SyntaxMetadata, { kind: 'diagram' }>;
    expect(syn.engine).toBe('mermaid');
  });

  it('detects diagram blocks from code with lang "plantuml"', () => {
    const md = '```plantuml\n@startuml\nA --> B\n@enduml\n```';
    const { root } = parse(md);
    expect(root.children[0].type).toBe('diagram');
    const syn = root.children[0].syntax as Extract<SyntaxMetadata, { kind: 'diagram' }>;
    expect(syn.engine).toBe('plantuml');
  });

  it('does not detect math/diagram from regular code langs', () => {
    const md = '```javascript\nconst x = 1;\n```';
    const { root } = parse(md);
    expect(root.children[0].type).toBe('code');
  });

  it('math and diagram nodes have correct capabilities from extension registry', () => {
    const md = '```math\nx^2\n```\n\n```mermaid\nA --> B\n```';
    const { root } = parse(md);
    const math = root.children[0];
    const diag = root.children[1];
    // Math: movable=true, canHaveChildren=false, convertible=false
    expect(math.capabilities.movable).toBe(true);
    expect(math.capabilities.canHaveChildren).toBe(false);
    expect(math.capabilities.convertible).toBe(false);
    // Diagram: same capabilities
    expect(diag.capabilities.movable).toBe(true);
    expect(diag.capabilities.canHaveChildren).toBe(false);
  });
});

describe('parser — quotes', () => {
  it('parses a simple blockquote', () => {
    const md = '> Quote text';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.type).toBe('quote');
    expect(q.role).toBe('block-container');
    expect(q.syntax).toEqual({ kind: 'none' });
    expect(q.content.text).toBe('Quote text');
    expect(q.depth).toBe(1);
  });

  it('parses nested quotes (quote inside quote)', () => {
    const md = '> outer\n> > inner';
    const { root } = parse(md);
    const outer = root.children[0];
    expect(outer.type).toBe('quote');
    expect(outer.content.text).toBe('outer');
    expect(outer.children).toHaveLength(1);
    const inner = outer.children[0];
    expect(inner.type).toBe('quote');
    expect(inner.content.text).toBe('inner');
    expect(inner.depth).toBe(2);
    expect(inner.children).toHaveLength(0);
  });

  it('parses headings inside quotes (local scope only)', () => {
    const md = '> # Heading in quote\n> Body text';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.type).toBe('quote');
    // Heading is encountered before the first paragraph, so the first
    // paragraph encountered after it ("Body text") is promoted to content.
    expect(q.content.text).toBe('Body text');
    expect(q.children).toHaveLength(1);
    expect(q.children[0].type).toBe('heading');
    expect(q.children[0].content.text).toBe('Heading in quote');
    const syn = q.children[0].syntax as Extract<SyntaxMetadata, { kind: 'heading' }>;
    expect(syn.level).toBe(1);
    expect(q.children[0].depth).toBe(2);
  });

  it('parses lists inside quotes', () => {
    const md = '> Quote intro\n>\n> - item1\n> - item2';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.content.text).toBe('Quote intro');
    expect(q.children).toHaveLength(2);
    for (const item of q.children) {
      expect(item.type).toBe('list-item');
      // Tree depth = quote.depth + 1 = 2 (spec 001 §19: depth from parent)
      expect(item.depth).toBe(2);
      const syn = item.syntax as Extract<SyntaxMetadata, { kind: 'list-item' }>;
      // List nesting depth = 1 (top-level list inside the quote, not a
      // nested list). Tree depth and list nesting depth are separate
      // dimensions per spec 001 §19 and the Phase 3 refactoring plan.
      expect(syn.depth).toBe(1);
    }
    expect(q.children.map(c => c.content.text)).toEqual(['item1', 'item2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Images (spec 001 §11)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — images', () => {
  it('parses a standalone image as an image node', () => {
    const md = '![alt text](http://example.com/x.png)';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const img = root.children[0];
    expect(img.type).toBe('image');
    expect(img.role).toBe('block-leaf');
    expect(img.content.text).toBe('alt text');
    const syn = img.syntax as Extract<SyntaxMetadata, { kind: 'image' }>;
    expect(syn.src).toBe('http://example.com/x.png');
    expect(syn.alt).toBe('alt text');
    expect(syn.title).toBeUndefined();
    expect(img.children).toEqual([]);
  });

  it('preserves image title in standalone image syntax', () => {
    const md = '![alt](http://example.com/x.png "title here")';
    const { root } = parse(md);
    const img = root.children[0];
    const syn = img.syntax as Extract<SyntaxMetadata, { kind: 'image' }>;
    expect(syn.title).toBe('title here');
  });

  it('treats an inline image as part of a paragraph (not a standalone image node)', () => {
    const md = 'Text ![alt](http://example.com/x.png) after';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const p = root.children[0];
    expect(p.type).toBe('paragraph');
    expect(p.type).not.toBe('image');
    // Image is preserved in inline content.
    expect(p.content.inline).not.toBeNull();
    expect(p.content.inline!.some(n => n.type === 'image')).toBe(true);
  });

  it('falls back to URL when alt is empty for a standalone image', () => {
    const md = '![](http://example.com/x.png)';
    const { root } = parse(md);
    const img = root.children[0];
    expect(img.type).toBe('image');
    const syn = img.syntax as Extract<SyntaxMetadata, { kind: 'image' }>;
    expect(syn.alt).toBe('');
    expect(syn.src).toBe('http://example.com/x.png');
    expect(img.content.text).toBe('http://example.com/x.png');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Paragraphs and inline syntax preservation (spec 001 §7)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — paragraphs and inline syntax', () => {
  it('preserves inline syntax (bold, italic, code, link) in content.inline', () => {
    const md = 'This is **bold** and _italic_ and `code` and [link](http://x).';
    const { root } = parse(md);
    const p = root.children[0];
    expect(p.type).toBe('paragraph');
    expect(p.content.text).toBe('This is bold and italic and code and link.');
    expect(p.content.inline).not.toBeNull();
    const inline = p.content.inline!;
    expect(inline.some(n => n.type === 'strong')).toBe(true);
    expect(inline.some(n => n.type === 'emphasis')).toBe(true);
    expect(inline.some(n => n.type === 'inlineCode')).toBe(true);
    expect(inline.some(n => n.type === 'link')).toBe(true);
  });

  it('returns null inline for plain-text paragraphs', () => {
    const md = 'Just plain text.';
    const { root } = parse(md);
    const p = root.children[0];
    expect(p.content.text).toBe('Just plain text.');
    expect(p.content.inline).toBeNull();
  });

  it('preserves link URL and title in inline nodes', () => {
    const md = 'See [docs](http://x.com "title").';
    const { root } = parse(md);
    const p = root.children[0];
    const link = p.content.inline!.find(n => n.type === 'link')!;
    expect(link.type === 'link').toBe(true);
    if (link.type === 'link') {
      expect(link.url).toBe('http://x.com');
      expect(link.title).toBe('title');
    }
  });

  it('preserves strikethrough (delete) inline syntax', () => {
    const md = 'Some ~~deleted~~ text.';
    const { root } = parse(md);
    const p = root.children[0];
    expect(p.content.inline).not.toBeNull();
    expect(p.content.inline!.some(n => n.type === 'delete')).toBe(true);
  });

  it('preserves footnote references inline', () => {
    const md = 'Text with a note[^1].\n\n[^1]: note body';
    const { root } = parse(md);
    const p = root.children[0];
    expect(p.content.inline).not.toBeNull();
    expect(p.content.inline!.some(n => n.type === 'footnoteReference')).toBe(true);
  });

  it('preserves full reference links as linkReference (not downgraded to link)', () => {
    const md = '[x][id]\n\n[id]: https://example.com';
    const { root } = parse(md);
    const p = root.children[0];
    expect(p.content.inline).not.toBeNull();
    const ref = p.content.inline!.find(n => n.type === 'linkReference');
    expect(ref).toBeDefined();
    if (ref && ref.type === 'linkReference') {
      expect(ref.identifier).toBe('id');
      expect(ref.referenceType).toBe('full');
    }
    // Must NOT be downgraded to a plain link with empty URL (P0-2).
    expect(p.content.inline!.some(n => n.type === 'link')).toBe(false);
  });

  it('preserves collapsed and shortcut reference links', () => {
    const md = '[x][]\n\n[x]: https://example.com';
    const { root } = parse(md);
    const p = root.children[0];
    const ref = p.content.inline!.find(n => n.type === 'linkReference');
    expect(ref).toBeDefined();
    if (ref && ref.type === 'linkReference') {
      expect(ref.referenceType).toBe('collapsed');
    }
  });

  it('preserves image references as imageReference', () => {
    const md = '![alt][id]\n\n[id]: https://example.com/img.png';
    const { root } = parse(md);
    const p = root.children[0];
    const ref = p.content.inline!.find(n => n.type === 'imageReference');
    expect(ref).toBeDefined();
    if (ref && ref.type === 'imageReference') {
      expect(ref.identifier).toBe('id');
      expect(ref.alt).toBe('alt');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tables (spec 001 §10)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — tables', () => {
  it('parses a GFM table', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const t = root.children[0];
    expect(t.type).toBe('table');
    expect(t.role).toBe('block-leaf');
    const syn = t.syntax as Extract<SyntaxMetadata, { kind: 'table' }>;
    expect(syn.columns).toBe(2);
    expect(syn.rows).toBe(1);
    expect(syn.align).toEqual([null, null]);
    // Tables are leaf nodes — no children expanded.
    expect(t.children).toEqual([]);
  });

  it('captures column alignments', () => {
    const md = '| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |';
    const { root } = parse(md);
    const t = root.children[0];
    const syn = t.syntax as Extract<SyntaxMetadata, { kind: 'table' }>;
    expect(syn.align).toEqual(['left', 'center', 'right']);
    expect(syn.columns).toBe(3);
  });

  it('counts data rows excluding the header', () => {
    const md = '| H |\n|---|\n| a |\n| b |\n| c |';
    const { root } = parse(md);
    const t = root.children[0];
    const syn = t.syntax as Extract<SyntaxMetadata, { kind: 'table' }>;
    expect(syn.rows).toBe(3);
  });

  it('includes header text in the content summary', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { root } = parse(md);
    const t = root.children[0];
    expect(t.content.text).toContain('A');
    expect(t.content.text).toContain('B');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HTML blocks (spec 001 §12)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — HTML blocks', () => {
  it('parses an HTML block as an html node', () => {
    const md = '<div>\nhello\n</div>';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const html = root.children[0];
    expect(html.type).toBe('html');
    expect(html.role).toBe('block-leaf');
    expect(html.syntax).toEqual({ kind: 'none' });
    expect(html.children).toEqual([]);
    expect(html.source).not.toBeNull();
    expect(html.source!.raw).toContain('<div>');
  });

  it('preserves the raw HTML in source.raw', () => {
    const md = '<span class="x">hi</span>';
    const { root } = parse(md);
    const html = root.children[0];
    expect(html.source!.raw).toBe('<span class="x">hi</span>');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Front Matter (spec 001 §12, §18.4)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — front matter', () => {
  it('parses YAML front matter as a metadata node attached to root', () => {
    const md = '---\ntitle: Hi\nauthor: Sam\n---\n\n# Doc';
    const { root } = parse(md);
    // Front matter is unshift-ed to be the first child of root.
    expect(root.children[0].type).toBe('metadata');
    const meta = root.children[0];
    expect(meta.role).toBe('block-leaf');
    const syn = meta.syntax as Extract<SyntaxMetadata, { kind: 'metadata' }>;
    expect(syn.format).toBe('yaml');
    expect(meta.depth).toBe(1);
    // The "# Doc" heading comes after.
    expect(root.children[1].type).toBe('heading');
    expect(root.children[1].content.text).toBe('Doc');
  });

  it('preserves the YAML body in content.raw', () => {
    const md = '---\ntitle: Hi\n---\n\nText';
    const { root } = parse(md);
    const meta = root.children[0];
    expect(meta.content.raw).toContain('title: Hi');
  });

  it('parses TOML front matter as a metadata node with toml format', () => {
    const md = '+++\ntitle = "Hi"\nauthor = "Sam"\n+++\n\n# Doc';
    const { root } = parse(md);
    expect(root.children[0].type).toBe('metadata');
    const meta = root.children[0];
    const syn = meta.syntax as Extract<SyntaxMetadata, { kind: 'metadata' }>;
    expect(syn.format).toBe('toml');
    expect(meta.content.raw).toContain('title = "Hi"');
    // The "# Doc" heading comes after.
    expect(root.children[1].type).toBe('heading');
    expect(root.children[1].content.text).toBe('Doc');
  });

  it('parses JSON front matter as a metadata node with json format', () => {
    const md = ';;;\n{ "title": "Hi", "author": "Sam" }\n;;;\n\n# Doc';
    const { root } = parse(md);
    expect(root.children[0].type).toBe('metadata');
    const meta = root.children[0];
    const syn = meta.syntax as Extract<SyntaxMetadata, { kind: 'metadata' }>;
    expect(syn.format).toBe('json');
    expect(meta.content.raw).toContain('title');
    // The "# Doc" heading comes after.
    expect(root.children[1].type).toBe('heading');
    expect(root.children[1].content.text).toBe('Doc');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Footnotes (spec 001 §12, §18.3)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — footnotes', () => {
  it('parses a footnote definition and also collects it on the root', () => {
    const md = '[^1]: Note text';
    const { root } = parse(md);
    // Footnote node in tree.
    expect(root.children).toHaveLength(1);
    const fn = root.children[0];
    expect(fn.type).toBe('footnote');
    expect(fn.role).toBe('block-leaf');
    const syn = fn.syntax as Extract<SyntaxMetadata, { kind: 'footnote' }>;
    expect(syn.identifier).toBe('1');
    expect(fn.content.text).toBe('[^1]');
    // Collected on root.
    expect(root.footnoteDefinitions).toHaveLength(1);
    expect(root.footnoteDefinitions[0].identifier).toBe('1');
    expect(root.footnoteDefinitions[0].content).toBe('Note text');
  });

  it('collects multiple footnote definitions in source order', () => {
    const md = '[^1]: first\n[^2]: second';
    const { root } = parse(md);
    expect(root.footnoteDefinitions).toHaveLength(2);
    expect(root.footnoteDefinitions[0].identifier).toBe('1');
    expect(root.footnoteDefinitions[1].identifier).toBe('2');
    expect(root.children).toHaveLength(2);
    expect(root.children.map(c => c.content.text)).toEqual(['[^1]', '[^2]']);
  });

  it('preserves source range for footnote definitions', () => {
    const md = '[^1]: Note text';
    const { root } = parse(md);
    const def = root.footnoteDefinitions[0];
    expect(def.source).not.toBeNull();
    expect(def.source!.raw).toBe('[^1]: Note text');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Link definitions (spec 001 §12)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — link definitions', () => {
  it('collects link definitions on root.linkDefinitions and creates no node', () => {
    const md = '[ref]: http://example.com\n\nParagraph';
    const { root } = parse(md);
    expect(root.linkDefinitions).toHaveLength(1);
    const def = root.linkDefinitions[0];
    expect(def.identifier).toBe('ref');
    expect(def.url).toBe('http://example.com');
    expect(def.title).toBeNull();
    // No node is created for the definition; only the paragraph remains.
    expect(root.children).toHaveLength(1);
    expect(root.children[0].type).toBe('paragraph');
    expect(root.children[0].content.text).toBe('Paragraph');
  });

  it('collects multiple link definitions with titles', () => {
    const md = '[a]: http://a.com\n[b]: http://b.com "title"\n\nText';
    const { root } = parse(md);
    expect(root.linkDefinitions).toHaveLength(2);
    expect(root.linkDefinitions[0]).toMatchObject({
      identifier: 'a',
      url: 'http://a.com',
      title: null,
    });
    expect(root.linkDefinitions[1]).toMatchObject({
      identifier: 'b',
      url: 'http://b.com',
      title: 'title',
    });
  });

  it('preserves source range for link definitions', () => {
    const md = '[ref]: http://example.com';
    const { root } = parse(md);
    const def = root.linkDefinitions[0];
    expect(def.source).not.toBeNull();
    expect(def.source!.raw).toBe('[ref]: http://example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unknown extension preservation (spec 001 §16, §18.4)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — unknown extension preservation', () => {
  it('returns a warnings array (empty for standard markdown)', () => {
    const { warnings } = parse('# H\n\n- item\n\nText');
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('does not produce warnings for the full standard block vocabulary', () => {
    const md = [
      '---',
      'title: T',
      '---',
      '',
      '# H',
      '',
      'Paragraph with **bold**.',
      '',
      '```ts',
      'code',
      '```',
      '',
      '- item',
      '',
      '> quote',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '<div>html</div>',
      '',
      '[^1]: note',
      '',
      '[ref]: http://x.com',
    ].join('\n');
    const { warnings } = parse(md);
    // Standard markdown with the configured plugin set never triggers the
    // unknown-extension path; warnings must remain empty.
    expect(warnings).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Node identity — duplicate headings and content (spec 001 §21)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — node identity (duplicates)', () => {
  it('gives duplicate headings distinct runtime IDs', () => {
    const md = '# A\n# A';
    const { root } = parse(md);
    expect(root.children).toHaveLength(2);
    const [h1, h2] = root.children;
    expect(h1.id).not.toBe(h2.id);
    expect(h1.content.text).toBe('A');
    expect(h2.content.text).toBe('A');
  });

  it('gives duplicate headings distinct semantic keys (occurrence increments)', () => {
    const md = '# A\n# A\n# A';
    const { root } = parse(md);
    const keys = root.children.map(c => c.semanticKey);
    expect(keys).toHaveLength(3);
    // All distinct.
    expect(new Set(keys).size).toBe(3);
  });

  it('gives duplicate content paragraphs distinct IDs and semantic keys', () => {
    const md = 'Same text\n\nSame text';
    const { root } = parse(md);
    expect(root.children).toHaveLength(2);
    const [p1, p2] = root.children;
    expect(p1.content.text).toBe('Same text');
    expect(p2.content.text).toBe('Same text');
    expect(p1.id).not.toBe(p2.id);
    expect(p1.semanticKey).not.toBe(p2.semanticKey);
  });

  it('keeps semantic keys stable across re-parses of identical input', () => {
    const md = '# A\n## B\n- item';
    // Two independent parses (counter reset between them).
    resetRuntimeIdCounter();
    const r1 = parse(md);
    resetRuntimeIdCounter();
    const r2 = parse(md);
    const collect = (n: SemanticNode, out: string[] = []): string[] => {
      out.push(n.semanticKey);
      for (const c of n.children) collect(c, out);
      return out;
    };
    expect(collect(r1.root)).toEqual(collect(r2.root));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Root attachment and first heading's scope (spec 001 §20 step 2)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — root attachment and scope', () => {
  it('attaches content before the first heading to root', () => {
    const md = 'Intro paragraph\n\n# First heading\nContent';
    const { root } = parse(md);
    expect(root.children).toHaveLength(2);
    expect(root.children[0].type).toBe('paragraph');
    expect(root.children[0].content.text).toBe('Intro paragraph');
    expect(root.children[0].depth).toBe(1);
    expect(root.children[1].type).toBe('heading');
    expect(root.children[1].content.text).toBe('First heading');
  });

  it('attaches the first heading to root (empty stack)', () => {
    const md = '# Only heading';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].type).toBe('heading');
    expect(root.children[0].depth).toBe(1);
  });

  it('places content in the first heading\'s scope', () => {
    const md = '# Title\nTitle scope paragraph\n## Sub\nSub scope paragraph';
    const { root } = parse(md);
    const title = root.children[0];
    expect(title.content.text).toBe('Title');
    // First child is the in-scope paragraph.
    expect(title.children[0].type).toBe('paragraph');
    expect(title.children[0].content.text).toBe('Title scope paragraph');
    expect(title.children[0].depth).toBe(2);
    // Second child is the sub-heading.
    expect(title.children[1].type).toBe('heading');
    expect(title.children[1].content.text).toBe('Sub');
    // The sub-heading's scope contains its paragraph.
    const sub = title.children[1];
    expect(sub.children[0].type).toBe('paragraph');
    expect(sub.children[0].content.text).toBe('Sub scope paragraph');
    expect(sub.children[0].depth).toBe(3);
  });

  it('keeps list/quote content under the current heading, not root', () => {
    const md = '# H\n- item\n> quote';
    const { root } = parse(md);
    expect(root.children).toHaveLength(1);
    const H = root.children[0];
    expect(H.content.text).toBe('H');
    expect(H.depth).toBe(1);
    // Both the list item and the quote attach to H, not to root.
    expect(H.children.map(c => c.type)).toEqual(['list-item', 'quote']);
    expect(H.children[0].content.text).toBe('item');
    expect(H.children[1].content.text).toBe('quote');
    // Both list items and blockquotes use parent.depth + 1 for tree depth
    // (spec 001 §19: depth derived from parent, no fixed depth assumption).
    // H is at depth 1, so both children are at depth 2.
    expect(H.children[0].depth).toBe(2);
    expect(H.children[1].depth).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Heading-in-container local scope (spec 001 §20 step 3, §20.1 rule 3)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — heading inside container has local scope', () => {
  it('heading inside a list item captures subsequent content within the container', () => {
    // Spec 001 §20 step 3: "容器内部出现的标题默认只在该容器作用域内建树"
    // The heading establishes a local section tree inside the list item.
    // "More text" becomes a child of "Sub heading", not a sibling.
    // The heading's scope is local — it does not pollute the outer document.
    const md = '- item\n  # Sub heading\n  More text';
    const { root } = parse(md);
    const li = root.children[0];
    expect(li.content.text).toBe('item');
    // The list item has one child: the heading (which captures "More text")
    expect(li.children).toHaveLength(1);
    expect(li.children[0].type).toBe('heading');
    expect(li.children[0].content.text).toBe('Sub heading');
    // "More text" is now a child of the heading, not a sibling
    expect(li.children[0].children).toHaveLength(1);
    expect(li.children[0].children[0].type).toBe('paragraph');
    expect(li.children[0].children[0].content.text).toBe('More text');
  });

  it('heading inside a list item does not pollute the outer heading stack', () => {
    // After the list item, the outer heading stack should be restored.
    // The "# Outer" heading should attach to root, not to the in-item heading.
    const md = '- item\n  # Sub heading\n  More text\n\n# Outer';
    const { root } = parse(md);
    // Root should have 2 children: the list item and the "Outer" heading
    expect(root.children).toHaveLength(2);
    expect(root.children[0].type).toBe('list-item');
    expect(root.children[1].type).toBe('heading');
    expect(root.children[1].content.text).toBe('Outer');
    // "Outer" is at depth 1 (top-level heading), not nested under the in-item heading
    expect(root.children[1].depth).toBe(1);
  });

  it('multiple headings inside a quote build a local section tree', () => {
    // Headings inside a quote establish a local hierarchy scoped to the quote.
    const md = '> # H1 in quote\n> Text under H1\n> ## H2 in quote\n> Text under H2';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.type).toBe('quote');
    // The first paragraph "Text under H1" is promoted as quote content
    expect(q.content.text).toBe('Text under H1');
    // The quote has one top-level heading child (H1)
    expect(q.children).toHaveLength(1);
    const h1 = q.children[0];
    expect(h1.type).toBe('heading');
    expect(h1.content.text).toBe('H1 in quote');
    // H2 is a child of H1 (local heading stack: H2 > H1, so H2 nests under H1)
    expect(h1.children).toHaveLength(1);
    const h2 = h1.children[0];
    expect(h2.type).toBe('heading');
    expect(h2.content.text).toBe('H2 in quote');
    // "Text under H2" is a child of H2
    expect(h2.children).toHaveLength(1);
    expect(h2.children[0].type).toBe('paragraph');
    expect(h2.children[0].content.text).toBe('Text under H2');
  });

  it('headings of equal level inside a container are siblings', () => {
    // Two H1 headings inside a quote should be siblings, not nested.
    const md = '> # First\n> Text1\n> # Second\n> Text2';
    const { root } = parse(md);
    const q = root.children[0];
    expect(q.type).toBe('quote');
    // "Text1" is promoted as quote content
    expect(q.content.text).toBe('Text1');
    // Two sibling headings
    expect(q.children).toHaveLength(2);
    expect(q.children[0].type).toBe('heading');
    expect(q.children[0].content.text).toBe('First');
    expect(q.children[1].type).toBe('heading');
    expect(q.children[1].content.text).toBe('Second');
    // "Text2" is a child of "Second"
    expect(q.children[1].children).toHaveLength(1);
    expect(q.children[1].children[0].content.text).toBe('Text2');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Source anchors (spec 001 §21, §22)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — source anchors', () => {
  it('captures source range with raw, start, and end for top-level blocks', () => {
    const md = '# Heading';
    const { root } = parse(md);
    const h = root.children[0];
    expect(h.source).not.toBeNull();
    const src = h.source!;
    expect(src.raw).toBe('# Heading');
    expect(src.start.line).toBe(1);
    expect(src.start.column).toBe(1);
    expect(src.start.offset).toBe(0);
    expect(src.end.offset).toBe(md.length);
  });

  it('captures leading and trailing whitespace around blocks', () => {
    const md = '# A\n\n# B';
    const { root } = parse(md);
    const a = root.children[0];
    const b = root.children[1];
    // There is a blank line between A and B → A has trailing whitespace,
    // B has leading whitespace.
    expect(a.source!.trailingWhitespace).toContain('\n');
    expect(b.source!.leadingWhitespace).toContain('\n');
  });

  it('root has null source', () => {
    const { root } = parse('# H');
    expect(root.source).toBeNull();
  });

  it('preserves exact raw text for a code block', () => {
    const md = '```ts\nconst x = 1;\n```';
    const { root } = parse(md);
    const code = root.children[0];
    expect(code.source!.raw).toBe('```ts\nconst x = 1;\n```');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Capabilities (spec 001 §23)
// ─────────────────────────────────────────────────────────────────────────

describe('parser — capabilities per node type', () => {
  it('assigns capabilities to root', () => {
    const { root } = parse('');
    expect(root.capabilities.inlineEditable).toBe(false);
    expect(root.capabilities.canHaveChildren).toBe(true);
    expect(root.capabilities.movable).toBe(false);
    expect(root.capabilities.convertible).toBe(false);
  });

  it('assigns capabilities to heading nodes', () => {
    const { root } = parse('# H');
    const h = root.children[0];
    expect(h.capabilities.inlineEditable).toBe(true);
    expect(h.capabilities.canHaveChildren).toBe(true);
    expect(h.capabilities.movable).toBe(true);
    expect(h.capabilities.convertible).toBe(true);
    expect(h.capabilities.convertibleTo).toContain('list-item');
    expect(h.capabilities.convertibleTo).toContain('paragraph');
  });

  it('assigns capabilities to list-item nodes', () => {
    const { root } = parse('- item');
    const li = root.children[0];
    expect(li.capabilities.inlineEditable).toBe(true);
    expect(li.capabilities.hasSpecialEditor).toBe(true);
    expect(li.capabilities.canHaveChildren).toBe(true);
    expect(li.capabilities.convertibleTo).toContain('heading');
  });

  it('assigns capabilities to paragraph nodes (no children)', () => {
    const { root } = parse('text');
    const p = root.children[0];
    expect(p.capabilities.canHaveChildren).toBe(false);
    expect(p.capabilities.inlineEditable).toBe(true);
  });

  it('assigns capabilities to code nodes (not inline-editable)', () => {
    const { root } = parse('```\nx\n```');
    const c = root.children[0];
    expect(c.capabilities.inlineEditable).toBe(false);
    expect(c.capabilities.hasSpecialEditor).toBe(true);
    expect(c.capabilities.canHaveChildren).toBe(false);
    expect(c.capabilities.convertible).toBe(false);
  });

  it('assigns capabilities to metadata nodes (not movable)', () => {
    const { root } = parse('---\nx: 1\n---\n\n# H');
    const meta = root.children[0];
    expect(meta.type).toBe('metadata');
    expect(meta.capabilities.movable).toBe(false);
    expect(meta.capabilities.convertible).toBe(false);
  });

  it('assigns capabilities to footnote nodes (not movable)', () => {
    const { root } = parse('[^1]: note');
    const fn = root.children[0];
    expect(fn.type).toBe('footnote');
    expect(fn.capabilities.movable).toBe(false);
    expect(fn.capabilities.canHaveChildren).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: a full document exercising many features together
// ─────────────────────────────────────────────────────────────────────────

describe('parser — integration', () => {
  it('parses a full document with mixed constructs', () => {
    const md = [
      '---',
      'title: Doc',
      '---',
      '',
      '# Introduction',
      '',
      'Welcome to **MarkGrove**. See [docs](http://x).',
      '',
      '## Features',
      '',
      '- Lists',
      '- [x] Tasks',
      '  1. Nested ordered',
      '',
      '```ts',
      'const x: number = 1;',
      '```',
      '',
      '> A quote',
      '> with two lines.',
      '',
   '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '![logo](logo.png)',
      '',
      '[^1]: a note',
      '',
      '[ref]: http://ref.com',
    ].join('\n');

    const { root, warnings } = parse(md, 'doc.md');

    // Front matter is the first child.
    expect(root.children[0].type).toBe('metadata');
    expect(root.fileName).toBe('doc');

    // Introduction heading.
    const intro = root.children.find(c => c.content.text === 'Introduction');
    expect(intro).toBeDefined();
    expect(intro!.type).toBe('heading');
    expect(intro!.children.some(c => c.type === 'paragraph')).toBe(true);

    // Features heading is a child of Introduction.
    const features = intro!.children.find(c => c.content.text === 'Features');
    expect(features).toBeDefined();
    expect(features!.type).toBe('heading');

    // Features contains list, code, quote, table, image.
    const types = features!.children.map(c => c.type);
    expect(types).toContain('list-item');
    expect(types).toContain('code');
    expect(types).toContain('quote');
    expect(types).toContain('table');
    expect(types).toContain('image');

    // Definitions collected on root.
    expect(root.linkDefinitions).toHaveLength(1);
    expect(root.footnoteDefinitions).toHaveLength(1);
    // Footnote also creates a node, attached to whatever heading was on
    // the stack at its source position (here: under Features).
    expect(findFirst(root, 'footnote')).toBeDefined();

    // No warnings for standard markdown.
    expect(warnings).toHaveLength(0);
  });
});
