import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { MANUSCRIPT_NOT_FOUND } from '../copy/userFacing';
import { AppNav } from '../components/AppNav';
import { useProject, useSample } from '../state/sampleStore';

export function Workspace() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { actions } = useSample();
  useEffect(() => {
    if (project) actions.focusProject(project.id);
  }, [project, actions]);
  if (!project) {
    return (
      <div className="page">
        <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>
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
