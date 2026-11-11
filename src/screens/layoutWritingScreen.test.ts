import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import {
  CARDS_PANEL_ARIA,
  CLOSE_CARDS_ARIA,
  CLOSE_CHAPTER_TREE_ARIA,
  FLOATING_CHAPTER_TREE_ARIA,
  FLOATING_VIEW_CARDS_ARIA,
  FOCUS_MODE_ENTER_BUTTON,
  FOCUS_MODE_EXIT_BUTTON,
  OPEN_CHAPTER_TREE_ARIA,
  todayWordsLabel,
  TREE_DRAWER_BUTTON,
  VIEW_CARDS_BUTTON,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import {
  closeSidePanel,
  createInitialPanelsState,
  enterFocusMode,
  exitFocusMode,
  getEditorMaxWidthCalc,
  LAYOUT_EDITOR_LIMITS,
  LayoutProvider,
  openSidePanel,
  type LayoutMode,
  type WideColumns,
} from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { EditorPane } from './EditorPane';
import { WriteScreen } from './WriteScreen';

const sampleChapter: ChapterNode = {
  id: 'ch-sample-wo55',
  type: 'file',
  title: '【範例】第七章　晨霧與軌道',
  content: '【範例】初冬的早晨，站台邊聚集著稀稀落落的候車旅客。',
  progress: 'Draft',
  expanded: true,
};

function renderEditorWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  panels?: { left?: boolean; right?: boolean },
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
  panels?: { left?: boolean; right?: boolean },
  projectId = 'fog',
  chapterId = 'ch-sample-wo55',
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

describe('WO-55：各版面正文限寬規則驗證', () => {
  it('WO-55：global.css 存在各版面正文限寬規則且 N 值正確（19, 30, 30, 36）', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 1. 手機直拿 N = 19
    expect(css).toMatch(/html\[data-layout="phone-portrait"\][\s\S]*?\.editor-input[\s\S]*?max-width:\s*calc\(19\s*\*\s*\(1em\s*\+\s*0\.5px\)\)/);
    // 2. 手機橫拿 N = 30
    expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.editor-input[\s\S]*?max-width:\s*calc\(30\s*\*\s*\(1em\s*\+\s*0\.5px\)\)/);
    // 3. 中等 N = 30
    expect(css).toMatch(/html\[data-layout="medium"\][\s\S]*?\.editor-input[\s\S]*?max-width:\s*calc\(30\s*\*\s*\(1em\s*\+\s*0\.5px\)\)/);
    // 4. 寬版 N = 36
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.editor-input[\s\S]*?max-width:\s*calc\(36\s*\*\s*\(1em\s*\+\s*0\.5px\)\)/);
  });

  it('WO-55：純函式與限寬常數設定值正確', () => {
    expect(LAYOUT_EDITOR_LIMITS['phone-portrait'].chars).toBe(19);
    expect(LAYOUT_EDITOR_LIMITS['phone-landscape'].chars).toBe(30);
    expect(LAYOUT_EDITOR_LIMITS.medium.chars).toBe(30);
    expect(LAYOUT_EDITOR_LIMITS.wide.chars).toBe(36);

    expect(getEditorMaxWidthCalc(19)).toBe('calc(19 * (1em + 0.5px))');
    expect(getEditorMaxWidthCalc(30)).toBe('calc(30 * (1em + 0.5px))');
    expect(getEditorMaxWidthCalc(36)).toBe('calc(36 * (1em + 0.5px))');
  });
});

