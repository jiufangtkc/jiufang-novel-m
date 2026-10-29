import { Link, useParams } from 'react-router-dom';
import { CalendarIcon, ClockIcon, FlameIcon, PenIcon } from '../components/Icons';
import { MANUSCRIPT_NOT_FOUND } from '../copy/userFacing';
import { formatInteger } from '../domain/formatNumber';
import { useProject, useSample } from '../state/sampleStore';

export function StatsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { stats, bookWords } = useSample();
  if (!project) return <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>;
  const total = bookWords(project.id);
  const bookRatio = project.bookGoal > 0 ? Math.min(100, (total / project.bookGoal) * 100) : 0;

  return (
    <div className="page" data-testid="stats-screen">
      <header className="topbar">
        <h1>{project.title} — 寫作統計</h1>
      </header>
      <div className="scroll-pane stats-page">
        <div className="stat-grid">
          <article className="stat-card">
            <p className="stat-label">
              <PenIcon size={16} /> 今天寫了
            </p>
            <p className="stat-value">
              {formatInteger(stats.todayWords)} <small>字</small>
            </p>
            <p className="stat-sub">目標 {formatInteger(stats.todayGoal)} 字</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">
              <FlameIcon size={16} /> 連續寫作
            </p>
            <p className="stat-value">
              {stats.streak} <small>天</small>
            </p>
            <p className="stat-sub">最長連續 {stats.longestStreak} 天</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">
              <CalendarIcon size={16} /> 近 7 天累計
            </p>
            <p className="stat-value">
              {formatInteger(stats.last7Words)} <small>字</small>
            </p>
            <p className="stat-sub">日均 {formatInteger(stats.last7Average)} 字</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">
              <ClockIcon size={16} /> 總共寫了
            </p>
            <p className="stat-value">
              {stats.totalHoursLabel} <small>小時</small>
            </p>
            <p className="stat-sub">有寫的天數 {formatInteger(stats.activeDays)} 天</p>
          </article>
        </div>
        <article className="panel goal-panel">
          <div className="panel-head">
            <h2>寫作目標進度</h2>
            <span className="achieved-pill" data-testid="achievement-count">
              已達成 {stats.achievementCount} 次
            </span>
          </div>
          <div className="goal-row">
            <Ring ratio={stats.todayRatio} />
            <div>
              <p className="stat-label">今日目標</p>
              <p className="stat-value compact">
                {formatInteger(stats.todayWords)} / {formatInteger(stats.todayGoal)} 字
              </p>
              <p className="stat-sub">
                {stats.todayMet
                  ? '今日目前已達到目標'
                  : `尚需 ${formatInteger(stats.todayRemaining)} 字即可完成今日目標`}
              </p>
            </div>
          </div>
          <div className="book-progress">
            <div className="book-progress-label">
              <span>全書總字數進度</span>
              <strong>{bookRatio.toFixed(1)}%</strong>
            </div>
            <div className="book-track">
              <span style={{ width: `${bookRatio}%` }} />
            </div>
            <div className="book-progress-label sub">
              <span>目前 {formatInteger(total)} 字</span>
              <span>
                目標 {formatInteger(project.bookGoal)} 字（尚餘 {formatInteger(Math.max(0, project.bookGoal - total))} 字）
              </span>
            </div>
          </div>
        </article>
        <article className="panel">
          <h2>達成目標次數</h2>
          <p className="stat-value">
            {stats.achievementCount} <small>次</small>
          </p>
          <p className="hint">
            一天最多算 1 次。要等那天結束，用最後一次設定的目標來比對當天字數。中途亮過又熄掉，不算。已經算好的日子不會再變。今天就算正在發光，也要等今天結束才記入。
          </p>
          <Link className="text-link stats-log-link" to={`/p/${project.id}/logs`}>
            查看寫作過程紀錄
          </Link>
        </article>
      </div>
    </div>
  );
}

function Ring({ ratio }: { ratio: number }) {
  const radius = 36;
  const length = 2 * Math.PI * radius;
  const offset = length * (1 - Math.min(100, Math.max(0, ratio)) / 100);
  return (
    <div className="ring">
      <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r={radius} stroke="#3C3C3C" strokeWidth="8" fill="none" />
        <circle
          cx="52"
          cy="52"
          r={radius}
          stroke="#61AFEF"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={offset}
          transform="rotate(-90 52 52)"
        />
      </svg>
      <div>
        <strong>{ratio.toFixed(1)}%</strong>
        <span>進度</span>
      </div>
    </div>
  );
}
