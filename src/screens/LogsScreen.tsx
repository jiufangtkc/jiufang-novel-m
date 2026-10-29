import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/Icons';
import { formatDuration } from '../domain/writingLog';
import { useProject, useSample } from '../state/sampleStore';

export function LogsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state } = useSample();
  const navigate = useNavigate();
  if (!project) return <p className="empty-note">找不到這個專案。</p>;
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
        <p className="hint">
          以下是示範假資料，加上你在這個樣品裡實際打字的變化。一天一列。若以後從電腦版匯入，AI 相關欄位會原樣留著、另存時不會少；這個樣品不做 AI，所以這裡不顯示那些數字。
        </p>
        <ul className="log-list">
          {rows.map((row) => (
            <li key={row.id} className="log-card">
              <strong>{row.date}</strong>
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
