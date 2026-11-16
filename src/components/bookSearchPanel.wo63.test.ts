import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACK_TO_RESULTS,
  BACK_TO_RESULTS_ARIA,
  BACK_TO_WRITING_ARIA,
  BODY_ONLY_NOTE,
  BOOK_SEARCH_OPEN_ARIA,
  BOOK_SEARCH_TITLE,
  FIND_REPLACE_TOGGLE,
  REPLACE_ALL,
  REPLACE_ONE,
  REPLACE_WITH_LABEL,
  REPLACED_MARK,
  SCOPE_BOOK,
  SCOPE_CHAPTER,
  UNDO_LAST_REPLACE,
  confirmCardsNote,
  confirmSummary,
  hitPositionLabel,
  replaceDoneMessage,
  searchSummary,
  undoBarMessage,
} from '../copy/bookSearchCopy';
import { findNode, type ChapterNode } from '../data/demo';
import { findInBook } from '../domain/bookSearch';
import { LayoutProvider, type LayoutMode, type WideColumns } from '../layout';
import {
  getProjectCards,
  manuscriptSnapshotParts,
  reduce,
  SampleProvider,
  type SampleState,
} from '../state/sampleStore';
import { WriteScreen } from '../screens/WriteScreen';
import {
  chapterCount,
  exampleCardTitle,
  groupHits,
  indexOfRef,
  marksFromRecord,
  nextAfterReplace,
  nodeOrder,
  planReplaceAll,
  planReplaceOne,
  planUndo,
  revertEntry,
  searchBody,
  withLiveText,
  type BodyCommit,
} from './BookSearchPanelModel';
import { demoFixtureState } from '../state/testing/sampleFixture';

const NOON = new Date('2026-11-15T04:00:00Z');

// 固定「今天」：reducer 內的 new Date() 要與 demoFixtureState(NOON) 同一天，測試才不會因執行日期而失敗。
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});
const Q = '燈塔';
const R = '燈臺';

function fog(state: SampleState) {
  return state.projects.find((item) => item.id === 'fog')!;
}

/** 與寫作頁相同：每一章正文都走既有 commit-text。 */
function commitAll(state: SampleState, commits: readonly BodyCommit[]): SampleState {
  let next = state;
  for (const commit of commits) {
    next = reduce(next, { type: 'commit-text', projectId: 'fog', nodeId: commit.nodeId, text: commit.text });
  }
  return next;
}

function bodyOf(state: SampleState, nodeId: string): string {
  return findNode(fog(state).nodes, nodeId)?.content ?? '';
}

