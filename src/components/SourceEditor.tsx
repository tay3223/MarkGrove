import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { useAppStore } from '../stores/appStore';
import type { OpenFile } from '../types';

export default function SourceEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeFilePath = useAppStore(s => activeProjectId ? s.activeFilePath[activeProjectId] : null);
  const activeFile = useAppStore(s => {
    const pid = s.activeProjectId;
    if (!pid) return null;
    const fp = s.activeFilePath[pid];
    return s.openFiles[pid]?.find(f => f.path === fp) ?? null;
  });

  const latestRef = useRef<{
    activeProjectId: string | null;
    activeFilePath: string | null;
    updateFileContent: (pid: string, fp: string, content: string) => void;
    saveFile: (pid: string, fp: string) => Promise<void>;
  }>({} as any);
  latestRef.current = {
    activeProjectId,
    activeFilePath,
    updateFileContent: useAppStore.getState().updateFileContent,
    saveFile: useAppStore.getState().saveFile,
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: '',
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
      const { activeProjectId: pid, activeFilePath: fp, updateFileContent, saveFile } = latestRef.current;
      if (!pid || !fp || loadingRef.current) return;
      updateFileContent(pid, fp, editor.getValue());
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveFile(pid, fp);
      }, 500);
    });

    return () => {
      sub.dispose();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFile) return;
    if (editor.getValue() !== activeFile.content) {
      loadingRef.current = true;
      editor.setValue(activeFile.content);
      loadingRef.current = false;
    }
  }, [activeFile?.path]);

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
