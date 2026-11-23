import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { LayoutProvider, type LayoutMode, type WideColumns } from '../layout';
import { createState, reduce, SampleProvider } from '../state/sampleStore';
import { firstFileNode } from '../state/testing/firstFile';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { EditorPane } from './EditorPane';

/** WO-117：底下進度條有顯示時，頁首不再重複今天字數與已暫存。全部使用程式產生的假資料。 */
const chapter: ChapterNode = {
  id: 'ch-fake-wo117',
  type: 'file',
  title: '【範例】第一章　假資料',
  content: '【範例】這是程式產生的假正文。',
  progress: 'Draft',
  expanded: true,
};

function render(mode: LayoutMode, wide: WideColumns | null, focusMode: boolean): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState(new Date(), { withDemoStats: true }) },
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wide, initialPanels: { focusMode } },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/fog/write/${chapter.id}`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/write/:chapterId',
              element: createElement(EditorPane, { projectId: 'fog', chapter }),
            }),
          ),
        ),
      ),
    ),
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const global = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const focusCss = readFileSync(new URL('./focusMode.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');

const layouts: Array<[string, LayoutMode, WideColumns | null]> = [
  ['390 直拿', 'phone-portrait', null],
  ['844×390 手機橫拿', 'phone-landscape', null],
  ['768 medium', 'medium', null],
  ['1024 wide', 'wide', 'one-side'],
  ['1440 wide', 'wide', 'both'],
];

describe('WO-117：各版面標記——頁首不再有今天字數與暫存', () => {
  for (const [name, mode, wide] of layouts) {
    for (const focus of [false, true]) {
      it(`${name}${focus ? '專注' : '一般'}：頁首無 topbar-words／topbar-save，各只有一份來源`, () => {
        const html = render(mode, wide, focus);
        expect(html).not.toContain('data-testid="topbar-words"');
        expect(html).not.toContain('data-testid="topbar-save"');
        // 搜尋、專注模式、看卡片等頁首按鈕與頁首統計容器（半形提醒）照舊
        expect(html).toContain('data-testid="topbar-stats"');
        expect(html).toContain('data-testid="toggle-cards-topbar"');
        // 底列恆產生一份（專注／橫拿打字顯示；一般由 CSS display:none 移出無障礙樹）
        expect(count(html, 'data-testid="focus-bottom-status"')).toBe(1);
        // 底下狀態區（一般顯示）的今天字數朗讀句與暫存各一份
        expect(count(html, 'data-testid="save-status"')).toBe(1);
        expect(count(html, 'role="progressbar"')).toBe(1);
        // 朗讀原句不改：進度條朗讀句只出現在進度條
        expect(count(html, '今天寫了 300 字，每日目標 1,000 字')).toBeLessThanOrEqual(2);
      });
    }
  }

  it('底列用既有用字：「今天 N／目標 字」「·」與暫存狀態', () => {
    const html = render('phone-portrait', null, true);
    expect(html).toContain(
      '<div class="focus-bottom-status" data-testid="focus-bottom-status"><span>今天 300／1,000 字</span><span class="focus-status-sep">·</span>',
    );
  });
});

describe('WO-117：CSS 顯示規則（每個情況至少一份、不重複）', () => {
  it('頁首統計預設隱藏，寬版僅留半形提醒；擠位規則不再藏任何一項', () => {
    expect(global).toMatch(/\.topbar-stats\s*\{\s*display:\s*none;\s*\}/);
    expect(focusCss).not.toContain('.topbar-words');
    expect(focusCss).not.toContain('.topbar-save');
    expect(global).not.toContain('.topbar-words');
    expect(global).not.toContain('.topbar-save');
    expect(source).toContain('HalfWidthBadge controller={halfWidth} expandable');
  });

  it('專注底列預設 display:none（移出無障礙樹，非只透明）；一般模式不會與底下那組同時可讀', () => {
    expect(global).toMatch(/\.focus-bottom-status\s*\{\s*display:\s*none;\s*\}/);
    expect(global).toMatch(/html\[data-focus-mode="true"\]\s+\.editor-status[\s\S]*?display:\s*none\s*!important/);
    expect(focusCss).toMatch(/html\[data-focus-mode="true"\]\s+\.editor-status[\s\S]*?display:\s*none\s*!important/);
  });

  it('專注模式（含手機直拿／橫拿）顯示底列並避開安全區；底區同時收起，不重複', () => {
    expect(global).toMatch(/html\[data-focus-mode="true"\]\s+\.focus-bottom-status,\s*html\.landscape-writing\s+\.focus-bottom-status\s*\{[^}]*display:\s*flex/);
    expect(focusCss).toMatch(/phone-portrait"\]\s+\.focus-bottom-status[\s\S]*?safe-area-inset-bottom/);
    expect(focusCss).toMatch(/phone-landscape"\]\s+\.focus-bottom-status[\s\S]*?padding:\s*0 64px/);
    expect(focusCss).toMatch(/phone-portrait"\]\s+\.editor[\s\S]*?padding-bottom/);
  });

  it('底列跟隨可見區域（--vv-height／--vv-offset），鍵盤開啟時不被遮住', () => {
    const rule = global.match(/html\[data-focus-mode="true"\]\s+\.focus-bottom-status,\s*html\.landscape-writing\s+\.focus-bottom-status\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule![1];
    expect(body).toMatch(/top:\s*calc\(var\(--vv-offset\)\s*\+\s*var\(--vv-height\)/);
    expect(body).toContain('safe-area-inset-bottom');
    expect(body).toMatch(/bottom:\s*auto/);
    expect(body).toMatch(/translateY\(-100%\)/);
    // 手機專注／橫拿打字不得再只依版面底部定位
    const phone = focusCss.match(/phone-portrait"\]\s+\.focus-bottom-status,[\s\S]*?\{([^}]*)\}/);
    expect(phone).not.toBeNull();
    expect(phone![1]).not.toMatch(/(^|[\s;])bottom:/);
    expect(phone![1]).toContain('--focus-status-gap');
    // 中等／寬版同樣跟隨可見區域
    for (const layout of ['medium', 'wide']) {
      const m = focusCss.match(new RegExp(`data-layout="${layout}"\\]\\s+\\.focus-bottom-status\\s*\\{([^}]*)\\}`));
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(/var\(--vv-offset\)\s*\+\s*var\(--vv-height\)/);
      expect(m![1]).not.toMatch(/(^|[\s;])bottom:\s*\d/);
    }
  });

  it('手機橫拿打字：頁首與完整底區收合，由 .focus-bottom-status 顯示兩項，不另顯示精簡進度條', () => {
    expect(global).toMatch(/html\.landscape-writing \.editor \.topbar,\s*html\.landscape-writing \.editor-status\s*\{\s*display:\s*none;/);
    expect(focusCss).toMatch(/html\.landscape-writing\[data-layout\]\s+\.focus-bottom-status\s*\{[^}]*display:\s*flex/);
  });

  it('鍵盤精簡模式：保留精簡今天字數＋一份暫存，不再整列隱藏；本章字數收起', () => {
    expect(global).not.toMatch(/\.editor\.is-keyboard \.status-row\s*\{\s*display:\s*none/);
    expect(global).toMatch(/\.editor\.is-keyboard \.status-cluster\s*\{\s*display:\s*none/);
    expect(global).toMatch(/\.editor\.is-keyboard \.status-row\s*\{[^}]*justify-content:\s*flex-end/);
    // 暫存狀態來源仍是 save-status（範例書於底列渲染，非範例書由頁首角落標示單一呈現）
    expect(source).toContain('data-testid="save-status"');
    expect(source).toContain("navigate(`/p/${projectId}/files`)");
  });

  it('WO-132 嚴-7：非範例書只在頁首角落顯示單一存檔狀態，底列不重複渲染 save-status，專注底列採同一說法', () => {
    const nowMs = Date.parse('2026-11-23T17:10:00Z');
    const id = 'p-1763917800000';
    let s = createState(new Date(nowMs));
    s = reduce(s, { type: 'add-project', id, title: '【範例】單一狀態檢查', shape: 'novel', startedMs: nowMs });
    s = reduce(s, { type: 'focus-project', id });
    const ch = firstFileNode(s.projects.find((p) => p.id === id)!.nodes)!;
    s = reduce(s, { type: 'commit-text', projectId: id, nodeId: ch.id, text: '【範例】測試內文' });
    const updatedCh = firstFileNode(s.projects.find((p) => p.id === id)!.nodes)!;

    const html = renderToStaticMarkup(
      createElement(
        SampleProvider,
        { initialState: s },
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait', initialWideColumns: null, initialPanels: { focusMode: false } },
          createElement(
            MemoryRouter,
            { initialEntries: [`/p/${id}/write/${updatedCh.id}`] },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/p/:projectId/write/:chapterId',
                element: createElement(EditorPane, { projectId: id, chapter: updatedCh }),
              }),
            ),
          ),
        ),
      ),
    );
    expect(count(html, 'data-testid="save-header-status"')).toBe(1);
    expect(count(html, 'data-testid="save-status"')).toBe(0);
    expect(html).not.toContain('今天還沒另存');
    expect(html).toContain('還沒存成檔案');
  });
});
