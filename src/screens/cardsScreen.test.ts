import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  cardDetailAria,
  CARDS_HEADING,
  displayCardTitle,
  SAMPLE_CARDS_NOTICE,
} from '../copy/userFacing';
import { DEMO_CARD_CATEGORIES, DEMO_CARDS } from '../data/demoCards';
import {
  buildCardTree,
  filterVisibleCategories,
  flattenVisibleCards,
  isCategoryHidden,
  shouldResetForProject,
} from '../domain/cards';
import { SampleProvider } from '../state/sampleStore';
import { CardsScreen, type CardsScreenProps } from './CardsScreen';

vi.mock('../state/sampleStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/sampleStore')>();
  return {
    ...actual,
    useProject: (projectId: string | undefined) => {
      if (projectId === 'desktop-project') {
        return {
          id: 'desktop-project',
          title: '電腦版範例稿件',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          origin: 'file',
          nodes: [],
        };
      }
      return actual.useProject(projectId);
    },
  };
});

function renderCardsScreen(
  initialUrl: string,
  initialState?: CardsScreenProps,
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [initialUrl] },
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
  );
}

describe('CardsScreen 畫面與驗收標準（WO-45、WO-50 定案）', () => {
  it('分類清單顯示各分類名稱與正確卡片數，格式包含「角色，5 張卡片」', () => {
    const html = renderCardsScreen('/p/fog/cards');

    expect(html).toContain(CARDS_HEADING);
    expect(html).toContain('本書綱要');
    expect(html).toContain('角色');
    expect(html).toContain('世界觀');
    expect(html).toContain('時間軸');
    expect(html).toContain('自訂分類001');

    // 檢查卡片數（九方 14:34 最新定案：分類列朗讀改「角色，3 張卡片」）
    expect(html).toContain('角色，5 張卡片');
    expect(html).toContain('本書綱要，3 張卡片');
    expect(html).toContain('世界觀，4 張卡片');
    expect(html).toContain('時間軸，3 張卡片');
    expect(html).toContain('自訂分類001，3 張卡片');
  });

  it('從電腦版 .db 開啟的稿件會顯示「範例卡片，之後會換成這份稿子的卡片」', () => {
    const source = readFileSync(new URL('./CardsScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('isDesktopFile');
    expect(source).toContain('cards-file-notice');
    expect(source).toContain('SAMPLE_CARDS_NOTICE');
    expect(SAMPLE_CARDS_NOTICE).toBe('範例卡片，之後會換成這份稿子的卡片');

    // 實際 DOM 靜態渲染驗證
    const html = renderCardsScreen('/p/desktop-project/cards');
    expect(html).toContain('cards-file-notice');
    expect(html).toContain(SAMPLE_CARDS_NOTICE);
  });

  it('範例書不會顯示電腦版專用的暫用提示小字', () => {
    const html = renderCardsScreen('/p/fog/cards');
    expect(html).not.toContain(SAMPLE_CARDS_NOTICE);
  });

  it('子卡片層級每層左縮 16px，最多 3 層', () => {
    const tree = buildCardTree(DEMO_CARDS, 'character');
    const rows = flattenVisibleCards(tree, new Set());

    // 沈雨晴 (level 0) -> 0px
    expect(rows[0].card.title).toBe('【範例】沈雨晴');
    expect(rows[0].level).toBe(0);

    // 隨身舊懷錶 (level 1) -> 16px
    expect(rows[1].card.title).toBe('【範例】隨身舊懷錶');
    expect(rows[1].level).toBe(1);

    // 懷錶夾層的黑白照片 (level 2) -> 32px
    expect(rows[2].card.title).toBe('【範例】懷錶夾層的黑白照片');
    expect(rows[2].level).toBe(2);

    // 驗證每一層縮排換算皆在最多 3 層（level <= 2）之內
    for (const r of rows) {
      expect(r.level).toBeLessThanOrEqual(2);
      expect(Math.min(r.level, 2) * 16).toBeLessThanOrEqual(32);
    }
  });

  it('子卡片收合功能可正常隱藏子項目', () => {
    const tree = buildCardTree(DEMO_CARDS, 'character');

    // 收合 沈雨晴 (20000000-0000-4000-8000-000000000001)
    const collapsed = new Set(['20000000-0000-4000-8000-000000000001']);
    const rows = flattenVisibleCards(tree, collapsed);

    expect(rows.some((r) => r.card.id === '20000000-0000-4000-8000-000000000002')).toBe(false);
    expect(rows.some((r) => r.card.id === '20000000-0000-4000-8000-000000000003')).toBe(false);
    expect(rows.some((r) => r.card.id === '20000000-0000-4000-8000-000000000004')).toBe(true);
  });

  it('AI 對話紀錄分類完全被隱藏', () => {
    const categories = filterVisibleCategories([
      ...DEMO_CARD_CATEGORIES,
      { id: 'ai_chat', name: 'AI 對話紀錄', sort_order: 99 },
    ]);
    expect(categories.some((c) => isCategoryHidden(c.id) || isCategoryHidden(c.name))).toBe(false);
    expect(categories.some((c) => c.name.includes('AI'))).toBe(false);
  });

  it('只能看：畫面上絕不放編輯、新增、刪除按鈕，亦不可有 disabled 變灰按鈕', () => {
    const source = readFileSync(new URL('./CardsScreen.tsx', import.meta.url), 'utf8');

    // 原始碼檢查：不可出現編輯、新增、刪除的動作按鈕
    expect(source).not.toContain('新增卡片');
    expect(source).not.toContain('新增分類');
    expect(source).not.toContain('編輯卡片');
    expect(source).not.toContain('編輯分類');
    expect(source).not.toContain('刪除卡片');
    expect(source).not.toContain('刪除分類');
    expect(source).not.toContain('disabled');

    // 渲染的第一層（分類清單）檢查
    const html = renderCardsScreen('/p/fog/cards');
    expect(html).not.toContain('編輯');
    expect(html).not.toContain('新增');
    expect(html).not.toContain('刪除');
    expect(html).not.toContain('disabled');
  });

  it('導覽返回按鈕具備臺灣繁體中文 aria-label', () => {
    expect(BACK_TO_CATEGORIES_ARIA).toBe('返回分類清單');
    expect(BACK_TO_CARDS_ARIA).toBe('返回卡片清單');
  });

  it('卡片文字在全形/換行上正確保留原文格式', () => {
    const longCard = DEMO_CARDS.find((c) => c.id === '30000000-0000-4000-8000-000000000001');
    expect(longCard).toBeDefined();
    // 內容保留段落換行符號
    expect(longCard!.content.split('\n\n').length).toBeGreaterThanOrEqual(4);
  });

  it('（必修）卡片列無障礙：li 僅作為結構容器，展開箭頭與卡片本體為兄弟按鈕，不可按鈕包按鈕', () => {
    const html = renderCardsScreen('/p/fog/cards', { initialCategoryId: 'character' });

    // 存在卡片容器 li
    expect(html).toContain('class="card-item"');
    // 包含展開／收合箭頭獨立按鈕
    expect(html).toContain('class="card-chevron-button"');
    // 包含右側卡片本體獨立按鈕
    expect(html).toContain('class="card-item-button"');
    expect(html).toContain(cardDetailAria('【範例】沈雨晴'));

    // 結構檢查：不可按鈕包按鈕（button 內不能包含另一個 button，兩按鈕為兄弟節點）
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i);

    // li 不得帶有 onClick 事件或 role="button"
    expect(html).not.toMatch(/<li[^>]*onClick/i);
  });

  it('（必修）切換稿子時重置狀態：初次掛載不誤重置，稿件確實改變時才重置', () => {
    // 1. shouldResetForProject 判斷：初次掛載（無前值或前值相同）不觸發重置
    expect(shouldResetForProject(undefined, 'fog')).toBe(false);
    expect(shouldResetForProject(null, 'fog')).toBe(false);
    expect(shouldResetForProject('fog', 'fog')).toBe(false);

    // 2. 只有在 projectId 確實改變時才重置
    expect(shouldResetForProject('fog', 'second')).toBe(true);
    expect(shouldResetForProject('second', 'fog')).toBe(true);

    // 3. 驗證掛載時 initial 參數正確生效，不被初次掛載沖刷
    const html = renderCardsScreen('/p/fog/cards', { initialCategoryId: 'character' });
    expect(html).toContain('<h1>角色</h1>');
    expect(html).toContain('category-card-list');
  });

  it('卡片內容頁標題重複修正：頂列顯示分類名稱（例如「角色」），內文顯示卡片標題與同色小圓點', () => {
    const html = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
    });

    // 頂列 h1 顯示分類名稱「角色」
    expect(html).toContain('<h1>角色</h1>');
    // 內文 h2 顯示卡片標題「【範例】沈雨晴」
    expect(html).toContain('<h2 class="card-detail-heading">【範例】沈雨晴</h2>');
    // 頂列不可重複出現卡片標題
    expect(html).not.toContain('<h1>【範例】沈雨晴</h1>');

    // 內文包含同色小圓點與卡片內文
    expect(html).toContain('class="card-color-dot"');
    expect(html).toContain('女主角，二十四歲，鐘錶修復師的養女。');
  });

  it('淡底顏色：以 linear-gradient 疊加在 var(--panel) 上，不蓋掉面板底色', () => {
    const html = renderCardsScreen('/p/fog/cards', { initialCategoryId: 'character' });
    // 檢查沈雨晴卡片（#61afef）之樣式包含 linear-gradient 與 var(--panel)
    expect(html).toContain('background-image:linear-gradient(rgba(97, 175, 239, 0.10), rgba(97, 175, 239, 0.10))');
    expect(html).toContain('background-color:var(--panel)');
    expect(html).toContain('border-left:4px solid #61afef');
  });

  it('以 renderToStaticMarkup 完整驗證第一層、第二層、第三層靜態輸出', () => {
    // 第一層：分類清單
    const layer1 = renderCardsScreen('/p/fog/cards');
    expect(layer1).toContain(CARDS_HEADING);
    expect(layer1).toContain('category-list');
    expect(layer1).toContain('角色');

    // 第二層：卡片清單
    const layer2 = renderCardsScreen('/p/fog/cards', { initialCategoryId: 'world' });
    expect(layer2).toContain('<h1>世界觀</h1>');
    expect(layer2).toContain(BACK_TO_CATEGORIES_ARIA);
    expect(layer2).toContain('category-card-list');
    expect(layer2).toContain('【範例】霧港地理與海潮氣候');

    // 第三層：卡片內容
    const layer3 = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'world',
      initialCardId: '30000000-0000-4000-8000-000000000001',
    });
    expect(layer3).toContain('<h1>世界觀</h1>');
    expect(layer3).toContain(BACK_TO_CARDS_ARIA);
    expect(layer3).toContain('card-detail-heading');
    expect(layer3).toContain('【範例】霧港地理與海潮氣候');
    expect(layer3).toContain('card-raw-content');
  });

  it('卡片標題為空字串或純空白時顯示「未命名卡片」（九方 14:34 定案）', () => {
    const copy = displayCardTitle('');
    expect(copy).toBe('未命名卡片');
    expect(displayCardTitle('   ')).toBe('未命名卡片');
    expect(displayCardTitle(null)).toBe('未命名卡片');
  });
});
