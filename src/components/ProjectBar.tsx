import { useAppStore } from '../stores/appStore';

export default function ProjectBar() {
  const projects = useAppStore(s => s.projects);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const setActiveProject = useAppStore(s => s.setActiveProject);
  const addProject = useAppStore(s => s.addProject);
  const removeProject = useAppStore(s => s.removeProject);

  return (
    <div className="project-bar">
      {projects.map(p => (
        <div
          key={p.id}
          className={`project-icon ${p.id === activeProjectId ? 'active' : ''}`}
          title={p.name}
          onClick={() => setActiveProject(p.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (confirm(`关闭项目 "${p.name}"?`)) {
              removeProject(p.id);
            }
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
