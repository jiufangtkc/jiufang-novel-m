import { useNavigate, useParams } from 'react-router-dom';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { BackIcon } from '../components/Icons';
import { LOG_IMPORTED_DAY_NOTE, VISUAL_WRITING_RECORD } from '../copy/userFacing';
import { formatCalendarDate } from '../domain/formatCalendarDate';
import { formatDuration, type WritingLogRow } from '../domain/writingLog';
import { countImportEventsOn } from '../state/importEvents';
import { displayLogRows, projectImportEventsOf, useProject, useSample } from '../state/sampleStore';
import './importExport.css';

export function LogCardItem({
  row,
  imported = false,
}: {
  row: WritingLogRow;
  /** WO-120：這份稿子這一個寫作日有匯入事件（同日多筆也只算有）。 */
  imported?: boolean;
}) {
  return (
    <li className="log-card" data-testid={`log-card-${row.date}`}>
      <strong>{formatCalendarDate(row.date)}</strong>
      <span>字數 {row.word_count}</span>
      <span>寫作時間 {formatDuration(row.duration)}</span>
      {/* WO-120：只在匯入日顯示一行；不顯示次數。匯出事件仍記在檔內；大量刪除資料保留但不顯示。 */}
      {imported ? <span data-testid="log-import-row">{LOG_IMPORTED_DAY_NOTE}</span> : null}
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
              imported={countImportEventsOn(importEvents, row.date) > 0}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
