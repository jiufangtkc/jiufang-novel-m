import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { findNode } from '../data/demo';
import { writingDayKey } from '../domain/dailyGoal';
import { countBookWords, countWords } from '../domain/wordCount';
import { classifyTextDelta } from '../domain/writingLog';
import { executeFormat, executeUndo, type FormatFlowDeps, type FormatRequest } from '../editor/formatFlow';
import type { FormatKind } from '../editor/formatText';
import type { FormatScope } from '../editor/formatScope';
import { createState, displayLogRows, reduce, type Action, type SampleState } from './sampleStore';

const NOON = new Date('2026-11-18T04:00:00Z');
const PID = 'p-wo122';
const OTHER = 'p-other';

function tree(): ChapterNode[] {
  return [
    {
      id: 'v1',
      type: 'folder',
      title: '第一卷',
      content: '卷不改\n\n\n',
      children: [
        {
          id: 'c1',
          type: 'file',
          title: '第一章',
          content: '甲甲甲\n乙乙乙\n\n\n丙丙丙',
          children: [
            { id: 's1', type: 'scene', title: '第一幕', content: '丁丁\n戊戊' },
            { id: 's2', type: 'scene', title: '第二幕', content: '' },
          ],
        },
        { id: 'c2', type: 'file', title: '第二章', content: '' },
      ],
    },
    { id: 'c3', type: 'file', title: '第三章', content: ' 己己\n庚庚' },
  ];
}

function baseState(): SampleState {
  let s = reduce(createState(NOON), { type: 'add-project', id: PID, title: '【範例】WO-122 排版驗收', shape: 'novel' });
  s = reduce(s, { type: 'add-project', id: OTHER, title: '另一份稿子', shape: 'novel' });
  s = reduce(s, { type: 'set-nodes', projectId: PID, nodes: tree() });
  s = reduce(s, { type: 'focus-project', id: PID });
  return s;
}

function content(state: SampleState, id: string, projectId = PID): string | undefined {
  return findNode(state.projects.find((p) => p.id === projectId)!.nodes, id)?.content;
}

function todayRow(state: SampleState, projectId = PID) {
  const key = writingDayKey(NOON, 0);
  return displayLogRows(state, projectId).find((row) => row.date === key);
}

/** 把排版入口接到真正的 reducer；記下每個被送出的 action，證明沒有走 note-large。 */
function harness(initial: SampleState, opts: { currentId: string; live?: string | null }) {
  const sent: Action[] = [];
  let state = initial;
  let currentId = opts.currentId;
  let live: string | null = opts.live === undefined ? (content(state, currentId) ?? '') : opts.live;
  let composing = false;
  const send = (action: Action) => {
    sent.push(action);
    state = reduce(state, action);
  };
  const deps: FormatFlowDeps = {
    getNodes: () => state.projects.find((p) => p.id === PID)?.nodes ?? null,
    readLive: () => live,
    isComposing: () => composing,
    // 與 useWritingSurface.replaceText 相同：只送一次 commit-text，不經 input／paste／noteLarge
    syncCurrent: (next) => {
      if (composing) return false;
      live = next;
      send({ type: 'commit-text', projectId: PID, nodeId: currentId, text: next });
      return true;
    },
    applyOthers: (changes, snapshot) => send({ type: 'format-apply', projectId: PID, changes, snapshot }),
    undoOthers: (entries) => send({ type: 'format-undo', projectId: PID, entries }),
    clearSnapshot: () => send({ type: 'format-clear' }),
  };
  const request = (kind: FormatKind, scope: FormatScope, extra: Partial<FormatRequest> = {}): FormatRequest => ({
    projectId: PID,
    currentId,
    openedProjectId: PID,
    openedChapterId: currentId,
    kind,
    scope,
    ...extra,
  });
  return {
    sent,
    get state() {
      return state;
    },
    set state(next: SampleState) {
      state = next;
    },
    get live() {
      return live;
    },
    /** 使用者在寫作框打字（尚未送出到 store） */
    typeLive(text: string) {
      live = text;
    },
    /** 使用者打字後由停筆計時送出 */
    flushLive() {
      send({ type: 'commit-text', projectId: PID, nodeId: currentId, text: live ?? '' });
    },
    setComposing(value: boolean) {
      composing = value;
    },
    switchTo(id: string) {
      currentId = id;
      live = content(state, id) ?? '';
    },
    format: (kind: FormatKind, scope: FormatScope, extra?: Partial<FormatRequest>) =>
      executeFormat(deps, request(kind, scope, extra)),
    undo: () => executeUndo(deps, { projectId: PID, currentId, snapshot: state.formatUndo }),
    send,
  };
}

