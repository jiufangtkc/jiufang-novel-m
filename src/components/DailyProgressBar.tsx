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
      aria-label={
        met ? `今日已寫 ${words} 字，已達到目標 ${goal} 字` : `今日已寫 ${words} 字，目標 ${goal} 字`
      }
    >
      <div className="daily-bar-heading">
        <span>{met ? '✦ 今日已寫' : '今日已寫'} {words} 字{met ? '，已達標' : ''}</span>
        <span>目標 {goal} 字</span>
      </div>
      <span className="daily-bar-track">
        <span className="daily-bar-fill" style={{ width: `${ratio}%` }} />
      </span>
    </div>
  );
}
