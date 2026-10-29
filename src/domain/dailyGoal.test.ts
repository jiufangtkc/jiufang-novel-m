import { describe, expect, it } from 'vitest';
import {
  applyWordDelta,
  changeDayEndHour,
  changeGoal,
  countAchievements,
  createSchedule,
  DailyGoalError,
  formatDayEndHour,
  glowing,
  goalProgress,
  settleImportedLogs,
  withClock,
  writingDayEnd,
  writingDayKey,
  type GoalSchedule,
  type SettledWritingDay,
} from './dailyGoal';

/** 臺灣牆上時間。月份從 1 起算。 */
function taipei(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second));
}

function openOn(dayEndHour: number, goal: number, now: Date): GoalSchedule {
  return withClock(createSchedule({ dayEndHour, defaultGoal: goal }), now);
}

describe('寫作日的切分', () => {
  it('午夜 12 點結束時，跨過午夜就換日', () => {
    expect(writingDayKey(taipei(2026, 10, 29, 23, 59, 59), 0)).toBe('2026-10-29');
    expect(writingDayKey(taipei(2026, 10, 30, 0, 0, 0), 0)).toBe('2026-10-30');
  });

  it('清晨 4 點結束時，4 點前仍算前一天', () => {
    expect(writingDayKey(taipei(2026, 10, 30, 3, 59), 4)).toBe('2026-10-29');
    expect(writingDayKey(taipei(2026, 10, 30, 4, 0), 4)).toBe('2026-10-30');
  });

  it('結束時刻就是隔日的那個整點', () => {
    expect(writingDayEnd('2026-10-29', 0).toISOString()).toBe(taipei(2026, 10, 30).toISOString());
    expect(writingDayEnd('2026-10-29', 4).toISOString()).toBe(taipei(2026, 10, 30, 4).toISOString());
  });

  it('結束時刻只接受 0 到 23 的整點', () => {
    expect(() => writingDayKey(taipei(2026, 10, 29), 24)).toThrow(DailyGoalError);
    expect(() => writingDayKey(taipei(2026, 10, 29), -1)).toThrow(DailyGoalError);
    expect(() => writingDayKey(taipei(2026, 10, 29), 1.5)).toThrow(DailyGoalError);
  });
});

describe('每日目標的範圍', () => {
  it('至少 300 字、沒有上限，而且要是整數', () => {
    expect(() => createSchedule({ defaultGoal: 299 })).toThrow(DailyGoalError);
    expect(() => createSchedule({ defaultGoal: 300.5 })).toThrow(DailyGoalError);
    expect(createSchedule({ defaultGoal: 300 }).defaultGoal).toBe(300);
    expect(createSchedule({ defaultGoal: 1_000_000 }).defaultGoal).toBe(1_000_000);
  });

  it('預設是午夜 12 點', () => {
    expect(createSchedule().dayEndHour).toBe(0);
    expect(formatDayEndHour(0)).toBe('午夜 12 點');
    expect(formatDayEndHour(4)).toBe('上午 4 點');
    expect(formatDayEndHour(12)).toBe('中午 12 點');
    expect(formatDayEndHour(15)).toBe('下午 3 點');
  });
});

describe('當天改目標與發光', () => {
  const morning = taipei(2026, 10, 29, 10);

  it('字數達到目前目標就發光，調高之後沒達到就熄', () => {
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 400, morning);
    expect(glowing(schedule)).toBe(true);
    schedule = changeGoal(schedule, 1000, taipei(2026, 10, 29, 11));
    expect(glowing(schedule)).toBe(false);
    expect(goalProgress(schedule.open?.wordCount ?? 0, 1000)).toBe(40);
  });

  it('調高之後又寫到新目標，會再亮', () => {
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 500, morning);
    schedule = changeGoal(schedule, 800, taipei(2026, 10, 29, 12));
    expect(glowing(schedule)).toBe(false);
    schedule = applyWordDelta(schedule, 300, taipei(2026, 10, 29, 13));
    expect(glowing(schedule)).toBe(true);
    expect(schedule.open?.wordCount).toBe(800);
  });

  it('刪掉文字使字數低於目標時，光會熄', () => {
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 300, morning);
    expect(glowing(schedule)).toBe(true);
    schedule = applyWordDelta(schedule, -50, morning);
    expect(glowing(schedule)).toBe(false);
    expect(schedule.open?.wordCount).toBe(250);
  });

  it('字數不會被減到 0 以下', () => {
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 20, morning);
    schedule = applyWordDelta(schedule, -100, morning);
    expect(schedule.open?.wordCount).toBe(0);
  });

  it('剛好達到目標也算達成', () => {
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 300, morning);
    expect(glowing(schedule)).toBe(true);
  });
});

