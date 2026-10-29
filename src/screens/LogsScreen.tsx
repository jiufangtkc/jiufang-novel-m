import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/Icons';
import { MANUSCRIPT_NOT_FOUND } from '../copy/userFacing';
import { formatCalendarDate } from '../domain/formatCalendarDate';
import { formatDuration } from '../domain/writingLog';
import { useProject, useSample } from '../state/sampleStore';

export function LogsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state } = useSample();
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
        <p className="hint">視覺化的寫作記錄</p>
        <ul className="log-list">
          {rows.map((row) => (
            <li key={row.id} className="log-card">
              <strong>{formatCalendarDate(row.date)}</strong>
              <span>字數 {row.word_count}</span>
              <span>寫作時間 {formatDuration(row.duration)}</span>
              <span>大量貼上 {row.paste_large_count} 次</span>
              <span>大量刪除 {row.delete_large_count} 次</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
