import { goalProgress } from '../domain/dailyGoal';

export function DailyProgressBar({
  words,
  goal,
  met,
  compact = false,
}: {
  words: number;
  goal: number;
  met: boolean;
  compact?: boolean;
}) {
  const ratio = goalProgress(words, goal);
  const label = met
    ? `今日已寫 ${words} 字，已達到目標 ${goal} 字`
    : `今日已寫 ${words} 字，目標 ${goal} 字`;
  return (
    <div
      className={['daily-bar', met ? 'is-met' : '', compact ? 'is-compact' : ''].filter(Boolean).join(' ')}
      data-testid="daily-progress"
      data-met={met ? 'true' : 'false'}
      data-compact={compact ? 'true' : 'false'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={Math.min(words, goal)}
      aria-label={label}
    >
      {compact ? null : (
        <div className="daily-bar-heading">
          <span>{met ? '✦ 今日已寫' : '今日已寫'} {words} 字{met ? '，已達標' : ''}</span>
          <span>目標 {goal} 字</span>
        </div>
      )}
      <span className="daily-bar-track">
        <span className="daily-bar-fill" style={{ width: `${ratio}%` }} />
      </span>
      {compact ? (
        <span className="daily-bar-compact">
          {words}／{goal}
        </span>
      ) : null}
    </div>
  );
}
