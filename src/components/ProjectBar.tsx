import { useAppStore } from '../stores/appStore';
import { confirmDialog } from './ConfirmDialog';

export default function ProjectBar() {
  const projects = useAppStore(s => s.projects);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const setActiveProject = useAppStore(s => s.setActiveProject);
  const addProject = useAppStore(s => s.addProject);
  const removeProject = useAppStore(s => s.removeProject);

  const handleRemoveProject = async (projectId: string, projectName: string) => {
    const confirmed = await confirmDialog({
      title: '关闭项目',
      message: `确定要关闭项目 "${projectName}" 吗？`,
      confirmLabel: '关闭',
      danger: true,
    });
    if (confirmed) {
      removeProject(projectId);
    }
  };

  return (
    <div className="project-bar">
      {projects.map(p => (
        <div
          key={p.id}
          className={`project-icon ${p.id === activeProjectId ? 'active' : ''}`}
          title={`${p.name}\n右键关闭项目`}
          onClick={() => setActiveProject(p.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            handleRemoveProject(p.id, p.name);
          }}
        >
          {p.name.charAt(0).toUpperCase()}
        </div>
      ))}
      <div
        className="project-icon add-btn"
        title="打开项目"
        onClick={addProject}
      >
        +
      </div>
    </div>
  );
}
