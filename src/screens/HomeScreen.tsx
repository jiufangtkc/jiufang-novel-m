import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookIcon, CloseIcon, FolderIcon, PlusIcon } from '../components/Icons';
import {
  lastEditDisplay,
  IMPORT_TEXT_FILE_BUTTON,
  IMPORT_TEXT_WORKING,
  NEW_BOOK_DEFAULT_TITLE,
  NEW_BOOK_NOVEL,
  NEW_BOOK_SHAPE,
  NEW_BOOK_SINGLE,
  openButtonLabel,
  removeFromDeviceAria,
} from '../copy/userFacing';
import { latestEditTimestamp } from '../domain/saveClock';
import { useLayout } from '../layout';
import { manuscriptWritePath, newManuscriptFirstNodeId, writePath } from '../domain/openManuscript';
import {
  BADGE_SAME_BOOK,
  BADGE_SAME_TITLE,
  KEEP_ONE_BUTTON,
  KEEP_ONE_PARTIAL_FAILED,
  filenameLine,
  removeAlsoSameTitleNote,
} from '../copy/duplicateOpenCopy';
import { hasUnsavedChanges } from '../domain/duplicateOpen';
import { browserDeviceStore, createDeviceOnlyProbe } from '../state/deviceOnlyContent';
import { removeOtherCopies } from '../state/keepOnlyThis';
import { recentListEntries } from '../state/recentProjects';
import { useSample } from '../state/sampleStore';
import { KeepOnlyThisDialog } from './KeepOnlyThisDialog';
import { RemoveFromDeviceDialog } from './RemoveFromDeviceDialog';
import { useFirstRunWelcome } from './useFirstRunWelcome';
import { useImportTextFile } from './useImportTextFile';
import { useOpenManuscriptFile } from './useOpenManuscriptFile';
import { isWelcomeStartNew } from './welcomeStart';
import { useWelcomeSteps } from './WelcomeSteps';
import { WelcomeTour } from './WelcomeTour';

