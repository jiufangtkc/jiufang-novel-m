import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CloudUploadIcon, DownloadIcon, FolderIcon, HomeIcon, SaveIcon } from '../components/Icons';
import {
  MANUSCRIPT_NOT_FOUND,
  OPEN_DB_FAIL,
  OPEN_DB_HINT,
  currentFileLine,
  titlePendingNotice,
} from '../copy/userFacing';
import { canPickLocalFiles } from '../db/browserDisk';
import { writePath } from '../domain/openManuscript';
import { formatLastExportLabel, formatLastProjectSave, latestSaveTimestamp } from '../domain/saveClock';
import { useProject, useSample } from '../state/sampleStore';
import { appSpaceStatusLine, isComputerLayout } from './filesStatus';
import { filesPageLayout } from './filesPageLayout';

function useComputerLayout(): boolean {
  const [computer, setComputer] = useState(() =>
    typeof window !== 'undefined' ? isComputerLayout(window.innerWidth) : false,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 600px)');
    const apply = () => setComputer(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return computer;
}

export function FilesScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const navigate = useNavigate();
  const openInputRef = useRef<HTMLInputElement>(null);
  const computer = useComputerLayout();
  if (!project) return <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>;

  const supportsDirectWriteback = canPickLocalFiles();
  const layout = filesPageLayout(supportsDirectWriteback);

  const meta = state.saveMeta[project.id] ?? {
    lastAutoSaveMs: null,
    lastManualSaveMs: null,
    lastExportMs: null,
    lastProjectSaveMs: null,
  };
  const lastSaveMs = latestSaveTimestamp(meta);
  const exportLabel = formatLastExportLabel(meta.lastExportMs);
  const projectSaveLabel = formatLastProjectSave(meta.lastProjectSaveMs);
  const pendingTitle = titlePendingNotice(project.titleSavePending);

  const openAnother = async () => {
    if (canPickLocalFiles()) {
      try {
        const opened = await actions.openWithPicker();
        if (opened) navigate(writePath(opened.id, opened.chapterId));
      } catch {
        actions.toast(OPEN_DB_FAIL);
      }
      return;
    }
    openInputRef.current?.click();
  };

  return (
    <div className="page" data-testid="files-screen">
      <header className="topbar">
        <h1>檔案</h1>
      </header>
      <div className="scroll-pane files-page">
        <article className="files-status-card" data-testid="files-status">
          <p className="files-status-title">
            目前的稿子：<strong>{project.title}</strong>
          </p>
          {pendingTitle ? (
            <p className="files-status-line is-warning" data-testid="title-pending-notice">
              {pendingTitle}
            </p>
          ) : null}
          {computer && project.hasExternalFile && project.filename ? (
            <p className="files-status-line" data-testid="current-file-line">
              {currentFileLine(project.filename)}
            </p>
          ) : null}
          <p className="files-status-line" data-testid="app-space-status">
            {appSpaceStatusLine({
              stored: project.origin === 'file',
              computer,
              lastSaveMs,
            })}
          </p>
          {layout.showLastProjectSave ? (
            <p className="files-status-line" data-testid="last-project-save-line">
              上次儲存：{projectSaveLabel}
            </p>
          ) : null}
          <p className="files-status-line">上次另存：{exportLabel}</p>
        </article>

        {layout.showSaveProject ? (
          <>
            <button
              type="button"
              className="button primary files-primary-action"
              data-testid="save-project"
              onClick={() => void actions.saveProject()}
            >
              <SaveIcon size={20} />
              儲存專案
            </button>
            <p className="hint files-action-hint">存回開啟時的那個檔案</p>
          </>
        ) : null}

        {layout.primaryIsSaveAs ? (
          <>
            <button
              type="button"
              className="button primary files-primary-action"
              data-testid="save-as-project"
              onClick={() => void actions.saveProjectAs()}
            >
              <CloudUploadIcon size={20} />
              另存專案
            </button>
            <p className="hint files-action-hint">將稿子存到各類雲端或其他位置</p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button secondary files-secondary-action"
              data-testid="save-as-project"
              onClick={() => void actions.saveProjectAs()}
            >
              <CloudUploadIcon size={20} />
              另存專案
            </button>
            <p className="hint files-action-hint">將稿子存到各類雲端或其他位置</p>
          </>
        )}

        {layout.showStashDraft ? (
          <button type="button" className="setting-row" data-testid="stash-draft" onClick={() => void actions.stashDraft()}>
            <DownloadIcon />
            <span>
              <strong>立刻暫存稿子</strong>
              <small>立刻存進這支手機的 App 空間，防止掉字</small>
            </span>
          </button>
        ) : null}

        <button type="button" className="setting-row" data-testid="open-other-file" onClick={() => void openAnother()}>
          <FolderIcon />
          <span>
            <strong>開啟別的稿子</strong>
            <small>{OPEN_DB_HINT}</small>
          </span>
        </button>
        <input
          ref={openInputRef}
          type="file"
          accept=".db,application/octet-stream,application/x-sqlite3"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void actions
              .importFile(file)
              .then((opened) => navigate(writePath(opened.id, opened.chapterId)))
              .catch(() => actions.toast(OPEN_DB_FAIL));
          }}
        />

        <button type="button" className="setting-row" data-testid="close-project" onClick={() => navigate('/')}>
          <HomeIcon />
          <span>
            <strong>關閉稿子並回首頁</strong>
          </span>
        </button>
      </div>
    </div>
  );
}