describe('WO-55：側欄讓位樣式驗證（手機橫拿與中等開抽屜時正文縮窄讓位，而非覆蓋）', () => {
  it('WO-55：global.css 明訂側欄讓位規則且不使用覆蓋層', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 手機橫拿與中等時，writing-cards-overlay 隱藏，不阻擋正文
    expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.writing-cards-overlay[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="medium"\][\s\S]*?\.writing-cards-overlay[\s\S]*?display:\s*none\s*!important/);

    // 手機橫拿看卡片讓位 290px、中等看卡片讓位 380px
    expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.editor\.yield-right[\s\S]*?margin-right:\s*290px/);
    expect(css).toMatch(/html\[data-layout="medium"\][\s\S]*?\.editor\.yield-right[\s\S]*?margin-right:\s*380px/);
  });

  it('WO-55：手機橫拿與中等開側欄時，正文容器套上讓位樣式（yield-left 或 yield-right）', () => {
    // 1. 中等版面開啟左側目錄抽屜時
    const mediumLeftOpen = renderWriteScreenWithLayout('medium', null, { left: true, right: false });
    expect(mediumLeftOpen).toContain('yield-left');
    expect(mediumLeftOpen).toContain('is-yielding');
    expect(mediumLeftOpen).toContain('data-yielding="left"');

    // 2. 手機橫拿開啟右側卡片時
    const landscapeRightOpen = renderWriteScreenWithLayout('phone-landscape', null, { left: false, right: true });
    expect(landscapeRightOpen).toContain('yield-right');
    expect(landscapeRightOpen).toContain('is-yielding');
    expect(landscapeRightOpen).toContain('data-yielding="right"');

    // 3. 側欄關閉時不套用讓位樣式
    const mediumClosed = renderWriteScreenWithLayout('medium', null, { left: false, right: false });
    expect(mediumClosed).not.toContain('yield-left');
    expect(mediumClosed).not.toContain('yield-right');
    expect(mediumClosed).not.toContain('is-yielding');
  });
});