describe('結束時才計入達成次數', () => {
  it('亮過又熄，結束時未達標就不算', () => {
    const morning = taipei(2026, 10, 29, 10);
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 400, morning);
    expect(glowing(schedule)).toBe(true);
    schedule = changeGoal(schedule, 1000, taipei(2026, 10, 29, 18));
    expect(glowing(schedule)).toBe(false);
    schedule = withClock(schedule, taipei(2026, 10, 30, 0));
    expect(schedule.settled).toHaveLength(1);
    expect(schedule.settled[0]).toMatchObject({
      dayKey: '2026-10-29',
      wordCount: 400,
      finalGoal: 1000,
      achieved: false,
    });
    expect(countAchievements(schedule.settled)).toBe(0);
    expect(schedule.open?.dayKey).toBe('2026-10-30');
    expect(schedule.open?.wordCount).toBe(0);
  });

  it('同一天先熄再達標，結束時只算 1 次', () => {
    const morning = taipei(2026, 10, 29, 9);
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 500, morning);
    schedule = changeGoal(schedule, 800, taipei(2026, 10, 29, 12));
    schedule = applyWordDelta(schedule, 400, taipei(2026, 10, 29, 21));
    schedule = withClock(schedule, taipei(2026, 10, 30, 0));
    expect(schedule.settled[0].achieved).toBe(true);
    expect(countAchievements(schedule.settled)).toBe(1);
  });

  it('結束前把字刪到低於最後目標，就不算', () => {
    const morning = taipei(2026, 10, 29, 9);
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 500, morning);
    schedule = applyWordDelta(schedule, -250, taipei(2026, 10, 29, 22));
    schedule = withClock(schedule, taipei(2026, 10, 30, 0));
    expect(schedule.settled[0]).toMatchObject({ wordCount: 250, achieved: false });
  });

  it('隔天的目標沿用前一天最後設定，但前一天的結算不再變', () => {
    const morning = taipei(2026, 10, 29, 9);
    let schedule = openOn(0, 300, morning);
    schedule = applyWordDelta(schedule, 300, morning);
    schedule = changeGoal(schedule, 500, taipei(2026, 10, 29, 15));
    schedule = applyWordDelta(schedule, 200, taipei(2026, 10, 29, 16));
    const frozen: SettledWritingDay[] = [];
    schedule = withClock(schedule, taipei(2026, 10, 30, 0));
    frozen.push(schedule.settled[0]);
    expect(frozen[0]).toMatchObject({ finalGoal: 500, wordCount: 500, achieved: true });
    expect(schedule.open?.goals.at(-1)?.goal).toBe(500);
    schedule = changeGoal(schedule, 5000, taipei(2026, 10, 30, 9));
    expect(schedule.settled).toEqual(frozen);
    expect(countAchievements(schedule.settled)).toBe(1);
    expect(glowing(schedule)).toBe(false);
  });

  it('同一天不能結算兩次', () => {
    const day: SettledWritingDay = {
      dayKey: '2026-10-01',
      dayEndHour: 0,
      wordCount: 300,
      finalGoal: 300,
      achieved: true,
    };
    expect(() => countAchievements([day, day])).toThrow(DailyGoalError);
  });
});

