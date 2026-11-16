import { useNavigate, useParams } from 'react-router-dom';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { BackIcon } from '../components/Icons';
import { FEATURE_IN_PREPARATION, PREPARING_BADGE, VISUAL_WRITING_RECORD } from '../copy/userFacing';
import { formatCalendarDate } from '../domain/formatCalendarDate';
import { getDayImportExportStats } from '../domain/importExportStats';
import { formatDuration, type WritingLogRow } from '../domain/writingLog';
import { countImportEventsOn } from '../state/importEvents';
import { displayLogRows, projectImportEventsOf, useProject, useSample } from '../state/sampleStore';
import './importExport.css';

export function LogCardItem({
  row,
  importCount = 0,
  onPreparingClick,
}: {
  row: WritingLogRow;
  /** WO-99：這份稿子這一個寫作日的 TXT 匯入次數。 */
  importCount?: number;
  onPreparingClick?: () => void;
}) {
  const dayStats = getDayImportExportStats(importCount);

  return (
    <li className="log-card" data-testid={`log-card-${row.date}`}>
      <strong>{formatCalendarDate(row.date)}</strong>
      <span>字數 {row.word_count}</span>
      <span>寫作時間 {formatDuration(row.duration)}</span>
      {/* WO-99：匯入已開放，照一般列顯示，不再帶準備中。 */}
      <span className="log-metric" data-testid="log-import-row">
        <span>{dayStats.importLabel}</span>
      </span>
      <span
        className="log-metric-preparing is-preparing"
        onClick={onPreparingClick}
        data-testid="log-export-row"
      >
        <span>{dayStats.exportLabel}</span>
        <small className="badge-preparing">{PREPARING_BADGE}</small>
      </span>
      <span>大量刪除 {row.delete_large_count} 次</span>
    </li>
  );
}

export function LogsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const navigate = useNavigate();
  if (!project) return <ManuscriptNotFound />;
  // WO-100：每日次數與統計頁同一份事件集合；只有匯入事件的日子也有卡。
  const importEvents = projectImportEventsOf(state, project.id);
  const rows = displayLogRows(state, project.id);

  return (
    <div className="page" data-testid="logs-screen">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="返回" onClick={() => navigate(-1)}>
          <BackIcon />
        </button>
        <h1>寫作過程紀錄</h1>
      </header>
      <div className="scroll-pane logs-page">
        <p className="hint">{VISUAL_WRITING_RECORD}</p>
        <ul className="log-list">
          {rows.map((row) => (
            <LogCardItem
              key={row.id}
              row={row}
              importCount={countImportEventsOn(importEvents, row.date)}
              onPreparingClick={() => actions.toast(FEATURE_IN_PREPARATION)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
