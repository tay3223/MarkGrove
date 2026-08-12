import { useMemo, useEffect, useRef } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import DOMPurify from 'dompurify';
import { useAppStore } from '../stores/appStore';
import { showToast } from './Toast';
import 'prismjs/themes/prism-tomorrow.css';

/** Generate a stable slug from heading text */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/** Extract heading positions from Markdown AST (covers ATX, Setext, inline formatting) */
function extractHeadingPositions(content: string): Array<{ line: number; text: string; level: number }> {
  try {
    const ast = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ['yaml'])
      .use(remarkGfm)
      .parse(content);

    const positions: Array<{ line: number; text: string; level: number }> = [];

    function extractText(node: any): string {
      if (node.type === 'text') return node.value;
      if (node.children) return node.children.map(extractText).join('');
      return '';
    }

    function walk(node: any) {
      if (node.type === 'heading' && node.position) {
        positions.push({
          line: node.position.start.line,
          text: extractText(node),
          level: node.depth,
        });
      }
      if (node.children) {
        for (const child of node.children) {
          walk(child);
        }
      }
    }
    walk(ast);
    return positions;
  } catch {
    return [];
  }
}

export default function Preview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });
  const requestSourcePosition = useAppStore(s => s.requestSourcePosition);
  const requestMindmapNode = useAppStore(s => s.requestMindmapNode);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const openFile = useAppStore(s => s.openFile);

  // Extract heading positions from AST for reliable source mapping
  const headingPositions = useMemo(() => {
    if (!activeFile?.content) return [];
    return extractHeadingPositions(activeFile.content);
  }, [activeFile?.content]);

  const html = useMemo(() => {
    if (!activeFile?.content) return '';
    try {
      const result = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml'])
        .use(remarkGfm)
        .use(remarkRehype)
        .use(rehypeHighlight)
        .use(rehypeStringify)
        .processSync(activeFile.content);
      const rawHtml = String(result);
      return DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'p', 'a', 'ul', 'ol', 'li', 'blockquote',
          'pre', 'code', 'em', 'strong', 'del',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'img', 'hr', 'br', 'span', 'div',
          'sup', 'sub', 'input', 'label',
        ],
        ALLOWED_ATTR: [
          'href', 'src', 'alt', 'title', 'class', 'id',
          'type', 'checked', 'disabled', 'readonly',
          'data-source-line', 'data-heading-slug',
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      });
    } catch {
      return '<p>预览渲染失败</p>';
    }
  }, [activeFile?.content]);

  // Add heading IDs and click handlers after render
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeFile?.content) return;

    // Assign IDs to headings using AST-derived positions
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const usedSlugs = new Set<string>();
    headings.forEach((heading, index) => {
      const el = heading as HTMLElement;
      const text = el.textContent || '';
      let slug = slugify(text);
      let counter = 1;
      let finalSlug = slug;
      while (usedSlugs.has(finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }
      usedSlugs.add(finalSlug);
      el.id = finalSlug;

      // Use AST position data for reliable source line mapping
      if (index < headingPositions.length) {
        el.setAttribute('data-source-line', String(headingPositions[index].line));
      }

      el.style.cursor = 'pointer';
      el.title = '点击定位源码';
    });

    // Click handler for headings - jump to source AND mindmap
    const handleHeadingClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const heading = target.closest('h1, h2, h3, h4, h5, h6');
      if (!heading) return;
      const line = heading.getAttribute('data-source-line');
      if (line && activeProjectId && activeFilePath) {
        const lineNum = parseInt(line, 10);
        // Request source position
        requestSourcePosition({
          filePath: activeFilePath,
          projectId: activeProjectId,
          startLine: lineNum,
          endLine: lineNum,
        });
        // Also request mindmap node selection
        requestMindmapNode({
          filePath: activeFilePath,
          projectId: activeProjectId,
          line: lineNum,
        });
        setActiveTab('source');
      }
    };

    // Click handler for links
    const handleLinkClick = async (e: Event) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href) return;

      // Handle relative .md links (with optional fragment/query) - resolve via IPC and open in app
      const mdLinkMatch = href.match(/^(.*?\.(?:md|markdown|mdown|mkd))([#?].*)?$/i);
      if (mdLinkMatch && !href.startsWith('http')) {
        e.preventDefault();
        const mdPath = mdLinkMatch[1]; // Path without fragment/query
        if (activeProjectId && activeFilePath) {
          try {
            const currentDir = await window.api.getDirName(activeFilePath);
            const result = await window.api.resolvePath(currentDir, mdPath);
            if (result.error) {
              showToast({ type: 'error', message: '无法解析链接路径', detail: result.error });
              return;
            }
            if (result.resolved) {
              await openFile(activeProjectId, result.resolved);
              // Verify file was opened
              const opened = useAppStore.getState().openFiles[activeProjectId]?.find(f => f.path === result.resolved);
              if (!opened) {
                showToast({ type: 'error', message: '无法打开链接的文件' });
              }
            }
          } catch (err: any) {
            showToast({ type: 'error', message: '打开链接失败', detail: err?.message });
          }
        }
        return;
      }

      // Handle anchor links within the same document
      if (href.startsWith('#')) {
        e.preventDefault();
        const targetId = href.slice(1);
        const targetEl = container.querySelector(`#${CSS.escape(targetId)}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      // External links - open in system browser via IPC
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        window.api.openExternal(href);
      }
    };

    container.addEventListener('click', handleHeadingClick);
    container.addEventListener('click', handleLinkClick);
    return () => {
      container.removeEventListener('click', handleHeadingClick);
      container.removeEventListener('click', handleLinkClick);
    };
  }, [html, activeFile?.content, activeProjectId, activeFilePath, requestSourcePosition, requestMindmapNode, setActiveTab, openFile, headingPositions]);

  if (!activeFile) {
    return (
      <div className="empty-state">
        <div className="empty-icon">👁</div>
        <div className="empty-text">从文件树选择一个文件</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="preview-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
