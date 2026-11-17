import { useNavigate, useParams } from 'react-router-dom';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { BackIcon } from '../components/Icons';
import { VISUAL_WRITING_RECORD } from '../copy/userFacing';
import { formatCalendarDate } from '../domain/formatCalendarDate';
import { getDayImportExportStats } from '../domain/importExportStats';
import { formatDuration, type WritingLogRow } from '../domain/writingLog';
import { countImportEventsOn } from '../state/importEvents';
import { displayLogRows, projectExportEventsOf, projectImportEventsOf, useProject, useSample } from '../state/sampleStore';
import './importExport.css';

export function LogCardItem({
  row,
  importCount = 0,
  exportCount = 0,
}: {
  row: WritingLogRow;
  /** WO-99：這份稿子這一個寫作日的 TXT 匯入次數。 */
  importCount?: number;
  /** WO-103：這份稿子這一個寫作日成功匯出全文（Word／TXT）的次數。 */
  exportCount?: number;
}) {
  const dayStats = getDayImportExportStats(importCount, {}, exportCount);

  return (
    <li className="log-card" data-testid={`log-card-${row.date}`}>
      <strong>{formatCalendarDate(row.date)}</strong>
      <span>字數 {row.word_count}</span>
      <span>寫作時間 {formatDuration(row.duration)}</span>
      {/* WO-99：匯入已開放；WO-103：匯出也開放，兩列都照一般列顯示，不再帶準備中。 */}
      <span className="log-metric" data-testid="log-import-row">
        <span>{dayStats.importLabel}</span>
      </span>
      <span className="log-metric" data-testid="log-export-row">
        <span>{dayStats.exportLabel}</span>
      </span>
      <span>大量刪除 {row.delete_large_count} 次</span>
    </li>
  );
}

export function LogsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state } = useSample();
  const navigate = useNavigate();
  if (!project) return <ManuscriptNotFound />;
  // WO-100：每日次數與統計頁同一份事件集合；只有匯入事件的日子也有卡。
  const importEvents = projectImportEventsOf(state, project.id);
  // WO-103：匯出次數同一份事件集合；只有匯出事件的日子也有卡。
  const exportEvents = projectExportEventsOf(state, project.id);
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
              exportCount={countImportEventsOn(exportEvents, row.date)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