describe('WO-122 排版入口與 store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('這一章：只改目前章正文，不連同子幕，標題／卷／其他章／其他稿子不變', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    const before = h.state;
    expect(h.format('space-paragraphs', 'chapter')).toEqual({ status: 'applied', changedCount: 1 });
    expect(content(h.state, 'c1')).toBe('甲甲甲\n\n乙乙乙\n\n丙丙丙');
    expect(content(h.state, 's1')).toBe('丁丁\n戊戊');
    expect(content(h.state, 'c3')).toBe(' 己己\n庚庚');
    expect(content(h.state, 'v1')).toBe('卷不改\n\n\n');
    expect(h.state.projects.find((p) => p.id === OTHER)).toBe(before.projects.find((p) => p.id === OTHER));
    expect(h.state.projects.find((p) => p.id === PID)!.nodes[0]!.title).toBe('第一卷');
    expect(h.state.formatUndo).toEqual({
      projectId: PID,
      kind: 'space-paragraphs',
      scope: 'chapter',
      entries: [{ nodeId: 'c1', before: '甲甲甲\n乙乙乙\n\n\n丙丙丙' }],
    });
  });

  it('全書：章自身與子幕、未開的章都改；空章與資料夾不動；一次完成', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    expect(h.format('indent', 'book')).toEqual({ status: 'applied', changedCount: 3 });
    expect(content(h.state, 'c1')).toBe('　　甲甲甲\n　　乙乙乙\n\n\n　　丙丙丙');
    expect(content(h.state, 's1')).toBe('　　丁丁\n　　戊戊');
    expect(content(h.state, 'c3')).toBe('　　己己\n　　庚庚');
    expect(content(h.state, 'c2')).toBe('');
    expect(content(h.state, 's2')).toBe('');
    expect(content(h.state, 'v1')).toBe('卷不改\n\n\n');
    expect(h.state.formatUndo?.entries.map((e) => e.nodeId).sort()).toEqual(['c1', 'c3', 's1']);
    // 目前章走寫作框同步（一次 commit-text），其他章幕走同一次 format-apply
    expect(h.sent.map((a) => a.type)).toEqual(['commit-text', 'format-apply']);
  });

  it('無改動（含空章）：不寫入、不建立也不覆蓋既有快照', () => {
    const h = harness(baseState(), { currentId: 'c2' });
    const before = h.state;
    expect(h.format('indent', 'chapter')).toEqual({ status: 'unchanged' });
    expect(h.sent).toEqual([]);
    expect(h.state).toBe(before);
    // 先做一次有效排版，再做一次沒有實質變更的，快照仍是第一次的
    const g = harness(baseState(), { currentId: 'c3' });
    g.format('indent', 'chapter');
    const snapshot = g.state.formatUndo;
    const sentBefore = g.sent.length;
    expect(g.format('indent', 'chapter')).toEqual({ status: 'unchanged' });
    expect(g.sent.length).toBe(sentBefore);
    expect(g.state.formatUndo).toBe(snapshot);
  });

  it('復原：單章與全書都一次還原所有被改正文；快照清空，重複復原不出錯', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    const original = baseState();
    h.format('space-paragraphs', 'book');
    expect(h.undo()).toEqual({ status: 'restored', restoredCount: 3 });
    for (const id of ['c1', 's1', 'c3', 'c2', 's2', 'v1']) expect(content(h.state, id)).toBe(content(original, id));
    expect(h.state.formatUndo).toBeNull();
    expect(h.undo()).toEqual({ status: 'none' });

    const g = harness(baseState(), { currentId: 'c1' });
    g.format('strip-blank', 'chapter');
    expect(content(g.state, 'c1')).toBe('甲甲甲\n乙乙乙\n丙丙丙');
    expect(g.undo()).toEqual({ status: 'restored', restoredCount: 1 });
    expect(content(g.state, 'c1')).toBe('甲甲甲\n乙乙乙\n\n\n丙丙丙');
  });

  it('復原後再重做同一功能得到相同結果', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.format('space-paragraphs', 'chapter');
    const first = content(h.state, 'c1');
    h.undo();
    h.format('space-paragraphs', 'chapter');
    expect(content(h.state, 'c1')).toBe(first);
  });

  it('連續兩次有效排版只保留第二次快照；復原第二次回到第一次排版後，不能再復原第一次', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.format('space-paragraphs', 'chapter');
    const afterFirst = content(h.state, 'c1');
    h.format('indent', 'chapter');
    const afterSecond = content(h.state, 'c1');
    expect(afterSecond).not.toBe(afterFirst);
    expect(h.undo().status).toBe('restored');
    expect(content(h.state, 'c1')).toBe(afterFirst);
    expect(h.state.formatUndo).toBeNull();
    expect(h.undo()).toEqual({ status: 'none' });
    expect(content(h.state, 'c1')).toBe(afterFirst);
  });

  it('復原會覆蓋排版後新打的字，但不碰沒被排版的章幕', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.format('space-paragraphs', 'chapter');
    h.typeLive(`${h.live}後來新打的字`);
    h.flushLive();
    h.switchTo('c3');
    h.send({ type: 'commit-text', projectId: PID, nodeId: 'c3', text: ' 己己\n庚庚新增' });
    h.switchTo('c1');
    expect(h.undo().status).toBe('restored');
    expect(content(h.state, 'c1')).toBe('甲甲甲\n乙乙乙\n\n\n丙丙丙');
    expect(content(h.state, 'c3')).toBe(' 己己\n庚庚新增');
  });

  it('尚未暫存的最新字納入排版前快照，不被舊 store 蓋掉', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    // 寫作框已打了新字，store 還是舊的
    h.typeLive(' 己己\n庚庚\n\n辛辛');
    expect(h.format('strip-blank', 'chapter')).toEqual({ status: 'applied', changedCount: 1 });
    expect(content(h.state, 'c3')).toBe(' 己己\n庚庚\n辛辛');
    expect(h.state.formatUndo?.entries).toEqual([{ nodeId: 'c3', before: ' 己己\n庚庚\n\n辛辛' }]);
    h.undo();
    expect(content(h.state, 'c3')).toBe(' 己己\n庚庚\n\n辛辛');
    expect(h.live).toBe(' 己己\n庚庚\n\n辛辛');
  });

  it('組字中：先暫停，什麼都不改（含全書半套更新）；復原也一樣', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    const before = h.state;
    h.setComposing(true);
    expect(h.format('indent', 'book')).toEqual({ status: 'composing' });
    expect(h.state).toBe(before);
    expect(h.sent).toEqual([]);
    h.setComposing(false);
    h.format('indent', 'book');
    h.setComposing(true);
    const mid = h.state;
    expect(h.undo()).toEqual({ status: 'composing' });
    expect(h.state).toBe(mid);
    expect(h.state.formatUndo).not.toBeNull();
  });

  it('切到其他章幕後才確認：取消舊流程，不誤改新目標', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    const before = h.state;
    expect(h.format('indent', 'book', { openedChapterId: 'c3' })).toEqual({ status: 'stale' });
    expect(h.format('indent', 'book', { openedProjectId: OTHER })).toEqual({ status: 'stale' });
    expect(h.state).toBe(before);
  });

  it('章幕已不存在：提示先打開章幕，什麼都不改', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.state = reduce(h.state, {
      type: 'set-nodes',
      projectId: PID,
      nodes: tree().filter((n) => n.id !== 'v1'),
    });
    const before = h.state;
    expect(h.format('indent', 'chapter')).toEqual({ status: 'no-target' });
    expect(h.state).toBe(before);
  });

  it('節點被刪除：整批復原停止、清空快照、不重建節點、不動其他稿子', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    h.format('indent', 'book');
    // 刪掉被排版過的幕 s1
    const pruned = tree();
    pruned[0]!.children![0]!.children = [{ id: 's2', type: 'scene', title: '第二幕', content: '' }];
    h.state = reduce(h.state, { type: 'set-nodes', projectId: PID, nodes: pruned });
    const otherBefore = h.state.projects.find((p) => p.id === OTHER);
    const c1Now = content(h.state, 'c1');
    expect(h.undo()).toEqual({ status: 'invalid' });
    expect(h.state.formatUndo).toBeNull();
    expect(findNode(h.state.projects.find((p) => p.id === PID)!.nodes, 's1')).toBeNull();
    expect(content(h.state, 'c1')).toBe(c1Now);
    expect(h.state.projects.find((p) => p.id === OTHER)).toBe(otherBefore);
  });

  it('reducer 自己也不做一半：format-apply 有章幕不存在就整批不動', () => {
    const state = baseState();
    const next = reduce(state, {
      type: 'format-apply',
      projectId: PID,
      changes: [
        { nodeId: 'c1', before: '', after: '改了' },
        { nodeId: 'not-there', before: '', after: '也改' },
      ],
      snapshot: { projectId: PID, kind: 'indent', scope: 'book', entries: [] },
    });
    expect(next).toBe(state);
  });

  it('離開這份稿子（換成別份）就清空快照', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.format('space-paragraphs', 'chapter');
    expect(h.state.formatUndo).not.toBeNull();
    h.state = reduce(h.state, { type: 'focus-project', id: OTHER });
    expect(h.state.formatUndo).toBeNull();
    h.state = reduce(h.state, { type: 'focus-project', id: PID });
    expect(h.undo()).toEqual({ status: 'none' });
  });

  it('同一份稿子切到別的分頁再回來：快照還在、仍可整批復原；只有換稿才清', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.format('space-paragraphs', 'chapter');
    const snapshot = h.state.formatUndo;
    expect(snapshot).not.toBeNull();
    // 離開寫作頁不會對 store 送任何清除動作；同稿重新聚焦（回來）快照原封不動
    h.state = reduce(h.state, { type: 'focus-project', id: PID });
    expect(h.state.formatUndo).toBe(snapshot);
    expect(h.undo().status).toBe('restored');
    // 換稿才清
    h.format('space-paragraphs', 'chapter');
    h.state = reduce(h.state, { type: 'focus-project', id: OTHER });
    expect(h.state.formatUndo).toBeNull();
  });

  it('format-clear（關閉提示）清空快照；沒有快照時不報錯', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    h.send({ type: 'format-clear' });
    h.format('space-paragraphs', 'chapter');
    h.send({ type: 'format-clear' });
    expect(h.state.formatUndo).toBeNull();
    expect(h.undo()).toEqual({ status: 'none' });
  });
});

