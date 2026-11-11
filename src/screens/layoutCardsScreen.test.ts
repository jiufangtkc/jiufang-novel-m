import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  CARDS_COLUMN_CATEGORIES,
  CARDS_COLUMN_CONTENT,
  CARDS_EMPTY_CARD_HINT,
  CARDS_EMPTY_CATEGORY_HINT,
  CARDS_HEADING,
  CARDS_PANEL_ARIA,
  CARDS_PREVIEW_EMPTY_HINT,
  CARDS_READONLY_BADGE,
  CLOSE_CARDS_ARIA,
} from '../copy/userFacing';
import { DEMO_CARD_CATEGORIES } from '../data/demoCards';
import {
  cardVisualStyles,
  filterVisibleCategories,
  isCategoryHidden,
  isDefaultCardColor,
} from '../domain/cards';
import {
  LayoutProvider,
  openSidePanel,
  closeSidePanel,
  createInitialPanelsState,
  type LayoutMode,
  type WideColumns,
} from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { CardsScreen, type CardsScreenProps } from './CardsScreen';
import { WriteScreen } from './WriteScreen';

function renderCardsScreenWithLayout(
  mode: LayoutMode,
  wideColumns: WideColumns | null = null,
  initialState?: CardsScreenProps,
  projectId = 'fog',
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
          { initialEntries: [`/p/${projectId}/cards`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/cards',
              element: createElement<CardsScreenProps>(CardsScreen, initialState ?? null),
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
  panels: { left?: boolean; right?: boolean } = {},
  projectId = 'fog',
  chapterId = 'ch-1',
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        {
          initialMode: mode,
          initialWideColumns: wideColumns,
          initialPanels: panels,
        },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/write/${chapterId}`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/write/:chapterId?',
              element: createElement(WriteScreen),
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-56：四種版面資料集分頁結構驗證（renderToStaticMarkup ＋ data-layout）', () => {
  it('WO-56：寬版（wide，≥1024）為三層並排（分類｜卡片清單｜卡片內容），內容區限寬約 720', () => {
    const html = renderCardsScreenWithLayout('wide', 'both', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
    });

    // 寬版外層標記
    expect(html).toContain('data-layout="wide"');
    expect(html).toContain('cards-wide-view');

    // 第 1 欄：分類清單
    expect(html).toContain('data-testid="cards-col-categories"');
    expect(html).toContain(CARDS_COLUMN_CATEGORIES);
    expect(html).toContain('data-testid="category-list"');

    // 第 2 欄：卡片清單
    expect(html).toContain('data-testid="cards-col-list"');
    expect(html).toContain('data-testid="category-card-list"');
    expect(html).toContain('【範例】沈雨晴');

    // 第 3 欄：卡片內容
    expect(html).toContain('data-testid="cards-col-detail"');
    expect(html).toContain(CARDS_COLUMN_CONTENT);
    expect(html).toContain('data-testid="card-raw-content"');
    expect(html).toContain('鐘錶修復師的養女');

    // 子卡片區塊
    expect(html).toContain('data-testid="cards-subcards-section"');
    expect(html).toContain('子卡片\u30001 張');
    expect(html).toContain('【範例】隨身舊懷錶');

    // CSS 規範檢查：內容區限寬約 720
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.cards-wide-view\s+\.card-detail-article[\s\S]*?max-width:\s*720px/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.cards-wide-view\s+\.cards-col-categories[\s\S]*?width:\s*240px/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.cards-wide-view\s+\.cards-col-list[\s\S]*?width:\s*320px/);
  });

  it('WO-56：中等（medium，600–1023）為兩欄並排（左欄分類、右欄卡片清單/內容）', () => {
    // 1. 選中分類未選卡片：左欄分類、右欄卡片清單
    const htmlList = renderCardsScreenWithLayout('medium', null, {
      initialCategoryId: 'world',
    });
    expect(htmlList).toContain('data-layout="medium"');
    expect(htmlList).toContain('cards-medium-view');
    expect(htmlList).toContain('data-testid="cards-col-categories"');
    expect(htmlList).toContain('data-testid="cards-col-main"');
    expect(htmlList).toContain('data-testid="category-card-list"');
    expect(htmlList).toContain('【範例】霧港地理與海潮氣候');

    // 2. 點選卡片：右欄切換為卡片內容，具備回清單按鈕
    const htmlDetail = renderCardsScreenWithLayout('medium', null, {
      initialCategoryId: 'world',
      initialCardId: '30000000-0000-4000-8000-000000000001',
    });
    expect(htmlDetail).toContain('data-testid="cards-col-main"');
    expect(htmlDetail).toContain(BACK_TO_CARDS_ARIA);
    expect(htmlDetail).toContain('data-testid="card-raw-content"');
    expect(htmlDetail).toContain('霧港坐落於半島東南側');

    // CSS 寬度規則
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.cards-medium-view\s+\.cards-col-categories[\s\S]*?width:\s*260px/);
  });

  it('WO-56：手機直拿（phone-portrait）維持整頁分層導覽', () => {
    // 分類層
    const layer1 = renderCardsScreenWithLayout('phone-portrait');
    expect(layer1).toContain('data-layout="phone-portrait"');
    expect(layer1).toContain('data-testid="category-list"');
    expect(layer1).toContain(CARDS_HEADING);

    // 卡片層
    const layer2 = renderCardsScreenWithLayout('phone-portrait', null, {
      initialCategoryId: 'timeline',
    });
    expect(layer2).toContain(BACK_TO_CATEGORIES_ARIA);
    expect(layer2).toContain('data-testid="category-card-list"');

    // 內容層
    const layer3 = renderCardsScreenWithLayout('phone-portrait', null, {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
    });
    expect(layer3).toContain(BACK_TO_CARDS_ARIA);
    expect(layer3).toContain('data-testid="card-raw-content"');
  });

  it('WO-56：手機橫拿（phone-landscape）為左側抽屜與右側正文讓位區域', () => {
    const html = renderCardsScreenWithLayout('phone-landscape', null, {
      initialCategoryId: 'character',
    });
    expect(html).toContain('data-layout="phone-landscape"');
    expect(html).toContain('cards-landscape-view');
    expect(html).toContain('data-testid="cards-drawer"');
    expect(html).toContain('data-testid="cards-landscape-yield"');
    expect(html).not.toContain('【範例正文】');
    expect(html).not.toContain('地下道的燈管');
    expect(html).toContain('第一章　來信');
    expect(html).toContain('data-testid="cards-preview-heading"');
    expect(html).toContain('data-testid="cards-preview-lead"');
    expect(html).toContain(CLOSE_CARDS_ARIA);

    // CSS 抽屜 320 寬度
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.cards-landscape-view\s+\.cards-drawer-pane[\s\S]*?width:\s*320px/);
  });
});

describe('WO-56：分類清單限制（無「場景」，無「AI 對話紀錄」）', () => {
  it('WO-56：分類清單只有本書綱要、角色、世界觀、時間軸與自訂分類，沒有「場景」與 AI 對話紀錄', () => {
    const categories = filterVisibleCategories(DEMO_CARD_CATEGORIES);
    const names = categories.map((c) => c.name);

    expect(names).toContain('本書綱要');
    expect(names).toContain('角色');
    expect(names).toContain('世界觀');
    expect(names).toContain('時間軸');
    expect(names).toContain('自訂分類001');

    // 絕對不可含有「場景」
    expect(names).not.toContain('場景');
    expect(categories.some((c) => c.id === 'scene' || c.name === '場景')).toBe(false);

    // 絕對不可含有「AI 對話紀錄」
    expect(names).not.toContain('AI對話紀錄');
    expect(names).not.toContain('AI 對話紀錄');
    expect(categories.some((c) => isCategoryHidden(c.id) || isCategoryHidden(c.name))).toBe(false);

    // 檢查畫面靜態渲染
    const html = renderCardsScreenWithLayout('wide');
    expect(html).not.toContain('場景');
    expect(html).not.toContain('AI');
  });
});

describe('WO-56：寫作時看卡片依版面調整與讓位驗證', () => {
  it('WO-56：手機橫拿與中等為縮窄讓位而非覆蓋（遮罩 display: none，容器套用 yield-right）', () => {
    // 1. 中等開啟看卡片面板：容器套用 yield-right、is-yielding
    const mediumHtml = renderWriteScreenWithLayout('medium', null, { right: true });
    expect(mediumHtml).toContain('yield-right');
    expect(mediumHtml).toContain('is-yielding');
    expect(mediumHtml).toContain('data-yielding="right"');

    // 2. 手機橫拿開啟看卡片面板：容器套用 yield-right、is-yielding
    const landscapeHtml = renderWriteScreenWithLayout('phone-landscape', null, { right: true });
    expect(landscapeHtml).toContain('yield-right');
    expect(landscapeHtml).toContain('is-yielding');
    expect(landscapeHtml).toContain('data-yielding="right"');

    // 3. CSS 檢驗：遮罩 display: none !important，正文讓位數值正確
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html\[data-layout="phone-landscape"\]\s+\.writing-cards-overlay[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.editor-pane\.yield-right[\s\S]*?margin-right:\s*290px/);
    expect(css).toMatch(/html\[data-layout="medium"\]\s+\.writing-cards-overlay[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="medium"\][\s\S]*?\.editor-pane\.yield-right[\s\S]*?margin-right:\s*380px/);
  });

  it('WO-56：寬版看卡片置於右側欄（write-aside），與正文並排不蓋字', () => {
    const wideHtml = renderWriteScreenWithLayout('wide', 'both', { right: true });

    // write-aside 展開且內部包含看卡片抽屜元件
    expect(wideHtml).toContain('data-testid="write-aside"');
    expect(wideHtml).toContain('aside-open');
    expect(wideHtml).toContain('data-testid="writing-cards-drawer"');
    expect(wideHtml).toContain(CARDS_PANEL_ARIA);

    // CSS 寬版 write-aside 內置 drawer 設為 static 並排
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-aside\s+\.writing-cards-drawer[\s\S]*?position:\s*static\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-aside\s+\.writing-cards-drawer[\s\S]*?box-shadow:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-aside\s+\.writing-cards-overlay[\s\S]*?display:\s*none\s*!important/);
  });

  it('WO-56：寬版 1024–1279 遵守 one-side 規則（打開看卡片目錄自動收起，關閉後目錄自動恢復）', () => {
    const wideOneSide = { mode: 'wide' as const, wideColumns: 'one-side' as const };
    let state = createInitialPanelsState({ left: true, right: false });

    // 打開右欄看卡片：左目錄自動收起並記錄
    state = openSidePanel(state, 'right', wideOneSide);
    expect(state.sidePanels).toEqual({ left: false, right: true });
    expect(state.savedForOneSide).toBe('left');

    // 關閉右欄看卡片：左目錄自動恢復
    state = closeSidePanel(state, 'right', wideOneSide);
    expect(state.sidePanels).toEqual({ left: true, right: false });
    expect(state.savedForOneSide).toBeNull();
  });

  it('WO-56：看卡片面板包含「只能看」標記，且絕無編輯、新增、刪除或 disabled 按鈕', () => {
    const wideHtml = renderWriteScreenWithLayout('wide', 'both', { right: true });

    // 具備「只能看」標籤
    expect(wideHtml).toContain(CARDS_READONLY_BADGE);
    expect(CARDS_READONLY_BADGE).toBe('只能看');

    // 看卡片面板本體絕無編輯、新增、刪除或 disabled 變灰按鈕
    const drawerHtml = wideHtml.slice(wideHtml.indexOf('data-testid="writing-cards-drawer"'));
    expect(drawerHtml).not.toContain('新增卡片');
    expect(drawerHtml).not.toContain('編輯卡片');
    expect(drawerHtml).not.toContain('刪除卡片');
    expect(drawerHtml).not.toContain('disabled');
  });
});

describe('WO-56：換版面狀態保留與空狀態操作導引驗證', () => {
  it('WO-56：換版面時選取的分類與卡片保留（狀態不因版面重建而丟失）', () => {
    const targetCategory = 'character';
    const targetCard = '20000000-0000-4000-8000-000000000001';

    // 1. 直拿手機
    const htmlPortrait = renderCardsScreenWithLayout('phone-portrait', null, {
      initialCategoryId: targetCategory,
      initialCardId: targetCard,
    });
    expect(htmlPortrait).toContain('【範例】沈雨晴');
    expect(htmlPortrait).toContain('鐘錶修復師的養女');

    // 2. 橫拿手機
    const htmlLandscape = renderCardsScreenWithLayout('phone-landscape', null, {
      initialCategoryId: targetCategory,
      initialCardId: targetCard,
    });
    expect(htmlLandscape).toContain('【範例】沈雨晴');
    expect(htmlLandscape).toContain('鐘錶修復師的養女');

    // 3. 中等版面
    const htmlMedium = renderCardsScreenWithLayout('medium', null, {
      initialCategoryId: targetCategory,
      initialCardId: targetCard,
    });
    expect(htmlMedium).toContain('【範例】沈雨晴');
    expect(htmlMedium).toContain('鐘錶修復師的養女');

    // 4. 寬版版面
    const htmlWide = renderCardsScreenWithLayout('wide', 'both', {
      initialCategoryId: targetCategory,
      initialCardId: targetCard,
    });
    expect(htmlWide).toContain('【範例】沈雨晴');
    expect(htmlWide).toContain('鐘錶修復師的養女');
  });

  it('WO-56：四種版面在空狀態（未選分類/未選卡片）下均提供可操作引導，不可整頁空白', () => {
    // 寬版未選分類與卡片
    const htmlWideEmpty = renderCardsScreenWithLayout('wide', 'both');
    expect(htmlWideEmpty).toContain(CARDS_EMPTY_CATEGORY_HINT);
    expect(htmlWideEmpty).toContain(CARDS_EMPTY_CARD_HINT);
    expect(htmlWideEmpty).toContain('data-testid="category-list"');

    // 中等版面未選分類
    const htmlMediumEmpty = renderCardsScreenWithLayout('medium');
    expect(htmlMediumEmpty).toContain(CARDS_EMPTY_CATEGORY_HINT);
    expect(htmlMediumEmpty).toContain('data-testid="category-list"');

    // 手機橫拿未選分類
    const htmlLandscapeEmpty = renderCardsScreenWithLayout('phone-landscape');
    expect(htmlLandscapeEmpty).toContain('data-testid="category-list"');

    // 手機直拿未選分類
    const htmlPortraitEmpty = renderCardsScreenWithLayout('phone-portrait');
    expect(htmlPortraitEmpty).toContain('data-testid="category-list"');
  });

  it('WO-56：按鈕與點擊熱區遵守 --hit-size（觸控 ≥44px、滑鼠 36px）', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    // 觸控熱區 ≥ 44px
    expect(css).toMatch(/\.category-card[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.card-item-button[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.cards-subcard-button[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/);
    expect(css).toMatch(/\.card-chevron-button[\s\S]*?min-width:\s*var\(--hit-size,\s*44px\)/);

    // 滑鼠模式熱區約 36px
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.category-card[\s\S]*?min-height:\s*var\(--hit-size,\s*36px\)/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.card-item-button[\s\S]*?min-height:\s*var\(--hit-size,\s*36px\)/);
  });

  it('WO-56：卡片色彩規範一致（預設色 #3C3F41 與空字串不畫色條/淡底，其他顏色調亮且具 3:1 對比）', () => {
    // 預設色
    expect(isDefaultCardColor('#3C3F41')).toBe(true);
    expect(isDefaultCardColor('#3c3f41')).toBe(true);
    expect(isDefaultCardColor('')).toBe(true);
    expect(isDefaultCardColor(null)).toBe(true);
    expect(cardVisualStyles('#3C3F41')).toBeNull();
    expect(cardVisualStyles('')).toBeNull();

    // 自訂顏色調亮驗證
    const blueVisual = cardVisualStyles('#61afef');
    expect(blueVisual).not.toBeNull();
    expect(blueVisual!.borderLeft).toBe('4px solid #61afef');
    expect(blueVisual!.backgroundColor).toBe('var(--panel)');
    expect(blueVisual!.backgroundImage).toContain('linear-gradient');

    // 深色驗證調亮
    const darkVisual = cardVisualStyles('#1a2b4c');
    expect(darkVisual).not.toBeNull();
    // 亮度應被調亮而非原始極暗色
    expect(darkVisual!.displayColor).not.toBe('#1a2b4c');
  });

  describe('WO-56：第 1 輪修正驗證（讓位不重複、目錄浮動鈕暫藏、預覽本書內容、關閉按鈕導向）', () => {
    it('WO-56：中等與手機橫拿開看卡片時讓位只算一次（正文框右緣緊貼面板左緣，不重複累加 margin）', () => {
      // 1. 中等版面開看卡片：正文容器只在 editor-pane 套用 yield-right，子層 editor 不重複掛載
      const mediumHtml = renderWriteScreenWithLayout('medium', null, { right: true }, 'fog', 'ch-1');
      expect(mediumHtml).toContain('editor-pane yield-right');
      expect(mediumHtml).not.toContain('editor yield-right');
      expect(mediumHtml).not.toContain('editor is-keyboard yield-right');

      // 2. 手機橫拿開看卡片：正文容器只在 editor-pane 套用 yield-right，子層 editor 不重複掛載
      const landscapeHtml = renderWriteScreenWithLayout('phone-landscape', null, { right: true }, 'fog', 'ch-1');
      expect(landscapeHtml).toContain('editor-pane yield-right');
      expect(landscapeHtml).not.toContain('editor yield-right');
      expect(landscapeHtml).not.toContain('editor is-keyboard yield-right');

      // 3. CSS 規則驗證：若嵌套，子層 editor margin-right 必強制歸零，防禦雙重累加
      const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
      expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.editor-pane\.yield-right\s+\.editor[\s\S]*?margin-right:\s*0\s*!important/);
      expect(css).toMatch(/html\[data-layout="medium"\][\s\S]*?\.editor-pane\.yield-right\s+\.editor[\s\S]*?margin-right:\s*0\s*!important/);
    });

    it('WO-56：手機橫拿開看卡片時左側目錄浮動鈕暫藏，不壓在正文字上', () => {
      const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

      // 看卡片開啟時（aside-open 或 yield-right），左側目錄浮動鈕隱藏
      expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.write-layout\.aside-open\s+\.floating-tree-trigger[\s\S]*?display:\s*none\s*!important/);
      expect(css).toMatch(/html\[data-layout="phone-landscape"\][\s\S]*?\.write-layout\.yield-right\s+\.floating-tree-trigger[\s\S]*?display:\s*none\s*!important/);
    });

    it('WO-56：手機橫拿資料集右側預覽顯示本書真實章節內容，標籤為章名，整本書無內容時顯示提示且唯讀', () => {
      // 1. 預設情境：顯示本書第一章真實內容
      const htmlDefault = renderCardsScreenWithLayout('phone-landscape', null, { initialCategoryId: 'character' });
      expect(htmlDefault).not.toContain('【範例正文】');
      expect(htmlDefault).not.toContain('地下道的燈管');
      expect(htmlDefault).toContain('第一章　來信');
      expect(htmlDefault).toContain('霧氣自港口緩緩爬上石階');
      // 預覽區唯讀：無輸入框或可編輯屬性
      expect(htmlDefault).not.toContain('contenteditable');

      // 2. 最近章節切換：若 session 記錄最近開啟章節，則優先顯示該章內容
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('jiufang:tree-place:fog', JSON.stringify({ nodeId: 'ch-2', prevId: null, offset: 0 }));
        const htmlRecent = renderCardsScreenWithLayout('phone-landscape', null, { initialCategoryId: 'character' });
        expect(htmlRecent).toContain('第二章　雨夜');
        window.sessionStorage.clear();
      }

      // 3. 全書皆無正文時：提示文字正確定義於 userFacing.ts
      expect(CARDS_PREVIEW_EMPTY_HINT).toBe('這份稿子還沒有正文。');
    });

    it('WO-56：手機橫拿資料集頁「關閉資料集」按鈕（✕）在各層皆導回寫作頁', () => {
      // 第一層（分類清單）：抽屜標題列包含關閉按鈕，標籤為關閉資料集
      const layer1 = renderCardsScreenWithLayout('phone-landscape');
      expect(layer1).toContain(CLOSE_CARDS_ARIA);
      expect(layer1).toContain('data-testid="close-cards-drawer"');

      // 第二層（卡片清單）：抽屜標題列同時具備返回上一層按鈕與關閉資料集按鈕
      const layer2 = renderCardsScreenWithLayout('phone-landscape', null, { initialCategoryId: 'character' });
      expect(layer2).toContain(BACK_TO_CATEGORIES_ARIA);
      expect(layer2).toContain(CLOSE_CARDS_ARIA);

      // 第三層（卡片內容）：抽屜標題列具備返回卡片清單按鈕與關閉資料集按鈕
      const layer3 = renderCardsScreenWithLayout('phone-landscape', null, {
        initialCategoryId: 'character',
        initialCardId: '20000000-0000-4000-8000-000000000001',
      });
      expect(layer3).toContain(BACK_TO_CARDS_ARIA);
      expect(layer3).toContain(CLOSE_CARDS_ARIA);
    });
  });
});
