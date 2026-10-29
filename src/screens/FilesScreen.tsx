import { useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CloudUploadIcon, DownloadIcon, FolderIcon, HomeIcon } from '../components/Icons';
import { formatClockTime, formatLastExportLabel, latestSaveTimestamp } from '../domain/saveClock';
import { useProject, useSample } from '../state/sampleStore';

export function FilesScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const navigate = useNavigate();
  const openInputRef = useRef<HTMLInputElement>(null);
  if (!project) return <p className="empty-note">找不到這個專案。</p>;

  const meta = state.saveMeta[project.id] ?? {
    lastAutoSaveMs: null,
    lastManualSaveMs: null,
    lastExportMs: null,
  };
  const lastSaveMs = latestSaveTimestamp(meta);
  const lastSaveLabel = lastSaveMs == null ? '—' : formatClockTime(new Date(lastSaveMs));
  const exportLabel = formatLastExportLabel(meta.lastExportMs);

  return (
    <div className="page" data-testid="files-screen">
      <header className="topbar">
        <h1>檔案</h1>
      </header>
      <div className="scroll-pane files-page">
        <article className="files-status-card" data-testid="files-status">
          <p className="files-status-title">
            目前的稿子：<strong>《{project.title}》</strong>
          </p>
          <p className="files-status-line">已自動存在這支手機・最後存檔 {lastSaveLabel}</p>
          <p className="files-status-line">上次另存：{exportLabel}</p>
        </article>

        <button
          type="button"
          className="button primary files-primary-action"
          data-testid="save-to-cloud"
          onClick={() => void actions.saveToCloud()}
        >
          <CloudUploadIcon size={20} />
          另存專案
        </button>
        <p className="hint files-action-hint">將稿子存到各類雲端或其他位置</p>

        <button type="button" className="setting-row" data-testid="save-project" onClick={() => void actions.saveNow()}>
          <DownloadIcon />
          <span>
            <strong>儲存專案</strong>
            <small>立刻儲存專案至手機</small>
          </span>
        </button>

        <button
          type="button"
          className="setting-row"
          data-testid="open-other-file"
          onClick={() => openInputRef.current?.click()}
        >
          <FolderIcon />
          <span>
            <strong>開啟別的稿子</strong>
            <small>選擇電腦版匯出的 .db</small>
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
              .then((id) => navigate(`/p/${id}/write`))
              .catch(() => actions.toast('這個檔案讀不了'));
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
