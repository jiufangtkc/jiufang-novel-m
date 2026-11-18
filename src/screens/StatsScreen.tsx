import { Link, useParams } from 'react-router-dom';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { CalendarIcon, ClockIcon, FlameIcon, PenIcon } from '../components/Icons';
import {
  STATS_HEADING,
  STATS_IMPORT_COUNT_LABEL,
  STATS_IMPORT_EXPORT_HEADING,
  STATS_IMPORT_EXPORT_SCOPE_HINT,
  VISUAL_WRITING_RECORD,
} from '../copy/userFacing';
import { getTotalImportExportStats } from '../domain/importExportStats';
import { formatInteger } from '../domain/formatNumber';
import { useLayout } from '../layout';
import { countImportEvents, countImportEventsOn } from '../state/importEvents';
import { displayLogRows, projectImportEventsOf, useProject, useSample } from '../state/sampleStore';
import { LogCardItem } from './LogsScreen';
import './importExport.css';

export function StatsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { stats, bookWords, state } = useSample();
  const { isWide } = useLayout();
  if (!project) return <ManuscriptNotFound />;
  const total = bookWords(project.id);
  const bookRatio = project.bookGoal > 0 ? Math.min(100, (total / project.bookGoal) * 100) : 0;
  // WO-99：匯入次數是這份稿子（目前開著的這份）的全書合計，不是整台裝置合計。
  // WO-100：全書與每日都取同一份事件集合（檔內事件 ∪ 本機可靠對應）。
  const importEvents = projectImportEventsOf(state, project.id);
  // WO-113：畫面只顯示匯入次數；匯出事件仍照舊記在檔內，不在此顯示。
  const totalImportExport =
    state.activeProjectId === project.id && stats.importExport
      ? stats.importExport
      : getTotalImportExportStats(countImportEvents(importEvents));
  const sortedLogs = displayLogRows(state, project.id);

  return (
    <div className="page" data-testid="stats-screen">
      <header className="topbar stats-heading">
        <div>
          <h1>{STATS_HEADING}</h1>
          <p className="stats-book-name">{project.title}</p>
        </div>
      </header>
      <div className={`scroll-pane stats-page ${isWide ? 'is-wide' : ''}`}>
        <div className="stats-main-column">
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
          </article>

          {/* WO-60 匯入與匯出（全書合計）。WO-99：匯入開放；WO-103：匯出也開放，不再有準備中。 */}
          <article className="panel stat-import-export-panel" data-testid="stats-import-export">
            <div className="panel-head">
              <h2>{STATS_IMPORT_EXPORT_HEADING}</h2>
            </div>
            <div className="stat-import-export-row" data-testid="stats-import-row">
              <span className="stat-import-export-label">
                <span className="stat-import-export-icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </span>
                <span>{STATS_IMPORT_COUNT_LABEL}</span>
              </span>
              <span className="stat-import-export-value is-open" data-testid="stats-import-count">
                {totalImportExport.importDisplay}
              </span>
            </div>
            <p className="hint stat-import-export-hint">{STATS_IMPORT_EXPORT_SCOPE_HINT}</p>
          </article>

          <Link className="text-link stats-log-link" to={`/p/${project.id}/logs`}>
            查看寫作過程紀錄
          </Link>
        </div>

        {/* 寬版統計頁將寫作過程紀錄並排於右欄 */}
        {isWide ? (
          <aside className="stats-logs-column" aria-label="寫作過程紀錄" data-testid="stats-wide-logs">
            <h2 className="stats-logs-heading">{VISUAL_WRITING_RECORD}</h2>
            <ul className="log-list">
              {sortedLogs.map((row) => (
                <LogCardItem
                  key={row.id}
                  row={row}
                  importCount={countImportEventsOn(importEvents, row.date)}
                />
              ))}
            </ul>
          </aside>
        ) : null}
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
        <circle className="ring-track" cx="52" cy="52" r={radius} strokeWidth="8" fill="none" />
        <circle
          cx="52"
          cy="52"
          r={radius}
          className="ring-value"
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