function renderWrite(mode: LayoutMode, wideColumns: WideColumns | null = null, chapterId = 'ch-1'): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns, initialPanels: mode === 'wide' ? { left: true } : {} },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/fog/write/${chapterId}`] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/p/:projectId/write/:chapterId?', element: createElement(WriteScreen) }),
          ),
        ),
      ),
    ),
  );
}

const css = readFileSync(new URL('./BookSearchPanel.css', import.meta.url), 'utf8');
const pos = (html: string, needle: string) => html.indexOf(needle);

describe('WO-63：四種版面的搜尋入口', () => {
  it('WO-63：手機直拿入口在寫作頁頁首右上（44×44 放大鏡），在看卡片左邊；專注鈕仍在拇指區第三顆（WO-81：打字中另顯示頁首既有入口）', () => {
    const html = renderWrite('phone-portrait');
    const search = pos(html, 'data-testid="search-open-topbar"');
    expect(search).toBeGreaterThan(pos(html, '<h1>'));
    expect(search).toBeLessThan(pos(html, 'data-testid="toggle-cards-topbar"'));
    expect(html).toContain(`aria-label="${BOOK_SEARCH_OPEN_ARIA}"`);
    // 拇指區仍是 目錄、看卡片、專注模式 三顆（收鍵盤後入口）；WO-81：打字中另顯示既有頁首入口，順序為放大鏡、專注模式、看卡片
    expect(search).toBeLessThan(pos(html, 'data-testid="enter-focus-mode"'));
    expect(pos(html, 'data-testid="enter-focus-mode"')).toBeLessThan(pos(html, 'data-testid="toggle-cards-topbar"'));
    const thumb = html.slice(pos(html, 'data-testid="thumb-bar"'));
    const order = ['thumb-tree-button', 'thumb-cards-button', 'thumb-focus-button'].map((id) => thumb.indexOf(id));
    expect(order.every((value, i) => value > 0 && (i === 0 || value > order[i - 1]!))).toBe(true);
    expect(css).toMatch(/html\[data-layout="phone-portrait"\] \.search-open-button,[\s\S]*?width: 44px;\s*height: 44px;/);
  });

  it('WO-63：手機橫拿入口是正文左側第二顆浮動鈕（目錄下面），44×44，頁首不放', () => {
    const html = renderWrite('phone-landscape');
    const tree = pos(html, 'data-testid="toggle-tree-floating"');
    const search = pos(html, 'data-testid="search-open-landscape"');
    expect(search).toBeGreaterThan(tree);
    expect(search).toBeLessThan(pos(html, 'data-testid="toggle-cards-landscape"'));
    const rule = css.slice(css.indexOf('html[data-layout="phone-landscape"] .landscape-search-trigger {'));
    expect(rule).toMatch(/left: 12px;\s*top: calc\(50% \+ 28px\);\s*width: 44px;\s*height: 44px;/);
    // 頁首放大鏡在手機橫拿不顯示（預設 display: none，只開直拿、中等、寬版）
    expect(css).not.toMatch(/html\[data-layout="phone-landscape"\] \.search-open-button/);
  });

  it('WO-63：中等入口是頁首放大鏡，在「專注模式」「看卡片」左邊', () => {
    const html = renderWrite('medium');
    const search = pos(html, 'data-testid="search-open-topbar"');
    const focus = pos(html, 'data-testid="enter-focus-mode"');
    const cards = pos(html, 'data-testid="toggle-cards-topbar"');
    expect(search).toBeGreaterThan(0);
    expect(search).toBeLessThan(focus);
    expect(focus).toBeLessThan(cards);
    expect(css).toMatch(/html\[data-layout="medium"\] \.write-layout\.is-searching \.editor-pane \{\s*margin-right: 380px;/);
  });

  it('WO-63：寬版左欄頂端有「目錄｜搜尋」切換，也可由頁首放大鏡進入', () => {
    const html = renderWrite('wide', 'both');
    expect(html).toContain('data-testid="tree-search-tabs"');
    expect(pos(html, 'data-testid="tree-tab-tree"')).toBeLessThan(pos(html, 'data-testid="tree-tab-search"'));
    expect(html).toMatch(/data-testid="tree-tab-tree"[^>]*>[\s\S]*?目錄<\/button>/);
    expect(html).toMatch(/data-testid="tree-tab-search"[^>]*>[\s\S]*?搜尋<\/button>/);
    expect(pos(html, 'data-testid="search-open-topbar"')).toBeLessThan(pos(html, 'data-testid="enter-focus-mode"'));
    expect(css).toMatch(/html\[data-layout="wide"\] \.tree-search-tabs \{\s*display: flex;/);
  });

  it('WO-63：平常不顯示搜尋畫面；四版的專注模式原入口都還在', () => {
    for (const mode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as LayoutMode[]) {
      const html = renderWrite(mode, mode === 'wide' ? 'both' : null);
      expect(html).not.toContain('data-testid="book-search-panel"');
      expect(html).toContain('data-testid="enter-focus-mode"');
      expect(html).toContain('data-testid="thumb-focus-button"');
      expect(html).toContain('data-testid="toggle-focus-landscape"');
    }
  });
});

describe('WO-63：取代只改正文，卡片逐字不變', () => {
  it('WO-63：取代全部後正文符合預期，資料集卡片（含被搜尋的同字詞）全部內容逐字不變，存檔用的卡片也不變', () => {
    const state0 = demoFixtureState(NOON);
    const cards0 = JSON.stringify(getProjectCards(state0, 'fog'));
    const saved0 = JSON.stringify(manuscriptSnapshotParts(state0, fog(state0)).cards);
    // 範例卡片確實含「燈塔」，不是拿空卡片當保護證據
    const withQuery = getProjectCards(state0, 'fog').filter((card) => `${card.title}${card.content}`.includes(Q));
    expect(withQuery.length).toBeGreaterThanOrEqual(3);

    const plan = planReplaceAll(fog(state0).nodes, Q, R, 'book', 'ch-1', 1)!;
    expect(plan.record.total).toBe(10);
    expect(plan.record.chapters).toBe(6);
    const state1 = commitAll(state0, plan.commits);

    expect(findInBook(fog(state1).nodes, Q)).toHaveLength(0);
    expect(findInBook(fog(state1).nodes, R)).toHaveLength(10);
    expect(bodyOf(state1, 'ch-1')).toBe(bodyOf(state0, 'ch-1').split(Q).join(R));
    expect(JSON.stringify(getProjectCards(state1, 'fog'))).toBe(cards0);
    expect(JSON.stringify(manuscriptSnapshotParts(state1, fog(state1)).cards)).toBe(saved0);
    expect(fog(state1).cards).toBe(fog(state0).cards);
  });

  it('WO-63：「這一章」只改這一章（含其下的幕），其他章與卡片不動', () => {
    const state0 = demoFixtureState(NOON);
    const plan = planReplaceAll(fog(state0).nodes, Q, R, 'chapter', 'ch-2', 2)!;
    expect(plan.commits.map((commit) => commit.nodeId)).toEqual(['ch-2', 'sc-1', 'sc-2']);
    const state1 = commitAll(state0, plan.commits);
    expect(bodyOf(state1, 'ch-1')).toBe(bodyOf(state0, 'ch-1'));
    expect(JSON.stringify(getProjectCards(state1, 'fog'))).toBe(JSON.stringify(getProjectCards(state0, 'fog')));
  });

  it('WO-63：取代走 commit-text，本章字數照既有算法更新（同字數不增減，多一字加一）', () => {
    const state0 = demoFixtureState(NOON);
    const today0 = state0.schedule.open?.wordCount ?? 0;
    const same = commitAll(state0, planReplaceAll(fog(state0).nodes, Q, R, 'book', null, 1)!.commits);
    expect(same.schedule.open?.wordCount ?? 0).toBe(today0);
    const longer = commitAll(state0, planReplaceAll(fog(state0).nodes, Q, '老燈塔', 'book', null, 2)!.commits);
    expect((longer.schedule.open?.wordCount ?? 0) - today0).toBe(10);
  });
});

describe('WO-63：復原上次取代', () => {
  it('WO-63：只還原該次正文，不還原先前的取代這處，也不碰卡片', () => {
    const state0 = demoFixtureState(NOON);
    const cards0 = JSON.stringify(getProjectCards(state0, 'fog'));
    const one = planReplaceOne(fog(state0).nodes, { nodeId: 'ch-1', ordinal: 0 }, Q, R, 1)!;
    const state1 = commitAll(state0, one.commits);
    const all = planReplaceAll(fog(state1).nodes, Q, R, 'book', null, 2)!;
    expect(all.record.total).toBe(9);
    const state2 = commitAll(state1, all.commits);
    const state3 = commitAll(state2, planUndo(fog(state2).nodes, all.record));
    expect(findInBook(fog(state3).nodes, Q)).toHaveLength(9);
    expect(bodyOf(state3, 'ch-1')).toBe(bodyOf(state1, 'ch-1'));
    expect(bodyOf(state3, 'ch-1')).not.toBe(bodyOf(state0, 'ch-1'));
    expect(JSON.stringify(getProjectCards(state3, 'fog'))).toBe(cards0);
  });

  it('WO-63：取代後又在正文打了字，復原只換回沒被碰到的那幾處，新打的字留著', () => {
    const before = '甲燈塔乙燈塔丙燈塔丁';
    const plan = planReplaceAll([{ id: 'c', type: 'file', title: '第一章', content: before }], Q, R, 'book', null, 1)!;
    const after = plan.record.entries[0]!.after;
    expect(after).toBe('甲燈臺乙燈臺丙燈臺丁');
    expect(revertEntry(after, plan.record.entries[0]!, R)).toBe(before);
    const typed = `${after.slice(0, 5)}新字${after.slice(5)}`;
    expect(revertEntry(typed, plan.record.entries[0]!, R)).toBe('甲燈塔乙燈新字臺丙燈塔丁');
  });

  it('WO-63：復原紀錄只記受影響章節的正文，不含卡片或整本專案', () => {
    const state0 = demoFixtureState(NOON);
    const plan = planReplaceAll(fog(state0).nodes, Q, R, 'chapter', 'ch-3', 1)!;
    expect(Object.keys(plan.record).sort()).toEqual(['chapters', 'entries', 'id', 'query', 'replacement', 'total']);
    expect(plan.record.entries.map((entry) => entry.nodeId)).toEqual(['ch-3']);
    expect(Object.keys(plan.record.entries[0]!).sort()).toEqual(['after', 'before', 'nodeId', 'spots', 'title']);
  });
});

describe('WO-63：取代這處與結果分組', () => {
  it('WO-63：取代這處只改那一處、留下「已取代」標記，目前結果移到下一筆', () => {
    const state0 = demoFixtureState(NOON);
    const nodes = fog(state0).nodes;
    const plan = planReplaceOne(nodes, { nodeId: 'ch-1', ordinal: 1 }, Q, R, 1)!;
    const state1 = commitAll(state0, plan.commits);
    const hitsAfter = searchBody(fog(state1).nodes, Q, 'book', null);
    expect(hitsAfter).toHaveLength(9);
    const spot = plan.record.entries[0]!.spots[0]!;
    const next = nextAfterReplace(hitsAfter, nodeOrder(nodes), 'ch-1', spot.start + spot.length);
    // 下一筆是第一章原本的第 3 處（現在是第一章第 2 處），不是停在已改的那筆
    expect(next).toEqual({ nodeId: 'ch-1', ordinal: 1 });
    expect(hitsAfter[indexOfRef(hitsAfter, next)]!.start).toBeGreaterThan(spot.start);
    const marks = marksFromRecord(plan.record);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ nodeId: 'ch-1', original: Q, replacement: R });
  });

  it('WO-63：這一章最後一處取代後，焦點移到下一章第一處', () => {
    const state0 = demoFixtureState(NOON);
    const nodes = fog(state0).nodes;
    const plan = planReplaceOne(nodes, { nodeId: 'ch-1', ordinal: 3 }, Q, R, 1)!;
    const after = commitAll(state0, plan.commits);
    const hitsAfter = searchBody(fog(after).nodes, Q, 'book', null);
    const spot = plan.record.entries[0]!.spots[0]!;
    expect(nextAfterReplace(hitsAfter, nodeOrder(nodes), 'ch-1', spot.start + spot.length)).toEqual({ nodeId: 'ch-2', ordinal: 0 });
  });

  it('WO-63：結果依章分組並標處數；正文框還沒寫回的字也算進去', () => {
    const state0 = demoFixtureState(NOON);
    const hits = searchBody(fog(state0).nodes, Q, 'book', null);
    const groups = groupHits(hits);
    expect(groups.map((group) => [group.title, group.hits.length])).toEqual([
      ['第一章　來信', 4],
      ['第二章　燈塔', 2],
      ['幕 1　上坡', 1],
      ['幕 2　守塔人', 1],
      ['第三章　舊照片', 1],
      ['第五章　退潮', 1],
    ]);
    expect(chapterCount(hits)).toBe(6);
    const live = withLiveText(fog(state0).nodes as ChapterNode[], { chapterId: 'ch-4', text: '【範例】燈塔' });
    expect(searchBody(live, Q, 'book', null)).toHaveLength(11);
    expect(searchBody(fog(state0).nodes, Q, 'chapter', null)).toHaveLength(0);
  });

  it('WO-63：確認視窗舉例的卡片是含這個字的範例卡片', () => {
    const state0 = demoFixtureState(NOON);
    expect(exampleCardTitle(getProjectCards(state0, 'fog'), Q)).toBe('【範例】核心主線：燈塔熄滅之夜');
    expect(exampleCardTitle(getProjectCards(state0, 'fog'), '不存在的字')).toBeNull();
  });
});

describe('WO-63：文案、朗讀與千分位', () => {
  it('WO-63：新詞審稿第 1–14 列定案文字', () => {
    expect(BOOK_SEARCH_TITLE).toBe('全書搜尋');
    expect(FIND_REPLACE_TOGGLE).toBe('找與取代');
    expect(REPLACE_WITH_LABEL).toBe('取代成');
    expect([SCOPE_BOOK, SCOPE_CHAPTER]).toEqual(['全書', '這一章']);
    expect(REPLACE_ONE).toBe('取代這處');
    expect(REPLACE_ALL).toBe('取代全部');
    expect(REPLACED_MARK).toBe('已取代');
    expect(UNDO_LAST_REPLACE).toBe('復原上次取代');
    expect(replaceDoneMessage(12, 4)).toBe('已取代 12 處（4 章）');
    expect(searchSummary(12, 4)).toBe('共 12 處，在 4 章');
    expect(confirmSummary(12, 4)).toBe('共 12 處，分布在 4 章');
    expect(BACK_TO_RESULTS).toBe('回結果');
    expect(BACK_TO_RESULTS_ARIA).toBe('返回搜尋結果');
    expect(BACK_TO_WRITING_ARIA).toBe('返回寫作');
    expect(BODY_ONLY_NOTE).toBe('只改正文，資料集的卡片不會改');
  });

  it('WO-63：提示與黃框句尾不加句號；確認視窗舉例卡片', () => {
    for (const line of [BODY_ONLY_NOTE, replaceDoneMessage(3, 1), confirmCardsNote('【範例】老鄭'), undoBarMessage(3, '老鄭', '老陳')]) {
      expect(line.endsWith('。')).toBe(false);
    }
    expect(confirmCardsNote('【範例】老鄭')).toBe('只改正文，資料集的卡片（例如「【範例】老鄭」）不會改');
    expect(confirmCardsNote(null)).toBe(BODY_ONLY_NOTE);
  });

  it('WO-63：四位數以上加千分位', () => {
    expect(replaceDoneMessage(1024, 4)).toBe('已取代 1,024 處（4 章）');
    expect(searchSummary(12345, 1200)).toBe('共 12,345 處，在 1,200 章');
    expect(confirmSummary(1000, 4)).toBe('共 1,000 處，分布在 4 章');
    expect(hitPositionLabel(2, 12)).toBe('第 2／12 處');
    expect(hitPositionLabel(1500, 2000)).toBe('第 1,500／2,000 處');
    expect(undoBarMessage(999, 'a', 'b')).toBe('已把 999 處「a」換成「b」');
  });

  it('WO-63：本張新增的畫面、文案、樣式與檢查腳本沒有簡體字，也不寫「假資料」', () => {
    const files = [
      '../copy/bookSearchCopy.ts',
      './BookSearchPanel.tsx',
      './BookSearchPanelParts.tsx',
      './BookSearchPanelState.ts',
      './BookSearchPanelModel.ts',
      './BookSearchPanel.css',
      '../../qa/全書搜尋/run.mjs',
    ];
    const simplified = /[这处换页书复还时们来为会写开关选认读结无与应点击统计编辑删设资记录发现进动图标说视级链输题钮键盘当筛区实际简万两个么样从对头边间长门问]/;
    for (const rel of files) {
      const content = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const hit = content.match(simplified);
      expect(hit?.[0] ?? null, rel).toBeNull();
      expect(content.includes('搜索'), rel).toBe(false);
      expect(content.includes('假資料'), rel).toBe(false);
    }
  });
});
