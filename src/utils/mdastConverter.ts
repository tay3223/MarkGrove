import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import type { MindmapNode } from '../types';

let nodeCounter = 0;

function nextId(): string {
  return `node-${++nodeCounter}-${Date.now().toString(36)}`;
}

// Occurrence counters per parentPath + type + normalized content, reset per
// conversion run. Using occurrence-of-same-content instead of a global sibling
// index keeps IDs stable when unrelated siblings are inserted/removed.
let occurrenceCounters = new Map<string, number>();

function nextOccurrence(parentPath: string, nodeType: string, content: string): number {
  const normalized = content.replace(/\s+/g, ' ').trim().slice(0, 60);
  const key = `${parentPath}|${nodeType}|${normalized}`;
  const idx = occurrenceCounters.get(key) || 0;
  occurrenceCounters.set(key, idx + 1);
  return idx;
}

/**
 * Generate a stable ID from structural path (node type + normalized content + occurrence index).
 * This survives position shifts caused by insertions/deletions before the node.
 */
function structuralId(nodeType: string, content: string, parentPath: string): string {
  const occurrence = nextOccurrence(parentPath, nodeType, content);
  // Normalize content: collapse whitespace, truncate for ID stability
  const normalized = content.replace(/\s+/g, ' ').trim().slice(0, 60);
  const path = parentPath ? `${parentPath}/${nodeType}-${occurrence}` : `${nodeType}-${occurrence}`;
  // Simple hash of the full path + content to keep ID compact
  let hash = 0;
  const full = `${path}:${normalized}`;
  for (let i = 0; i < full.length; i++) {
    const chr = full.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `s${Math.abs(hash).toString(36)}`;
}

export function resetNodeCounter(): void {
  nodeCounter = 0;
  occurrenceCounters = new Map();
}

const CODE_NODE_STYLE = {
  fontFamily: "'Fira Code', 'SF Mono', Menlo, monospace",
  background: '#11111b',
  border: '1px solid #fab387',
  color: '#fab387',
  fontSize: '12px',
};

function headingStyle(level: number): MindmapNode['style'] {
  switch (level) {
    case 1: return { fontSize: '16px', color: '#89b4fa', fontWeight: '600' };
    case 2: return { fontSize: '14px', color: '#cba6f7', fontWeight: '500' };
    case 3: return { fontSize: '13px', color: '#cdd6f4', fontWeight: '500' };
    default: return { fontSize: '12px', color: '#a6adc8' };
  }
}

export function parseMarkdown(content: string): any {
  return unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(content);
}

export function stringifyMarkdown(ast: any): string {
  return unified().use(remarkFrontmatter, ['yaml']).use(remarkGfm).use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
  }).stringify(ast);
}