describe('WO-122 不經 paste／noteLarge：大量計數前後相等', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 很多行的假正文：若走一般輸入路徑，這個改動會被判成大量文字出現。 */
  const BIG_LINE = '甲乙丙丁戊己庚辛';
  const bigText = Array.from({ length: 80 }, () => BIG_LINE).join('\n');

  it('前提：同樣的改動若被當成一般輸入，會被判為大量出現（所以下面的不變才有意義）', () => {
    const after = bigText
      .split('\n')
      .map((line) => `　　${line}`)
      .join('\n');
    expect(classifyTextDelta(bigText, after, { source: 'type' }).largeInsert).toBe(true);
  });

  for (const [kind, scope] of [
    ['indent', 'chapter'],
    ['indent', 'book'],
    ['space-paragraphs', 'book'],
    ['strip-blank', 'book'],
  ] as [FormatKind, FormatScope][]) {
    it(`${kind}／${scope}：排版與復原前後 paste_large_count、delete_large_count 都不變，沒有送 note-large`, () => {
      let state = baseState();
      state = reduce(state, { type: 'commit-text', projectId: PID, nodeId: 'c3', text: bigText });
      state = reduce(state, { type: 'commit-text', projectId: PID, nodeId: 'c1', text: `${bigText}\n\n\n${bigText}` });
      const before = todayRow(state);
      expect(before).toBeDefined();
      const h = harness(state, { currentId: 'c3' });
      expect(h.format(kind, scope).status).toBe('applied');
      const afterFormat = todayRow(h.state);
      expect(afterFormat?.paste_large_count).toBe(before?.paste_large_count);
      expect(afterFormat?.delete_large_count).toBe(before?.delete_large_count);
      expect(h.undo().status).toBe('restored');
      const afterUndo = todayRow(h.state);
      expect(afterUndo?.paste_large_count).toBe(before?.paste_large_count);
      expect(afterUndo?.delete_large_count).toBe(before?.delete_large_count);
      expect(h.sent.some((a) => a.type === 'note-large')).toBe(false);
      expect(before?.paste_large_count).toBe(0);
    });
  }
});

