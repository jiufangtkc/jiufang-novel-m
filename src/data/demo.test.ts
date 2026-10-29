import { describe, expect, it } from 'vitest';
import { changeGoal, countAchievements, glowing } from '../domain/dailyGoal';
import { countWords } from '../domain/wordCount';
import { createDemoSchedule, demoParagraph } from './demo';

describe('範例資料', () => {
  const now = new Date('2026-10-29T01:28:00.000Z');

  it('內文都標了範例，而且今天 300 字、目標 1000，尚未達標', () => {
    expect(demoParagraph('第一章', 1).startsWith('【範例】')).toBe(true);
    const schedule = createDemoSchedule(now);
    expect(schedule.open?.dayKey).toBe('2026-10-29');
    expect(schedule.open?.wordCount).toBe(300);
    expect(glowing(schedule)).toBe(false);
    expect(countAchievements(schedule.settled)).toBe(5);
    expect(countWords(demoParagraph('第一章', 1))).toBeGreaterThan(20);
  });

  it('改低今天的目標會發光，已經算好的次數不變', () => {
    const before = createDemoSchedule(now);
    const frozen = before.settled.map((day) => ({ ...day }));
    const after = changeGoal(before, 300, now);
    expect(glowing(after)).toBe(true);
    expect(after.settled).toEqual(frozen);
    expect(countAchievements(after.settled)).toBe(5);
  });
});