export function mdastToMindmap(ast: any, fileName: string): MindmapNode {
  resetNodeCounter();
  const root: MindmapNode = {
    topic: fileName.replace(/\.md$/, ''),
    id: 'root',
    children: [],
    data: { nodeType: 'root' },
  };

  const headingStack: Array<{ level: number; node: MindmapNode }> = [];
  let listStack: Array<{ node: MindmapNode; depth: number }> = [];

  // Build structural path from heading stack
  function currentPath(): string {
    return headingStack.map(h => h.node.id).join('/');
  }

  // Append paragraph text to a heading's description (for AuxPanel "正文摘要")
  function appendDescription(node: MindmapNode, text: string) {
    const desc = node.data?.description;
    node.data = {
      ...node.data,
      description: desc ? `${desc}\n${text}` : text,
    };
  }

  // Truncate long text for mindmap node topics to keep nodes readable
  function truncateTopic(text: string, maxLen = 120): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
  }

  for (const child of ast.children) {
    if (child.type === 'heading') {
      const text = extractText(child);
      const level = child.depth;

      // Pop headings of equal or deeper level so that the new heading attaches
      // to its correct ancestor. E.g. when stack is [root→H1→H2] and we see a
      // new H2, pop H2 then attach to H1; when we see a new H1, pop both H2
      // and H1 then attach to root. This faithfully mirrors Markdown's native
      // heading hierarchy: H1 = level-1 child of root, H2 = child of the
      // preceding H1, H3 = child of the preceding H2, etc.
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      const parentPath = currentPath();
      const node: MindmapNode = {
        topic: text,
        id: structuralId('heading', text, parentPath),
        children: [],
        style: headingStyle(level),
        data: {
          nodeType: 'heading',
          headingLevel: level,
          sourcePosition: child.position,
        },
      };

      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      parent.children = parent.children || [];
      parent.children.push(node);
      headingStack.push({ level, node });
      listStack = [];
    } else if (child.type === 'list') {
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      const listNodes = convertListToNodes(child, currentPath());
      parent.children = parent.children || [];
      parent.children.push(...listNodes);
      listStack = [];
    } else if (child.type === 'code') {
      const firstLine = (child.value || '').split('\n')[0]?.trim() || '';
      const codeSummary = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
      const codeNode: MindmapNode = {
        topic: `[${child.lang || 'code'}] ${codeSummary}`,
        id: structuralId('code', child.value || '', currentPath()),
        children: [],
        style: { ...CODE_NODE_STYLE },
        data: {
          nodeType: 'code',
          codeContent: child.value,
          codeLang: child.lang || 'text',
          sourcePosition: child.position,
          firstLine: firstLine || undefined,
          lineRange: child.position ? `${child.position.start.line}-${child.position.end.line}` : undefined,
        },
      };
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      parent.children = parent.children || [];
      parent.children.push(codeNode);
      listStack = [];
    } else if (child.type === 'paragraph') {
      const text = extractText(child);
      if (text.trim()) {
        const parent = headingStack.length > 0
          ? headingStack[headingStack.length - 1].node
          : root;
        const paraNode: MindmapNode = {
          topic: truncateTopic(text),
          id: structuralId('paragraph', text, currentPath()),
          children: [],
          style: { fontSize: '12px', color: '#bac2de' },
          data: {
            nodeType: 'paragraph',
            sourcePosition: child.position,
            fullText: text,
          },
        };
        parent.children = parent.children || [];
        parent.children.push(paraNode);
        // Also append to parent heading's description so AuxPanel shows
        // the full paragraph text when the heading is selected.
        appendDescription(parent, text);
      }
      listStack = [];
    } else if (child.type === 'blockquote') {
      const text = extractText(child);
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      const quoteNode: MindmapNode = {
        topic: `> ${truncateTopic(text)}`,
        id: structuralId('blockquote', text, currentPath()),
        children: [],
        style: { fontSize: '12px', color: '#a6adc8', borderLeft: '2px solid #6c7086', paddingLeft: '6px' },
        data: {
          nodeType: 'blockquote',
          sourcePosition: child.position,
          fullText: text,
        },
      };
      parent.children = parent.children || [];
      parent.children.push(quoteNode);
      appendDescription(parent, `> ${text}`);
      listStack = [];
    } else if (child.type === 'table') {
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      // Extract rows from the mdast table (remark-gfm already strips the
      // alignment separator row; children = headerRow + dataRows)
      const rows: string[][] = (child.children || [])
        .filter((r: any) => r.type === 'tableRow')
        .map((r: any) =>
          (r.children || [])
            .filter((c: any) => c.type === 'tableCell')
            .map((c: any) => extractText(c)),
        );
      const headerCells = rows.length > 0 ? rows[0] : [];
      const dataRows = rows.slice(1);

      // Build child nodes for each data row so table content is not lost.
      const rowNodes: MindmapNode[] = dataRows.map((cells, idx) => {
        // For 2-column (key-value) tables, use "key — value" format;
        // for wider tables join with " | ".
        const rowText = cells.length === 2
          ? `${cells[0]}  —  ${cells[1]}`
          : cells.join(' | ');
        return {
          topic: truncateTopic(rowText, 100),
          id: structuralId('tablerow', rowText + idx, currentPath()),
          children: [],
          style: { fontSize: '11px', color: '#a6adc8' },
          data: {
            nodeType: 'tablerow',
            sourcePosition: child.position,
            cells,
            headers: headerCells,
          },
        };
      });

      const tableNode: MindmapNode = {
        topic: '[表格]',
        id: structuralId('table', '', currentPath()),
        children: rowNodes,
        style: { fontSize: '12px', color: '#94e2d5', border: '1px dashed #94e2d5' },
        data: {
          nodeType: 'table',
          sourcePosition: child.position,
          lineRange: child.position ? `${child.position.start.line}-${child.position.end.line}` : undefined,
          headers: headerCells,
          rows: dataRows,
        },
      };
      parent.children = parent.children || [];
      parent.children.push(tableNode);
      listStack = [];
    } else if (child.type === 'html') {
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      const htmlNode: MindmapNode = {
        topic: '[HTML]',
        id: structuralId('html', child.value || '', currentPath()),
        children: [],
        style: { fontSize: '12px', color: '#f38ba8', border: '1px dashed #f38ba8' },
        data: {
          nodeType: 'html',
          sourcePosition: child.position,
          lineRange: child.position ? `${child.position.start.line}-${child.position.end.line}` : undefined,
        },
      };
      parent.children = parent.children || [];
      parent.children.push(htmlNode);
      listStack = [];
    } else if (child.type === 'thematicBreak') {
      // `---` separators are visual scaffolding in linear markdown and add
      // no information in a radial mindmap. Skip them instead of creating a
      // "———" child node that just adds noise.
      listStack = [];
    } else if (child.type === 'footnoteDefinition') {
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      const fnNode: MindmapNode = {
        topic: `[脚注: ${child.identifier || ''}]`,
        id: structuralId('footnote', child.identifier || '', currentPath()),
        children: [],
        style: { fontSize: '11px', color: '#f9e2af' },
        data: {
          nodeType: 'footnote',
          sourcePosition: child.position,
        },
      };
      parent.children = parent.children || [];
      parent.children.push(fnNode);
      listStack = [];
    } else if (child.type === 'yaml') {
      // Front matter: render as a non-editable metadata block
      const parent = headingStack.length > 0
        ? headingStack[headingStack.length - 1].node
        : root;
      const fmNode: MindmapNode = {
        topic: '[Front Matter]',
        id: structuralId('frontmatter', child.value || '', currentPath()),
        children: [],
        style: { fontSize: '11px', color: '#6c7086', border: '1px dashed #6c7086' },
        data: {
          nodeType: 'frontmatter',
          sourcePosition: child.position,
          lineRange: child.position ? `${child.position.start.line}-${child.position.end.line}` : undefined,
        },
      };
      parent.children = parent.children || [];
      parent.children.push(fmNode);
      listStack = [];
    }
    // Silently skip: definition, etc.
  }

  // Final safety net: structural IDs are stable across position shifts, but
  // pathological content could still collide. Mind Elixir breaks on duplicate
  // IDs (blank canvas), so enforce uniqueness deterministically.
  const seenIds = new Set<string>();
  const dedupe = (n: MindmapNode) => {
    if (seenIds.has(n.id)) {
      let k = 1;
      while (seenIds.has(`${n.id}-${k}`)) k++;
      n.id = `${n.id}-${k}`;
    }
    seenIds.add(n.id);
    n.children?.forEach(dedupe);
  };
  dedupe(root);

  return root;
}

