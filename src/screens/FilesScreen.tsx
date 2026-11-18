import { useRef, useState } from 'react';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { useNavigate, useParams } from 'react-router-dom';
import { CloudUploadIcon, DownloadIcon, FolderIcon, HomeIcon, SaveIcon } from '../components/Icons';
import {
  EXPORT_FULL_TEXT_BUTTON,
  EXPORT_FULL_TEXT_HINT,
  FILES_GROUP_IMPORT_EXPORT,
  FILES_GROUP_OPEN_CLOSE,
  FILES_GROUP_SAVE,
  lastEditDisplay,
  OPEN_DB_FAIL,
  OPEN_DB_HINT,
  stashDraftHint,
  currentFileLine,
  titlePendingNotice,
} from '../copy/userFacing';
import { canPickLocalFiles } from '../db/browserDisk';
import { writePath } from '../domain/openManuscript';
import { formatLastExportLabel, formatLastProjectSave, latestEditTimestamp, latestSaveTimestamp } from '../domain/saveClock';
import { useLayout } from '../layout';
import { useProject, useSample } from '../state/sampleStore';
import { appSpaceStatusLine } from './filesStatus';
import { filesPageLayout } from './filesPageLayout';
import { ExportDialog } from './ExportDialog';
import './importExport.css';

function useComputerLayout(): boolean {
  const { isAtLeastMedium } = useLayout();
  return isAtLeastMedium;
}

export function FilesScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const navigate = useNavigate();
  const openInputRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const computer = useComputerLayout();
  if (!project) return <ManuscriptNotFound />;

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

  // WO-103：匯出全文已開放（Word／TXT、全文／自選章節），開啟匯出選單。
  const openExport = () => setExportOpen(true);
  const closeExport = () => {
    setExportOpen(false);
    exportButtonRef.current?.focus();
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
              // WO-77：正文真的暫存成功過（有暫存時間）也算已在 App 空間，和寫作頁說法一致。
              stored: project.origin === 'file' || lastSaveMs != null,
              computer,
              lastSaveMs,
            })}
          </p>
          <p className="files-status-line" data-testid="last-edit-line">
            {`上次編輯：${lastEditDisplay({
              updatedLabel: project.updatedLabel,
              notPhone: computer,
              lastEditMs: latestEditTimestamp(meta),
            })}`}
          </p>
          {layout.showLastProjectSave ? (
            <p className="files-status-line" data-testid="last-project-save-line">
              上次儲存：{projectSaveLabel}
            </p>
          ) : null}
          <p className="files-status-line">上次另存：{exportLabel}</p>
        </article>

        {/* 第 1 組：存檔 */}
        <section className="files-group" aria-label={FILES_GROUP_SAVE} data-testid="files-group-save">
          <div className="files-group-head">
            <h2 className="files-group-title">{FILES_GROUP_SAVE}</h2>
          </div>

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
            <button
              type="button"
              className="setting-row"
              data-testid="stash-draft"
              onClick={() => void actions.stashDraft()}
            >
              <DownloadIcon />
              <span>
                <strong>立刻暫存稿子</strong>
                <small>{stashDraftHint(computer)}</small>
              </span>
            </button>
          ) : null}
        </section>

        {/* 第 2 組：開啟與關閉 */}
        <section className="files-group" aria-label={FILES_GROUP_OPEN_CLOSE} data-testid="files-group-open-close">
          <div className="files-group-head">
            <h2 className="files-group-title">{FILES_GROUP_OPEN_CLOSE}</h2>
          </div>

          <button
            type="button"
            className="setting-row"
            data-testid="open-other-file"
            onClick={() => void openAnother()}
          >
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

          <button
            type="button"
            className="setting-row"
            data-testid="close-project"
            onClick={() => navigate('/')}
          >
            <HomeIcon />
            <span>
              <strong>關閉稿子並回首頁</strong>
            </span>
          </button>
        </section>

        {/* 第 3 組：匯入與匯出 */}
        <section className="files-group" aria-label={FILES_GROUP_IMPORT_EXPORT} data-testid="files-group-import-export">
          <div className="files-group-head">
            <h2 className="files-group-title">{FILES_GROUP_IMPORT_EXPORT}</h2>
          </div>

          {/* WO-120：「匯入文字檔」已搬到首頁；這一組目前只剩匯出（組名未另定案，維持原樣）。 */}
          <button
            ref={exportButtonRef}
            type="button"
            className="setting-row"
            data-testid="export-full-text"
            aria-haspopup="dialog"
            onClick={openExport}
          >
            <span className="setting-icon" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
                <path d="M14 3.5V8h4.5" />
              </svg>
            </span>
            <span>
              <strong>{EXPORT_FULL_TEXT_BUTTON}</strong>
              <small>{EXPORT_FULL_TEXT_HINT}</small>
            </span>
          </button>
        </section>
        {exportOpen ? (
          <ExportDialog
            projectId={project.id}
            nodes={project.nodes}
            onClose={closeExport}
            onExport={(request, options) => actions.exportFullText(request, options)}
          />
        ) : null}
      </div>
    </div>
  );
}
