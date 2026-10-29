import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookIcon, DownloadIcon, HomeIcon, PencilIcon } from '../components/Icons';
import { formatDayEndHour, MIN_DAILY_GOAL } from '../domain/dailyGoal';
import { useProject, useSample } from '../state/sampleStore';

export function SettingsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const goalNow = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  const [daily, setDaily] = useState(String(goalNow));
  const [book, setBook] = useState(String(project?.bookGoal ?? 100000));
  const [error, setError] = useState('');
  if (!project) return <p className="empty-note">找不到這個專案。</p>;

  return (
    <div className="page" data-testid="settings-screen">
      <header className="topbar">
        <h1>專案與應用設定</h1>
      </header>
      <div className="scroll-pane settings-page">
        <article className="setting-card">
          <span className="project-icon">
            <BookIcon size={22} />
          </span>
          <span>
            <strong>{project.title}</strong>
            <small>
              目標字數：{project.bookGoal} 字　·　每日目標：{goalNow} 字
            </small>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="修改目標"
            onClick={() => {
              setDaily(String(goalNow));
              setBook(String(project.bookGoal));
              setError('');
              setEditing(true);
            }}
          >
            <PencilIcon />
          </button>
        </article>
        <label className="field">
          一天幾點結束
          <select
            data-testid="day-end-hour"
            value={state.schedule.dayEndHour}
            onChange={(event) => actions.setHour(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {formatDayEndHour(hour)}
              </option>
            ))}
          </select>
          <span className="hint">預設是午夜 12 點。改了只影響之後的寫作日，已經算好的日子不變。</span>
        </label>
        <button
          type="button"
          className="setting-row"
          onClick={() => void actions.saveNow()}
        >
          <DownloadIcon />
          <span>
            <strong>儲存專案</strong>
            <small>立刻寫入手機，切換或關閉也會自動存</small>
          </span>
        </button>
        <button type="button" className="setting-row" data-testid="hand-back" onClick={() => void actions.handBack()}>
          <DownloadIcon />
          <span>
            <strong>交回電腦</strong>
            <small>匯出完整 .db，用分享選單存到 OneDrive 或檔案</small>
          </span>
        </button>
        <Link className="setting-row" to={`/p/${project.id}/logs`}>
          <span>
            <strong>寫作過程紀錄</strong>
            <small>每日字數、寫作時間、大量文字出現</small>
          </span>
        </Link>
        <a className="setting-row" href="/fonts/OFL.txt">
          <span>
            <strong>芫荽字型授權</strong>
            <small>SIL Open Font License 1.1，作者 But Ko／Fontworks</small>
          </span>
        </a>
        <button type="button" className="setting-row" onClick={() => navigate('/')}>
          <HomeIcon />
          <span>
            <strong>關閉專案並返回首頁</strong>
          </span>
        </button>
      </div>
      {editing && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setEditing(false)}>
          <form
            className="dialog"
            role="dialog"
            aria-labelledby="goal-dialog-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const nextDaily = Number(daily);
              const nextBook = Number(book);
              if (!Number.isInteger(nextDaily) || nextDaily < MIN_DAILY_GOAL) {
                setError(`每日目標至少 ${MIN_DAILY_GOAL} 字，沒有上限，而且要是整數。`);
                return;
              }
              if (!Number.isInteger(nextBook) || nextBook < 1) {
                setError('全書目標要是 1 以上的整數。');
                return;
              }
              actions.setGoal(nextDaily);
              actions.setBookGoal(project.id, nextBook);
              setEditing(false);
            }}
          >
            <h2 id="goal-dialog-title">修改目標</h2>
            <label>
              每日目標（字）
              <input
                data-testid="daily-goal-input"
                inputMode="numeric"
                value={daily}
                onChange={(event) => setDaily(event.target.value)}
              />
            </label>
            <label>
              全書目標（字）
              <input
                inputMode="numeric"
                value={book}
                onChange={(event) => setBook(event.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <p className="hint">一天之內可以改每日目標。達標與否，以當天最後一次設定為準。</p>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setEditing(false)}>
                取消
              </button>
              <button type="submit" className="button primary" data-testid="apply-goal">
                套用
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
