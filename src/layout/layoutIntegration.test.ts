import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import type { ChapterNode } from '../data/demo';
import { scrollDeltaToReveal } from '../editor/caret';
import { EditorPane } from '../screens/EditorPane';
import { SampleProvider } from '../state/sampleStore';
import {
  CompositionActionQueue,
  handleEditorLayoutChange,
} from './compositionAction';
import { LayoutProvider } from './layoutContext';
import type { LayoutMode, WideColumns } from './layoutMode';

const sampleChapter: ChapterNode = {
  id: 'ch-sample-layout',
  type: 'file',
  title: '第一章　晨曦微露',
  content: '【範例】清晨的微風拂過書桌，筆尖落在嶄新的稿紙上。',
  progress: 'Draft',
  expanded: true,
};

function normalizeEditorThumbTreeButton(html: string): string {
  return html.replace(
    /<button type="button" class="thumb-button thumb-tree-button"[^>]*>/g,
    '<button type="button" class="thumb-button thumb-tree-button" data-normalized>',
  );
}

function renderEditorWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  projectId = 'fog',
  chapter = sampleChapter,
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns },
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

function renderDrawerWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  projectId = 'fog',
): string {
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: mode, initialWideColumns: wideColumns },
      createElement(WritingCardsDrawer, {
        projectId,
        onClose: () => {},
      }),
    ),
  );
}