function convertListToNodes(listNode: any, parentPath: string): MindmapNode[] {
  const nodes: MindmapNode[] = [];
  for (const item of listNode.children) {
    if (item.type !== 'listItem') continue;
    // Pass 1: extract own text (needed to compute a stable item ID first)
    let text = '';
    for (const sub of item.children) {
      if (sub.type === 'paragraph') {
        text = extractText(sub);
      }
    }
    if (listNode.ordered) {
      const idx = listNode.children.indexOf(item) + (listNode.start || 1);
      text = `${idx}. ${text}`;
    }
    const itemId = structuralId('list', text, parentPath);
    // Nested content identity includes this item's ID so identical sub-items
    // under different parents never collide
    const itemPath = parentPath ? `${parentPath}/${itemId}` : itemId;

    // Pass 2: build children with the hierarchical path
    const childNodes: MindmapNode[] = [];
    for (const sub of item.children) {
      if (sub.type === 'list') {
        childNodes.push(...convertListToNodes(sub, itemPath));
      } else if (sub.type === 'code') {
        childNodes.push({
          topic: `[${sub.lang || 'code'}]`,
          id: structuralId('code', sub.value || '', itemPath),
          children: [],
          style: { ...CODE_NODE_STYLE },
          data: {
            nodeType: 'code',
            codeContent: sub.value,
            codeLang: sub.lang || 'text',
            sourcePosition: sub.position,
          },
        });
      }
    }
    nodes.push({
      topic: text,
      id: itemId,
      children: childNodes,
      data: {
        nodeType: 'list',
        sourcePosition: item.position,
      },
    });
  }
  return nodes;
}