describe('WO-55：寬版 one-side／both 規則、專注模式與快捷鍵限制驗證', () => {
  it('WO-55：寬版 one-side 模式（1024–1279）打開一側自動收起另一側，關閉後自動復原', () => {
    const wideOneSide = { mode: 'wide' as const, wideColumns: 'one-side' as const };
    let state = createInitialPanelsState({ left: true, right: false });

    // 打開右欄，左欄自動收起並記住
    state = openSidePanel(state, 'right', wideOneSide);
    expect(state.sidePanels).toEqual({ left: false, right: true });
    expect(state.savedForOneSide).toBe('left');

    // 關閉右欄，左欄自動恢復
    state = closeSidePanel(state, 'right', wideOneSide);
    expect(state.sidePanels).toEqual({ left: true, right: false });
    expect(state.savedForOneSide).toBeNull();
  });

  it('WO-55：寬版 both 模式（≥1280）左右兩欄可同時開啟', () => {
    const wideBoth = { mode: 'wide' as const, wideColumns: 'both' as const };
    let state = createInitialPanelsState({ left: true, right: false });

    state = openSidePanel(state, 'right', wideBoth);
    expect(state.sidePanels).toEqual({ left: true, right: true });
  });

  it('WO-55：專注模式進出一鍵收起左右兩欄與導覽，離開時原樣恢復', () => {
    const wideBoth = { mode: 'wide' as const, wideColumns: 'both' as const };
    let state = createInitialPanelsState({ left: true, right: true });

    // 進入專注模式：全收
    state = enterFocusMode(state);
    expect(state.focusMode).toBe(true);
    expect(state.sidePanels).toEqual({ left: false, right: false });

    // 離開專注模式：原樣恢復
    state = exitFocusMode(state, wideBoth);
    expect(state.focusMode).toBe(false);
    expect(state.sidePanels).toEqual({ left: true, right: true });
  });

  it('WO-55：專注模式嚴格不註冊任何鍵盤快捷鍵（未綁定 Esc 等 Keydown 監聽）', () => {
    const editorSrc = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');
    const layoutContextSrc = readFileSync(new URL('../layout/layoutContext.tsx', import.meta.url), 'utf8');
    const sidePanelsSrc = readFileSync(new URL('../layout/sidePanels.ts', import.meta.url), 'utf8');

    // 檢查程式碼中絕無註冊 Esc 或快捷鍵進入／離開專注模式
    expect(editorSrc).not.toMatch(/['"]Escape['"]/);
    expect(editorSrc).not.toMatch(/['"]Esc['"]/);
    expect(layoutContextSrc).not.toMatch(/addEventListener\(['"]keydown['"]/);
    expect(sidePanelsSrc).not.toMatch(/addEventListener/);
  });
});

describe('WO-55：目錄卷列與章列精簡與點擊範圍驗證', () => {
  it('WO-55：global.css 包含觸控最小 44、滑鼠最小 36 規則，且列距精簡', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 指標尺寸設定
    expect(css).toMatch(/html\[data-pointer="mouse"\][\s\S]*?--hit-size:\s*36px/);
    expect(css).toMatch(/html\[data-pointer="touch"\][\s\S]*?--hit-size:\s*44px/);

    // 列高與留白精簡（padding-top/bottom 縮至 2px，min-height 依據 --hit-size）
    expect(css).toMatch(/\.tree-row[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.tree-row[\s\S]*?padding-top:\s*2px/);
    expect(css).toMatch(/\.tree-row[\s\S]*?padding-bottom:\s*2px/);

    // 把手、更多、進度標記最小尺寸不小於 --hit-size
    expect(css).toMatch(/\.tree-progress,\s*\.tree-progress-spacer,\s*\.tree-handle,\s*\.icon-button[\s\S]*?min-width:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.tree-progress,\s*\.tree-progress-spacer,\s*\.tree-handle,\s*\.icon-button[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
  });
});

describe('WO-55：元件結構恆定驗證（renderToStaticMarkup）', () => {
  it('WO-55：正文編輯器在四種版面下是同一元件結構（未卸載或條件分支替換）', () => {
    const portraitHtml = renderEditorWithLayout('phone-portrait');
    const landscapeHtml = renderEditorWithLayout('phone-landscape');
    const mediumHtml = renderEditorWithLayout('medium');
    const wideOneSideHtml = renderEditorWithLayout('wide', 'one-side');
    const wideBothHtml = renderEditorWithLayout('wide', 'both');

    // 驗證關鍵按鈕存在且全版面結構恆定
    for (const html of [portraitHtml, landscapeHtml, mediumHtml, wideOneSideHtml, wideBothHtml]) {
      expect(html).toContain('data-testid="editor"');
      expect(html).toContain('data-testid="writing-input"');
      expect(html).toContain('data-testid="toggle-tree-topbar"');
      expect(html).toContain('data-testid="toggle-tree-floating"');
      expect(html).toContain('data-testid="toggle-cards-topbar"');
      expect(html).toContain('data-testid="toggle-cards-landscape"');
      expect(html).toContain('data-testid="enter-focus-mode"');
      expect(html).toContain('data-testid="exit-focus-mode"');
      expect(html).toContain('data-testid="focus-bottom-status"');
    }

    // 四種版面之 HTML 輸出完全一致
    expect(portraitHtml).toBe(landscapeHtml);
    expect(portraitHtml).toBe(mediumHtml);
    expect(portraitHtml).toBe(wideOneSideHtml);
    expect(portraitHtml).toBe(wideBothHtml);
  });

  it('WO-55：看卡片面板在四種版面下是同一元件結構', () => {
    const drawerPortrait = renderToStaticMarkup(
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait' },
        createElement(WritingCardsDrawer, { projectId: 'fog', onClose: () => {} }),
      ),
    );
    const drawerLandscape = renderToStaticMarkup(
      createElement(
        LayoutProvider,
        { initialMode: 'phone-landscape' },
        createElement(WritingCardsDrawer, { projectId: 'fog', onClose: () => {} }),
      ),
    );
    const drawerMedium = renderToStaticMarkup(
      createElement(
        LayoutProvider,
        { initialMode: 'medium' },
        createElement(WritingCardsDrawer, { projectId: 'fog', onClose: () => {} }),
      ),
    );
    const drawerWide = renderToStaticMarkup(
      createElement(
        LayoutProvider,
        { initialMode: 'wide', initialWideColumns: 'both' },
        createElement(WritingCardsDrawer, { projectId: 'fog', onClose: () => {} }),
      ),
    );

    for (const html of [drawerPortrait, drawerLandscape, drawerMedium, drawerWide]) {
      expect(html).toContain('data-testid="writing-cards-overlay"');
      expect(html).toContain('data-testid="writing-cards-drawer"');
    }

    expect(drawerPortrait).toBe(drawerLandscape);
    expect(drawerPortrait).toBe(drawerMedium);
    expect(drawerPortrait).toBe(drawerWide);
  });
});

describe('WO-55：待審文字與臺灣繁體用詞檢查', () => {
  it('WO-55：新按鈕文字皆已定義且符合繁體中文規範', () => {
    expect(TREE_DRAWER_BUTTON).toBe('目錄');
    expect(OPEN_CHAPTER_TREE_ARIA).toBe('展開目錄');
    expect(CLOSE_CHAPTER_TREE_ARIA).toBe('收合目錄');
    expect(FOCUS_MODE_ENTER_BUTTON).toBe('專注模式');
    expect(FOCUS_MODE_EXIT_BUTTON).toBe('離開專注模式');
    expect(FLOATING_CHAPTER_TREE_ARIA).toBe('展開目錄');
    expect(FLOATING_VIEW_CARDS_ARIA).toBe('看卡片');
    expect(VIEW_CARDS_BUTTON).toBe('看卡片');
    expect(CLOSE_CARDS_ARIA).toBe('關閉資料集');
    expect(CARDS_PANEL_ARIA).toBe('資料集');
  });

  it('WO-55：非定案之 WIDE_CARDS_SIDEBAR_BUTTON 已移除，右側欄維持定案之「看卡片」', () => {
    const userFacingSrc = readFileSync(new URL('../copy/userFacing.ts', import.meta.url), 'utf8');
    const editorSrc = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');
    const writeScreenSrc = readFileSync(new URL('./WriteScreen.tsx', import.meta.url), 'utf8');

    expect(userFacingSrc).not.toMatch(/WIDE_CARDS_SIDEBAR_BUTTON/);
    expect(editorSrc).not.toMatch(/WIDE_CARDS_SIDEBAR_BUTTON/);
    expect(writeScreenSrc).toContain('aria-label={CARDS_PANEL_ARIA}');
  });
});

describe('WO-55：第 1 輪修正驗證（審查報告必須先改 1～5 與之後改 6～8）', () => {
  it('WO-55：中等與手機橫拿未選章時目錄為頁面主內容，選章後才為抽屜', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 中等版面未選章時直接為 flex 100%，隱藏 editor-pane 與關閉按鈕
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.tree-pane[\s\S]*?display:\s*flex\s*!important/);
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.tree-pane[\s\S]*?width:\s*100%\s*!important/);
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.editor-pane[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.tree-close-button[\s\S]*?display:\s*none\s*!important/);

    // 手機橫拿未選章時直接為 flex 100%，隱藏 editor-pane 與關閉按鈕
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.tree-pane[\s\S]*?display:\s*flex\s*!important/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.tree-pane[\s\S]*?width:\s*100%\s*!important/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.editor-pane[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.write-layout:not\(\.has-chapter\)\s+\.tree-close-button[\s\S]*?display:\s*none\s*!important/);
  });

  it('WO-55：寬版左目錄預設開著，且 1024–1279 one-side 開右欄時自動收左欄、關右欄恢復', () => {
    // 預設 wide 版面 sidePanels.left 應為 true
    const wideOneSideState = createInitialPanelsState(undefined, { mode: 'wide', wideColumns: 'one-side' });
    expect(wideOneSideState.sidePanels.left).toBe(true);
    expect(wideOneSideState.sidePanels.right).toBe(false);

    // 非 wide 版面 sidePanels.left 應維持 false（抽屜模式）
    const mediumState = createInitialPanelsState(undefined, { mode: 'medium', wideColumns: null });
    expect(mediumState.sidePanels.left).toBe(false);

    // 寬版 1024-1279 打開右側欄，自動收起左側欄並記錄
    const wideLayout = { mode: 'wide' as const, wideColumns: 'one-side' as const };
    const rightOpened = openSidePanel(wideOneSideState, 'right', wideLayout);
    expect(rightOpened.sidePanels).toEqual({ left: false, right: true });
    expect(rightOpened.savedForOneSide).toBe('left');

    // 關閉右側欄，自動恢復左側欄
    const rightClosed = closeSidePanel(rightOpened, 'right', wideLayout);
    expect(rightClosed.sidePanels).toEqual({ left: true, right: false });
    expect(rightClosed.savedForOneSide).toBeNull();
  });

  it('WO-55：寬版「專注模式」按鈕文字橫排，不受 44 寬度限制且符合 hit-size', () => {
    const editorSrc = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // EditorPane 專注按鈕不再受 icon-button 固定 44 限制
    expect(editorSrc).toMatch(/className="focus-enter-button"/);
    expect(editorSrc).not.toMatch(/className="[^"]*icon-button[^"]*focus-enter-button[^"]*"/);

    // global.css 寬版專注按鈕設定 width: auto、min-width/height 為 --hit-size，且 white-space: nowrap
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.focus-enter-button[\s\S]*?width:\s*auto/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.focus-enter-button[\s\S]*?min-width:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.focus-enter-button[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.focus-enter-button[\s\S]*?white-space:\s*nowrap/);
  });

  it('WO-55：手機橫拿時頂列「看卡片」按鈕隱藏，只保留正文右側浮動鈕', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.view-cards-button[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.landscape-cards-trigger/);
  });

  it('WO-55：目錄子層 .tree-list 底部留白去除，僅最外層保留留白', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.tree-list\s+\.tree-list[\s\S]*?padding:\s*0/);
  });

  it('WO-55：頁首頂列右側內距加大，看卡片按鈕寬度自動不削邊', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // topbar padding 右側為 12px
    expect(css).toMatch(/\.topbar[\s\S]*?padding:\s*0\s+12px\s+0\s+16px/);
    // view-cards-button 寬度為 auto 且 white-space: nowrap
    expect(css).toMatch(/\.view-cards-button[\s\S]*?width:\s*auto/);
    expect(css).toMatch(/\.view-cards-button[\s\S]*?white-space:\s*nowrap/);
  });
});

describe('WO-55：第 2 輪修正驗證（寬版 has-chapter 權重、固定 320 寬與收起開目錄鈕）', () => {
  it('WO-55：寬版選章（has-chapter）與未選章時 tree-pane 權重足以顯示且固定 320 寬', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 寬版包含 .write-layout.has-chapter .tree-pane 規則，權重高於全域 (0,3,0)，足以克服覆蓋問題
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.write-layout\.has-chapter\s+\.tree-pane/);

    // 寬版目錄不論有沒有選章均為 display: flex !important，且 flex: 0 0 320px、width/max-width: 320px !important
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.write-layout\.has-chapter\s+\.tree-pane[\s\S]*?display:\s*flex\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.write-layout\.has-chapter\s+\.tree-pane[\s\S]*?flex:\s*0\s+0\s+320px\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.write-layout\.has-chapter\s+\.tree-pane[\s\S]*?width:\s*320px\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.write-layout\.has-chapter\s+\.tree-pane[\s\S]*?max-width:\s*320px\s*!important/);

    // 寬版未選章時亦限制 320px 寬，右側 editor-pane 與提示正常顯示
    expect(css).toMatch(/html\[data-layout="wide"\][\s\S]*?\.write-layout:not\(\.has-chapter\)\s+\.tree-pane/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.editor-empty\.wide-hint[\s\S]*?display:\s*flex\s*!important/);
  });

  it('WO-55：寬版左目錄收起時頁首具備開目錄鈕（topbar-tree-button），展開時隱藏', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 收起時顯示（支援 data-side-panel-left="false"、tree-closed 等多種狀態）
    expect(css).toMatch(/html\[data-layout="wide"\]\[data-side-panel-left="false"\]\s+\.topbar-tree-button[\s\S]*?display:\s*grid\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-layout\.tree-closed\s+\.topbar-tree-button/);

    // 展開時隱藏
    expect(css).toMatch(/html\[data-layout="wide"\]\[data-side-panel-left="true"\]\s+\.topbar-tree-button[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-layout\.tree-open\s+\.topbar-tree-button[\s\S]*?display:\s*none\s*!important/);
  });

  it('WO-55：已清除錯誤之 html[data-layout="wide"].tree-closed 選擇器，改為 .write-layout.tree-closed', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 確保沒有錯誤地把 .tree-closed 放在 html 上
    expect(css).not.toMatch(/html\[data-layout="wide"\]\.tree-closed/);
    // 確保正確放在 .write-layout 上
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-layout\.tree-closed\s+\.tree-pane/);
  });
});

