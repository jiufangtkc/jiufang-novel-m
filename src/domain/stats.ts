import { addDays, type GoalSchedule, goalProgress, wordsRemaining } from './dailyGoal';
import { formatHours, type WritingLogRow } from './writingLog';

export interface StatsSummary {
  todayKey: string;
  todayWords: number;
  todayGoal: number;
  todayRatio: number;
  todayRemaining: number;
  todayMet: boolean;
  /** 只算已經結束的日子。今天亮著還沒算進去。 */
  achievementCount: number;
  streak: number;
  longestStreak: number;
  last7Words: number;
  last7Average: number;
  totalDurationSeconds: number;
  totalHoursLabel: string;
  activeDays: number;
}

export function streakFromKeys(
  activeKeys: readonly string[],
  todayKey: string,
): { current: number; longest: number } {
  const active = new Set(activeKeys);
  const sorted = [...active].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  // 今天還沒寫時，連續天數先算到昨天；今天結束仍是 0 字，下次就接不下去。
  let cursor = active.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let current = 0;
  while (active.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

export function summarizeStats(
  schedule: GoalSchedule,
  logs: readonly WritingLogRow[],
  settledAchievements: number,
): StatsSummary {
  const open = schedule.open;
  const todayKey = open?.dayKey ?? '';
  const todayWords = open?.wordCount ?? 0;
  const todayGoal = open ? open.goals[open.goals.length - 1].goal : schedule.defaultGoal;
  const wordsByDay = new Map<string, number>();
  for (const log of logs) wordsByDay.set(log.date, log.word_count);
  if (todayKey) wordsByDay.set(todayKey, todayWords);
  let last7Words = 0;
  if (todayKey) {
    for (let index = 0; index < 7; index += 1) {
      last7Words += wordsByDay.get(addDays(todayKey, -index)) ?? 0;
    }
  }
  const activeKeys = [...wordsByDay.entries()]
    .filter(([, words]) => words > 0)
    .map(([key]) => key);
  const streak = todayKey ? streakFromKeys(activeKeys, todayKey) : { current: 0, longest: 0 };
  const totalDurationSeconds = logs.reduce((sum, log) => sum + log.duration, 0);
  return {
    todayKey,
    todayWords,
    todayGoal,
    todayRatio: goalProgress(todayWords, todayGoal),
    todayRemaining: wordsRemaining(todayWords, todayGoal),
    todayMet: open ? todayWords >= todayGoal : false,
    achievementCount: settledAchievements,
    streak: streak.current,
    longestStreak: streak.longest,
    last7Words,
    last7Average: Math.round(last7Words / 7),
    totalDurationSeconds,
    totalHoursLabel: formatHours(totalDurationSeconds),
    activeDays: activeKeys.length,
  };
}
