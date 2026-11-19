import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  halfWidthBubbleAria,
  halfWidthDone,
  halfWidthDoneAria,
  halfWidthNoticeLong,
  halfWidthNoticeLongAria,
  halfWidthNoticeShort,
  halfWidthNoticeShortAria,
  halfWidthNoticeShortExpandAria,
  halfWidthSettingAria,
} from '../copy/halfWidthCopy';
import { countAchievements } from '../domain/dailyGoal';
import { convertHalfWidthInChapter, findHalfWidthMarks } from '../domain/halfWidthPunct';
import { summarizeStats } from '../domain/stats';
import { countBookWords, countWords } from '../domain/wordCount';
import {
  HALF_WIDTH_REMINDER_STORAGE_KEY,
  isHalfWidthSkipped,
  noteHalfWidthBook,
  readHalfWidthReminder,
  resetHalfWidthSession,
  skipHalfWidthForChapter,
  writeHalfWidthReminder,
} from './halfWidthReminder';
import { firstFileNode } from './testing/firstFile';
import { createState, manuscriptSnapshotParts, reduce, type SampleState } from './sampleStore';
import { demoFixtureState } from './testing/sampleFixture';

const NOON = new Date('2026-11-14T04:00:00Z');

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function projectOf(state: SampleState, id: string) {
  return state.projects.find((item) => item.id === id)!;
}

function chapterOf(state: SampleState, projectId: string) {
  return firstFileNode(projectOf(state, projectId).nodes)!;
}

function write(state: SampleState, projectId: string, text: string): SampleState {
  return reduce(state, { type: 'commit-text', projectId, nodeId: chapterOf(state, projectId).id, text });
}

function todayWords(state: SampleState): number {
  return summarizeStats(state.schedule, state.logs, countAchievements(state.schedule.settled)).todayWords;
}

describe('WO-76 乙段：「先不用」與本機開關', () => {
  afterEach(() => {
    resetHalfWidthSession();
  });

  it('WO-76 乙段：按「先不用」後同一章不再出提示條，切到別章再回來仍記得', () => {
    noteHalfWidthBook('book-a');
    expect(isHalfWidthSkipped('book-a', 'ch-1')).toBe(false);
    skipHalfWidthForChapter('book-a', 'ch-1');
    expect(isHalfWidthSkipped('book-a', 'ch-1')).toBe(true);
    // 別章不受影響
    expect(isHalfWidthSkipped('book-a', 'ch-2')).toBe(false);
    // 切到別章再回來
    noteHalfWidthBook('book-a');
    expect(isHalfWidthSkipped('book-a', 'ch-1')).toBe(true);
  });

  it('WO-76 乙段：換書或重新開 App 後會再提醒', () => {
    skipHalfWidthForChapter('book-a', 'ch-1');
    noteHalfWidthBook('book-b');
    noteHalfWidthBook('book-a');
    expect(isHalfWidthSkipped('book-a', 'ch-1')).toBe(false);

    skipHalfWidthForChapter('book-a', 'ch-1');
    resetHalfWidthSession();
    expect(isHalfWidthSkipped('book-a', 'ch-1')).toBe(false);
  });

  it('WO-76 乙段：「提醒半形標點」預設開啟，只存在這個裝置的一把鍵', () => {
    const store = memoryStore();
    expect(readHalfWidthReminder(store)).toBe(true);
    writeHalfWidthReminder(false, store);
    expect(store.data.get(HALF_WIDTH_REMINDER_STORAGE_KEY)).toBe('0');
    expect(readHalfWidthReminder(store)).toBe(false);
    writeHalfWidthReminder(true, store);
    expect(readHalfWidthReminder(store)).toBe(true);
    expect([...store.data.keys()]).toEqual([HALF_WIDTH_REMINDER_STORAGE_KEY]);
    expect(readHalfWidthReminder(null)).toBe(true);
  });

  it('WO-76 乙段：開關不寫進稿子：另存內容裡沒有這把鍵', () => {
    const state = demoFixtureState(NOON);
    const parts = manuscriptSnapshotParts(state, projectOf(state, 'fog'));
    expect(JSON.stringify(parts)).not.toContain('half-width');
  });
});