function extractText(node: any): string {
  let text = '';
  // 同时保留普通文本与行内代码（如 `_docs/`），并按其在源中的顺序拼接。
  // 注意：行内代码原样保留内容即可——mind-elixir 用 textContent 渲染节点，
  // 下划线不会被当作斜体语法吞噬。链接文本会被 visit 自然递归捕获。
  visit(node, (n: any) => {
    if (n.type === 'text') text += n.value;
    else if (n.type === 'inlineCode') text += n.value;
  });
  return text || '';
}

export interface MindmapOperation {
  type: 'addChild' | 'editText' | 'deleteNode' | 'moveNode';
  nodeId: string;
  parentId?: string;
  newText?: string;
  newParentId?: string;
  newIndex?: number;
}

export function applyMindmapOperation(
  ast: any,
  mindmapRoot: MindmapNode,
  operation: MindmapOperation,
): any {
  const newAst = JSON.parse(JSON.stringify(ast));
  switch (operation.type) {
    case 'addChild':
      return applyAddChild(newAst, mindmapRoot, operation);
    case 'editText':
      return applyEditText(newAst, mindmapRoot, operation);
    case 'deleteNode':
      return applyDeleteNode(newAst, mindmapRoot, operation);
    case 'moveNode':
      return applyMoveNode(newAst, mindmapRoot, operation);
    default:
      return newAst;
  }
}

function applyAddChild(ast: any, root: MindmapNode, op: MindmapOperation): any {
  const parentMindNode = findMindNode(root, op.parentId!);
  if (!parentMindNode) return ast;
  const parentPos = parentMindNode.data?.sourcePosition;
  const parentType = parentMindNode.data?.nodeType;
  const headingLevel = parentMindNode.data?.headingLevel;

  if (parentType === 'root' || !parentPos) {
    const newHeading = {
      type: 'heading',
      depth: 1,
      children: [{ type: 'text', value: op.newText || 'New Node' }],
    };
    ast.children.push(newHeading);
    return ast;
  }

  if (parentType === 'heading' && headingLevel) {
    const newLevel = Math.min(headingLevel + 1, 6);
    const newHeading = {
      type: 'heading',
      depth: newLevel,
      children: [{ type: 'text', value: op.newText || 'New Node' }],
    };
    const insertIdx = findInsertIndexForHeading(ast, parentPos, headingLevel);
    ast.children.splice(insertIdx, 0, newHeading);
    return ast;
  }

  if (parentType === 'list') {
    const newItem = {
      type: 'list',
      ordered: false,
      children: [{
        type: 'listItem',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: op.newText || 'New Node' }] }],
      }],
    };
    const insertIdx = findInsertIndexForList(ast, parentPos);
    ast.children.splice(insertIdx, 0, newItem);
    return ast;
  }

  return ast;
}

function applyEditText(ast: any, root: MindmapNode, op: MindmapOperation): any {
  const mindNode = findMindNode(root, op.nodeId);
  if (!mindNode || !op.newText) return ast;
  const pos = mindNode.data?.sourcePosition;
  if (!pos) return ast;
  const astNode = findAstNodeByPosition(ast, pos);
  if (!astNode) return ast;

  if (astNode.type === 'heading') {
    astNode.children = [{ type: 'text', value: op.newText }];
  } else if (astNode.type === 'listItem') {
    for (const child of astNode.children) {
      if (child.type === 'paragraph') {
        child.children = [{ type: 'text', value: op.newText }];
        break;
      }
    }
  }
  return ast;
}