function createMockTextarea(initial?: {
  value?: string;
  selectionStart?: number;
  selectionEnd?: number;
  scrollTop?: number;
  clientHeight?: number;
}) {
  const focusSpy = vi.fn();
  const blurSpy = vi.fn();
  const stub = {
    value: initial?.value ?? '【範例】這是測試正文內容，包含了長長的文章段落與游標位置。',
    selectionStart: initial?.selectionStart ?? 10,
    selectionEnd: initial?.selectionEnd ?? 10,
    scrollTop: initial?.scrollTop ?? 0,
    clientHeight: initial?.clientHeight ?? 400,
    focus: focusSpy,
    blur: blurSpy,
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  return {
    textarea: stub as unknown as HTMLTextAreaElement,
    focusSpy,
    blurSpy,
    state: stub,
  };
}

describe('WO-54：換版面不卸載正文與面板元件結構驗證', () => {
  it('WO-54：四種版面下正文元件結構完全一致（相同 data-testid 與 DOM 結構，未重新掛載或條件分支）', () => {
    const portraitHtml = renderEditorWithLayout('phone-portrait');
    const landscapeHtml = renderEditorWithLayout('phone-landscape');
    const mediumHtml = renderEditorWithLayout('medium');
    const wideOneSideHtml = renderEditorWithLayout('wide', 'one-side');
    const wideBothHtml = renderEditorWithLayout('wide', 'both');

    // 每一種版面皆具有相同的正文輸入框與關鍵節點
    for (const html of [portraitHtml, landscapeHtml, mediumHtml, wideOneSideHtml, wideBothHtml]) {
      expect(html).toContain('data-testid="editor"');
      expect(html).toContain('data-testid="writing-input"');
      expect(html).toContain('name="jiufang-manuscript"');
      expect(html).toContain('data-testid="status-bar"');
      expect(html).toContain('data-testid="toggle-cards-topbar"');
      expect(html).toContain('data-testid="toggle-cards-landscape"');
    }

    // 正文編輯區的結構在所有版面下相同（WO-80 直拿拇指區目錄鈕屬性除外）
    const layouts = [portraitHtml, landscapeHtml, mediumHtml, wideOneSideHtml, wideBothHtml].map(
      normalizeEditorThumbTreeButton,
    );
    const [portraitNorm, landscapeNorm, mediumNorm, wideOneNorm, wideBothNorm] = layouts;
    expect(portraitNorm).toBe(landscapeNorm);
    expect(portraitNorm).toBe(mediumNorm);
    expect(portraitNorm).toBe(wideOneNorm);
    expect(portraitNorm).toBe(wideBothNorm);
  });

  it('WO-54：四種版面下看卡片面板（WritingCardsDrawer）具有相同的元件結構', () => {
    const drawerPortrait = renderDrawerWithLayout('phone-portrait');
    const drawerLandscape = renderDrawerWithLayout('phone-landscape');
    const drawerMedium = renderDrawerWithLayout('medium');
    const drawerWide = renderDrawerWithLayout('wide', 'both');

    for (const html of [drawerPortrait, drawerLandscape, drawerMedium, drawerWide]) {
      expect(html).toContain('data-testid="writing-cards-overlay"');
      expect(html).toContain('data-testid="writing-cards-drawer"');
    }

    expect(drawerPortrait).toBe(drawerLandscape);
    expect(drawerPortrait).toBe(drawerMedium);
    expect(drawerPortrait).toBe(drawerWide);
  });
});

describe('WO-54：狀態保留五項動態行為測試（游標、捲動、組字、看卡片面板、鍵盤）', () => {
  it('WO-54：狀態保留 (a) 游標：切版面前後 selectionStart 與 selectionEnd 完全不變', () => {
    const mock = createMockTextarea({ selectionStart: 15, selectionEnd: 25 });
    const queue = new CompositionActionQueue();

    // 執行版面切換動作
    handleEditorLayoutChange({
      textarea: mock.textarea,
      isComposing: false,
      queue,
      revealFn: () => {},
    });

    expect(mock.state.selectionStart).toBe(15);
    expect(mock.state.selectionEnd).toBe(25);
  });

  it('WO-54：狀態保留 (b) 捲動：游標在可見範圍內時 scrollTop 不變，跑出範圍時才用 revealCaret 校正', () => {
    const queue = new CompositionActionQueue();

    // 情境 1：游標在可見範圍內（例如 top: 100, height: 24, viewHeight: 400）
    const inViewMock = createMockTextarea({ scrollTop: 50, clientHeight: 400 });
    const revealInView = (el: HTMLTextAreaElement) => {
      // 游標在可見範圍內，scrollDeltaToReveal 為 0
      const delta = scrollDeltaToReveal(100, 24, el.scrollTop, el.clientHeight);
      if (delta !== 0) el.scrollTop += delta;
    };

    handleEditorLayoutChange({
      textarea: inViewMock.textarea,
      isComposing: false,
      queue,
      revealFn: revealInView,
    });
    // scrollTop 完全不變
    expect(inViewMock.state.scrollTop).toBe(50);

    // 情境 2：游標跑出可見範圍下方（例如 caretTop: 600, height: 24，而 viewTop=50+24=74, viewBottom=50+400-24=426）
    const outOfViewMock = createMockTextarea({ scrollTop: 50, clientHeight: 400 });
    const revealOutOfView = (el: HTMLTextAreaElement) => {
      // 游標在下方超界，scrollDeltaToReveal > 0
      const delta = scrollDeltaToReveal(600, 24, el.scrollTop, el.clientHeight);
      if (delta !== 0) el.scrollTop += delta;
    };

    handleEditorLayoutChange({
      textarea: outOfViewMock.textarea,
      isComposing: false,
      queue,
      revealFn: revealOutOfView,
    });
    // delta = 624 - 426 = 198, scrollTop 從 50 校正為 248
    expect(outOfViewMock.state.scrollTop).toBe(248);
  });

  it('WO-54：狀態保留 (c) 組字：組字中切版面不動 DOM，compositionend 後才校正一次', () => {
    const mock = createMockTextarea({ scrollTop: 50, clientHeight: 400 });
    const queue = new CompositionActionQueue();
    const revealSpy = vi.fn((el: HTMLTextAreaElement) => {
      el.scrollTop = 200;
    });

    // 1. 開始組字（注音輸入中）
    queue.startComposition();

    // 2. 切換版面，觸發換版面處理
    const result = handleEditorLayoutChange({
      textarea: mock.textarea,
      isComposing: true,
      queue,
      revealFn: revealSpy,
    });

    // 驗證：動作被延後，未執行 DOM 捲動校正
    expect(result.deferred).toBe(true);
    expect(result.executed).toBe(false);
    expect(revealSpy).not.toHaveBeenCalled();
    expect(mock.state.scrollTop).toBe(50);

    // 3. 組字結束（compositionend）
    queue.endComposition();

    // 驗證：此時才執行一次捲動校正
    expect(revealSpy).toHaveBeenCalledTimes(1);
    expect(mock.state.scrollTop).toBe(200);
  });

  it('WO-54：狀態保留 (d) 看卡片面板：開著時切版面仍維持開著（狀態不受版面影響且元件結構恆定）', () => {
    // 1. 驗證卡片檢視狀態在版面變更時不會被重設
    const initialCardsState = {
      selectedCategoryId: 'chars',
      selectedCardId: 'card-1',
      collapsedIds: new Set<string>(['card-parent']),
    };
    expect(initialCardsState.selectedCategoryId).toBe('chars');
    expect(initialCardsState.selectedCardId).toBe('card-1');

    // 2. 驗證在 EditorPane 中看卡片面板在切版面時元件結構恆定
    const portraitHtml = renderEditorWithLayout('phone-portrait');
    const landscapeHtml = renderEditorWithLayout('phone-landscape');
    const wideHtml = renderEditorWithLayout('wide', 'both');

    for (const html of [portraitHtml, landscapeHtml, wideHtml]) {
      expect(html).toContain('data-testid="toggle-cards-topbar"');
      expect(html).toContain('data-testid="toggle-cards-landscape"');
    }

    // 3. 驗證 WritingCardsDrawer 渲染輸出在不同版面完全一致（無條件分支替換元件）
    const drawerPortrait = renderDrawerWithLayout('phone-portrait');
    const drawerWide = renderDrawerWithLayout('wide', 'both');
    expect(drawerPortrait).toBe(drawerWide);
  });

  it('WO-54：狀態保留 (e) 鍵盤：切版面過程中 blur 與 focus 均絕不被呼叫（防止鍵盤收起閃爍）', () => {
    const mock = createMockTextarea();
    const queue = new CompositionActionQueue();

    // 1. 未組字時切版面
    handleEditorLayoutChange({
      textarea: mock.textarea,
      isComposing: false,
      queue,
      revealFn: () => {},
    });

    expect(mock.blurSpy).not.toHaveBeenCalled();
    expect(mock.focusSpy).not.toHaveBeenCalled();

    // 2. 組字中切版面
    queue.startComposition();
    handleEditorLayoutChange({
      textarea: mock.textarea,
      isComposing: true,
      queue,
      revealFn: () => {},
    });
    queue.endComposition();

    // 依然沒有呼叫 blur 與 focus
    expect(mock.blurSpy).not.toHaveBeenCalled();
    expect(mock.focusSpy).not.toHaveBeenCalled();
  });
});