describe('改一天的結束時刻', () => {
  it('進行中的這一天仍用舊時刻，已結算的日子不動', () => {
    const first = taipei(2026, 10, 28, 10);
    let schedule = openOn(0, 300, first);
    schedule = applyWordDelta(schedule, 300, first);
    schedule = withClock(schedule, taipei(2026, 10, 29, 0));
    const settledBefore = schedule.settled.map((day) => ({ ...day }));
    const openEnds = schedule.open?.endsAt;
    const openHour = schedule.open?.dayEndHour;
    schedule = changeDayEndHour(schedule, 4, taipei(2026, 10, 29, 15));
    expect(schedule.settled).toEqual(settledBefore);
    expect(schedule.open?.endsAt).toBe(openEnds);
    expect(schedule.open?.dayEndHour).toBe(openHour);
    expect(schedule.dayEndHour).toBe(4);
  });

  it('一天之內改兩次，下一天用最後那次', () => {
    let schedule = openOn(0, 300, taipei(2026, 10, 29, 10));
    schedule = changeDayEndHour(schedule, 5, taipei(2026, 10, 29, 11));
    schedule = changeDayEndHour(schedule, 4, taipei(2026, 10, 29, 12));
    expect(schedule.open?.dayEndHour).toBe(0);
    schedule = withClock(schedule, taipei(2026, 10, 30, 0));
    expect(schedule.settled[0].dayKey).toBe('2026-10-29');
    expect(schedule.open?.dayEndHour).toBe(4);
    expect(schedule.open?.dayKey).toBe('2026-10-30');
    expect(new Date(schedule.open?.endsAt ?? '').toISOString()).toBe(
      taipei(2026, 10, 31, 4).toISOString(),
    );
  });

  it('舊日子在午夜結算後，不會把已鎖定的日期再打開', () => {
    let schedule = openOn(0, 1000, taipei(2026, 10, 29, 10));
    schedule = applyWordDelta(schedule, 1000, taipei(2026, 10, 29, 11));
    schedule = changeDayEndHour(schedule, 4, taipei(2026, 10, 29, 18));
    schedule = withClock(schedule, taipei(2026, 10, 30, 0));
    const keys = schedule.settled.map((day) => day.dayKey);
    expect(keys).toEqual(['2026-10-29']);
    expect(schedule.open?.dayKey).not.toBe('2026-10-29');
    expect(countAchievements(schedule.settled)).toBe(1);
    schedule = changeGoal(schedule, 300, taipei(2026, 10, 30, 1));
    expect(countAchievements(schedule.settled)).toBe(1);
    expect(schedule.settled[0].finalGoal).toBe(1000);
  });

  it('結束時刻改成比較早之後，下一天才沿用新時刻', () => {
    let schedule = openOn(4, 300, taipei(2026, 10, 29, 10));
    schedule = applyWordDelta(schedule, 300, taipei(2026, 10, 29, 10));
    schedule = changeDayEndHour(schedule, 0, taipei(2026, 10, 29, 12));
    expect(schedule.open?.endsAt).toBe(taipei(2026, 10, 30, 4).toISOString());
    schedule = withClock(schedule, taipei(2026, 10, 30, 4));
    expect(schedule.settled[0]).toMatchObject({ dayKey: '2026-10-29', achieved: true, dayEndHour: 4 });
    expect(schedule.open?.dayEndHour).toBe(0);
    expect(schedule.open?.dayKey).toBe('2026-10-30');
  });
});

describe('跨日', () => {
  it('清晨 4 點一到就結算，新的一天字數從 0 開始', () => {
    let schedule = openOn(4, 300, taipei(2026, 10, 29, 22));
    schedule = applyWordDelta(schedule, 300, taipei(2026, 10, 30, 3, 59));
    expect(schedule.open?.dayKey).toBe('2026-10-29');
    expect(glowing(schedule)).toBe(true);
    schedule = withClock(schedule, taipei(2026, 10, 30, 4));
    expect(schedule.settled[0]).toMatchObject({ dayKey: '2026-10-29', achieved: true });
    expect(schedule.open).toMatchObject({ dayKey: '2026-10-30', wordCount: 0, dayEndHour: 4 });
    expect(glowing(schedule)).toBe(false);
    expect(countAchievements(schedule.settled)).toBe(1);
  });
});

describe('匯入舊的寫作紀錄', () => {
  const september = [
    { date: '2026-09-01', wordCount: 1000 },
    { date: '2026-09-02', wordCount: 1500 },
    { date: '2026-09-03', wordCount: 1200 },
    { date: '2026-09-04', wordCount: 1800 },
    { date: '2026-09-05', wordCount: 1000 },
    { date: '2026-09-06', wordCount: 1300 },
  ];

  it('用匯入當下的目標回頭算，六天都達標就是 6 次', () => {
    const settled = settleImportedLogs(september, 1000);
    expect(countAchievements(settled)).toBe(6);
    expect(settled.every((day) => day.finalGoal === 1000 && day.achieved)).toBe(true);
  });

  it('沒達到匯入時目標的那一天不算，算完就固定', () => {
    const settled = settleImportedLogs(
      [...september, { date: '2026-09-07', wordCount: 999 }],
      1000,
    );
    expect(countAchievements(settled)).toBe(6);
    let schedule = createSchedule({ defaultGoal: 1000 });
    schedule = { ...schedule, settled };
    schedule = withClock(schedule, taipei(2026, 10, 29, 9));
    schedule = changeGoal(schedule, 300, taipei(2026, 10, 29, 9));
    expect(countAchievements(schedule.settled)).toBe(6);
    expect(schedule.settled.map((day) => day.finalGoal)).toEqual(Array(7).fill(1000));
    expect(schedule.settled[6].achieved).toBe(false);
  });

  it('同一天多列時留最後一列，仍然只算一天', () => {
    const settled = settleImportedLogs(
      [
        { date: '2026-09-01', wordCount: 100 },
        { date: '2026-09-01', wordCount: 2000 },
      ],
      1000,
    );
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ wordCount: 2000, achieved: true });
  });

  it('目標低於 300 不能拿來回頭算', () => {
    expect(() => settleImportedLogs(september, 299)).toThrow(DailyGoalError);
  });
});
