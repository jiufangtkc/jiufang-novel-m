import { goalProgress } from '../domain/dailyGoal';

export function DailyProgressBar({
  words,
  goal,
  met,
}: {
  words: number;
  goal: number;
  met: boolean;
}) {
  const ratio = goalProgress(words, goal);
  return (
    <div
      className={met ? 'daily-bar is-met' : 'daily-bar'}
      data-testid="daily-progress"
      data-met={met ? 'true' : 'false'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={Math.min(words, goal)}
      aria-label={met ? '今日目標已達成' : '今日目標進度'}
    >
      <span className="daily-bar-caption">{met ? '✦ 今日已達標' : '今日目標'}</span>
      <span className="daily-bar-track">
        <span className="daily-bar-fill" style={{ width: `${ratio}%` }} />
      </span>
      <span className="daily-bar-count">
        {words} / {goal}
      </span>
    </div>
  );
}
