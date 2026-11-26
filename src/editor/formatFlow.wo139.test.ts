import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormatLayer, FormatNotice, type FormatTools } from '../components/FormatTools';
import * as punctCopy from '../copy/punctCopy';
import {
  FORMAT_CONFIRM_BOOK_NOTE,
  FORMAT_CONFIRM_TITLE,
  FORMAT_DONE,
  FORMAT_NOTICE_CLOSE,
  FORMAT_START,
  FORMAT_UNDO_BUTTON,
  FORMAT_UNDO_WARNING,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { findNode } from '../data/demo';
import { writingDayKey } from '../domain/dailyGoal';
import { findHalfWidthMarks } from '../domain/halfWidthPunct';
import { countBookWords, countWords } from '../domain/wordCount';
import { classifyTextDelta } from '../domain/writingLog';
import {
  executeFormat,
  executeUndo,
  previewFormat,
  type FormatFlowDeps,
  type FormatRequest,
} from './formatFlow';
import { planFormat, snapshotOf, type FormatScope } from './formatScope';
import { createTrashCaptureTracker } from './trashCapture';
import { unifyPunctuation } from './unifyPunctuation';
import { createState, displayLogRows, reduce, type Action, type SampleState } from '../state/sampleStore';

const NOON = new Date('2026-11-26T04:00:00Z');
const PID = 'p-wo139';
const OTHER = 'p-wo139-other';

const SIMPLIFIED_CHARS = /[删暂记说这为没现还进时请标样选会]/u;
const FORBIDDEN_PHRASE = '這台' + '裝置';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sampleTree(): ChapterNode[] {
  return [
    {
      id: 'v1',
      type: 'folder',
      title: '【範例】第一卷',
      content: '卷的正文不該被改,還有...破折—號',
      children: [
        {
          id: 'c1',
          type: 'file',
          title: '【範例】第一章',
          content: '他說:"你真的要走...太快了吧--等等!"',
          children: [
            {
              id: 's1',
              type: 'scene',
              title: '【範例】第一幕',
              content: '風吹過樹梢—落葉...好冷~',
            },
            {
              id: 's2',
              type: 'scene',
              title: '【範例】第二幕',
              content: '這裡已經統一過了，「沒問題」。',
            },
          ],
        },
        {
          id: 'c2',
          type: 'file',
          title: '【範例】第二章',
          content: '',
        },
      ],
    },
    {
      id: 'c3',
      type: 'file',
      title: '【範例】第三章',
      content: '“快走！”他回頭喊,外面下著大雨.',
    },
  ];
}

function baseState(): SampleState {
  let s = reduce(createState(NOON), {
    type: 'add-project',
    id: PID,
    title: '【範例】WO-139 統一標點驗收',
    shape: 'novel',
  });
  s = reduce(s, {
    type: 'add-project',
    id: OTHER,
    title: '【範例】另一本稿子',
    shape: 'single',
  });
  s = reduce(s, { type: 'set-nodes', projectId: PID, nodes: sampleTree() });
  s = reduce(s, {
    type: 'set-cards',
    projectId: PID,
    cards: [
      {
        id: 'card-1',
        parent_id: null,
        title: '【範例】主角卡',
        category: 'character',
        content: '備註裡有...半形,與—破折號,不能被改',
        color: '#ffffff',
        is_collapsed: 0,
        sort_order: 0,
      },
    ],
  });
  s = reduce(s, { type: 'focus-project', id: PID });
  return s;
}

function contentOf(state: SampleState, nodeId: string, projectId = PID): string | undefined {
  return findNode(state.projects.find((p) => p.id === projectId)!.nodes, nodeId)?.content;
}

function todayRow(state: SampleState, projectId = PID) {
  const key = writingDayKey(NOON, 0);
  return displayLogRows(state, projectId).find((row) => row.date === key);
}

/**
 * 模擬 EditorPane + useWritingSurface.replaceText + sampleStore reducer：
 * - replaceText({ countForToday: false }) 會先 flush() 尚未暫存的真正新打字，再送出 countForToday: false 的 commit-text。
 */
function harness(initial: SampleState, opts: { currentId: string; live?: string | null }) {
  const sent: Action[] = [];
  let state = initial;
  let currentId = opts.currentId;
  let live: string | null = opts.live === undefined ? (contentOf(state, currentId) ?? '') : opts.live;
  let composing = false;
  const send = (action: Action) => {
    sent.push(action);
    state = reduce(state, action);
  };
  const deps: FormatFlowDeps = {
    getNodes: () => state.projects.find((p) => p.id === PID)?.nodes ?? null,
    readLive: () => live,
    isComposing: () => composing,
    syncCurrent: (next, syncOptions) => {
      if (composing) return false;
      if (syncOptions?.countForToday === false && live !== null) {
        // 對齊 useWritingSurface.ts replaceRef：先送出排版前還沒存的真正新打字（計入今日字數）
        send({ type: 'commit-text', projectId: PID, nodeId: currentId, text: live });
      }
      live = next;
      send({
        type: 'commit-text',
        projectId: PID,
        nodeId: currentId,
        text: next,
        ...(syncOptions?.countForToday !== undefined ? { countForToday: syncOptions.countForToday } : {}),
      });
      return true;
    },
    applyOthers: (changes, snapshot) => send({ type: 'format-apply', projectId: PID, changes, snapshot }),
    undoOthers: (entries, undoOptions) =>
      send({
        type: 'format-undo',
        projectId: PID,
        entries,
        ...(undoOptions?.countForToday !== undefined ? { countForToday: undoOptions.countForToday } : {}),
      }),
    clearSnapshot: () => send({ type: 'format-clear' }),
  };

  const request = (
    kind: FormatRequest['kind'],
    scope: FormatScope,
    extra: Partial<FormatRequest> = {},
  ): FormatRequest => ({
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
    typeLive(text: string) {
      live = text;
    },
    setComposing(value: boolean) {
      composing = value;
    },
    preview: (scope: FormatScope, extra?: Partial<FormatRequest>) =>
      previewFormat(deps, request('unify-punctuation', scope, extra)),
    format: (kind: FormatRequest['kind'], scope: FormatScope, extra?: Partial<FormatRequest>) =>
      executeFormat(deps, request(kind, scope, extra)),
    undo: () => executeUndo(deps, { projectId: PID, currentId, snapshot: state.formatUndo }),
    send,
  };
}

describe('WO-139 第 2 段：預估、0 處跳過確認、單章與全書、復原與不動範圍', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('這一章：只統一目前章正文，不改子幕、其他章、卷、卡片與章名', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    const before = h.state;
    const beforeCards = before.projects.find((p) => p.id === PID)!.cards;
    const expectedCount = unifyPunctuation(contentOf(before, 'c1')!).replacementCount;

    const preview = h.preview('chapter');
    expect(preview).toEqual({
      status: 'ok',
      changedCount: 1,
      totalReplacements: expectedCount,
    });
    // 預估不改正文也不建快照
    expect(h.sent).toEqual([]);
    expect(h.state).toBe(before);

    const outcome = h.format('unify-punctuation', 'chapter');
    expect(outcome).toEqual({
      status: 'applied',
      changedCount: 1,
      replacementCount: expectedCount,
    });
    expect(contentOf(h.state, 'c1')).toBe('他說：「你真的要走……太快了吧──等等！」');
    expect(contentOf(h.state, 's1')).toBe('風吹過樹梢—落葉...好冷~');
    expect(contentOf(h.state, 'c3')).toBe('“快走！”他回頭喊,外面下著大雨.');
    expect(contentOf(h.state, 'v1')).toBe('卷的正文不該被改,還有...破折—號');
    expect(h.state.projects.find((p) => p.id === PID)!.cards).toEqual(beforeCards);
    expect(findNode(h.state.projects.find((p) => p.id === PID)!.nodes, 'c1')?.title).toBe('【範例】第一章');
    expect(findNode(h.state.projects.find((p) => p.id === PID)!.nodes, 's1')?.title).toBe('【範例】第一幕');
    expect(h.state.formatUndo).toEqual({
      projectId: PID,
      kind: 'unify-punctuation',
      scope: 'chapter',
      replacementCount: expectedCount,
      entries: [
        {
          nodeId: 'c1',
          before: '他說:"你真的要走...太快了吧--等等!"',
          after: '他說：「你真的要走……太快了吧──等等！」',
        },
      ],
    });
  });

  it('全書：遞迴統一章與巢狀幕，不改卷 folder、卡片、章名；處數正確加總', () => {
    const h = harness(baseState(), { currentId: 'c3' });
    const before = h.state;
    const c1Count = unifyPunctuation(contentOf(before, 'c1')!).replacementCount;
    const s1Count = unifyPunctuation(contentOf(before, 's1')!).replacementCount;
    const c3Count = unifyPunctuation(contentOf(before, 'c3')!).replacementCount;
    const expectedTotal = c1Count + s1Count + c3Count;

    expect(h.preview('book')).toEqual({
      status: 'ok',
      changedCount: 3,
      totalReplacements: expectedTotal,
    });

    const outcome = h.format('unify-punctuation', 'book');
    expect(outcome).toEqual({
      status: 'applied',
      changedCount: 3,
      replacementCount: expectedTotal,
    });
    expect(contentOf(h.state, 'c1')).toBe('他說：「你真的要走……太快了吧──等等！」');
    expect(contentOf(h.state, 's1')).toBe('風吹過樹梢──落葉……好冷～');
    expect(contentOf(h.state, 's2')).toBe('這裡已經統一過了，「沒問題」。');
    expect(contentOf(h.state, 'c2')).toBe('');
    expect(contentOf(h.state, 'c3')).toBe('「快走！」他回頭喊，外面下著大雨。');
    expect(contentOf(h.state, 'v1')).toBe('卷的正文不該被改,還有...破折—號');
    expect(h.state.formatUndo?.replacementCount).toBe(expectedTotal);
    expect(h.state.formatUndo?.entries.map((e) => e.nodeId)).toEqual(['c1', 's1', 'c3']);
  });

  it('0 處已統一：preview 回 0 且不改正文、不建也不覆蓋既有快照', () => {
    // 1) 本章已統一（s2）
    const h = harness(baseState(), { currentId: 's2' });
    const initial = h.state;
    expect(h.preview('chapter')).toEqual({ status: 'ok', changedCount: 0, totalReplacements: 0 });
    expect(h.format('unify-punctuation', 'chapter')).toEqual({ status: 'unchanged' });
    expect(h.sent).toEqual([]);
    expect(h.state).toBe(initial);

    // 2) 全書統一一次保留快照後，再預估全書 0 處，不覆蓋既有快照
    const g = harness(baseState(), { currentId: 'c3' });
    g.format('unify-punctuation', 'book');
    const savedSnapshot = g.state.formatUndo;
    expect(savedSnapshot).not.toBeNull();
    const sentCount = g.sent.length;
    expect(g.preview('book')).toEqual({ status: 'ok', changedCount: 0, totalReplacements: 0 });
    expect(g.state.formatUndo).toBe(savedSnapshot);
    expect(g.sent.length).toBe(sentCount);
  });

  it('previewFormat 支援 stale、no-target、composing 狀態檢核', () => {
    const h = harness(baseState(), { currentId: 'c1' });
    expect(h.preview('chapter', { openedChapterId: 'c3' })).toEqual({ status: 'stale' });
    expect(h.preview('chapter', { openedProjectId: OTHER })).toEqual({ status: 'stale' });
    h.setComposing(true);
    expect(h.preview('book')).toEqual({ status: 'composing' });
    h.setComposing(false);
    h.state = reduce(h.state, { type: 'set-nodes', projectId: PID, nodes: [] });
    expect(h.preview('chapter')).toEqual({ status: 'no-target' });
  });

  it('復原（單章與全書）與新編輯防覆蓋', () => {
    // 單章復原＋新編輯失效
    const single = harness(baseState(), { currentId: 'c1' });
    single.format('unify-punctuation', 'chapter');
    expect(single.undo()).toEqual({
      status: 'restored',
      restoredCount: 1,
      replacementCount: unifyPunctuation(contentOf(baseState(), 'c1')!).replacementCount,
    });
    expect(contentOf(single.state, 'c1')).toBe('他說:"你真的要走...太快了吧--等等!"');
    expect(single.state.formatUndo).toBeNull();
    expect(single.undo()).toEqual({ status: 'none' });

    // 單章套用後有了新編輯（live），復原判定失效不覆蓋新字
    single.format('unify-punctuation', 'chapter');
    const formattedC1 = contentOf(single.state, 'c1')!;
    single.typeLive(`${formattedC1}後面新打的字`);
    expect(single.undo()).toEqual({ status: 'invalid' });
    expect(single.live).toBe(`${formattedC1}後面新打的字`);
    expect(single.state.formatUndo).toBeNull();

    // 全書一次復原
    const book = harness(baseState(), { currentId: 'c3' });
    const orig = baseState();
    book.format('unify-punctuation', 'book');
    const undoRes = book.undo();
    expect(undoRes.status).toBe('restored');
    if (undoRes.status === 'restored') expect(undoRes.restoredCount).toBe(3);
    for (const id of ['c1', 's1', 's2', 'c2', 'c3', 'v1']) {
      expect(contentOf(book.state, id)).toBe(contentOf(orig, id));
    }
    expect(book.state.formatUndo).toBeNull();
  });

  it('既有三項排版的 planFormat 與 snapshotOf 不帶多餘 replacementCount 鍵', () => {
    const plan = planFormat({
      nodes: sampleTree(),
      currentId: 'c1',
      scope: 'chapter',
      kind: 'indent',
    });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect('totalReplacements' in plan).toBe(false);
    expect('replacementCount' in plan.changes[0]!).toBe(false);
    const snap = snapshotOf({ projectId: PID, kind: 'indent', scope: 'chapter', changes: plan.changes });
    expect('replacementCount' in snap).toBe(false);
  });
});

