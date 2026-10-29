import { Outlet, useParams } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { useProject } from '../state/sampleStore';

export function Workspace() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  if (!project) {
    return (
      <div className="page">
        <p className="empty-note">找不到這個專案。</p>
      </div>
    );
  }
  return (
    <div className="workspace">
      <AppNav projectId={project.id} variant="rail" />
      <div className="workspace-body">
        <Outlet />
      </div>
      <AppNav projectId={project.id} variant="bottom" />
    </div>
  );
}