export function HomeScreen() {
  const { state, actions, bookWords, isGlowing } = useSample();
  // WO-110：全新裝置第一次打開首頁時自動出現歡迎導覽。
  const welcome = useFirstRunWelcome();
  const { isAtLeastMedium } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  // 「開啟稿子」：picker 或隱藏 file input（WO-111 抽成共用，歡迎導覽收尾也用）。
  const openFile = useOpenManuscriptFile();
  // WO-120：「匯入文字檔」（原在檔案頁）。WO-126：選檔後開視窗，先預覽再確定，成功直接開成新稿子。
  const importText = useImportTextFile();
  // WO-111：歡迎導覽三關內容（第一次使用，沒有開著的稿子）。
  const steps = useWelcomeSteps({ entry: 'first', project: null });
  const [title, setTitle] = useState(NEW_BOOK_DEFAULT_TITLE);
  const [shape, setShape] = useState<'novel' | 'single'>('novel');
  // WO-143（取代 WO-84）：同名稿子每一份都列出來，重名時標示差別。
  const recent = recentListEntries(state.projects, state.recentIds);

  // WO-143：「留下這一份，刪掉同一本的其他份」；keepOne 有值才顯示確認視窗。
  const [keepOne, setKeepOne] = useState<{
    id: string;
    title: string;
    otherIds: string[];
    hasUnsaved: boolean;
  } | null>(null);
  const [keepOneBusy, setKeepOneBusy] = useState(false);
  const closeKeepOne = () => {
    if (!keepOneBusy) setKeepOne(null);
  };
  const confirmKeepOne = async () => {
    if (!keepOne || keepOneBusy) return;
    setKeepOneBusy(true);
    try {
      const result = await removeOtherCopies({ ids: keepOne.otherIds, remove: actions.removeFromDevice });
      if (result.failedId !== null) actions.toast(KEEP_ONE_PARTIAL_FAILED);
    } finally {
      setKeepOneBusy(false);
      setKeepOne(null);
    }
  };
  useEffect(() => {
    if (!keepOne) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !keepOneBusy) setKeepOne(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keepOne, keepOneBusy]);

  // WO-116：按 X 先問；removing 有值才顯示確認視窗。
  const [removing, setRemoving] = useState<{ id: string; title: string; note: string | null } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const closeRemoving = () => {
    if (!removeBusy) setRemoving(null);
  };
  const confirmRemoving = async () => {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    try {
      await actions.removeFromDevice(removing.id);
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  };
  useEffect(() => {
    if (!removing) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removeBusy) setRemoving(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removing, removeBusy]);

  // WO-111：從「設定 › 關於」再看一次、第 3 關選「開新稿子」後回到首頁：打開現有的開新稿子對話框（不直接建稿）。
  // 用過就清掉，重新載入或上一頁不會再打開。
  useEffect(() => {
    if (!isWelcomeStartNew(location.state)) return;
    setCreating(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  return (
    <div className="home" data-testid="home-screen" data-import-open={importText.open ? 'true' : undefined}>
      <header className="topbar" inert={welcome.show || importText.open}>
        <h1>九方小說編輯器M</h1>
      </header>
      <main className="home-main" inert={welcome.show || importText.open}>
        <h2>最近開啟的稿子</h2>
        {recent.length === 0 ? (
          <p className="empty-note">還沒有稿子。開一本新的，或開啟已經存在的 .db 稿件檔。</p>
        ) : (
          <ul className="project-list">
            {recent.map((entry) => {
              const { project } = entry;
              return (
              <li
                key={project.id}
                className={entry.otherSameBookIds.length > 0 ? 'project-card has-keep-one' : 'project-card'}
                data-testid="project-card"
              >
                <Link to={manuscriptWritePath(project)} className="project-main">
                  <span className="project-icon">
                    <BookIcon />
                  </span>
                  <span>
                    <strong>{project.title}</strong>
                    <small>
                      {`上次編輯：${lastEditDisplay({
                        updatedLabel: project.updatedLabel,
                        notPhone: isAtLeastMedium,
                        lastEditMs: latestEditTimestamp(state.saveMeta[project.id]),
                      })}　·　字數：${bookWords(project.id)}`}
                    </small>
                    {entry.filename ? (
                      <small data-testid="project-filename">{filenameLine(entry.filename)}</small>
                    ) : null}
                    {entry.badge ? (
                      <small className="project-badge" data-testid="project-badge" data-badge={entry.badge}>
                        {entry.badge === 'same-book' ? BADGE_SAME_BOOK : BADGE_SAME_TITLE}
                      </small>
                    ) : null}
                  </span>
                </Link>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={removeFromDeviceAria(project.title)}
                  // WO-116：只開確認視窗，不動任何資料；按「刪掉」才真的刪。辨認哪一份一律用稿子代號。
                  onClick={() =>
                    setRemoving({
                      id: project.id,
                      title: project.title,
                      note: entry.sameTitleOthers > 0 ? removeAlsoSameTitleNote(project.title) : null,
                    })
                  }
                >
                  <CloseIcon />
                </button>
                {entry.otherSameBookIds.length > 0 ? (
                  <button
                    type="button"
                    className="project-keep-one"
                    data-testid="keep-only-this"
                    // 只開確認視窗，不動任何資料；只刪 isSameBook 的其他份，不刪只是同名的別本。
                    onClick={() =>
                      setKeepOne({
                        id: project.id,
                        title: project.title,
                        otherIds: entry.otherSameBookIds,
                        hasUnsaved: entry.otherSameBookIds.some((otherId) => {
                          const other = state.projects.find((item) => item.id === otherId);
                          // 與開檔詢問同一個判斷：含這個裝置獨有的卡片草稿與即時草稿。
                          return (
                            !other ||
                            hasUnsavedChanges(other, state.saveMeta, createDeviceOnlyProbe(browserDeviceStore()))
                          );
                        }),
                      })
                    }
                  >
                    {KEEP_ONE_BUTTON}
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </main>
      <footer className="home-actions" inert={welcome.show || importText.open}>
        <button type="button" className="button primary" onClick={() => setCreating(true)}>
          <PlusIcon size={18} />
          開新稿子
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={openFile.busy}
          onClick={() => openFile.open()}
        >
          <FolderIcon size={18} />
          {openButtonLabel(openFile.busy, '開啟稿子')}
        </button>
        {/* WO-120：匯入文字檔從檔案頁搬來，固定排在開啟稿子後面；窄版放不下時整顆換行，不切字。 */}
        <button
          type="button"
          className="button secondary"
          data-testid="import-text-file"
          ref={importText.buttonRef}
          aria-busy={importText.busy ? 'true' : undefined}
          aria-describedby={importText.error ? 'import-text-error' : undefined}
          onClick={importText.pick}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          {IMPORT_TEXT_FILE_BUTTON}
        </button>
        {importText.busy ? (
          <p className="home-import-status" role="status" data-testid="import-text-working">
            {IMPORT_TEXT_WORKING}
          </p>
        ) : null}
        {importText.error ? (
          <p className="home-import-error" id="import-text-error" role="alert" data-testid="import-text-error">
            {importText.error}
          </p>
        ) : null}
      </footer>
      {/* 放在 inert 區塊外：導覽收尾「開始寫」選檔時，首頁後面還是 inert。 */}
      {openFile.input}
      {importText.input}
      {/* WO-126：匯入視窗（填章名例子、看預覽、確定）；放在 inert 區塊外。 */}
      {importText.dialog}
      {welcome.show && (
        <WelcomeTour
          entry="first"
          todayWords={state.schedule.open?.wordCount ?? 0}
          dailyGoal={state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal}
          met={isGlowing}
          {...steps}
          openBusy={openFile.busy}
          // 整趟跳過、收尾「回首頁」都是關掉導覽留在首頁；紀錄已由導覽寫好。
          // WO-111：收尾「開始寫」：開新稿子＝打開現有對話框（全書目標由 WO-109 帶入）；開啟稿子＝系統選檔。
          // WO-121：開啟稿子在讀取中導覽先留著，「開始寫」顯示開檔忙碌用字；成功／失敗／取消結束後才關掉導覽。
          onExit={(exit) => {
            if (exit === 'finish-open') {
              openFile.open(() => welcome.dismiss());
              return;
            }
            welcome.dismiss();
            if (exit === 'finish-new') setCreating(true);
          }}
        />
      )}
      {removing && (
        <RemoveFromDeviceDialog
          bookTitle={removing.title}
          busy={removeBusy}
          extraNote={removing.note}
          onConfirm={() => void confirmRemoving()}
          onCancel={closeRemoving}
        />
      )}
      {keepOne && (
        <KeepOnlyThisDialog
          bookTitle={keepOne.title}
          otherCount={keepOne.otherIds.length}
          hasUnsaved={keepOne.hasUnsaved}
          busy={keepOneBusy}
          onConfirm={() => void confirmKeepOne()}
          onCancel={closeKeepOne}
        />
      )}
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
              navigate(writePath(id, newManuscriptFirstNodeId(id, shape)));
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
