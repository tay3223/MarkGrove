import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { useAppStore } from '../stores/appStore';
import { modelKey, getOrCreateModel, getViewState, setViewState, disposeModel } from '../utils/monacoModelRegistry';

export default function SourceEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const loadingRef = useRef(false);
  const decorationsRef = useRef<string[]>([]);

  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });
  const pendingSourcePosition = useAppStore(s => s.pendingSourcePosition);
  const clearSourcePosition = useAppStore(s => s.clearSourcePosition);

  const latestRef = useRef<{
    activeProjectId: string | null;
    activeFilePath: string | null;
    updateFileContent: (pid: string, fp: string, content: string) => void;
    queueSave: (pid: string, fp: string) => void;
    requestMindmapNode: (req: { filePath: string; projectId: string; line: number }) => void;
  }>({} as any);
  latestRef.current = {
    activeProjectId,
    activeFilePath,
    updateFileContent: useAppStore.getState().updateFileContent,
    queueSave: useAppStore.getState().queueSave,
    requestMindmapNode: useAppStore.getState().requestMindmapNode,
  };

  // Track previous file key for view state save/restore
  const prevFileKeyRef = useRef<string | null>(null);

  // Debounce cursor position changes for mindmap sync
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create editor (no default model - we set per-file models)
  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      model: null, // Start with no model
      language: 'markdown',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      padding: { top: 12 },
      renderLineHighlight: 'none',
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { vertical: 'auto', horizontal: 'auto' },
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      const { activeProjectId: pid, activeFilePath: fp, updateFileContent, queueSave } = latestRef.current;
      if (!pid || !fp || loadingRef.current) return;
      updateFileContent(pid, fp, editor.getValue());
      queueSave(pid, fp);
    });

    // Listen for cursor position changes to sync with mindmap
    const cursorSub = editor.onDidChangeCursorPosition((e) => {
      const { activeProjectId: pid, activeFilePath: fp, requestMindmapNode } = latestRef.current;
      if (!pid || !fp || loadingRef.current) return;
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = setTimeout(() => {
        cursorTimerRef.current = null;
        requestMindmapNode({ filePath: fp, projectId: pid, line: e.position.lineNumber });
      }, 300);
    });

    return () => {
      sub.dispose();
      cursorSub.dispose();
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      // Save view state for current file before disposing
      if (prevFileKeyRef.current && editor) {
        try {
          setViewState(prevFileKeyRef.current, editor.saveViewState());
        } catch { /* ignore */ }
      }
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Handle file switch: save/restore view state and set model
  // This effect only runs when the file identity changes, not on every content update
  const fileKey = activeProjectId && activeFilePath ? modelKey(activeProjectId, activeFilePath) : null;
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFile || !activeProjectId || !activeFilePath || !fileKey) return;

    // Save view state for previous file
    if (prevFileKeyRef.current && prevFileKeyRef.current !== fileKey) {
      try {
        setViewState(prevFileKeyRef.current, editor.saveViewState());
      } catch { /* ignore */ }
    }

    // Get or create per-file model
    const model = getOrCreateModel(activeProjectId, activeFilePath, activeFile.content);

    // Sync content if model was just created with different content
    if (model.getValue() !== activeFile.content) {
      loadingRef.current = true;
      model.setValue(activeFile.content);
      loadingRef.current = false;
    }

    // Set model on editor and restore view state only on actual file switch
    if (editor.getModel() !== model) {
      editor.setModel(model);
      // Restore view state only when we actually switched models
      const savedViewState = getViewState(fileKey);
      if (savedViewState) {
        try {
          editor.restoreViewState(savedViewState);
        } catch { /* ignore */ }
      }
    }

    prevFileKeyRef.current = fileKey;
  }, [fileKey]); // Only depend on file identity, not content

  // Sync content from store to model when content changes (same file)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFile || !activeProjectId || !activeFilePath || !fileKey) return;
    if (prevFileKeyRef.current !== fileKey) return; // Not the current file

    const model = editor.getModel();
    if (!model || model.isDisposed()) return;

    // Only sync if content differs and we're not in the middle of user typing
    if (model.getValue() !== activeFile.content && !loadingRef.current) {
      // Use pushEditOperations to preserve undo stack and selection
      const fullRange = model.getFullModelRange();
      loadingRef.current = true;
      model.pushEditOperations(
        [],
        [{ range: fullRange, text: activeFile.content }],
        () => null
      );
      loadingRef.current = false;
    }
  }, [activeFile?.content, fileKey]);

  // Consume pending source position from store (mindmap → source navigation)
  useEffect(() => {
    if (!pendingSourcePosition || !editorRef.current) return;
    if (pendingSourcePosition.filePath !== activeFilePath) return;

    const editor = editorRef.current;
    const { startLine, endLine } = pendingSourcePosition;

    const model = editor.getModel();
    if (!model) return;
    const totalLines = model.getLineCount();
    const safeLine = Math.min(Math.max(1, startLine), totalLines);
    const safeEndLine = Math.min(Math.max(safeLine, endLine || startLine), totalLines);

    editor.revealLineInCenter(safeLine);
    editor.setPosition({ lineNumber: safeLine, column: 1 });

    const decorations = editor.deltaDecorations(decorationsRef.current, [{
      range: new monaco.Range(safeLine, 1, safeEndLine, 1),
      options: {
        isWholeLine: true,
        className: 'highlighted-line',
        linesDecorationsClassName: 'highlighted-line-decoration',
      },
    }]);
    decorationsRef.current = decorations;

    setTimeout(() => {
      if (editorRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
      }
    }, 2000);

    clearSourcePosition();
  }, [pendingSourcePosition, activeFilePath, clearSourcePosition]);

  if (!activeFile) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📝</div>
        <div className="empty-text">从文件树选择一个文件</div>
      </div>
    );
  }

  return <div className="source-editor" ref={containerRef} />;
}
