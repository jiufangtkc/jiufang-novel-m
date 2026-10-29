import { describe, expect, it } from 'vitest';
import { countAchievements, createSchedule, withClock } from './dailyGoal';
import { summarizeStats, streakFromKeys } from './stats';
import { emptyWritingLog, type WritingLogRow } from './writingLog';

function taipei(hour: number): Date {
  return new Date(Date.UTC(2026, 9, 29, hour - 8, 0, 0));
}

describe('連續天數與統計', () => {
  it('今天有寫就從今天往回算，今天還沒寫就先算到昨天', () => {
    const keys = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-27', '2026-10-28'];
    expect(streakFromKeys(keys, '2026-10-29')).toEqual({ current: 2, longest: 4 });
    expect(streakFromKeys([...keys, '2026-10-29'], '2026-10-29')).toEqual({ current: 3, longest: 4 });
  });

  it('達成次數只用已結算的日子，今天的發光不先算進去', () => {
    let schedule = withClock(createSchedule({ defaultGoal: 1000 }), taipei(10));
    schedule = {
      ...schedule,
      settled: [
        {
          dayKey: '2026-10-21',
          dayEndHour: 0,
          wordCount: 700,
          finalGoal: 300,
          achieved: true,
        },
        {
          dayKey: '2026-10-28',
          dayEndHour: 0,
          wordCount: 1200,
          finalGoal: 1000,
          achieved: true,
        },
      ],
      open: schedule.open
        ? { ...schedule.open, wordCount: 1000 }
        : schedule.open,
    };
    const logs: WritingLogRow[] = [
      { ...emptyWritingLog(1, '2026-10-21'), word_count: 700, duration: 3600 },
      { ...emptyWritingLog(2, '2026-10-28'), word_count: 1200, duration: 3600 },
    ];
    const summary = summarizeStats(schedule, logs, countAchievements(schedule.settled));
    expect(summary.todayMet).toBe(true);
    expect(summary.achievementCount).toBe(2);
    expect(summary.todayWords).toBe(1000);
    expect(summary.totalHoursLabel).toBe('2.0');
  });
});
