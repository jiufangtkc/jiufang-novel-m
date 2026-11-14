import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countAchievements, writingDayKey } from '../domain/dailyGoal';
import { summarizeStats } from '../domain/stats';
import { openNodeSql } from '../db/nodeSql';
import { readFileProject, writeFileProject, type FileLog } from '../db/projectFile';
import { createVersion14Shell } from '../db/schemaFixture';
import { scheduleFromLogs } from '../db/library';
import { createState, manuscriptSnapshotParts, reduce, type SampleState } from './sampleStore';

/** 範例書自己的範例紀錄日期（10/18～10/28 共 6 天）。 */
const SAMPLE_DATES = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-27', '2026-10-28'];
/** 臺北 2026-11-14 中午。 */
const NOON = new Date('2026-11-14T04:00:00Z');
const TODAY = writingDayKey(NOON, 0);

function statsOf(state: SampleState) {
  return summarizeStats(state.schedule, state.logs, countAchievements(state.schedule.settled));
}

function chapterOf(state: SampleState, projectId: string): string {
  const project = state.projects.find((item) => item.id === projectId)!;
  return project.nodes[0]!.id;
}

function addAndOpen(state: SampleState, id: string, title: string): SampleState {
  const added = reduce(state, { type: 'add-project', id, title, shape: 'novel' });
  return reduce(added, { type: 'focus-project', id });
}

function write(state: SampleState, projectId: string, text: string): SampleState {
  return reduce(state, { type: 'commit-text', projectId, nodeId: chapterOf(state, projectId), text });
}

/** 依另存流程取出要寫進檔案的內容，寫進一份空白 .db，再像「開啟稿子」一樣讀回。 */
function saveAndReopen(state: SampleState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId)!;
  const parts = manuscriptSnapshotParts(state, project);
  const { db, sql } = openNodeSql();
  try {
    createVersion14Shell(sql);
    writeFileProject(sql, parts.info, project.nodes, parts.cards, parts.logs);
    const loaded = readFileProject(sql);
    return { parts, loaded };
  } finally {
    db.close();
  }
}

function dates(logs: readonly Pick<FileLog, 'date'>[]): string[] {
  return logs.map((log) => log.date).sort();
}

