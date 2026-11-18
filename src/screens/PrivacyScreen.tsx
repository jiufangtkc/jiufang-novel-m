import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/Icons';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { PRIVACY_PARAGRAPHS, PRIVACY_TITLE } from '../copy/userFacing';
import { useProject } from '../state/sampleStore';
import './privacy.css';

export function PrivacyScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const navigate = useNavigate();

  if (!project) return <ManuscriptNotFound />;

  return (
    <div className="page" data-testid="privacy-screen">
      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          aria-label="返回設定"
          data-testid="privacy-back"
          onClick={() => navigate(`/p/${project.id}/settings`)}
        >
          <BackIcon />
        </button>
        <h1>{PRIVACY_TITLE}</h1>
      </header>
      <div className="scroll-pane privacy-page" data-testid="privacy-body">
        {PRIVACY_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph} className="privacy-paragraph">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
