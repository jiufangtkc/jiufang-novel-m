import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/Icons';
import { MANUSCRIPT_NOT_FOUND } from '../copy/userFacing';
import { useProject } from '../state/sampleStore';
import './fontLicense.css';

const OFL_URL = '/fonts/OFL.txt';

export function FontLicenseScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const navigate = useNavigate();
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(OFL_URL);
        if (!response.ok) {
          throw new Error('fetch failed');
        }
        const body = await response.text();
        if (!cancelled) {
          setText(body);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!project) return <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>;

  return (
    <div className="page" data-testid="font-license-screen">
      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          aria-label="返回設定"
          data-testid="font-license-back"
          onClick={() => navigate(`/p/${project.id}/settings`)}
        >
          <BackIcon />
        </button>
        <h1>芫荽字型授權</h1>
      </header>
      <div className="scroll-pane font-license-page">
        {loadError && (
          <p className="form-error" role="alert">
            無法載入授權全文，請稍後再試。
          </p>
        )}
        {text !== null && (
          <pre className="font-license-text" data-testid="font-license-body">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}