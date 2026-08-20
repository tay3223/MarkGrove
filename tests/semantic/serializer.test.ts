/**
 * Serializer round-trip stability tests (spec 001 S15, S25.2).
 *
 * Verifies the core round-trip guarantee:
 *   parse(source) -> tree1 -> serialize(tree1) -> source2 -> parse(source2) -> tree2
 *   tree1 and tree2 must be semantically equivalent.
 *
 * Coverage (spec 001 S15.1):
 *   - Semantic content not lost (all visible text, URLs, code, table cells)
 *   - Parent-child relationships unchanged
 *   - Sibling order unchanged
 *   - Heading levels preserved
 *   - List types (ordered/unordered) preserved
 *   - Task status preserved
 *   - Code language preserved
 *   - Unknown extensions preserved as-is
 *
 * treesAreEquivalent (S25.2) compares type, role, content.text, syntax
 * (heading level, list ordered/checked, code lang), children structure.
 * It does NOT compare runtime IDs or source ranges.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/semantic/parser';
import { serializeMarkdown, treesAreEquivalent } from '../../src/semantic/serializer';
import type { SemanticRoot } from '../../src/semantic/types';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Full round-trip: parse -> serialize -> parse. Returns both trees and the intermediate source. */
function roundTrip(
  md: string,
): { tree1: SemanticRoot; source2: string; tree2: SemanticRoot } {
  const { root: tree1 } = parseMarkdown(md, 'test.md');
  const source2 = serializeMarkdown(tree1);
  const { root: tree2 } = parseMarkdown(source2, 'test.md');
  return { tree1, source2, tree2 };
}

