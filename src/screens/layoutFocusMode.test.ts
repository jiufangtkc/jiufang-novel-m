import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  FOCUS_MODE_ENTER_BUTTON,
  FOCUS_MODE_EXIT_BUTTON,
} from '../copy/userFacing';
import {
  FOCUS_MODE_LANDSCAPE_ENTER_ARIA,
  FOCUS_MODE_THUMB_ENTER_LABEL,
} from '../copy/focusModeCopy';
import type { ChapterNode } from '../data/demo';
import {
  createInitialPanelsState,
  enterFocusMode,
  exitFocusMode,
  INITIAL_LANDSCAPE_EXIT_STATE,
  LANDSCAPE_EXIT_TIMEOUT_MS,
  landscapeExitReducer,
  LayoutProvider,
  type LayoutMode,
  type SidePanelsState,
  type WideColumns,
} from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { EditorPane } from './EditorPane';
import { Workspace } from './Workspace';
import { WriteScreen } from './WriteScreen';

const sampleChapter: ChapterNode = {
  id: 'ch-sample-wo62',
  type: 'file',
  title: '【範例】第八章　站台燈火',
  content: '【範例】列車緩緩駛入地下道，窗外的燈管一閃一閃。',
  progress: 'Draft',
  expanded: true,
};

function renderEditorWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  panels?: Partial<SidePanelsState> & { focusMode?: boolean },
  projectId = 'fog',
  chapter = sampleChapter,
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns, initialPanels: panels },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/write/${chapter.id}`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/write/:chapterId',
              element: createElement(EditorPane, { projectId, chapter }),
            }),
          ),
        ),
      ),
    ),
  );
}

function renderWriteScreenWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  panels?: Partial<SidePanelsState> & { focusMode?: boolean },
  projectId = 'fog',
  chapterId = 'ch-1',
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns, initialPanels: panels },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/write/${chapterId}`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/write/:chapterId',
              element: createElement(WriteScreen),
            }),
          ),
        ),
      ),
    ),
  );
}

function renderWorkspaceWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  panels?: Partial<SidePanelsState> & { focusMode?: boolean },
  projectId = 'fog',
  chapterId = 'ch-1',
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns, initialPanels: panels },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/write/${chapterId}`] },
          createElement(
            Routes,
            null,
            createElement(
              Route,
              { path: '/p/:projectId', element: createElement(Workspace) },
              createElement(Route, {
                path: 'write/:chapterId',
                element: createElement(WriteScreen),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

describe('WO-62：四種版面專注模式入口與離開方式驗收', () => {
  // 驗收條件 1：四種版面各一條：寫作頁 HTML 含「專注模式」入口（手機橫拿為浮動鈕且朗讀為「專注模式」）
  it('WO-62：① 手機直拿寫作頁 HTML 含下方拇指區第三顆「專注模式」入口', () => {
    const portraitHtml = renderWriteScreenWithLayout('phone-portrait');
    expect(portraitHtml).toContain('data-testid="thumb-bar"');
    expect(portraitHtml).toContain('data-testid="thumb-focus-button"');
    expect(portraitHtml).toContain(`aria-label="${FOCUS_MODE_THUMB_ENTER_LABEL}"`);
    expect(portraitHtml).toContain(`<span>${FOCUS_MODE_THUMB_ENTER_LABEL}</span>`);
  });

  it('WO-62：② 手機橫拿寫作頁 HTML 含右側第二顆浮動鈕入口且朗讀為「專注模式」', () => {
    const landscapeHtml = renderWriteScreenWithLayout('phone-landscape');
    expect(landscapeHtml).toContain('data-testid="toggle-focus-landscape"');
    expect(landscapeHtml).toContain(`aria-label="${FOCUS_MODE_LANDSCAPE_ENTER_ARIA}"`);
    expect(landscapeHtml).toContain(`class="floating-button-label">${FOCUS_MODE_LANDSCAPE_ENTER_ARIA}</span>`);
  });

  it('WO-62：③ 中等版面寫作頁 HTML 頁首含「專注模式」有字按鈕入口', () => {
    const mediumHtml = renderWriteScreenWithLayout('medium');
    expect(mediumHtml).toContain('data-testid="enter-focus-mode"');
    expect(mediumHtml).toContain(`aria-label="${FOCUS_MODE_ENTER_BUTTON}"`);
    expect(mediumHtml).toContain(`<span class="focus-enter-label">${FOCUS_MODE_ENTER_BUTTON}</span>`);
  });

  it('WO-62：④ 寬版寫作頁 HTML 頁首維持現行「專注模式」入口', () => {
    const wideHtml = renderWriteScreenWithLayout('wide', 'both');
    expect(wideHtml).toContain('data-testid="enter-focus-mode"');
    expect(wideHtml).toContain(`aria-label="${FOCUS_MODE_ENTER_BUTTON}"`);
    expect(wideHtml).toContain(`<span class="focus-enter-label">${FOCUS_MODE_ENTER_BUTTON}</span>`);
  });

  // 驗收條件 2：四種版面進入後：含「離開專注模式」；頁首／分頁／側欄收起；手機直拿與橫拿不顯示底部字數行
  it('WO-62：① 手機直拿進入專注模式後：含「離開專注模式」；頁首／分頁／側欄收起；不顯示底部字數行', () => {
    const writeHtml = renderWriteScreenWithLayout('phone-portrait', null, { focusMode: true });
    expect(writeHtml).toContain('data-testid="exit-focus-mode"');
    expect(writeHtml).toContain(FOCUS_MODE_EXIT_BUTTON);
    expect(writeHtml).toContain('is-focus-mode');
    expect(writeHtml).toContain('tree-closed');
    expect(writeHtml).toContain('aside-closed');
    expect(writeHtml).not.toContain('data-testid="writing-cards-drawer"');

    const workspaceHtml = renderWorkspaceWithLayout('phone-portrait', null, { focusMode: true });
    expect(workspaceHtml).not.toContain('data-testid="bottom-nav"');
    expect(workspaceHtml).not.toContain('data-testid="nav-rail"');

    const editorHtml = renderEditorWithLayout('phone-portrait', null, { focusMode: true });
    expect(editorHtml).not.toContain('data-testid="focus-bottom-status"');
  });

  it('WO-62：② 手機橫拿進入專注模式後：含「離開專注模式」；頁首／分頁／側欄收起；不顯示底部字數行', () => {
    const writeHtml = renderWriteScreenWithLayout('phone-landscape', null, { focusMode: true });
    expect(writeHtml).toContain('data-testid="exit-focus-mode"');
    expect(writeHtml).toContain(FOCUS_MODE_EXIT_BUTTON);
    expect(writeHtml).toContain('is-focus-mode');
    expect(writeHtml).toContain('tree-closed');
    expect(writeHtml).toContain('aside-closed');
    expect(writeHtml).not.toContain('data-testid="writing-cards-drawer"');

    const workspaceHtml = renderWorkspaceWithLayout('phone-landscape', null, { focusMode: true });
    expect(workspaceHtml).not.toContain('data-testid="bottom-nav"');
    expect(workspaceHtml).not.toContain('data-testid="nav-rail"');

    const editorHtml = renderEditorWithLayout('phone-landscape', null, { focusMode: true });
    expect(editorHtml).not.toContain('data-testid="focus-bottom-status"');
  });

  it('WO-62：③ 中等版面進入專注模式後：含「離開專注模式」；頁首／分頁／側欄收起；顯示底部淡淡字數行', () => {
    const writeHtml = renderWriteScreenWithLayout('medium', null, { focusMode: true });
    expect(writeHtml).toContain('data-testid="exit-focus-mode"');
    expect(writeHtml).toContain(FOCUS_MODE_EXIT_BUTTON);
    expect(writeHtml).toContain('is-focus-mode');
    expect(writeHtml).toContain('tree-closed');
    expect(writeHtml).toContain('aside-closed');
    expect(writeHtml).not.toContain('data-testid="writing-cards-drawer"');

    const workspaceHtml = renderWorkspaceWithLayout('medium', null, { focusMode: true });
    expect(workspaceHtml).not.toContain('data-testid="bottom-nav"');
    expect(workspaceHtml).not.toContain('data-testid="nav-rail"');

    const editorHtml = renderEditorWithLayout('medium', null, { focusMode: true });
    expect(editorHtml).toContain('data-testid="focus-bottom-status"');
  });

  it('WO-62：④ 寬版進入專注模式後：含「離開專注模式」；頁首／分頁／側欄收起；顯示底部淡淡字數行', () => {
    const writeHtml = renderWriteScreenWithLayout('wide', 'both', { focusMode: true });
    expect(writeHtml).toContain('data-testid="exit-focus-mode"');
    expect(writeHtml).toContain(FOCUS_MODE_EXIT_BUTTON);
    expect(writeHtml).toContain('is-focus-mode');
    expect(writeHtml).toContain('tree-closed');
    expect(writeHtml).toContain('aside-closed');
    expect(writeHtml).not.toContain('data-testid="writing-cards-drawer"');

    const workspaceHtml = renderWorkspaceWithLayout('wide', 'both', { focusMode: true });
    expect(workspaceHtml).not.toContain('data-testid="bottom-nav"');
    expect(workspaceHtml).not.toContain('data-testid="nav-rail"');

    const editorHtml = renderEditorWithLayout('wide', 'both', { focusMode: true });
    expect(editorHtml).toContain('data-testid="focus-bottom-status"');
  });

  // 驗收條件 3：手機橫拿離開鈕：第一次點只展開文字、狀態仍在專注模式；第二次點才離開（用純函式或 reducer 測）
  it('WO-62：手機橫拿離開鈕：第一次點只展開文字、狀態仍在專注模式；第二次點才離開（用純函式或 reducer 測）', () => {
    // 初始狀態為未展開
    let state = INITIAL_LANDSCAPE_EXIT_STATE;
    expect(state.expanded).toBe(false);

    // 第一次點擊：展開文字，仍處於專注模式（shouldExit 為 false）
    const firstResult = landscapeExitReducer(state, { type: 'click' });
    expect(firstResult.nextState.expanded).toBe(true);
    expect(firstResult.shouldExit).toBe(false);

    // 第二次點擊：確認離開（shouldExit 為 true）
    const secondResult = landscapeExitReducer(firstResult.nextState, { type: 'click' });
    expect(secondResult.nextState.expanded).toBe(false);
    expect(secondResult.shouldExit).toBe(true);

    // 展開後約 3 秒沒點就收回（collapse）
    expect(LANDSCAPE_EXIT_TIMEOUT_MS).toBe(3000);
    const timeoutResult = landscapeExitReducer({ expanded: true }, { type: 'collapse' });
    expect(timeoutResult.nextState.expanded).toBe(false);
    expect(timeoutResult.shouldExit).toBe(false);
  });

  // 驗收條件 4：離開後側欄恢復進入前狀態（四種版面）
  it('WO-62：離開專注模式後側欄恢復進入前狀態（四種版面）', () => {
    // 1. ① 手機直拿：進入前開啟左側目錄，離開後恢復
    let portrait = createInitialPanelsState({ left: true, right: false }, { mode: 'phone-portrait', wideColumns: null });
    portrait = enterFocusMode(portrait);
    expect(portrait.focusMode).toBe(true);
    expect(portrait.sidePanels).toEqual({ left: false, right: false });
    portrait = exitFocusMode(portrait, { mode: 'phone-portrait', wideColumns: null });
    expect(portrait.focusMode).toBe(false);
    expect(portrait.sidePanels).toEqual({ left: true, right: false });

    // 2. ② 手機橫拿：進入前開啟右側卡片，離開後恢復
    let landscape = createInitialPanelsState({ left: false, right: true }, { mode: 'phone-landscape', wideColumns: null });
    landscape = enterFocusMode(landscape);
    expect(landscape.focusMode).toBe(true);
    expect(landscape.sidePanels).toEqual({ left: false, right: false });
    landscape = exitFocusMode(landscape, { mode: 'phone-landscape', wideColumns: null });
    expect(landscape.focusMode).toBe(false);
    expect(landscape.sidePanels).toEqual({ left: false, right: true });

    // 3. ③ 中等：進入前開啟左側目錄，離開後恢復
    let medium = createInitialPanelsState({ left: true, right: false }, { mode: 'medium', wideColumns: null });
    medium = enterFocusMode(medium);
    expect(medium.focusMode).toBe(true);
    expect(medium.sidePanels).toEqual({ left: false, right: false });
    medium = exitFocusMode(medium, { mode: 'medium', wideColumns: null });
    expect(medium.focusMode).toBe(false);
    expect(medium.sidePanels).toEqual({ left: true, right: false });

    // 4. ④ 寬版（both）：進入前雙欄皆開，離開後原樣恢復
    let wideBoth = createInitialPanelsState({ left: true, right: true }, { mode: 'wide', wideColumns: 'both' });
    wideBoth = enterFocusMode(wideBoth);
    expect(wideBoth.focusMode).toBe(true);
    expect(wideBoth.sidePanels).toEqual({ left: false, right: false });
    wideBoth = exitFocusMode(wideBoth, { mode: 'wide', wideColumns: 'both' });
    expect(wideBoth.focusMode).toBe(false);
    expect(wideBoth.sidePanels).toEqual({ left: true, right: true });

    // 5. ④ 寬版（one-side）：進入前開啟右欄，離開後恢復右欄
    let wideOne = createInitialPanelsState({ left: false, right: true }, { mode: 'wide', wideColumns: 'one-side' });
    wideOne = enterFocusMode(wideOne);
    expect(wideOne.focusMode).toBe(true);
    expect(wideOne.sidePanels).toEqual({ left: false, right: false });
    wideOne = exitFocusMode(wideOne, { mode: 'wide', wideColumns: 'one-side' });
    expect(wideOne.focusMode).toBe(false);
    expect(wideOne.sidePanels).toEqual({ left: false, right: true });
  });

  // 驗收條件 5：寬版既有專注模式測試照舊通過
  it('WO-62：寬版既有專注模式測試照舊通過', () => {
    // 寬版未進入專注模式時包含頁首「專注模式」按鈕
    const wideNormal = renderEditorWithLayout('wide', 'both');
    expect(wideNormal).toContain('aria-label="專注模式"');
    expect(wideNormal).toContain('<span class="focus-enter-label">專注模式</span>');

    // 寬版進入專注模式後包含「離開專注模式」按鈕與底列字數狀態
    const wideFocus = renderEditorWithLayout('wide', 'both', { focusMode: true });
    expect(wideFocus).toContain('aria-label="離開專注模式"');
    expect(wideFocus).toContain('data-testid="exit-focus-mode">離開專注模式</button>');
    expect(wideFocus).toContain('data-testid="focus-bottom-status"');
  });

  it('WO-62：focusMode.css 包含四種版面專注模式規則與樣式設定', () => {
    const css = readFileSync(new URL('./focusMode.css', import.meta.url), 'utf8');

    // 1. 手機直拿拇指區
    expect(css).toMatch(/html\[data-layout="phone-portrait"\]\s+\.thumb-bar[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.thumb-button[\s\S]*?min-height:\s*48px/);
    expect(css).toMatch(/\.thumb-button[\s\S]*?max-width:\s*120px/);

    // 2. 手機橫拿浮動鈕與 44×44 圓形規格
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.landscape-focus-trigger[\s\S]*?display:\s*grid/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.landscape-focus-trigger[\s\S]*?width:\s*44px/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.landscape-focus-trigger[\s\S]*?height:\s*44px/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.landscape-focus-trigger[\s\S]*?border-radius:\s*50%/);

    // 3. 中等頂列有字按鈕
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.focus-enter-button[\s\S]*?display:\s*inline-flex/);

    // 4. 手機直拿與手機橫拿專注時不顯示底部字數行
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-portrait"\]\s+\.focus-bottom-status[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-landscape"\]\s+\.focus-bottom-status[\s\S]*?display:\s*none\s*!important/);

    // 5. 手機直拿專注模式離開鈕高 44 且不透明度約 60%
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-portrait"\]\s+\.focus-exit-button[\s\S]*?height:\s*44px/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-portrait"\]\s+\.focus-exit-button[\s\S]*?opacity:\s*0\.6/);

    // 6. 手機橫拿專注模式離開鈕 44×44 圓鈕與展開樣式
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-landscape"\]\s+\.focus-exit-button[\s\S]*?width:\s*44px/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-landscape"\]\s+\.focus-exit-button[\s\S]*?height:\s*44px/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-landscape"\]\s+\.focus-exit-button\.is-expanded[\s\S]*?width:\s*auto/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-landscape"\]\s+\.focus-exit-button:hover[\s\S]*?opacity:\s*1/);

    // 7. 中等版面專注模式離開鈕與底列字數
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="medium"\]\s+\.focus-exit-button[\s\S]*?height:\s*44px/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="medium"\]\s+\.focus-exit-button[\s\S]*?opacity:\s*0\.6/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="medium"\]\s+\.focus-exit-button:hover[\s\S]*?opacity:\s*1/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="medium"\]\s+\.focus-bottom-status[\s\S]*?bottom:\s*14px/);

    // 8. 寬版專注模式離開鈕與底列字數（右上淡淡離開鈕、滑鼠移過或碰一下變清楚、底列淡淡字數）
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="wide"\]\s+\.focus-exit-button[\s\S]*?height:\s*44px/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="wide"\]\s+\.focus-exit-button[\s\S]*?opacity:\s*0\.6/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="wide"\]\s+\.focus-exit-button:hover[\s\S]*?opacity:\s*1/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="wide"\]\s+\.focus-bottom-status[\s\S]*?bottom:\s*14px/);
  });

  it('WO-62：進出專注模式絕不呼叫 blur()／focus() 且未綁定 Esc 等鍵盤快捷鍵', () => {
    const editorSrc = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');
    const layoutContextSrc = readFileSync(new URL('../layout/layoutContext.tsx', import.meta.url), 'utf8');
    const sidePanelsSrc = readFileSync(new URL('../layout/sidePanels.ts', import.meta.url), 'utf8');

    // 原始碼檢查：進出專注模式不可呼叫 textarea blur 或 focus
    expect(editorSrc).not.toMatch(/enterFocusMode[\s\S]*?ref\.current\?.blur\(\)/);
    expect(editorSrc).not.toMatch(/exitFocusMode[\s\S]*?ref\.current\?.blur\(\)/);
    expect(editorSrc).not.toMatch(/['"]Escape['"]/);
    expect(editorSrc).not.toMatch(/['"]Esc['"]/);
    expect(layoutContextSrc).not.toMatch(/addEventListener\(['"]keydown['"]/);
    expect(sidePanelsSrc).not.toMatch(/addEventListener/);

    // 專注模式切換時應透過 handleEditorLayoutChange 保障游標校正與組字排隊保護
    expect(editorSrc).toMatch(/prevFocusModeRef\.current\s*!==\s*focusMode/);
    expect(editorSrc).toContain('handleEditorLayoutChange');
  });

  it('WO-62：四種版面專注模式入口在 focusMode.css 中具備預設隱藏且僅在各自版面顯示、手機專注模式不顯示底列字數', () => {
    const css = readFileSync(new URL('./focusMode.css', import.meta.url), 'utf8');

    // 1. 各入口元素宣告預設隱藏（防禦性樣式，防止未指定或非預期版面露出）
    expect(css).toMatch(/\.thumb-bar\s*\{[\s\S]*?display:\s*none;/);
    expect(css).toMatch(/\.thumb-focus-button\s*\{[\s\S]*?display:\s*none;/);
    expect(css).toMatch(/\.landscape-focus-trigger\s*\{[\s\S]*?display:\s*none;/);
    expect(css).toMatch(/\.focus-enter-button\s*\{[\s\S]*?display:\s*none;/);

    // 2. ① 手機直拿（phone-portrait）：僅顯示拇指區專注鈕，其餘入口不顯示
    expect(css).toMatch(/html\[data-layout="phone-portrait"\]\s+\.thumb-bar[\s\S]*?display:\s*flex;/);
    expect(css).toMatch(/html\[data-layout="phone-portrait"\]\s+\.thumb-focus-button[\s\S]*?display:\s*inline-flex;/);
    expect(css).not.toMatch(/html\[data-layout="phone-portrait"\][^{]*?\.(landscape-focus-trigger|focus-enter-button)[^{]*?display:\s*(inline-flex|flex|grid|block)/);

    // 3. ② 手機橫拿（phone-landscape）：僅顯示右側浮動專注鈕，其餘入口不顯示
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.landscape-focus-trigger[\s\S]*?display:\s*grid;/);
    expect(css).not.toMatch(/html\[data-layout="phone-landscape"\][^{]*?\.(thumb-bar|thumb-focus-button|focus-enter-button)[^{]*?display:\s*(inline-flex|flex|grid|block)/);

    // 4. ③ 中等版面（medium）：僅顯示頁首專注按鈕，其餘入口不顯示
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.focus-enter-button[\s\S]*?display:\s*inline-flex;/);
    expect(css).not.toMatch(/html\[data-layout="medium"\][^{]*?\.(thumb-bar|thumb-focus-button|landscape-focus-trigger)[^{]*?display:\s*(inline-flex|flex|grid|block)/);

    // 5. ④ 寬版版面（wide）：僅顯示頁首專注按鈕，其餘入口不顯示
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.focus-enter-button[\s\S]*?display:\s*inline-flex;/);
    expect(css).not.toMatch(/html\[data-layout="wide"\][^{]*?\.(thumb-bar|thumb-focus-button|landscape-focus-trigger)[^{]*?display:\s*(inline-flex|flex|grid|block)/);

    // 6. 專注模式中，手機兩種版面強制隱藏底部字數列（display: none !important）
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-portrait"\]\s+\.focus-bottom-status[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="phone-landscape"\]\s+\.focus-bottom-status[\s\S]*?display:\s*none\s*!important/);

    // 7. 中等與寬版在專注模式下正常顯示底部字數列
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="medium"\]\s+\.focus-bottom-status[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/html\[data-focus-mode="true"\]\[data-layout="wide"\]\s+\.focus-bottom-status[\s\S]*?display:\s*flex/);
  });

  it('WO-62：手機橫拿離開按鈕計時與兩段式互動模擬（點一次展開、過 3 秒收回、再點展開、再點離開且清除計時）', () => {
    vi.useFakeTimers();
    try {
      let state = INITIAL_LANDSCAPE_EXIT_STATE;
      let timerId: ReturnType<typeof setTimeout> | null = null;
      let exited = false;

      const clearTimer = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
      };

      // 模擬 EditorPane handleExitClick 針對手機橫拿版面之防誤觸兩段式點擊與定時收合機制
      const handleClick = () => {
        const result = landscapeExitReducer(state, { type: 'click' });
        state = result.nextState;
        if (result.shouldExit) {
          clearTimer();
          exited = true;
        } else {
          clearTimer();
          timerId = setTimeout(() => {
            state = landscapeExitReducer(state, { type: 'collapse' }).nextState;
            timerId = null;
          }, LANDSCAPE_EXIT_TIMEOUT_MS);
        }
      };

      // 步驟 1：點擊第一次 -> 展開提示文字、尚未離開專注模式、啟動 3 秒計時
      handleClick();
      expect(state.expanded).toBe(true);
      expect(exited).toBe(false);
      expect(timerId).not.toBeNull();

      // 步驟 2：經過 3 秒未點擊 -> 自動收回為圓鈕、未離開、計時器清空
      vi.advanceTimersByTime(3000);
      expect(state.expanded).toBe(false);
      expect(exited).toBe(false);
      expect(timerId).toBeNull();

      // 步驟 3：逾時收回後再點一次 -> 重新計為第一次點擊、展開文字、尚未離開、重新啟動 3 秒計時
      handleClick();
      expect(state.expanded).toBe(true);
      expect(exited).toBe(false);
      expect(timerId).not.toBeNull();

      // 步驟 4：在 3 秒內（例如過 1 秒）再點擊一次 -> 確認離開專注模式、清除計時器
      vi.advanceTimersByTime(1000);
      handleClick();
      expect(state.expanded).toBe(false);
      expect(exited).toBe(true);
      expect(timerId).toBeNull();

      // 步驟 5：確認計時已清除，時間再前進 3 秒不會觸發任何殘留副作用
      vi.advanceTimersByTime(3000);
      expect(state.expanded).toBe(false);
      expect(exited).toBe(true);
      expect(timerId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
