import { goalProgress } from '../domain/dailyGoal';
import {
  dailyProgressAriaLabel,
  dailyProgressCompactLabel,
  dailyProgressGoalLabel,
  dailyProgressWordsLabel,
} from '../copy/userFacing';

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
  const compactLabel = dailyProgressCompactLabel(words, goal);
  const label = compact ? compactLabel : dailyProgressAriaLabel(words, goal, met);
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
          <span>{dailyProgressWordsLabel(words, met)}</span>
          <span>{dailyProgressGoalLabel(goal)}</span>
        </div>
      )}
      <span className="daily-bar-track">
        <span className="daily-bar-fill" style={{ width: `${ratio}%` }} />
      </span>
      {compact ? <span className="daily-bar-compact">{compactLabel}</span> : null}
    </div>
  );
}