function applyDeleteNode(ast: any, root: MindmapNode, op: MindmapOperation): any {
  const mindNode = findMindNode(root, op.nodeId);
  if (!mindNode) return ast;
  const pos = mindNode.data?.sourcePosition;
  if (!pos) return ast;

  const removeFromChildren = (children: any[]): boolean => {
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.position && positionsMatch(child.position, pos)) {
        children.splice(i, 1);
        return true;
      }
      if (child.children && removeFromChildren(child.children)) {
        return true;
      }
    }
    return false;
  };

  removeFromChildren(ast.children);
  return ast;
}

function applyMoveNode(ast: any, root: MindmapNode, op: MindmapOperation): any {
  const mindNode = findMindNode(root, op.nodeId);
  const newParentMindNode = findMindNode(root, op.newParentId!);
  if (!mindNode || !newParentMindNode) return ast;
  const pos = mindNode.data?.sourcePosition;
  if (!pos) return ast;

  let extractedNode: any = null;
  const removeFromChildren = (children: any[]): boolean => {
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.position && positionsMatch(child.position, pos)) {
        extractedNode = children.splice(i, 1)[0];
        return true;
      }
      if (child.children && removeFromChildren(child.children)) {
        return true;
      }
    }
    return false;
  };

  removeFromChildren(ast.children);
  if (!extractedNode) return ast;

  const newParentPos = newParentMindNode.data?.sourcePosition;
  if (newParentPos) {
    const parentAstNode = findAstNodeByPosition(ast, newParentPos);
    if (parentAstNode) {
      if (parentAstNode.type === 'heading') {
        const insertIdx = findInsertIndexForHeading(ast, newParentPos, parentAstNode.depth);
        ast.children.splice(insertIdx, 0, extractedNode);
        return ast;
      }
    }
  }

  ast.children.push(extractedNode);
  return ast;
}

function findMindNode(root: MindmapNode, id: string): MindmapNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findMindNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findAstNodeByPosition(ast: any, pos: any): any {
  let found: any = null;
  const search = (node: any) => {
    if (found) return;
    if (node.position && positionsMatch(node.position, pos)) {
      found = node;
      return;
    }
    if (node.children) {
      for (const child of node.children) search(child);
    }
  };
  search(ast);
  return found;
}

function positionsMatch(a: any, b: any): boolean {
  return a.start.line === b.start.line &&
    a.start.column === b.start.column &&
    a.end.line === b.end.line &&
    a.end.column === b.end.column;
}

function findInsertIndexForHeading(ast: any, parentPos: any, parentLevel: number): number {
  let insertIdx = ast.children.length;
  let foundParent = false;
  for (let i = 0; i < ast.children.length; i++) {
    const child = ast.children[i];
    if (child.position && positionsMatch(child.position, parentPos)) {
      foundParent = true;
      continue;
    }
    if (foundParent && child.type === 'heading' && child.depth <= parentLevel) {
      insertIdx = i;
      break;
    }
  }
  return insertIdx;
}

function findInsertIndexForList(ast: any, parentPos: any): number {
  for (let i = 0; i < ast.children.length; i++) {
    const child = ast.children[i];
    if (child.position && positionsMatch(child.position, parentPos)) {
      if (child.type === 'list') {
        return i;
      }
      return i + 1;
    }
    if (child.children) {
      const idx = findInsertIndexForList(child, parentPos);
      if (idx >= 0) return idx;
    }
  }
  return ast.children.length;
}

export function flattenMindmapForOutline(root: MindmapNode, depth = 0): Array<{
  id: string;
  topic: string;
  depth: number;
  nodeType?: string;
}> {
  const items: Array<{ id: string; topic: string; depth: number; nodeType?: string }> = [{
    id: root.id,
    topic: root.topic,
    depth,
    nodeType: root.data?.nodeType,
  }];
  if (root.children) {
    for (const child of root.children) {
      items.push(...flattenMindmapForOutline(child, depth + 1));
    }
  }
  return items;
}
