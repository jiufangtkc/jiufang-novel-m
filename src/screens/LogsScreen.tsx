import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/Icons';
import { FEATURE_IN_PREPARATION, MANUSCRIPT_NOT_FOUND, PREPARING_BADGE } from '../copy/userFacing';
import { formatCalendarDate } from '../domain/formatCalendarDate';
import { getDayImportExportStats } from '../domain/importExportStats';
import { formatDuration, type WritingLogRow } from '../domain/writingLog';
import { useProject, useSample } from '../state/sampleStore';
import './importExport.css';

export function LogCardItem({
  row,
  onPreparingClick,
}: {
  row: WritingLogRow;
  onPreparingClick?: () => void;
}) {
  const dayStats = getDayImportExportStats(row);

  return (
    <li className="log-card" data-testid={`log-card-${row.date}`}>
      <strong>{formatCalendarDate(row.date)}</strong>
      <span>字數 {row.word_count}</span>
      <span>寫作時間 {formatDuration(row.duration)}</span>
      <span
        className="log-metric-preparing is-preparing"
        onClick={onPreparingClick}
        data-testid="log-import-row"
      >
        <span>{dayStats.importLabel}</span>
        <small className="badge-preparing">{PREPARING_BADGE}</small>
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
  if (!project) return <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>;
  const rows = [...state.logs].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="page" data-testid="logs-screen">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="返回" onClick={() => navigate(-1)}>
          <BackIcon />
        </button>
        <h1>寫作過程紀錄</h1>
      </header>
      <div className="scroll-pane logs-page">
        <p className="hint">視覺化的寫作紀錄</p>
        <ul className="log-list">
          {rows.map((row) => (
            <LogCardItem
              key={row.id}
              row={row}
              onPreparingClick={() => actions.toast(FEATURE_IN_PREPARATION)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