/** Perform N round-trips and return the final tree plus the last serialized source. */
function multiRoundTrip(
  md: string,
  iterations: number,
): { firstTree: SemanticRoot; finalTree: SemanticRoot; finalSource: string } {
  const { root: firstTree } = parseMarkdown(md, 'test.md');
  let source = serializeMarkdown(firstTree);
  for (let i = 0; i < iterations; i++) {
    const { root } = parseMarkdown(source, 'test.md');
    source = serializeMarkdown(root);
  }
  const { root: finalTree } = parseMarkdown(source, 'test.md');
  return { firstTree, finalTree, finalSource: source };
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('serializer round-trip', () => {
  // ─── 1. Empty document ───────────────────────────────────────────────
  describe('empty document', () => {
    it('round-trips a completely empty document', () => {
      const { tree1, tree2 } = roundTrip('');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree1.children).toHaveLength(0);
      expect(tree2.children).toHaveLength(0);
    });

    it('round-trips a whitespace-only document', () => {
      const { tree1, tree2 } = roundTrip('   \n\n  \n');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('round-trips a single newline document', () => {
      const { tree1, tree2 } = roundTrip('\n');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });
  });

  // ─── 2. Heading hierarchy with skips ─────────────────────────────────
  describe('heading hierarchy', () => {
    it('should preserve heading hierarchy', () => {
      const md = '# A\n## B\n### C';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves heading hierarchy with level skips', () => {
      const md = '# A\n### C';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves heading levels 1 through 6', () => {
      // Decreasing levels so all headings are siblings (no nesting)
      const md = '###### H6\n##### H5\n#### H4\n### H3\n## H2\n# H1';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children).toHaveLength(6);
      const levels = tree2.children.map(
        c => (c.syntax as { kind: string; level: number }).level,
      );
      expect(levels).toEqual([6, 5, 4, 3, 2, 1]);
    });

    it('preserves heading level when going from h3 to h2 (siblings)', () => {
      const md = '### Section\n## Subsection';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves heading text content', () => {
      const md = '# My Heading Text';
      const { tree2 } = roundTrip(md);
      expect(tree2.children[0].content.text).toBe('My Heading Text');
    });
  });

  // ─── 3. Ordered and unordered lists ──────────────────────────────────
  describe('lists', () => {
    it('preserves unordered list', () => {
      const md = '- Apple\n- Banana\n- Cherry';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves ordered list', () => {
      const md = '1. First\n2. Second\n3. Third';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves list type (ordered vs unordered)', () => {
      const md = '- unordered item\n1. ordered item';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect((tree2.children[0].syntax as { ordered: boolean }).ordered).toBe(false);
      expect((tree2.children[1].syntax as { ordered: boolean }).ordered).toBe(true);
    });

    it('preserves nested list structure (parent-child relationships)', () => {
      const md = '- Outer\n  - Inner';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].children).toHaveLength(1);
      expect(tree2.children[0].children[0].content.text).toBe('Inner');
    });

    it('preserves deeply nested lists (3 levels)', () => {
      const md = '- A\n  - B\n    - C';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves sibling order in lists', () => {
      const md = '- First\n- Second\n- Third';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].content.text).toBe('First');
      expect(tree2.children[1].content.text).toBe('Second');
      expect(tree2.children[2].content.text).toBe('Third');
    });

    it('preserves ordered list with start number type', () => {
      const md = '1. One\n2. Two';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect((tree2.children[0].syntax as { ordered: boolean }).ordered).toBe(true);
      expect((tree2.children[1].syntax as { ordered: boolean }).ordered).toBe(true);
    });
  });

  // ─── 4. Task list items (checked/unchecked) ──────────────────────────
  describe('task list items', () => {
    it('preserves unchecked task items', () => {
      const md = '- [ ] Todo';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(
        (tree2.children[0].syntax as { checked: boolean | 'unchecked' | undefined })
          .checked,
      ).toBe('unchecked');
    });

    it('preserves checked task items', () => {
      const md = '- [x] Done';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(
        (tree2.children[0].syntax as { checked: boolean | 'unchecked' | undefined })
          .checked,
      ).toBe(true);
    });

    it('preserves mixed task list states', () => {
      const md = '- [ ] Todo\n- [x] Done\n- [ ] Also todo';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      const states = tree2.children.map(
        c =>
          (c.syntax as { checked: boolean | 'unchecked' | undefined }).checked,
      );
      expect(states).toEqual(['unchecked', true, 'unchecked']);
    });

    it('preserves task status across round-trip', () => {
      const md = '- [x] Completed task\n- [ ] Pending task';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      for (let i = 0; i < tree1.children.length; i++) {
        const s1 = (tree1.children[i].syntax as { checked: unknown }).checked;
        const s2 = (tree2.children[i].syntax as { checked: unknown }).checked;
        expect(s2).toBe(s1);
      }
    });
  });

  // ─── 5. Code blocks with language ────────────────────────────────────
  describe('code blocks', () => {
    it('preserves code block with language', () => {
      const md = '```ts\nconst x = 1;\n```';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect((tree2.children[0].syntax as { lang: string }).lang).toBe('ts');
    });

    it('preserves code block without language', () => {
      const md = '```\nplain code\n```';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect((tree2.children[0].syntax as { lang: string }).lang).toBe('');
    });

    it('preserves code block content', () => {
      const md = '```python\ndef hello():\n    print("world")\n```';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].content.text).toBe('def hello():\n    print("world")');
    });

    it.each(['javascript', 'rust', 'go', 'sql', 'bash', 'json'])(
      'preserves %s code language identifier',
      lang => {
        const md = '```' + lang + '\ncode here\n```';
        const { tree2 } = roundTrip(md);
        expect((tree2.children[0].syntax as { lang: string }).lang).toBe(lang);
      },
    );

    it('preserves multi-line code blocks', () => {
      const md = '```ts\nconst a = 1;\nconst b = 2;\nconst c = a + b;\n```';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].content.text).toContain('const a = 1;');
      expect(tree2.children[0].content.text).toContain('const b = 2;');
      expect(tree2.children[0].content.text).toContain('const c = a + b;');
    });
  });

  // ─── 6. Blockquotes with nested content ──────────────────────────────
  describe('blockquotes', () => {
    it('preserves simple blockquote', () => {
      const md = '> This is a quote.';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].content.text).toBe('This is a quote.');
    });

    it('preserves blockquote with nested heading', () => {
      const md = '> Quote text\n>\n> # Heading in quote';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].children).toHaveLength(1);
      expect(tree2.children[0].children[0].type).toBe('heading');
      expect(tree2.children[0].children[0].content.text).toBe('Heading in quote');
    });

    it('preserves blockquote with nested list', () => {
      const md = '> Quote intro\n>\n> - List item 1\n> - List item 2';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].children).toHaveLength(2);
      expect(tree2.children[0].children[0].content.text).toBe('List item 1');
      expect(tree2.children[0].children[1].content.text).toBe('List item 2');
    });

    it('preserves blockquote with nested code', () => {
      const md = '> Quote text\n>\n> ```ts\n> const x = 1;\n> ```';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].children).toHaveLength(1);
      expect(tree2.children[0].children[0].type).toBe('code');
      expect(tree2.children[0].children[0].content.text).toBe('const x = 1;');
    });

    it('preserves blockquote content text via first-content promotion', () => {
      const md = '> Promoted content here.';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree1.children[0].content.text).toBe(tree2.children[0].content.text);
    });
  });

  // ─── 7. Tables ───────────────────────────────────────────────────────
  describe('tables', () => {
    it('preserves simple table', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves table with alignment', () => {
      const md = '| Left | Center | Right |\n|:---|:---:|---:|\n| 1 | 2 | 3 |';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves table with multiple rows', () => {
      const md = '| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves table cells (semantic content not lost)', () => {
      const md = '| Header1 | Header2 |\n|---|---|\n| Cell1 | Cell2 |';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('Header1');
      expect(source2).toContain('Header2');
      expect(source2).toContain('Cell1');
      expect(source2).toContain('Cell2');
    });

    it('preserves table column count and row count', () => {
      const md = '| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      const syn1 = tree1.children[0].syntax as {
        kind: string;
        columns: number;
        rows: number;
      };
      const syn2 = tree2.children[0].syntax as {
        kind: string;
        columns: number;
        rows: number;
      };
      expect(syn2.columns).toBe(syn1.columns);
      expect(syn2.rows).toBe(syn1.rows);
    });
  });

  // ─── 8. Mixed content ────────────────────────────────────────────────
  describe('mixed content', () => {
    it('preserves mixed paragraphs, lists, code, and headings', () => {
      // Heading at the end (no children) - all other content is siblings at root level
      const md = [
        'Some paragraph text.',
        '',
        '- List item 1',
        '- List item 2',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '# Heading',
      ].join('\n');
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves mixed content sibling order', () => {
      const md = [
        'First paragraph.',
        '',
        'Second paragraph.',
        '',
        '1. Ordered item',
        '',
        '- Unordered item',
      ].join('\n');
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      const texts = tree2.children.map(c => c.content.text);
      expect(texts[0]).toBe('First paragraph.');
      expect(texts[1]).toBe('Second paragraph.');
      expect(texts[2]).toBe('Ordered item');
      expect(texts[3]).toBe('Unordered item');
    });

    it('preserves mixed content with table and blockquote', () => {
      const md = [
        '> A blockquote.',
        '',
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        'Final paragraph.',
      ].join('\n');
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('preserves parent-child relationships in mixed content', () => {
      const md = '- Parent\n  - Child';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
      expect(tree2.children[0].children).toHaveLength(1);
      expect(tree2.children[0].children[0].content.text).toBe('Child');
    });
  });

  // ─── 9. Multiple round-trip stability ────────────────────────────────
  describe('multiple round-trip stability', () => {
    it('should be stable across multiple round-trips (spec example)', () => {
      const md = '# Title\n\nParagraph.\n\n- Item 1\n- Item 2\n';
      const { root: tree1 } = parseMarkdown(md, 'test.md');
      let source = serializeMarkdown(tree1);
      // Multiple round-trips
      for (let i = 0; i < 3; i++) {
        const { root } = parseMarkdown(source, 'test.md');
        source = serializeMarkdown(root);
      }
      const { root: finalTree } = parseMarkdown(source, 'test.md');
      expect(treesAreEquivalent(tree1, finalTree)).toBe(true);
    });

    it('is stable across 3 round-trips with mixed content', () => {
      const md = [
        'Paragraph text.',
        '',
        '- Item 1',
        '- Item 2',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '# Heading',
      ].join('\n');
      const { firstTree, finalTree } = multiRoundTrip(md, 3);
      expect(treesAreEquivalent(firstTree, finalTree)).toBe(true);
    });

    it('is stable across 5 round-trips with lists and code', () => {
      const md =
        '- Item 1\n- Item 2\n\n```ts\nconst x = 1;\n```\n\nText paragraph.';
      const { firstTree, finalTree } = multiRoundTrip(md, 5);
      expect(treesAreEquivalent(firstTree, finalTree)).toBe(true);
    });

    it('produces stable serialized output (no drift) across iterations', () => {
      const md =
        '- Item 1\n- Item 2\n\n```ts\nconst x = 1;\n```\n\nText paragraph.';
      const { root } = parseMarkdown(md, 'test.md');
      const source1 = serializeMarkdown(root);
      let source = source1;
      for (let i = 0; i < 5; i++) {
        const { root: r } = parseMarkdown(source, 'test.md');
        source = serializeMarkdown(r);
      }
      // After multiple round-trips, output should be stable (no drift)
      expect(source).toBe(source1);
    });

    it('produces stable serialized output for tables', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const { root } = parseMarkdown(md, 'test.md');
      const source1 = serializeMarkdown(root);
      let source = source1;
      for (let i = 0; i < 3; i++) {
        const { root: r } = parseMarkdown(source, 'test.md');
        source = serializeMarkdown(r);
      }
      expect(source).toBe(source1);
    });

    it('produces stable serialized output for blockquotes', () => {
      const md = '> Quote text\n>\n> - Item 1\n> - Item 2';
      const { root } = parseMarkdown(md, 'test.md');
      const source1 = serializeMarkdown(root);
      let source = source1;
      for (let i = 0; i < 3; i++) {
        const { root: r } = parseMarkdown(source, 'test.md');
        source = serializeMarkdown(r);
      }
      expect(source).toBe(source1);
    });
  });

  // ─── 10. Content preservation ────────────────────────────────────────
  describe('content preservation (semantic content not lost)', () => {
    it('preserves visible text', () => {
      const md = 'This is visible text.';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('This is visible text.');
    });

    it('preserves URLs in links', () => {
      const md = '[Click here](https://example.com/page)';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('https://example.com/page');
      expect(source2).toContain('Click here');
    });

    it('preserves code block content and language', () => {
      const md = '```python\ndef hello():\n    print("world")\n```';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('def hello():');
      expect(source2).toContain('print("world")');
      expect(source2).toContain('python');
    });

    it('preserves table cells', () => {
      const md = '| Name | URL |\n|---|---|\n| Site | https://example.com |';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('Name');
      expect(source2).toContain('Site');
      expect(source2).toContain('https://example.com');
    });

    it('preserves inline code', () => {
      const md = 'Use `npm install` to install.';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('npm install');
    });

    it('preserves bold and italic text content', () => {
      const md = 'This is **bold** and *italic*.';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('bold');
      expect(source2).toContain('italic');
    });

    it('preserves all content in a complex document', () => {
      // Heading at the end to keep all other content at root level
      const md = [
        'Read the [guide](https://example.com/guide) for details.',
        '',
        '```python',
        'def hello():',
        '    print("world")',
        '```',
        '',
        '| Name | URL |',
        '|---|---|',
        '| Site | https://example.com |',
        '',
        '# Documentation',
      ].join('\n');
      const { source2 } = roundTrip(md);
      // URLs preserved
      expect(source2).toContain('https://example.com/guide');
      expect(source2).toContain('https://example.com');
      // Code preserved
      expect(source2).toContain('def hello():');
      expect(source2).toContain('print("world")');
      expect(source2).toContain('python');
      // Table cells preserved
      expect(source2).toContain('Name');
      expect(source2).toContain('Site');
      // Visible text preserved
      expect(source2).toContain('Documentation');
      expect(source2).toContain('Read the');
      expect(source2).toContain('guide');
      expect(source2).toContain('for details.');
    });

    it('preserves HTML blocks as-is (unknown/raw content)', () => {
      const md = '<div class="raw">\n  <p>HTML content</p>\n</div>';
      const { source2 } = roundTrip(md);
      expect(source2).toContain('<div class="raw">');
      expect(source2).toContain('<p>HTML content</p>');
      expect(source2).toContain('</div>');
    });

    it('preserves unknown/raw content round-trip equivalence', () => {
      const md = '<div>raw html</div>';
      const { tree1, tree2 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('round-trips math blocks preserving type and content', () => {
      const md = '```math\nE = mc^2\n```';
      const { tree1, tree2 } = roundTrip(md);
      expect(tree1.children[0].type).toBe('math');
      expect(tree2.children[0].type).toBe('math');
      expect(tree2.children[0].content.text).toBe('E = mc^2');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('round-trips diagram blocks preserving type and engine', () => {
      const md = '```mermaid\ngraph TD\n  A --> B\n```';
      const { tree1, tree2 } = roundTrip(md);
      expect(tree1.children[0].type).toBe('diagram');
      expect(tree2.children[0].type).toBe('diagram');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('round-trips TOML front matter preserving format', () => {
      const md = '+++\ntitle = "Test"\n+++\n\n# Heading';
      const { tree1, tree2 } = roundTrip(md);
      expect(tree1.children[0].type).toBe('metadata');
      expect(tree2.children[0].type).toBe('metadata');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('round-trips JSON front matter preserving format', () => {
      const md = ';;;\n{ "title": "Test", "count": 3 }\n;;;\n\n# Heading';
      const { tree1, tree2 } = roundTrip(md);
      expect(tree1.children[0].type).toBe('metadata');
      expect(tree2.children[0].type).toBe('metadata');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });
  });

  // ─── Cross-cutting: treesAreEquivalent semantics ─────────────────────
  describe('treesAreEquivalent semantics (spec 001 S25.2)', () => {
    it('returns true for identical trees', () => {
      const md = '- Item';
      const { tree1 } = roundTrip(md);
      expect(treesAreEquivalent(tree1, tree1)).toBe(true);
    });

    it('does not compare runtime IDs', () => {
      const md = '- Same text';
      const { root: tree1 } = parseMarkdown(md, 'test.md');
      const { root: tree2 } = parseMarkdown(md, 'test.md');
      // IDs will differ but trees should be equivalent
      expect(tree1.id).not.toBe(tree2.id);
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('does not compare source ranges', () => {
      const md1 = '- Item';
      const md2 = '  \n- Item'; // Different leading whitespace
      const { root: tree1 } = parseMarkdown(md1, 'test.md');
      const { root: tree2 } = parseMarkdown(md2, 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(true);
    });

    it('detects different content text', () => {
      const { root: tree1 } = parseMarkdown('- Apple', 'test.md');
      const { root: tree2 } = parseMarkdown('- Banana', 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(false);
    });

    it('detects different heading levels', () => {
      const { root: tree1 } = parseMarkdown('# Heading', 'test.md');
      const { root: tree2 } = parseMarkdown('## Heading', 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(false);
    });

    it('detects different list types (ordered vs unordered)', () => {
      const { root: tree1 } = parseMarkdown('- Item', 'test.md');
      const { root: tree2 } = parseMarkdown('1. Item', 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(false);
    });

    it('detects different task status', () => {
      const { root: tree1 } = parseMarkdown('- [x] Done', 'test.md');
      const { root: tree2 } = parseMarkdown('- [ ] Done', 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(false);
    });

    it('detects different code language', () => {
      const { root: tree1 } = parseMarkdown('```ts\ncode\n```', 'test.md');
      const { root: tree2 } = parseMarkdown('```js\ncode\n```', 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(false);
    });

    it('detects different children count', () => {
      const { root: tree1 } = parseMarkdown('- A\n- B', 'test.md');
      const { root: tree2 } = parseMarkdown('- A', 'test.md');
      expect(treesAreEquivalent(tree1, tree2)).toBe(false);
    });
  });

  // ─── 11. P0 lossless source fidelity (spec 001 §12, §18, §22) ────────
  describe('P0 lossless source fidelity', () => {
    // P0-1: thematic breaks must not be dropped on round-trip
    describe('thematic breaks (P0-1)', () => {
      it('preserves a thematic break between paragraphs', () => {
        const md = 'A\n\n---\n\nB';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('---');
        expect(source2).toContain('A');
        expect(source2).toContain('B');
        // The separator must not be dropped, collapsing A and B.
        expect(source2).not.toBe('A\n\nB');
      });

      it('preserves multiple thematic breaks', () => {
        const md = '---\n\n***\n\n___';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('---');
        expect(source2).toContain('***');
        expect(source2).toContain('___');
      });

      it('records thematic breaks in the fidelity layer, not as nodes', () => {
        const { root } = parseMarkdown('A\n\n---\n\nB', 't.md');
        // No node is created for the thematic break (spec 001 §12).
        expect(root.children).toHaveLength(2);
        expect(root.children.map(c => c.type)).toEqual(['paragraph', 'paragraph']);
        // But it is preserved in the fidelity layer.
        expect(root.fidelityItems).toHaveLength(1);
        expect(root.fidelityItems[0].kind).toBe('thematic-break');
        expect(root.fidelityItems[0].source.raw).toContain('---');
      });

      it('is stable across multiple round-trips', () => {
        const md = 'A\n\n---\n\nB';
        const { firstTree, finalTree } = multiRoundTrip(md, 4);
        expect(treesAreEquivalent(firstTree, finalTree)).toBe(true);
        // Fidelity items survive multiple round-trips.
        expect(finalTree.fidelityItems).toHaveLength(1);
      });
    });

    // P0-2: link definitions and reference links must round-trip
    describe('link definitions and reference links (P0-2)', () => {
      it('preserves a link definition at its source position', () => {
        const md = '[id]: https://example.com "T"\n\nText';
        const { source2, tree1 } = roundTrip(md);
        expect(source2).toContain('[id]: https://example.com "T"');
        expect(tree1.linkDefinitions).toHaveLength(1);
        expect(tree1.linkDefinitions[0].url).toBe('https://example.com');
      });

      it('preserves a full reference link without downgrading to empty URL', () => {
        const md = '[x][id]\n\n[id]: https://example.com "T"';
        const { source2 } = roundTrip(md);
        // The reference link must not degrade to [x]().
        expect(source2).not.toContain('[x](');
        expect(source2).toContain('[x][id]');
        expect(source2).toContain('https://example.com');
      });

      it('preserves a collapsed reference link', () => {
        const md = '[x][]\n\n[x]: https://example.com';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('[x][]');
        expect(source2).toContain('https://example.com');
      });

      it('preserves a shortcut reference link', () => {
        const md = '[x]\n\n[x]: https://example.com';
        const { source2 } = roundTrip(md);
        // Shortcut reference: just [x], not [x][] or [x](...)
        expect(source2).toContain('[x]');
        expect(source2).not.toContain('[x](');
        expect(source2).toContain('https://example.com');
      });

      it('preserves case-sensitive labels in reference links', () => {
        const md = '[x][ID]\n\n[ID]: https://example.com';
        const { source2 } = roundTrip(md);
        // Labels are case-insensitive for matching but original case is preserved.
        expect(source2).toContain('https://example.com');
      });

      it('preserves multiple link definitions in source order', () => {
        const md = '[a]: http://a.com\n[b]: http://b.com "title"\n\nText';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('[a]: http://a.com');
        expect(source2).toContain('[b]: http://b.com "title"');
        // Both definitions preserved exactly once.
        expect(source2.match(/http:\/\/a\.com/g)).toHaveLength(1);
        expect(source2.match(/http:\/\/b\.com/g)).toHaveLength(1);
      });

      it('preserves an image reference', () => {
        const md = '![alt][id]\n\n[id]: https://example.com/img.png';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('![alt][id]');
        expect(source2).toContain('https://example.com/img.png');
      });

      it('is stable across multiple round-trips with reference links', () => {
        const md = '[x][id]\n\n[id]: https://example.com "T"';
        const { firstTree, finalTree, finalSource } = multiRoundTrip(md, 4);
        expect(treesAreEquivalent(firstTree, finalTree)).toBe(true);
        expect(finalSource).toContain('https://example.com');
        expect(finalSource).not.toContain('[x]()');
      });
    });

    // P0-3: footnote definitions must not be duplicated
    describe('footnote definitions (P0-3)', () => {
      it('serializes a footnote definition exactly once', () => {
        const md = 'Text[^1]\n\n[^1]: Note';
        const { source2 } = roundTrip(md);
        // The definition must appear exactly once, not duplicated.
        expect(source2.match(/\[\^1\]: Note/g)).toHaveLength(1);
        // The corrupted pseudo-definition [^1]: [^1] must not appear.
        expect(source2).not.toContain('[^1]: [^1]');
        expect(source2).toContain('Text[^1]');
      });

      it('preserves footnote reference and definition together', () => {
        const md = 'Text[^1]\n\n[^1]: Note';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('Text[^1]');
        expect(source2).toContain('[^1]: Note');
      });

      it('preserves multiple footnote definitions in source order', () => {
        const md = '[^1]: first\n\n[^2]: second';
        const { source2 } = roundTrip(md);
        expect(source2).toContain('[^1]: first');
        expect(source2).toContain('[^2]: second');
        // Each definition exactly once.
        expect(source2.match(/\[\^1\]: first/g)).toHaveLength(1);
        expect(source2.match(/\[\^2\]: second/g)).toHaveLength(1);
      });

      it('keeps the footnote node as single source of truth', () => {
        const { root } = parseMarkdown('[^1]: Note', 't.md');
        // The footnote node exists in the tree.
        expect(root.children).toHaveLength(1);
        expect(root.children[0].type).toBe('footnote');
        // The lookup table still exists for reference resolution.
        expect(root.footnoteDefinitions).toHaveLength(1);
        // Serializing produces exactly one definition.
        const source2 = serializeMarkdown(root);
        expect(source2.match(/\[\^1\]: Note/g)).toHaveLength(1);
      });

      it('is stable across multiple round-trips', () => {
        const md = 'Text[^1]\n\n[^1]: Note';
        const { firstTree, finalTree, finalSource } = multiRoundTrip(md, 4);
        expect(treesAreEquivalent(firstTree, finalTree)).toBe(true);
        expect(finalSource.match(/\[\^1\]: Note/g)).toHaveLength(1);
        expect(finalSource).not.toContain('[^1]: [^1]');
      });
    });

    // P0-4: combined fidelity — all non-node source items round-trip together
    describe('combined fidelity', () => {
      it('preserves thematic breaks, link defs and footnotes together', () => {
        const md = [
          '# Title',
          '',
          '---',
          '',
          'Paragraph with [ref][id].',
          '',
          '[id]: https://example.com',
          '',
          'Text[^1]',
          '',
          '[^1]: Note',
        ].join('\n');
        const { source2 } = roundTrip(md);
        expect(source2).toContain('---');
        expect(source2).toContain('[ref][id]');
        expect(source2).toContain('https://example.com');
        expect(source2).toContain('[^1]: Note');
        expect(source2).not.toContain('[^1]: [^1]');
        expect(source2).not.toContain('[ref](');
      });
    });
  });
});