describe('WO-139 防護：刪稿暫存區、大量貼上／刪除、今日字數不灌水與半形提醒重掃', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('不觸發 WO-138 刪稿暫存區，不誤記 paste_large_count／delete_large_count', () => {
    const bigLine = '他說:"這件事...真的沒問題--對嗎?"\n';
    const bigBefore = bigLine.repeat(40);
    const bigAfter = unifyPunctuation(bigBefore).text;
    // 確認改動量本身足以跨過大量刪除/貼上判定（若走一般輸入路徑會誤判）
    expect(classifyTextDelta(bigBefore, bigAfter, { source: 'type' }).wordDelta).not.toBe(0);

    let state = baseState();
    state = reduce(state, { type: 'commit-text', projectId: PID, nodeId: 'c1', text: bigBefore });
    state = reduce(state, { type: 'commit-text', projectId: PID, nodeId: 'c3', text: bigBefore });
    const rowBefore = todayRow(state);
    const tracker = createTrashCaptureTracker();

    const h = harness(state, { currentId: 'c1' });
    expect(h.format('unify-punctuation', 'book').status).toBe('applied');
    expect(h.sent.some((a) => a.type === 'note-large')).toBe(false);
    expect(todayRow(h.state)?.paste_large_count).toBe(rowBefore?.paste_large_count ?? 0);
    expect(todayRow(h.state)?.delete_large_count).toBe(rowBefore?.delete_large_count ?? 0);
    // 不經 trashCapture
    expect(tracker.getLastAutoTrash()).toBeNull();
    expect(h.state.fileExtras[PID]?.trash).toBeUndefined();

    expect(h.undo().status).toBe('restored');
    expect(h.sent.some((a) => a.type === 'note-large')).toBe(false);
    expect(todayRow(h.state)?.paste_large_count).toBe(rowBefore?.paste_large_count ?? 0);
    expect(todayRow(h.state)?.delete_large_count).toBe(rowBefore?.delete_large_count ?? 0);
  });

  it('標點字數差不灌水／不扣減今日字數；但排版前尚未暫存的真正新打字仍計入今日字數', () => {
    // c1 原文 17 字（含 ... 與 --），轉成 ……（少 1 字）與 ──（少 0 或多 1），全書亦然
    let state = baseState();
    const initialWords = 100;
    state = reduce(state, {
      type: 'commit-text',
      projectId: PID,
      nodeId: 'c2',
      text: '一'.repeat(initialWords),
    });
    const beforeToday = todayRow(state)?.word_count;
    expect(beforeToday).toBe(initialWords);

    const h = harness(state, { currentId: 'c1' });
    // 使用者在寫作框剛打了 5 個新字，尚未停筆暫存，此時按「全書統一標點」
    const newTyped = '新打五個字';
    const preLive = `${contentOf(state, 'c1')!}${newTyped}`;
    h.typeLive(preLive);

    const outcome = h.format('unify-punctuation', 'book');
    expect(outcome.status).toBe('applied');

    // 1) 今日字數 = 原本 100 + 新打的 5 字 = 105（不受 ... -> …… 等標點字數差影響）
    expect(todayRow(h.state)?.word_count).toBe(initialWords + countWords(newTyped));

    // 2) 本章字數與全書字數依實際正文重算，保持精確
    const proj = h.state.projects.find((p) => p.id === PID)!;
    const expectedTitleWords =
      countWords('【範例】第一卷') +
      countWords('【範例】第一章') +
      countWords('【範例】第一幕') +
      countWords('【範例】第二幕') +
      countWords('【範例】第二章') +
      countWords('【範例】第三章');
    expect(countBookWords(proj.nodes)).toBe(
      expectedTitleWords +
        countWords(contentOf(h.state, 'c1')!) +
        countWords(contentOf(h.state, 's1')!) +
        countWords(contentOf(h.state, 's2')!) +
        countWords(contentOf(h.state, 'c2')!) +
        countWords(contentOf(h.state, 'c3')!),
    );

    // 3) 按「復原」後，syncCurrent 會先送出 commit-text 清空 state.formatUndo，
    //    executeUndo 必須明確傳入 { countForToday: false } 給 undoOthers，才不會因還原其他章而改動今日字數
    const undoRes = h.undo();
    expect(undoRes.status).toBe('restored');
    expect(todayRow(h.state)?.word_count).toBe(initialWords + countWords(newTyped));
  });

  it('統一標點後中文句中半形標點數歸零，與 WO-76 半形標點提醒一致', () => {
    const raw = '他說,這樣做真的好嗎?對!';
    expect(findHalfWidthMarks(raw).length).toBeGreaterThan(0);
    const unified = unifyPunctuation(raw).text;
    expect(findHalfWidthMarks(unified).length).toBe(0);
  });
});

