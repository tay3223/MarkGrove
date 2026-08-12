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
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const openFile = useAppStore(s => s.openFile);

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
      // Sanitize HTML to prevent XSS
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

    // Parse source to get heading positions
    const lines = activeFile.content.split('\n');
    const headingPositions: Array<{ line: number; text: string; level: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        headingPositions.push({ line: i + 1, text: match[2], level: match[1].length });
      }
    }

    // Assign IDs to headings in the rendered HTML
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const usedSlugs = new Set<string>();
    headings.forEach((heading, index) => {
      const el = heading as HTMLElement;
      const text = el.textContent || '';
      let slug = slugify(text);
      // Deduplicate slugs
      let counter = 1;
      let finalSlug = slug;
      while (usedSlugs.has(finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }
      usedSlugs.add(finalSlug);
      el.id = finalSlug;

      // Add source line data attribute if we have a matching heading
      if (index < headingPositions.length) {
        el.setAttribute('data-source-line', String(headingPositions[index].line));
      }

      // Make headings clickable to jump to source
      el.style.cursor = 'pointer';
      el.title = '点击定位源码';
    });

    // Click handler for headings
    const handleHeadingClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const heading = target.closest('h1, h2, h3, h4, h5, h6');
      if (!heading) return;
      const line = heading.getAttribute('data-source-line');
      if (line && activeProjectId && activeFilePath) {
        const lineNum = parseInt(line, 10);
        requestSourcePosition({
          filePath: activeFilePath,
          projectId: activeProjectId,
          startLine: lineNum,
          endLine: lineNum,
        });
        setActiveTab('source');
      }
    };

    // Click handler for links
    const handleLinkClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href) return;

      // Handle relative .md links - open in app
      if (/\.(md|markdown|mdown|mkd)$/i.test(href) && !href.startsWith('http')) {
        e.preventDefault();
        if (activeProjectId && activeFilePath) {
          // Resolve relative path
          const currentDir = activeFilePath.replace(/[/\\][^/\\]*$/, '');
          const resolvedPath = href.startsWith('/')
            ? href
            : `${currentDir}/${href}`;
          // Normalize path separators
          const normalized = resolvedPath.replace(/\\/g, '/');
          openFile(activeProjectId, normalized);
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

      // External links - let them open in default browser
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        window.open(href, '_blank');
      }
    };

    container.addEventListener('click', handleHeadingClick);
    container.addEventListener('click', handleLinkClick);
    return () => {
      container.removeEventListener('click', handleHeadingClick);
      container.removeEventListener('click', handleLinkClick);
    };
  }, [html, activeFile?.content, activeProjectId, activeFilePath, requestSourcePosition, setActiveTab, openFile]);

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
