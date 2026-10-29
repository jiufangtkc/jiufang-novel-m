export const MIN_DAILY_GOAL = 300;
export const DEFAULT_DAY_END_HOUR = 0;
/** 臺灣沒有日光節約時間，固定 UTC+8。 */
export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export class DailyGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyGoalError';
  }
}

export function assertDailyGoal(goal: number): number {
  if (!Number.isInteger(goal) || goal < MIN_DAILY_GOAL) {
    throw new DailyGoalError(`每日目標至少 ${MIN_DAILY_GOAL} 字，而且要是整數。`);
  }
  return goal;
}

export function assertDayEndHour(hour: number): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new DailyGoalError('一日結束時刻要是 0 到 23 的整點。');
  }
  return hour;
}

/**
 * 寫作日標籤（YYYY-MM-DD）。
 * 結束時刻以前的時間算前一個日曆日。例如結束時刻是清晨 4 點，
 * 那麼 10 月 30 日 03:59 仍屬 10 月 29 日。
 */
export function writingDayKey(instant: Date, dayEndHour: number): string {
  assertDayEndHour(dayEndHour);
  const shifted = instant.getTime() + TAIPEI_OFFSET_MS - dayEndHour * 60 * 60 * 1000;
  const wall = new Date(shifted);
  const year = wall.getUTCFullYear();
  const month = String(wall.getUTCMonth() + 1).padStart(2, '0');
  const day = String(wall.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 寫作日 D 在隔日的結束時刻截止，那個瞬間改屬下一天。 */
export function writingDayEnd(dayKey: string, dayEndHour: number): Date {
  assertDayEndHour(dayEndHour);
  const [year, month, day] = dayKey.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day + 1, dayEndHour, 0, 0, 0);
  return new Date(wall - TAIPEI_OFFSET_MS);
}

export interface GoalChange {
  at: string;
  goal: number;
}

export interface OpenWritingDay {
  dayKey: string;
  dayEndHour: number;
  endsAt: string;
  wordCount: number;
  goals: GoalChange[];
}

export interface SettledWritingDay {
  dayKey: string;
  dayEndHour: number;
  wordCount: number;
  finalGoal: number;
  /** 結束時的字數有沒有達到當天最後一次設定的目標。中途亮過又熄掉就是 false。 */
  achieved: boolean;
}

export interface GoalSchedule {
  settled: SettledWritingDay[];
  open: OpenWritingDay | null;
  /** 下一個新寫作日要使用的結束時刻。進行中的那一天不會被改掉。 */
  dayEndHour: number;
  /** 新的一天一開始用的目標。當天再改，以最後一次為準。 */
  defaultGoal: number;
}

export function createSchedule(options?: {
  dayEndHour?: number;
  defaultGoal?: number;
}): GoalSchedule {
  return {
    settled: [],
    open: null,
    dayEndHour: assertDayEndHour(options?.dayEndHour ?? DEFAULT_DAY_END_HOUR),
    defaultGoal: assertDailyGoal(options?.defaultGoal ?? 1000),
  };
}

export function lastGoal(goals: readonly GoalChange[]): number {
  const last = goals[goals.length - 1];
  if (!last) throw new DailyGoalError('這個寫作日還沒有目標。');
  return last.goal;
}

export function isGoalMet(wordCount: number, goal: number): boolean {
  return wordCount >= goal;
}

export function goalProgress(wordCount: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.min(100, (wordCount / goal) * 100);
}

export function wordsRemaining(wordCount: number, goal: number): number {
  return Math.max(0, goal - wordCount);
}

/** 只看結束當下。中途是否亮過不計入。 */
export function settleOpenDay(day: OpenWritingDay): SettledWritingDay {
  const finalGoal = lastGoal(day.goals);
  return {
    dayKey: day.dayKey,
    dayEndHour: day.dayEndHour,
    wordCount: day.wordCount,
    finalGoal,
    achieved: isGoalMet(day.wordCount, finalGoal),
  };
}

/** 每個寫作日最多 1 次。已結算的結果呼進來，不再重算。 */
export function countAchievements(settled: readonly SettledWritingDay[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const day of settled) {
    if (seen.has(day.dayKey)) {
      throw new DailyGoalError(`寫作日 ${day.dayKey} 被結算了兩次。`);
    }
    seen.add(day.dayKey);
    if (day.achieved) count += 1;
  }
  return count;
}

export function glowing(schedule: GoalSchedule): boolean {
  if (!schedule.open) return false;
  return isGoalMet(schedule.open.wordCount, lastGoal(schedule.open.goals));
}

function settleElapsed(schedule: GoalSchedule, now: Date): GoalSchedule {
  if (!schedule.open) return schedule;
  if (now.getTime() < new Date(schedule.open.endsAt).getTime()) return schedule;
  return {
    ...schedule,
    settled: [...schedule.settled, settleOpenDay(schedule.open)],
    open: null,
  };
}

function openNewDay(schedule: GoalSchedule, now: Date, hour: number): OpenWritingDay {
  assertDayEndHour(hour);
  let dayKey = writingDayKey(now, hour);
  const taken = new Set(schedule.settled.map((day) => day.dayKey));
  if (taken.has(dayKey)) {
    // 改了結束時刻之後，新規則有時還會指回剛結算的那一天。
    // 已結算的日子不重開，這段時間改算進下一個還沒用過的日期。
    do {
      dayKey = addDays(dayKey, 1);
    } while (taken.has(dayKey));
  }
  return {
    dayKey,
    dayEndHour: hour,
    endsAt: writingDayEnd(dayKey, hour).toISOString(),
    wordCount: 0,
    goals: [{ at: now.toISOString(), goal: schedule.defaultGoal }],
  };
}

/** 時鐘往前走。過了結束時刻就結算並鎖定，然後打開新的一天。 */
export function withClock(schedule: GoalSchedule, now: Date): GoalSchedule {
  const settledNow = settleElapsed(schedule, now);
  if (settledNow.open) return settledNow;
  return {
    ...settledNow,
    open: openNewDay(settledNow, now, settledNow.dayEndHour),
  };
}

export function changeGoal(schedule: GoalSchedule, goal: number, now: Date): GoalSchedule {
  const nextGoal = assertDailyGoal(goal);
  const current = withClock(schedule, now);
  if (!current.open) throw new DailyGoalError('目前沒有進行中的寫作日。');
  return {
    ...current,
    defaultGoal: nextGoal,
    open: {
      ...current.open,
      goals: [...current.open.goals, { at: now.toISOString(), goal: nextGoal }],
    },
  };
}

export function applyWordDelta(schedule: GoalSchedule, delta: number, now: Date): GoalSchedule {
  if (!Number.isInteger(delta)) {
    throw new DailyGoalError('字數變化要是整數。');
  }
  const current = withClock(schedule, now);
  if (!current.open) throw new DailyGoalError('目前沒有進行中的寫作日。');
  return {
    ...current,
    open: {
      ...current.open,
      wordCount: Math.max(0, current.open.wordCount + delta),
    },
  };
}

/**
 * 改「一天幾點結束」。
 * 進行中的這一天仍走到原來的結束時刻才結算。新時刻從下一個寫作日才生效。
 * 已經結算的日子完全不動。
 */
export function changeDayEndHour(schedule: GoalSchedule, hour: number, now: Date): GoalSchedule {
  const nextHour = assertDayEndHour(hour);
  const settledNow = settleElapsed(schedule, now);
  const withHour: GoalSchedule = { ...settledNow, dayEndHour: nextHour };
  if (withHour.open) return withHour;
  return { ...withHour, open: openNewDay(withHour, now, nextHour) };
}

/**
 * 匯入電腦版舊紀錄時，用「匯入當下的每日目標」把過去每一天結算一次，之後就固定。
 * 同一天若有多列，留最後一列，仍然只算一天。
 */
export function settleImportedLogs(
  logs: readonly { date: string; wordCount: number }[],
  goalAtImport: number,
): SettledWritingDay[] {
  const goal = assertDailyGoal(goalAtImport);
  const byDate = new Map<string, number>();
  for (const log of logs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(log.date)) {
      throw new DailyGoalError(`日期要寫成 YYYY-MM-DD：${log.date}`);
    }
    if (!Number.isInteger(log.wordCount) || log.wordCount < 0) {
      throw new DailyGoalError('匯入的字數要是 0 以上的整數。');
    }
    byDate.set(log.date, log.wordCount);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, wordCount]) => ({
      dayKey,
      dayEndHour: DEFAULT_DAY_END_HOUR,
      wordCount,
      finalGoal: goal,
      achieved: wordCount >= goal,
    }));
}

export function formatDayEndHour(hour: number): string {
  assertDayEndHour(hour);
  if (hour === 0) return '午夜 12 點';
  if (hour === 12) return '中午 12 點';
  if (hour < 12) return `上午 ${hour} 點`;
  return `下午 ${hour - 12} 點`;
}
