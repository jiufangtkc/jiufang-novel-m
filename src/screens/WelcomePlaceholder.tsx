import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/Icons';
import {
  WELCOME_PLACEHOLDER_BACK_ARIA,
  WELCOME_PLACEHOLDER_BODY,
  WELCOME_PLACEHOLDER_TITLE,
} from '../copy/aboutCopy';

/** WO-108 過渡空頁：只能返回設定，不寫任何設定、不改目標。WO-110 以正式導覽取代。 */
export function WelcomePlaceholder() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <div className="page" data-testid="welcome-placeholder">
      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          aria-label={WELCOME_PLACEHOLDER_BACK_ARIA}
          data-testid="welcome-placeholder-back"
          onClick={() => navigate(`/p/${projectId}/settings`)}
        >
          <BackIcon />
        </button>
        <h1>{WELCOME_PLACEHOLDER_TITLE}</h1>
      </header>
      <div className="scroll-pane privacy-page">
        <p className="privacy-paragraph">{WELCOME_PLACEHOLDER_BODY}</p>
      </div>
    </div>
  );
}