describe('WO-69 每份稿子各自的寫作紀錄', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('WO-69：新稿一開，今天寫了與統計都從 0 開始，不借範例書紀錄', () => {
    const state = addAndOpen(createState(NOON), 'p-new', '【範例】新稿');
    const stats = statsOf(state);
    expect(state.logs).toEqual([]);
    expect(state.schedule.settled).toEqual([]);
    expect(stats.todayWords).toBe(0);
    expect(stats.last7Words).toBe(0);
    expect(stats.activeDays).toBe(0);
    expect(stats.streak).toBe(0);
    expect(stats.longestStreak).toBe(0);
    expect(stats.totalDurationSeconds).toBe(0);
    expect(stats.achievementCount).toBe(0);
    // 每日目標值沿用原設定，不必歸零
    expect(stats.todayGoal).toBe(1000);
  });

  it('WO-69：新稿另存後寫作紀錄不含範例日期，重開後統計前後一致', () => {
    let state = addAndOpen(createState(NOON), 'p-new', '【範例】新稿');
    state = write(state, 'p-new', '第一段，霧從港口慢慢退去。\n');
    state = write(state, 'p-new', '第一段，霧從港口慢慢退去。\n第二段，燈塔亮了。\n');
    state = reduce(state, { type: 'add-duration', seconds: 120 });
    const before = statsOf(state);
    expect(before.todayWords).toBeGreaterThan(0);

    const { parts, loaded } = saveAndReopen(state, 'p-new');
    // 另存寫進檔案的紀錄只有今天這一筆
    expect(dates(parts.logs)).toEqual([TODAY]);
    expect(dates(loaded.logs)).toEqual([TODAY]);
    for (const day of SAMPLE_DATES) expect(dates(loaded.logs)).not.toContain(day);
    expect(loaded.logs[0]!.word_count).toBe(before.todayWords);
    expect(loaded.logs[0]!.duration).toBe(120);

    // 重開：依檔案紀錄排出結算狀態，統計與另存前一致
    const schedule = scheduleFromLogs(loaded.logs, loaded.info.dailyTargetWordCount, NOON);
    const reopened = reduce(state, {
      type: 'attach-file',
      project: {
        id: 'reopened',
        dbKey: 'reopened',
        title: loaded.info.title,
        updatedLabel: '剛剛',
        bookGoal: loaded.info.targetWordCount,
        nodes: loaded.tree,
        origin: 'file',
      },
      schedule,
      extras: { info: loaded.info, cards: loaded.cards, logs: loaded.logs },
    });
    const after = statsOf(reopened);
    expect(after.todayWords).toBe(before.todayWords);
    expect(after.achievementCount).toBe(before.achievementCount);
    expect(after.achievementCount).toBe(0);
    expect(after.streak).toBe(before.streak);
    expect(after.longestStreak).toBe(before.longestStreak);
    expect(after.activeDays).toBe(before.activeDays);
    expect(after.totalHoursLabel).toBe(before.totalHoursLabel);
  });

  it('WO-69：新稿當天暫時達標，不會多出一次已結算達成', () => {
    let state = addAndOpen(createState(NOON), 'p-new', '【範例】新稿');
    state = reduce(state, { type: 'set-goal', goal: 300 });
    state = write(state, 'p-new', '字'.repeat(320));
    expect(statsOf(state).todayMet).toBe(true);
    expect(statsOf(state).achievementCount).toBe(0);
    const { loaded } = saveAndReopen(state, 'p-new');
    const schedule = scheduleFromLogs(loaded.logs, loaded.info.dailyTargetWordCount, NOON);
    expect(countAchievements(schedule.settled)).toBe(0);
    expect(loaded.info.dailyTargetWordCount).toBe(300);
  });

  it('WO-69：內建範例書紀錄仍在，新稿寫字後也不受影響', () => {
    const initial = createState(NOON);
    const sampleToday = statsOf(reduce(initial, { type: 'focus-project', id: 'fog' }));
    let state = addAndOpen(initial, 'p-new', '【範例】新稿');
    state = write(state, 'p-new', '新稿的字。\n');
    state = reduce(state, { type: 'focus-project', id: 'fog' });

    const stats = statsOf(state);
    for (const day of SAMPLE_DATES) expect(state.logs.map((log) => log.date)).toContain(day);
    expect(stats.achievementCount).toBe(5);
    expect(stats.todayWords).toBe(sampleToday.todayWords);
    expect(stats.totalHoursLabel).toBe(sampleToday.totalHoursLabel);
    const fog = state.projects.find((item) => item.id === 'fog')!;
    expect(fog.title).toBe('【範例】霧港紀事');

    // 範例書自己另存時，仍帶自己的範例紀錄
    const parts = manuscriptSnapshotParts(state, fog);
    for (const day of SAMPLE_DATES) expect(dates(parts.logs)).toContain(day);
  });

  it('WO-69：兩份稿子的今天寫了互不干擾，也不加到範例書', () => {
    const initial = createState(NOON);
    const sampleBefore = statsOf(reduce(initial, { type: 'focus-project', id: 'fog' })).todayWords;

    let state = addAndOpen(initial, 'p-a', '【範例】甲稿');
    state = reduce(state, { type: 'add-project', id: 'p-b', title: '【範例】乙稿', shape: 'novel' });
    state = write(state, 'p-a', '甲稿寫了十個字左右。\n');
    const aWords = statsOf(state).todayWords;
    expect(aWords).toBeGreaterThan(0);

    state = reduce(state, { type: 'focus-project', id: 'p-b' });
    expect(statsOf(state).todayWords).toBe(0);
    expect(state.logs).toEqual([]);
    state = write(state, 'p-b', '乙稿。\n');
    const bWords = statsOf(state).todayWords;
    expect(bWords).toBeGreaterThan(0);
    expect(bWords).not.toBe(aWords + bWords);

    state = reduce(state, { type: 'focus-project', id: 'p-a' });
    expect(statsOf(state).todayWords).toBe(aWords);
    expect(dates(state.logs)).toEqual([TODAY]);

    state = reduce(state, { type: 'focus-project', id: 'fog' });
    expect(statsOf(state).todayWords).toBe(sampleBefore);

    // 另存各自的紀錄，也只帶各自的字數
    const aParts = saveAndReopen(state, 'p-a').parts;
    const bParts = saveAndReopen(state, 'p-b').parts;
    expect(aParts.logs.map((log) => log.word_count)).toEqual([aWords]);
    expect(bParts.logs.map((log) => log.word_count)).toEqual([bWords]);
  });

  it('WO-69：離開甲稿後才送進來的甲稿正文，字數仍記在甲稿', () => {
    let state = addAndOpen(createState(NOON), 'p-a', '【範例】甲稿');
    state = reduce(state, { type: 'add-project', id: 'p-b', title: '【範例】乙稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-b' });
    state = write(state, 'p-a', '甲稿晚一步存進來。\n');
    expect(statsOf(state).todayWords).toBe(0);
    state = reduce(state, { type: 'focus-project', id: 'p-a' });
    expect(statsOf(state).todayWords).toBeGreaterThan(0);
  });
});