describe('WO-122 字數沿用既有算法，不重複記帳', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('排版只動空白與換行時，今天字數與全書字數不變；復原後也不變', () => {
    let state = baseState();
    // 先送出有新增字的正文，讓今日字數不是 0；只改空白不會產生今日紀錄列或不會增加今日字數。
    state = reduce(state, { type: 'commit-text', projectId: PID, nodeId: 'c3', text: ' 己己\n庚庚\n辛辛' });
    const wordsBefore = todayRow(state)?.word_count;
    expect(wordsBefore).toBeGreaterThan(0);
    const bookBefore = countBookWords(state.projects.find((p) => p.id === PID)!.nodes);
    const h = harness(state, { currentId: 'c3' });
    h.format('indent', 'book');
    expect(todayRow(h.state)?.word_count).toBe(wordsBefore);
    expect(countBookWords(h.state.projects.find((p) => p.id === PID)!.nodes)).toBe(bookBefore);
    h.undo();
    expect(todayRow(h.state)?.word_count).toBe(wordsBefore);
  });

  it('尚未暫存的新字在排版時只記一次：等同先送出再排版', () => {
    const typed = ' 己己\n庚庚\n\n新新新新';
    const viaFormat = harness(baseState(), { currentId: 'c3' });
    viaFormat.typeLive(typed);
    viaFormat.format('strip-blank', 'chapter');

    let manual = baseState();
    manual = reduce(manual, { type: 'commit-text', projectId: PID, nodeId: 'c3', text: typed });
    manual = reduce(manual, { type: 'commit-text', projectId: PID, nodeId: 'c3', text: ' 己己\n庚庚\n新新新新' });

    expect(todayRow(viaFormat.state)?.word_count).toBe(todayRow(manual)?.word_count);
    expect(countWords(content(viaFormat.state, 'c3') ?? '')).toBe(countWords(' 己己\n庚庚\n新新新新'));
  });

  it('更新走既有 projects 狀態（自動暫存讀的就是這份），重新整理讀回的是排版後的字', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    h.format('indent', 'chapter');
    const stored = h.state.projects.find((p) => p.id === PID)!;
    expect(findNode(stored.nodes, 'c3')?.content).toBe('　　己己\n　　庚庚');
    expect(stored.updatedLabel).toBe('剛剛');
  });
});
