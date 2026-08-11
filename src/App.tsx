import { useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import ProjectBar from './components/ProjectBar';
import FileTree from './components/FileTree';
import ContentArea from './components/ContentArea';

export default function App() {
  const initialized = useAppStore(s => s.initialized);
  const initFromSession = useAppStore(s => s.initFromSession);
  const handleExternalFileChange = useAppStore(s => s.handleExternalFileChange);

  useEffect(() => {
    initFromSession();
  }, [initFromSession]);

  useEffect(() => {
    window.api.onFileChanged(({ path, projectPath }) => {
      handleExternalFileChange(path, projectPath);
    });
    return () => {
      window.api.removeFileChangedListener();
    };
  }, [handleExternalFileChange]);

  if (!initialized) {
    return (
      <div className="app-layout">
        <div className="titlebar" />
        <div className="app-body">
          <div className="empty-state" style={{ width: '100%' }}>
            <div className="empty-icon">⏳</div>
            <div className="empty-text">加载中...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <div className="titlebar" />
      <div className="app-body">
        <ProjectBar />
        <FileTree />
        <ContentArea />
      </div>
    </div>
  );
}