describe('WO-55：第 3 輪修正驗證（滑鼠列距 36～38 與拖曳把手平常不佔位）', () => {
  it('WO-55：滑鼠模式目錄列距緊湊（約 36～38），內部元件寬高綁定 --hit-size 且列上下留白縮為 0', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 1. 目錄列內部的方形按鈕（.icon-button、chevron、把手、spacer）寬高均綁定 --hit-size
    expect(css).toMatch(/\.tree-row\s+\.icon-button,\s*\.tree-row\s+\.tree-chevron,\s*\.tree-row\s+\.tree-chevron-spacer,\s*\.tree-row\s+\.tree-handle,\s*\.tree-row\s+\.tree-progress-spacer[\s\S]*?width:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.tree-row\s+\.icon-button,\s*\.tree-row\s+\.tree-chevron,\s*\.tree-row\s+\.tree-chevron-spacer,\s*\.tree-row\s+\.tree-handle,\s*\.tree-row\s+\.tree-progress-spacer[\s\S]*?height:\s*var\(--hit-size,\s*44px\)/);

    // 2. 滑鼠模式下 .tree-row 上下內距縮到 0，使相鄰列距達到 36～38px
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row[\s\S]*?padding-top:\s*0/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row[\s\S]*?padding-bottom:\s*0/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row[\s\S]*?min-height:\s*var\(--hit-size,\s*36px\)/);

    // 3. 觸控模式維持預設 min-height 44px 與 padding-top/bottom 2px（觸控列距 48px 不變，可點 ≥ 44px）
    expect(css).toMatch(/\.tree-row[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.tree-row[\s\S]*?padding-top:\s*2px/);
    expect(css).toMatch(/\.tree-row[\s\S]*?padding-bottom:\s*2px/);
  });

  it('WO-55：寬版觸控模式拖曳把手平常不佔位，章名至少可見約 8 個中文字，僅整理目錄模式顯示把手', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 觸控非整理模式下，拖曳把手完全 display: none 不佔位
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-pane:not\(\.is-organizing\)\s+\.tree-handle[\s\S]*?display:\s*none\s*!important/);

    // 觸控整理目錄模式下，把手正常以 grid 顯示並具備 44px 觸控熱區
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-pane\.is-organizing\s+\.tree-handle[\s\S]*?display:\s*grid\s*!important/);
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-pane\.is-organizing\s+\.tree-handle[\s\S]*?opacity:\s*1\s*!important/);
  });

  it('WO-55：滑鼠模式拖曳把手以絕對定位疊在列右側，平常不佔位且滑過不擠壓章名', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 滑鼠模式下把手以 position: absolute 疊在列右側，平常 opacity: 0 不佔位
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-handle[\s\S]*?position:\s*absolute/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-handle[\s\S]*?right:\s*calc\(var\(--hit-size,\s*36px\)\s*\+\s*4px\)/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-handle[\s\S]*?opacity:\s*0/);

    // 滑過列（hover/focus-within）才浮現把手供拖曳
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row:hover\s+\.tree-handle/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row:hover\s+\.tree-handle[\s\S]*?opacity:\s*1/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row:hover\s+\.tree-handle[\s\S]*?pointer-events:\s*auto/);
  });
});

