import { useMemo } from 'react';
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

export default function Preview() {
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });

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
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      });
    } catch {
      return '<p>预览渲染失败</p>';
    }
  }, [activeFile?.content]);

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
      className="preview-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