describe('WO-139 用字合規、元件渲染與原始碼防護', () => {
  it('punctCopy.ts 全部暫定用字逐字對齊技術規劃第 5 節、四位數加千分位且無禁用詞', () => {
    expect(punctCopy.PUNCT_KIND_LABEL).toBe('統一標點');
    expect(punctCopy.PUNCT_CONFIRM_TITLE).toBe('要統一標點嗎？');
    expect(punctCopy.punctConfirmSentence('chapter', 12)).toBe(
      '這一章會統一 12 處標點，只改正文，改完可以復原。',
    );
    expect(punctCopy.punctConfirmSentence('book', 1234)).toBe(
      '全書會統一 1,234 處標點，只改正文，改完可以復原。',
    );
    expect(punctCopy.PUNCT_CONFIRM_START).toBe('統一標點');
    expect(punctCopy.punctAlreadyUnifiedToast('chapter')).toBe('這一章的標點已經是統一的了。');
    expect(punctCopy.punctAlreadyUnifiedToast('book')).toBe('全書的標點已經是統一的了。');
    expect(punctCopy.punctDoneTitle(12)).toBe('已統一 12 處標點');
    expect(punctCopy.punctDoneTitle(1234)).toBe('已統一 1,234 處標點');
    expect(punctCopy.PUNCT_UNDONE_TOAST).toBe('已回到統一標點前的樣子。');

    const texts: string[] = [
      punctCopy.PUNCT_KIND_LABEL,
      punctCopy.PUNCT_CONFIRM_TITLE,
      punctCopy.punctConfirmSentence('chapter', 1234),
      punctCopy.punctConfirmSentence('book', 1234),
      punctCopy.PUNCT_CONFIRM_START,
      punctCopy.punctAlreadyUnifiedToast('chapter'),
      punctCopy.punctAlreadyUnifiedToast('book'),
      punctCopy.punctDoneTitle(1234),
      punctCopy.PUNCT_UNDONE_TOAST,
    ];
    for (const text of texts) {
      expect(text).not.toMatch(SIMPLIFIED_CHARS);
      expect(text).not.toContain('您');
      expect(text).not.toContain(FORBIDDEN_PHRASE);
      expect(text).not.toContain('彈窗');
    }
    for (const key of Object.keys(punctCopy)) {
      expect(key).not.toMatch(/^FORMAT_|^format/);
    }
  });

  it('FormatLayer 與 FormatNotice 呈現統一標點選項、確認視窗處數與完成通知', () => {
    const baseStub: FormatTools = {
      flow: null,
      isOpen: true,
      open: () => undefined,
      close: () => undefined,
      dismissMenu: () => undefined,
      confirm: () => undefined,
      undo: () => undefined,
      dismissNotice: () => undefined,
      hasSnapshot: false,
      snapshot: null,
      pick: {
        menu: () => undefined,
        kind: () => undefined,
        scope: () => undefined,
        back: () => undefined,
      },
    };

    // 1. 方式選單露出「統一標點」第 4 個選項
    const kindHtml = renderToStaticMarkup(
      createElement(FormatLayer, {
        tools: {
          ...baseStub,
          flow: { step: 'kind', kind: null, scope: null, menuPos: { left: 100, top: 64 } },
        },
      }),
    );
    expect(kindHtml).toContain('data-testid="format-kind-unify-punctuation"');
    expect(kindHtml).toContain(punctCopy.PUNCT_KIND_LABEL);

    // 2. 確認視窗（unify-punctuation + 全書 1,234 處）
    const confirmHtml = renderToStaticMarkup(
      createElement(FormatLayer, {
        tools: {
          ...baseStub,
          flow: {
            step: 'confirm',
            kind: 'unify-punctuation',
            scope: 'book',
            menuPos: { left: 100, top: 64 },
            estimatedCount: 1234,
          },
        },
      }),
    );
    expect(confirmHtml).toContain(punctCopy.PUNCT_CONFIRM_TITLE);
    expect(confirmHtml).toContain('全書會統一 1,234 處標點，只改正文，改完可以復原。');
    expect(confirmHtml).toContain(FORMAT_CONFIRM_BOOK_NOTE);
    expect(confirmHtml).toContain(FORMAT_UNDO_WARNING);
    expect(confirmHtml).toContain(punctCopy.PUNCT_CONFIRM_START);

    // 3. 確認視窗（既有三項維持原貌）
    const legacyConfirmHtml = renderToStaticMarkup(
      createElement(FormatLayer, {
        tools: {
          ...baseStub,
          flow: {
            step: 'confirm',
            kind: 'indent',
            scope: 'chapter',
            menuPos: { left: 100, top: 64 },
          },
        },
      }),
    );
    expect(legacyConfirmHtml).toContain(FORMAT_CONFIRM_TITLE);
    expect(legacyConfirmHtml).toContain(FORMAT_START);

    // 4. 完成提示（unify-punctuation vs 既有三項）
    const punctNoticeHtml = renderToStaticMarkup(
      createElement(FormatNotice, {
        tools: {
          ...baseStub,
          hasSnapshot: true,
          snapshot: {
            projectId: PID,
            kind: 'unify-punctuation',
            scope: 'chapter',
            replacementCount: 12,
            entries: [{ nodeId: 'c1', before: 'a', after: 'b' }],
          },
        },
      }),
    );
    expect(punctNoticeHtml).toContain('已統一 12 處標點');
    expect(punctNoticeHtml).toContain(FORMAT_UNDO_BUTTON);
    expect(punctNoticeHtml).toContain(FORMAT_NOTICE_CLOSE);

    const legacyNoticeHtml = renderToStaticMarkup(
      createElement(FormatNotice, {
        tools: {
          ...baseStub,
          hasSnapshot: true,
          snapshot: {
            projectId: PID,
            kind: 'indent',
            scope: 'chapter',
            entries: [{ nodeId: 'c1', before: 'a', after: 'b' }],
          },
        },
      }),
    );
    expect(legacyNoticeHtml).toContain(FORMAT_DONE);
  });

  it('改動元件／流程無硬寫中文且不碰 noteLarge／clipboard／beforeinput／.value =，且 EditorPane 已接上 halfWidth.rescan', () => {
    for (const path of [
      '../components/FormatTools.tsx',
      './formatFlow.ts',
      './formatScope.ts',
      './formatText.ts',
      './unifyPunctuation.ts',
    ]) {
      const src = code(read(path));
      expect(src, path).not.toMatch(/noteLarge|note-large|clipboard|beforeinput|dispatchEvent|InputEvent|insertFromPaste/i);
      expect(src, path).not.toMatch(/\.value\s*=/);
    }
    for (const path of ['../components/FormatTools.tsx', './formatFlow.ts', './formatScope.ts']) {
      expect(code(read(path)), path).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    }
    expect(read('../components/FormatTools.tsx')).toMatch(/from '\.\.\/copy\/punctCopy'/);
    expect(read('../screens/HalfWidthReminder.tsx')).toMatch(/rescan:\s*\(\)\s*=>\s*void/);
    expect(read('../screens/EditorPane.tsx')).toMatch(/onAfterApplyOrUndo:\s*\(\)\s*=>\s*halfWidth\.rescan\(\)/);
  });
});
