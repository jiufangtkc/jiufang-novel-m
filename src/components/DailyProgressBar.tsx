import { goalProgress } from '../domain/dailyGoal';
import { dailyProgressAriaLabel, dailyProgressDisplayLabel } from '../copy/userFacing';

/**
 * 今日目標進度條（WO-101）。
 * 完整與鍵盤開啟的精簡模式畫面都是「今天 N／M 字」，達標後接「　達標了」；
 * 朗讀兩種模式都用定稿句，不拿含「／」的畫面字串來念。
 */
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
  const display = dailyProgressDisplayLabel(words, goal, met);
  const label = dailyProgressAriaLabel(words, goal, met);
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
      aria-valuetext={label}
    >
      {compact ? null : (
        <div className="daily-bar-heading" aria-hidden="true">
          <span>{display}</span>
        </div>
      )}
      <span className="daily-bar-track">
        <span className="daily-bar-fill" style={{ width: `${ratio}%` }} />
      </span>
      {compact ? (
        <span className="daily-bar-compact" aria-hidden="true">
          {display}
        </span>
      ) : null}
    </div>
  );
}
