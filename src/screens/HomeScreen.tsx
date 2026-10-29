import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookIcon, CloseIcon, FolderIcon, PlusIcon, RefreshIcon } from '../components/Icons';
import { useSample } from '../state/sampleStore';

export function HomeScreen() {
  const { state, actions, bookWords } = useSample();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [title, setTitle] = useState('【示範】未命名專案');
  const recent = state.recentIds
    .map((id) => state.projects.find((project) => project.id === id))
    .filter((project) => project !== undefined);

  return (
    <div className="home" data-testid="home-screen">
      <header className="topbar">
        <h1>九方小說編輯器M</h1>
        <button
          type="button"
          className="icon-button"
          aria-label="重新整理"
          onClick={() => actions.toast('已重新整理。樣品沒有伺服器，清單就是目前畫面上的示範專案。')}
        >
          <RefreshIcon />
        </button>
      </header>
      <main className="home-main">
        <h2>最近開啟的專案</h2>
        {recent.length === 0 ? (
          <p className="empty-note">最近沒有專案。可以新增一個示範專案。</p>
        ) : (
          <ul className="project-list">
            {recent.map((project) => (
              <li key={project.id} className="project-card" data-testid="project-card">
                <Link to={`/p/${project.id}/write`} className="project-main">
                  <span className="project-icon">
                    <BookIcon />
                  </span>
                  <span>
                    <strong>{project.title}</strong>
                    <small>
                      上次編輯：{project.updatedLabel}　·　字數：{bookWords(project.id)}
                    </small>
                  </span>
                </Link>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`從最近清單移除${project.title}`}
                  onClick={() => actions.dismissRecent(project.id)}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      <footer className="home-actions">
        <button type="button" className="button primary" onClick={() => setCreating(true)}>
          <PlusIcon size={18} />
          新增專案
        </button>
        <button type="button" className="button secondary" onClick={() => setOpening(true)}>
          <FolderIcon size={18} />
          開啟檔案
        </button>
      </footer>
      {creating && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setCreating(false)}>
          <form
            className="dialog"
            role="dialog"
            aria-labelledby="new-project-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const id = actions.addProject(title);
              setCreating(false);
              navigate(`/p/${id}/write`);
            }}
          >
            <h2 id="new-project-title">新增專案</h2>
            <label>
              專案名稱
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={40}
              />
            </label>
            <p className="hint">只會留在這個畫面裡，不會寫進檔案，也不會上傳。</p>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setCreating(false)}>
                取消
              </button>
              <button type="submit" className="button primary">
                建立
              </button>
            </div>
          </form>
        </div>
      )}
      {opening && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setOpening(false)}>
          <div className="dialog" role="dialog" aria-labelledby="open-file-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="open-file-title">開啟檔案</h2>
            <p>
              匯入電腦版的 .db 會在成品階段才接上。這個樣品不會讀取任何檔案，也不會把書稿放進公開的程式庫。
            </p>
            <div className="dialog-actions">
              <button type="button" className="button primary" onClick={() => setOpening(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
