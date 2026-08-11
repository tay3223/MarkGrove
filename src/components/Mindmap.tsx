import { useEffect, useRef, useCallback, useState } from 'react';
import MindElixir from 'mind-elixir';
import { DARK_THEME } from 'mind-elixir';
import type { MainLineParams, MindElixirInstance, SubLineParams } from 'mind-elixir';
import { useAppStore } from '../stores/appStore';
import { parseMarkdown, stringifyMarkdown, mdastToMindmap, applyMindmapOperation } from '../utils/mdastConverter';
import type { MindmapNode } from '../types';
import type { MindmapOperation } from '../utils/mdastConverter';

const themeSpacing = {
  '--node-gap-x': '36px',
  '--node-gap-y': '6px',
  '--main-gap-x': '64px',
  '--main-gap-y': '4px',
  '--topic-padding': '3px 10px',
  '--map-padding': '20px',
};

const orthogonalPath = (x1: number, y1: number, x2: number, y2: number) => {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
};

function orthogonalMainBranch({
  pT, pL, pW, pH, cT, cL, cW, cH, direction,
}: MainLineParams): string {
  const isLeft = direction === 'lhs';
  const x1 = isLeft ? pL : pL + pW;
  const x2 = isLeft ? cL + cW : cL;
  return orthogonalPath(x1, pT + pH / 2, x2, cT + cH / 2);
}

function orthogonalSubBranch(this: MindElixirInstance, {
  pT, pL, pW, pH, cT, cL, cW, cH, direction, isFirst,
}: SubLineParams): string {
  // SubLineParams 的宽度包含 me-parent 留给连线的水平 padding，
  // 而一级节点被 mind-elixir 的高优先级样式取消了这层 padding。
  const nodeGap = Number.parseFloat(
    this.container.style.getPropertyValue('--node-gap-x'),
  ) || Number.parseFloat(themeSpacing['--node-gap-x']);
  const isLeft = direction === 'lhs';
  const x1 = isLeft
    ? pL + (isFirst ? 0 : nodeGap)
    : pL + pW - (isFirst ? 0 : nodeGap);
  const x2 = isLeft ? cL + cW - nodeGap : cL + nodeGap;
  return orthogonalPath(x1, pT + pH / 2, x2, cT + cH / 2);
}

function enableLeftButtonPan(me: MindElixirInstance): () => void {
  const { container } = me;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const stopMindElixirPointerHandling = (event: PointerEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (
      event.pointerType !== 'mouse'
      || event.button !== 0
      || event.target !== container
    ) return;

    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    container.setPointerCapture(pointerId);
    stopMindElixirPointerHandling(event);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    me.move(dx, dy);
    stopMindElixirPointerHandling(event);
  };

  const finishPan = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (container.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId);
    }
    pointerId = null;
    stopMindElixirPointerHandling(event);
  };

  container.addEventListener('pointerdown', handlePointerDown, true);
  container.addEventListener('pointermove', handlePointerMove, true);
  container.addEventListener('pointerup', finishPan, true);
  container.addEventListener('pointercancel', finishPan, true);

  return () => {
    container.removeEventListener('pointerdown', handlePointerDown, true);
    container.removeEventListener('pointermove', handlePointerMove, true);
    container.removeEventListener('pointerup', finishPan, true);
    container.removeEventListener('pointercancel', finishPan, true);
  };
}