describe('WO-76 乙段：改成全形與一次復原走既有 commit-text', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('WO-76 乙段：轉換後本章、全書、今天字數照甲段算法更新；復原一次整批還原', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-yi', title: '【範例】半形稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-yi' });
    const typed = '他說,走吧.真的嗎?好...潮位3.5米,共1,000人.';
    state = write(state, 'p-yi', typed);
    const typedWords = countWords(typed);
    expect(todayWords(state)).toBe(typedWords);
    expect(findHalfWidthMarks(typed)).toHaveLength(6);

    const converted = convertHalfWidthInChapter(typed, typed.length);
    expect(converted.text).toBe('他說，走吧。真的嗎？好……潮位3.5米，共1,000人。');
    expect(converted.count).toBe(6);
    const afterConvert = write(state, 'p-yi', converted.text);
    expect(chapterOf(afterConvert, 'p-yi').content).toBe(converted.text);
    // 「...」3 個半形符號各算 1，換成「……」算 2：字數少 1，由 commit-text 相減得出
    expect(countWords(converted.text)).toBe(typedWords - 1);
    expect(todayWords(afterConvert)).toBe(countWords(converted.text));
    expect(countBookWords(projectOf(afterConvert, 'p-yi').nodes)).toBe(
      countBookWords(projectOf(state, 'p-yi').nodes) - 1,
    );

    // 復原：整批換回原文，字數回到原值
    const undone = write(afterConvert, 'p-yi', typed);
    expect(chapterOf(undone, 'p-yi').content).toBe(typed);
    expect(todayWords(undone)).toBe(typedWords);
    expect(countBookWords(projectOf(undone, 'p-yi').nodes)).toBe(countBookWords(projectOf(state, 'p-yi').nodes));
  });

  it('WO-76 乙段：只改這一章，同一本範例書的別章不動', () => {
    const state = demoFixtureState(NOON);
    type Node = SampleState['projects'][number]['nodes'][number];
    const flat = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);
    const all = flat(projectOf(state, 'fog').nodes);
    const target = all.find((node) => node.type !== 'folder')!;
    const others = all.filter((node) => node.id !== target.id).map((node) => [node.id, node.content ?? '']);
    const converted = convertHalfWidthInChapter(`${target.content ?? ''}他說,走吧.`, 0);
    const next = reduce(state, { type: 'commit-text', projectId: 'fog', nodeId: target.id, text: converted.text });
    const after = flat(projectOf(next, 'fog').nodes);
    expect(after.find((node) => node.id === target.id)!.content).toBe(converted.text);
    expect(after.filter((node) => node.id !== target.id).map((node) => [node.id, node.content ?? ''])).toEqual(others);
  });
});

describe('WO-76 乙段：畫面與朗讀用字', () => {
  it('WO-76 乙段：甲案、乙案、轉換結果、小泡泡、開關用字照工單，範圍一律「這一章」', () => {
    expect(halfWidthNoticeLong(3)).toBe('這一章有 3 個半形標點');
    expect(halfWidthNoticeLongAria(3)).toBe('這一章有 3 個半形標點，點兩下可以一次改成全形');
    expect(halfWidthNoticeShort(3)).toBe('半形標點　3 處');
    expect(halfWidthNoticeShortAria(3)).toBe('半形標點 3 處，點兩下可以一次改成全形');
    expect(halfWidthNoticeShortExpandAria(3)).toBe('半形標點 3 處，點兩下展開選項');
    expect(halfWidthNoticeShortExpandAria(1234)).toBe('半形標點 1,234 處，點兩下展開選項');
    expect(halfWidthDone(3)).toBe('已改成全形，共 3 個');
    expect(halfWidthDoneAria(3)).toBe('已改成全形，共 3 個，點兩下復原');
    expect(halfWidthBubbleAria('comma')).toBe('半形逗號，點兩下改成全形逗號');
    expect(halfWidthBubbleAria('ellipsis')).toBe('半形刪節號，點兩下改成全形刪節號');
    expect(halfWidthSettingAria(true)).toBe('提醒半形標點，已開啟，點兩下關閉');
    expect(halfWidthSettingAria(false)).toBe('提醒半形標點，已關閉，點兩下開啟');
  });

  it('WO-76 乙段：四位數以上加千分位，不用「您」「錯誤」「錯字」、朗讀不用間隔號或斜線', () => {
    expect(halfWidthNoticeLong(1234)).toBe('這一章有 1,234 個半形標點');
    expect(halfWidthNoticeShort(1234)).toBe('半形標點　1,234 處');
    const all = [
      halfWidthNoticeLong(2),
      halfWidthNoticeLongAria(2),
      halfWidthNoticeShort(2),
      halfWidthNoticeShortAria(2),
      halfWidthNoticeShortExpandAria(2),
      halfWidthDone(2),
      halfWidthDoneAria(2),
      halfWidthBubbleAria('period'),
      halfWidthSettingAria(true),
      halfWidthSettingAria(false),
    ].join('');
    expect(all).not.toMatch(/您|錯誤|錯字|這一幕|[・‧·／/]/u);
  });
});

describe('WO-76 乙段返工1：「先不用」後不再出小泡泡', () => {
  const source = readFileSync(new URL('../screens/HalfWidthReminder.tsx', import.meta.url), 'utf8');

  it('placeBubble 與泡泡元件都檢查略過狀態，按下當下清掉小泡泡', () => {
    const place = source.slice(source.indexOf('const placeBubble'), source.indexOf('// 換章'));
    expect(place).toContain('skippedRef.current');
    expect(place.indexOf('skippedRef.current')).toBeLessThan(place.indexOf('markAtCaret'));
    const bubbleComp = source.slice(source.indexOf('export function HalfWidthBubble'));
    expect(bubbleComp).toContain('controller.skipped');
    const skipFn = source.slice(source.indexOf('const skip = () =>'), source.indexOf('return { count, typing'));
    expect(skipFn).toContain('skipHalfWidthForChapter(bookId, chapterId)');
    expect(skipFn).toContain('setBubble(null)');
  });

  it('略過狀態依書與章記憶：切章回來仍略過，別章不受影響', () => {
    noteHalfWidthBook('book-a');
    skipHalfWidthForChapter('book-a', 'ch-1');
    noteHalfWidthBook('book-a');
    expect(isHalfWidthSkipped('book-a', 'ch-1')).toBe(true);
    expect(isHalfWidthSkipped('book-a', 'ch-2')).toBe(false);
    resetHalfWidthSession();
  });
});
