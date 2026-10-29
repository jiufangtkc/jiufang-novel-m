import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookIcon, CloseIcon, FolderIcon, PlusIcon } from '../components/Icons';
import { NEW_BOOK_NOVEL, NEW_BOOK_SHAPE, NEW_BOOK_SINGLE, OPEN_DB_FAIL } from '../copy/userFacing';
import { formatProjectUpdatedLabel } from '../domain/formatCalendarDate';
import { manuscriptWritePath, newChapterId, writePath } from '../domain/openManuscript';
import { canPickLocalFiles } from '../db/browserDisk';
import { useSample } from '../state/sampleStore';

export function HomeScreen() {
  const { state, actions, bookWords } = useSample();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const openInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('【示範】未命名專案');
  const [shape, setShape] = useState<'novel' | 'single'>('novel');
  const recent = state.recentIds
    .map((id) => state.projects.find((project) => project.id === id))
    .filter((project) => project !== undefined);

  return (
    <div className="home" data-testid="home-screen">
      <header className="topbar">
        <h1>九方小說編輯器M</h1>
      </header>
      <main className="home-main">
        <h2>最近開啟的稿子</h2>
        {recent.length === 0 ? (
          <p className="empty-note">還沒有稿子。開一本新的，或開啟已經存在的 .db 稿件檔。</p>
        ) : (
          <ul className="project-list">
            {recent.map((project) => (
              <li key={project.id} className="project-card" data-testid="project-card">
                <Link to={manuscriptWritePath(project)} className="project-main">
                  <span className="project-icon">
                    <BookIcon />
                  </span>
                  <span>
                    <strong>{project.title}</strong>
                    <small>
                      上次編輯：{formatProjectUpdatedLabel(project.updatedLabel)}　·　字數：{bookWords(project.id)}
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
          開新稿子
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            if (canPickLocalFiles()) {
              setBusy(true);
              void actions
                .openWithPicker()
                .then((opened) => {
                  if (opened) navigate(writePath(opened.id, opened.chapterId));
                })
                .catch(() => actions.toast(OPEN_DB_FAIL))
                .finally(() => setBusy(false));
              return;
            }
            openInputRef.current?.click();
          }}
        >
          <FolderIcon size={18} />
          開啟稿子
        </button>
        <input
          ref={openInputRef}
          type="file"
          accept=".db,application/octet-stream,application/x-sqlite3"
          hidden
          data-testid="open-db"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            void actions
              .importFile(file)
              .then((opened) => navigate(writePath(opened.id, opened.chapterId)))
              .catch(() => actions.toast(OPEN_DB_FAIL))
              .finally(() => setBusy(false));
          }}
        />
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
              const id = actions.addProject(title, shape);
              setCreating(false);
              navigate(shape === 'single' ? writePath(id, newChapterId(id)) : writePath(id));
            }}
          >
            <h2 id="new-project-title">開新稿子</h2>
            <label>
              書名
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={40}
              />
            </label>
            <p className="hint">{NEW_BOOK_SHAPE}</p>
            <div className="shape-choice">
              <button
                type="button"
                data-testid="shape-novel"
                className={shape === 'novel' ? 'is-current' : undefined}
                onClick={() => setShape('novel')}
              >
                {NEW_BOOK_NOVEL}
              </button>
              <button
                type="button"
                data-testid="shape-single"
                className={shape === 'single' ? 'is-current' : undefined}
                onClick={() => setShape('single')}
              >
                {NEW_BOOK_SINGLE}
              </button>
            </div>
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
    </div>
  );
}