export default function Mindmap({
  onMindmapRoot,
  onSelectNode,
}: {
  onMindmapRoot?: (root: MindmapNode | null) => void;
  onSelectNode?: (node: MindmapNode | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<any>(null);
  const astRef = useRef<any>(null);
  const mindmapRootRef = useRef<MindmapNode | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const pendingFitFilePathRef = useRef<string | null>(null);
  const pendingAutoFitFilePathRef = useRef<string | null>(null);
  const lastFittedFilePathRef = useRef<string | null>(null);
  const [, forceReadyRender] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });
  const updateFileContent = useAppStore(s => s.updateFileContent);
  const saveFile = useAppStore(s => s.saveFile);
  const markFileDirty = useAppStore(s => s.markFileDirty);

  const fileName = activeFilePath ? activeFilePath.split('/').pop() || '' : '';

  const syncToFile = useCallback((newContent: string) => {
    if (!activeProjectId || !activeFilePath) return;
    updateFileContent(activeProjectId, activeFilePath, newContent);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveFile(activeProjectId, activeFilePath);
    }, 500);
  }, [activeProjectId, activeFilePath, updateFileContent, saveFile]);

  const scheduleFit = useCallback((filePath: string) => {
    const me = meRef.current;
    if (!me) return;
    pendingFitFilePathRef.current = filePath;
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = requestAnimationFrame(() => {
        if (pendingFitFilePathRef.current === filePath) {
          meRef.current?.scaleFit();
          lastFittedFilePathRef.current = filePath;
          pendingAutoFitFilePathRef.current = null;
          forceReadyRender(v => v + 1);
          pendingFitFilePathRef.current = null;
        }
        fitFrameRef.current = null;
      });
    });
  }, []);

  const handleOperation = useCallback((op: MindmapOperation) => {
    if (!astRef.current || !mindmapRootRef.current || !activeFilePath) return;
    const newAst = applyMindmapOperation(astRef.current, mindmapRootRef.current, op);
    astRef.current = newAst;
    const newContent = stringifyMarkdown(newAst);
    syncToFile(newContent);
  }, [activeFilePath, syncToFile]);

  const rebuildMindmap = useCallback((content: string, shouldAutoFit: boolean) => {
    if (!containerRef.current) return;
    try {
      const ast = parseMarkdown(content);
      astRef.current = ast;
      const mindmapData = mdastToMindmap(ast, fileName);
      mindmapRootRef.current = mindmapData;

      if (meRef.current) {
        meRef.current.destroy();
        meRef.current = null;
      }

      const me = new MindElixir({
        el: containerRef.current,
        direction: MindElixir.RIGHT,
        draggable: true,
        editable: true,
        contextMenu: false,
        toolBar: false,
        keypress: true,
        mouseSelectionButton: 2,
        theme: {
          name: 'MochaDark',
          palette: ['#89b4fa', '#cba6f7', '#94e2d5', '#fab387', '#a6e3a1', '#f9e2af', '#f38ba8', '#74c7ec', '#f5c2e7'],
          cssVar: {
            ...(DARK_THEME as any).cssVar,
            '--bgcolor': '#1e1e2e',
            '--color': '#cdd6f4',
            '--main-color': '#cdd6f4',
            '--main-bgcolor': '#45475a',
            '--main-border': '#89b4fa',
            '--main-radius': '6px',
            '--root-bgcolor': '#313244',
            '--root-color': '#cdd6f4',
            '--root-border-color': '#89b4fa',
            '--selected': '#89b4fa',
            '--panel-bgcolor': '#181825',
            '--panel-color': '#a6adc8',
            // 紧凑布局（间距值见模块顶层 themeSpacing，加进 useCallback 依赖以支持 HMR 热更新）
            ...themeSpacing,
          },
          generateMainBranch: orthogonalMainBranch,
          generateSubBranch: orthogonalSubBranch,
        },
        before: {
          insertSibling: () => true,
          addChild: () => true,
        },
      } as any);

      me.init({ nodeData: mindmapData });
      me.disposable.push(enableLeftButtonPan(me));
      onMindmapRoot?.(mindmapData);

      me.bus.addListener('selectNodes', (nodes: any[]) => {
        const nodeObj = nodes && nodes[0];
        if (!nodeObj || !mindmapRootRef.current) {
          onSelectNode?.(null);
          return;
        }
        const findById = (n: MindmapNode): MindmapNode | null => {
          if (n.id === nodeObj.id) return n;
          for (const c of n.children || []) {
            const f = findById(c);
            if (f) return f;
          }
          return null;
        };
        onSelectNode?.(findById(mindmapRootRef.current));
      });

      me.bus.addListener('operation', (operation: any) => {
        if (!operation) return;
        const name = operation.name;
        const obj = operation.obj;

        if (name === 'addChild') {
          handleOperation({
            type: 'addChild',
            nodeId: obj?.id || '',
            parentId: obj?.parent?.id || '',
            newText: obj?.topic || 'New Node',
          });
        } else if (name === 'finishEdit') {
          handleOperation({
            type: 'editText',
            nodeId: obj?.id || '',
            newText: obj?.topic || '',
          });
        } else if (name === 'removeNode') {
          handleOperation({
            type: 'deleteNode',
            nodeId: obj?.id || '',
          });
        } else if (name === 'moveNode') {
          handleOperation({
            type: 'moveNode',
            nodeId: obj?.id || '',
            newParentId: obj?.toParent?.id || '',
          });
        }
      });

      meRef.current = me;

      if (shouldAutoFit) {
        pendingAutoFitFilePathRef.current = activeFilePath || null;
        scheduleFit(activeFilePath || '');
      }
    } catch (err) {
      pendingAutoFitFilePathRef.current = null;
      console.error('Failed to build mindmap:', err);
    }
  }, [fileName, handleOperation, onMindmapRoot, onSelectNode, orthogonalMainBranch, orthogonalSubBranch, scheduleFit, themeSpacing]);

  useEffect(() => {
    if (activeFile?.content !== undefined) {
      const shouldAutoFit = activeFilePath !== lastFittedFilePathRef.current;
      rebuildMindmap(activeFile.content, shouldAutoFit);
    }
  }, [activeFile?.content, activeFilePath, rebuildMindmap]);

  useEffect(() => {
    return () => {
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      pendingFitFilePathRef.current = null;
      pendingAutoFitFilePathRef.current = null;
      lastFittedFilePathRef.current = null;
      if (meRef.current) {
        meRef.current.destroy();
        meRef.current = null;
      }
    };
  }, []);

  if (!activeFile) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🧠</div>
        <div className="empty-text">从文件树选择一个文件</div>
      </div>
    );
  }

  const shouldHideMindmap = activeFilePath !== null
    && (
      activeFilePath === pendingAutoFitFilePathRef.current
      || activeFilePath !== lastFittedFilePathRef.current
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div className="mindmap-toolbar">
        <span className="file-name">{fileName}</span>
        {activeFile.isDirty && <span className="dirty-dot" />}
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="搜索节点..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            width: '140px',
            outline: 'none',
          }}
        />
        <button
          onClick={() => {
            const me = meRef.current;
            if (me) me.scale(Math.max(me.scaleVal / 1.2, me.scaleMin));
          }}
          title="缩小"
        >－</button>
        <button
          onClick={() => {
            const me = meRef.current;
            if (me) me.scale(Math.min(me.scaleVal * 1.2, me.scaleMax));
          }}
          title="放大"
        >＋</button>
        <button onClick={() => meRef.current?.scaleFit()}>适应</button>
        <button onClick={() => {
          if (meRef.current) {
            const svg = meRef.current.exportSvg?.();
            if (svg) {
              const url = URL.createObjectURL(svg);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${fileName.replace('.md', '')}.svg`;
              a.click();
              URL.revokeObjectURL(url);
            }
          }
        }}>导出</button>
      </div>
      <div
        className="mindmap-container"
        ref={containerRef}
        style={{
          visibility: shouldHideMindmap ? 'hidden' : 'visible',
          pointerEvents: shouldHideMindmap ? 'none' : 'auto',
        }}
      />
    </div>
  );
}