describe('WO-55：第 4 輪修正驗證（進度標記自適應寬度與 EditorPane 文案抽離）', () => {
  it('WO-55：.tree-progress 依內容自適應寬度（width: auto），非固定 --hit-size 寬度，且 white-space 為 nowrap 不換行', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // .tree-progress 寬度為 auto，保留 min-width/min-height 與 height 為 --hit-size，且 white-space: nowrap
    expect(css).toMatch(/\.tree-row\s+\.tree-progress\s*\{[\s\S]*?width:\s*auto;/);
    expect(css).toMatch(/\.tree-row\s+\.tree-progress\s*\{[\s\S]*?min-width:\s*var\(--hit-size,\s*44px\);/);
    expect(css).toMatch(/\.tree-row\s+\.tree-progress\s*\{[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\);/);
    expect(css).toMatch(/\.tree-row\s+\.tree-progress\s*\{[\s\S]*?height:\s*var\(--hit-size,\s*44px\);/);
    expect(css).toMatch(/\.tree-row\s+\.tree-progress\s*\{[\s\S]*?white-space:\s*nowrap;/);

    // .badge 徽章也有 white-space: nowrap 防止文字折行直排
    expect(css).toMatch(/\.badge\s*\{[\s\S]*?white-space:\s*nowrap;/);

    // 確保 .tree-progress 未被包含在固定 width: var(--hit-size) 的選擇器清單中
    const fixedWidthMatch = css.match(/([^{]+)\{\s*width:\s*var\(--hit-size,\s*44px\);/);
    expect(fixedWidthMatch).not.toBeNull();
    if (fixedWidthMatch) {
      expect(fixedWidthMatch[1]).not.toContain('.tree-progress,');
      expect(fixedWidthMatch[1]).not.toContain('.tree-progress {');
    }
  });

  it('WO-55：EditorPane.tsx 不再寫死「今日」字樣，統一由 userFacing.ts 的 todayWordsLabel() 提供', () => {
    const editorPaneSrc = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');

    // 不包含寫死的「今日」字串
    expect(editorPaneSrc).not.toContain('今日 ');
    expect(editorPaneSrc).not.toContain('今日{');
    expect(editorPaneSrc).not.toMatch(/['"`]今日/);

    // 包含 todayWordsLabel 呼叫
    expect(editorPaneSrc).toContain('todayWordsLabel(');

    // 驗證 todayWordsLabel 輸出格式
    expect(todayWordsLabel(0)).toBe('今天 0 字');
    expect(todayWordsLabel(1234)).toBe('今天 1,234 字');
    expect(todayWordsLabel('1,234')).toBe('今天 1,234 字');
  });
});

describe('WO-57：版面用字定案畫面輸出與原始碼驗證', () => {
  it('WO-57：畫面輸出驗證（renderToStaticMarkup 含定案文字「專注模式」「離開專注模式」「展開目錄」「收合目錄」「資料集」「今天 0／1,000 字」）', () => {
    // 1. 編輯器畫面（EditorPane）
    const editorHtml = renderEditorWithLayout('wide', 'both');

    // 專注模式按鈕：包含 aria-label 與標籤文字
    expect(editorHtml).toContain('aria-label="專注模式"');
    expect(editorHtml).toContain('<span class="focus-enter-label">專注模式</span>');

    // 離開專注模式按鈕
    expect(editorHtml).toContain('aria-label="離開專注模式"');
    expect(editorHtml).toContain('data-testid="exit-focus-mode">離開專注模式</button>');

    // 左側目錄浮動鈕：朗讀文字改為「展開目錄」
    expect(editorHtml).toContain('class="floating-tree-trigger" aria-label="展開目錄"');
    expect(editorHtml).toContain('<span class="floating-button-label">展開目錄</span>');

    // 頁首統計字數與專注模式底列字數：包含每日目標「今天 300／1,000 字」
    expect(editorHtml).toContain('<span class="topbar-words" data-testid="topbar-words">今天 300／1,000 字</span>');
    expect(editorHtml).toContain('<div class="focus-bottom-status" data-testid="focus-bottom-status"><span>今天 300／1,000 字</span>');

    // 不再包含舊用字
    expect(editorHtml).not.toContain('aria-label="專心"');
    expect(editorHtml).not.toContain('離開專心');
    expect(editorHtml).not.toContain('今日 0 字');

    // 2. 寫作畫面（WriteScreen）
    // 左側抽屜關閉鈕：朗讀文字改為「收合目錄」
    const writeScreenLeftOpen = renderWriteScreenWithLayout('medium', null, { left: true });
    expect(writeScreenLeftOpen).toContain('aria-label="收合目錄"');
    expect(writeScreenLeftOpen).not.toContain('aria-label="收起目錄"');

    // 右側資料集面板：朗讀文字改為「資料集」
    const writeScreenRightOpen = renderWriteScreenWithLayout('wide', 'both', { right: true });
    expect(writeScreenRightOpen).toContain('aria-label="資料集"');
    expect(writeScreenRightOpen).not.toContain('aria-label="資料集面板"');
  });

  it('WO-57：原始碼（非測試、非 src/db）不再出現「專心」「收起目錄」「資料集面板」與「今日 {」寫法', () => {
    const sourceRelativePaths = [
      '../copy/userFacing.ts',
      './EditorPane.tsx',
      './WriteScreen.tsx',
      './CardsScreen.tsx',
      './FilesScreen.tsx',
      './SettingsScreen.tsx',
      './StatsScreen.tsx',
      '../styles/global.css',
      '../layout/layoutContext.tsx',
      '../layout/sidePanels.ts',
      '../layout/layoutMode.ts',
      '../layout/useLayoutMode.ts',
      '../layout/compositionAction.ts',
      '../layout/index.ts',
      '../components/WritingCardsDrawer.tsx',
      '../components/CardMarkdownView.tsx',
      '../App.tsx',
    ];

    expect(sourceRelativePaths.length).toBeGreaterThan(10);

    for (const rel of sourceRelativePaths) {
      const content = readFileSync(new URL(rel, import.meta.url), 'utf8');
      expect(content, `${rel} 不應包含「專心」`).not.toContain('專心');
      expect(content, `${rel} 不應包含「收起目錄」`).not.toContain('收起目錄');
      expect(content, `${rel} 不應包含「資料集面板」`).not.toContain('資料集面板');
      expect(content, `${rel} 不應包含「今日 {」或「今日 \${」寫法`).not.toMatch(/今日\s*(\$)?\{/);
    }
  });
});

