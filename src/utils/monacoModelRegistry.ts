import * as monaco from 'monaco-editor';

/** Per-file Monaco models keyed by `projectId:filePath` */
const models = new Map<string, monaco.editor.ITextModel>();
/** Per-file view states keyed by `projectId:filePath` */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

export function modelKey(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

export function getOrCreateModel(projectId: string, filePath: string, content: string): monaco.editor.ITextModel {
  const key = modelKey(projectId, filePath);
  let model = models.get(key);
  if (!model || model.isDisposed()) {
    model = monaco.editor.createModel(content, 'markdown');
    models.set(key, model);
  }
  return model;
}

export function getViewState(key: string): monaco.editor.ICodeEditorViewState | null | undefined {
  return viewStates.get(key);
}

export function setViewState(key: string, state: monaco.editor.ICodeEditorViewState | null): void {
  viewStates.set(key, state);
}

/** Dispose model for a closed file to avoid memory leaks */
export function disposeModel(projectId: string, filePath: string): void {
  const key = modelKey(projectId, filePath);
  const model = models.get(key);
  if (model && !model.isDisposed()) {
    model.dispose();
  }
  models.delete(key);
  viewStates.delete(key);
}

/** Dispose all models for a project (e.g., when project is removed) */
export function disposeProjectModels(projectId: string): void {
  const prefix = `${projectId}:`;
  for (const [key, model] of models) {
    if (key.startsWith(prefix)) {
      if (!model.isDisposed()) {
        model.dispose();
      }
      models.delete(key);
      viewStates.delete(key);
    }
  }
}
