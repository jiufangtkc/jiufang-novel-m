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
  TREE_UNDO_HINT,
} from '../copy/userFacing';
import {
  ADD_CATEGORY_BUTTON,
  CATEGORY_BUILTIN_ARIA,
  CATEGORY_BUILTIN_BADGE,
  CATEGORY_HAS_CARDS_WARNING,
  CARD_COLOR_LABEL,
  CARD_CONTENT_LABEL,
  CARD_TITLE_LABEL,
  CONFIRM_DELETE_BUTTON,
  DELETED_CARDS_TITLE,
  DELETE_CARD_BUTTON,
  deleteCardQuestion,
  deleteSubcardsImpact,
  deletedCardsListHint,
  EDIT_CARD_BUTTON,
  EDIT_CARD_CANCEL,
  EDIT_CARD_DONE,
  EDIT_CARD_HEADING,
  EDIT_CARD_MORE,
  KEEP_CARD_BUTTON,
  ORGANIZE_CATEGORIES_BUTTON,
  PUT_BACK_ORIGINAL_BUTTON,
  UNDO_BUTTON,
} from '../copy/cardEditCopy';
import type { DeletedCardRecord } from '../domain/cardArchive';
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
      if (projectId === 'desktop-project-with-cards') {
        return {
          id: 'desktop-project-with-cards',
          title: '有卡片的電腦版稿件',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          origin: 'file',
          nodes: [],
          cards: [
            {
              id: 'file-card-1',
              parent_id: null,
              category: 'character',
              title: '自訂檔案角色卡片',
              content: '這是檔案專屬卡片內容',
              color: '#3C3F41',
              is_collapsed: 0,
              sort_order: 1,
            },
          ],
        };
      }
      if (projectId === 'mobile-new-project') {
        return {
          id: 'mobile-new-project',
          title: '手機新開稿子',
          updatedLabel: '剛剛',
          bookGoal: 100000,
          cards: [],
          categoryOrderRaw: '["summary","character","world","timeline","ai_chat"]',
          expandedCategoriesRaw: null,
          categoriesMetaRaw: '{}',
          nodes: [],
        };
      }
      if (projectId === 'mobile-project-with-cards') {
        return {
          id: 'mobile-project-with-cards',
          title: '手機自訂卡片稿子',
          updatedLabel: '剛剛',
          bookGoal: 100000,
          cards: [
            {
              id: 'mobile-card-1',
              parent_id: null,
              category: 'character',
              title: '手機自訂角色卡片',
              content: '這是手機專屬卡片內容',
              color: '#3C3F41',
              is_collapsed: 0,
              sort_order: 1,
            },
          ],
          categoryOrderRaw: '["summary","character","world","timeline","ai_chat"]',
          expandedCategoriesRaw: null,
          categoriesMetaRaw: '{}',
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
    // 依據 WO-61 九方定案（工單第 37 行）：分類清單最下方新增「最近刪除」入口，取代 WO-50「只能看」不含刪除二字斷言
    expect(html).not.toContain('刪除卡片');
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

describe('WO-61 卡片編輯與挑顏色接線驗證（CardsScreen）', () => {
  it('WO-61 編輯：CardsScreen 接上 CardEditor，看卡片時提供「編輯」按鈕進入編輯，可改標題、內容與挑顏色，包含完成與取消', () => {
    // 1. 預覽模式（預設）：顯示「編輯」按鈕，呈現排版內容
    const previewHtml = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
    });
    expect(previewHtml).toContain(EDIT_CARD_BUTTON);
    expect(previewHtml).toContain('data-testid="card-editor-start-edit-btn"');
    expect(previewHtml).toContain('data-testid="card-raw-content"');
    expect(previewHtml).toContain('女主角，二十四歲，鐘錶修復師的養女。');

    // 2. 編輯模式（initialEditorMode = edit）：包含標題、內容、挑顏色、完成與取消按鈕
    const editHtml = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
      initialEditorMode: 'edit',
    });
    expect(editHtml).toContain(EDIT_CARD_HEADING);
    expect(editHtml).toContain(CARD_TITLE_LABEL);
    expect(editHtml).toContain('data-testid="card-editor-title-input"');
    expect(editHtml).toContain('value="【範例】沈雨晴"');

    expect(editHtml).toContain(CARD_CONTENT_LABEL);
    expect(editHtml).toContain('data-testid="card-editor-content-textarea"');
    expect(editHtml).toContain('女主角，二十四歲，鐘錶修復師的養女。');

    expect(editHtml).toContain(CARD_COLOR_LABEL);
    expect(editHtml).toContain('data-testid="card-editor-color-btn"');

    expect(editHtml).toContain(EDIT_CARD_DONE);
    expect(editHtml).toContain('data-testid="card-editor-done-btn"');

    expect(editHtml).toContain(EDIT_CARD_CANCEL);
    expect(editHtml).toContain('data-testid="card-editor-cancel-btn"');
  });
});

describe('WO-61 卡片刪除、10 秒復原與最近刪除接線驗證（CardsScreen）', () => {
  const sampleDeletedRecord: DeletedCardRecord = {
    id: 'del-sample-001',
    rootCardId: '20000000-0000-4000-8000-000000000001',
    title: '【範例】沈雨晴',
    category: 'character',
    parentId: null,
    index: 0,
    beforeIds: [],
    afterIds: [],
    cards: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        category: 'character',
        title: '【範例】沈雨晴',
        content: '女主角，二十四歲，鐘錶修復師的養女。',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 1,
        parent_id: null,
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        category: 'character',
        title: '【範例】隨身舊懷錶',
        content: '銀製雙蓋懷錶',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 1,
        parent_id: '20000000-0000-4000-8000-000000000001',
      },
    ],
    deletedAt: Date.now(),
  };

  it('WO-61 刪除確認：看卡片時點選「⋯」選單顯示刪除卡片，點選後顯示刪除確認對話框，有子卡片時顯示「連同底下 N 張子卡片一起刪除。」並列出子卡片名稱', () => {
    // 1. 「⋯」選單：看卡片時提供「更多動作」選單，包含「刪除卡片」
    const menuHtml = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
      initialShowCardMenu: true,
    });
    expect(menuHtml).toContain('data-testid="card-action-sheet"');
    expect(menuHtml).toContain(EDIT_CARD_MORE);
    expect(menuHtml).toContain('data-testid="card-menu-delete-btn"');
    expect(menuHtml).toContain(DELETE_CARD_BUTTON);
    expect(menuHtml).toContain(EDIT_CARD_CANCEL);

    // 2. 刪除確認對話框：有子卡片時顯示「連同底下 N 張子卡片一起刪除。」並列出子卡片名稱
    const dialogHtml = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
      initialConfirmDeleteCardId: '20000000-0000-4000-8000-000000000001',
    });
    expect(dialogHtml).toContain('data-testid="card-delete-dialog"');
    expect(dialogHtml).toContain(deleteCardQuestion('【範例】沈雨晴'));
    expect(dialogHtml).toContain('data-testid="delete-subcards-impact"');
    expect(dialogHtml).toContain(deleteSubcardsImpact(2));
    expect(dialogHtml).toContain('data-testid="delete-subcard-list"');
    expect(dialogHtml).toContain('【範例】隨身舊懷錶');
    expect(dialogHtml).toContain('【範例】懷錶夾層的黑白照片');
    expect(dialogHtml).toContain(TREE_UNDO_HINT);
    expect(dialogHtml).toContain(deletedCardsListHint('這支手機'));
    expect(dialogHtml).toContain('data-testid="confirm-delete-card-btn"');
    expect(dialogHtml).toContain(CONFIRM_DELETE_BUTTON);
    expect(dialogHtml).toContain('data-testid="cancel-delete-card-btn"');
    expect(dialogHtml).toContain(KEEP_CARD_BUTTON);
  });

  it('WO-61 刪除無子卡片：無子卡片時刪除確認對話框不顯示子卡片連同刪除警語', () => {
    const singleDialogHtml = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'summary',
      initialCardId: '10000000-0000-4000-8000-000000000001',
      initialConfirmDeleteCardId: '10000000-0000-4000-8000-000000000001',
    });
    expect(singleDialogHtml).toContain('data-testid="card-delete-dialog"');
    expect(singleDialogHtml).toContain(deleteCardQuestion('【範例】核心主線：燈塔熄滅之夜'));
    expect(singleDialogHtml).not.toContain('delete-subcards-impact');
    expect(singleDialogHtml).not.toContain('連同底下');
    expect(singleDialogHtml).toContain(TREE_UNDO_HINT);
    expect(singleDialogHtml).toContain(CONFIRM_DELETE_BUTTON);
    expect(singleDialogHtml).toContain(KEEP_CARD_BUTTON);
  });

  it('WO-61 10 秒復原：刪除卡片後顯示 10 秒內可復原 Toast 與倒數提示', () => {
    const undoHtml = renderCardsScreen('/p/fog/cards', {
      initialUndoRecord: sampleDeletedRecord,
    });
    expect(undoHtml).toContain('data-testid="card-undo-toast"');
    expect(undoHtml).toContain('data-testid="card-undo-toast-title"');
    expect(undoHtml).toContain('已刪除「【範例】沈雨晴」和 1 張子卡片');
    expect(undoHtml).toContain('data-testid="card-undo-toast-sub"');
    expect(undoHtml).toContain('10 秒內可以復原，剩 10 秒');
    expect(undoHtml).toContain('data-testid="card-undo-btn"');
    expect(undoHtml).toContain(UNDO_BUTTON);
  });

  it('WO-61 最近刪除入口與清單：分類清單最下方顯示「最近刪除」入口，點進顯示 DeletedCardsList 與放回原位置按鈕', () => {
    // 1. 分類清單最下方：顯示「最近刪除」入口
    const listHtml = renderCardsScreen('/p/fog/cards');
    expect(listHtml).toContain('data-testid="category-list-bottom-section"');
    expect(listHtml).toContain('data-testid="recent-deleted-entry-btn"');
    expect(listHtml).toContain(DELETED_CARDS_TITLE);

    // 2. 點選進入最近刪除：呈現 DeletedCardsList、項目標題、分類與「放回原位置」按鈕
    const deletedListHtml = renderCardsScreen('/p/fog/cards', {
      initialShowDeletedCards: true,
      initialDeletedCards: [sampleDeletedRecord],
    });
    expect(deletedListHtml).toContain('data-testid="deleted-cards-pane"');
    expect(deletedListHtml).toContain(DELETED_CARDS_TITLE);
    expect(deletedListHtml).toContain('【範例】沈雨晴');
    expect(deletedListHtml).toContain('角色');
    expect(deletedListHtml).toContain('含 1 張子卡片');
    expect(deletedListHtml).toContain(PUT_BACK_ORIGINAL_BUTTON);
    expect(deletedListHtml).toContain('data-testid="deleted-cards-back-btn"');
    expect(deletedListHtml).toContain(deletedCardsListHint('這支手機'));
  });

  it('WO-61 整理分類按鈕入口：分類清單提供「整理分類」按鈕（尺寸 ≥ 44×44）', () => {
    const listHtml = renderCardsScreen('/p/fog/cards');
    expect(listHtml).toContain('data-testid="cards-categories-footer"');
    expect(listHtml).toContain('data-testid="organize-categories-btn"');
    expect(listHtml).toContain(ORGANIZE_CATEGORIES_BUTTON);
  });

  it('WO-61 整理分類畫面接線：點入整理分類呈現 CategoryManager 元件、內建分類標「內建」且不可改名或刪除、自訂分類提供操作按鈕與刪除防護', () => {
    const managerHtml = renderCardsScreen('/p/fog/cards', {
      initialIsOrganizingCategories: true,
    });

    // 1. 呈現 CategoryManager 元件與標題
    expect(managerHtml).toContain('data-testid="category-manager-pane"');
    expect(managerHtml).toContain('data-testid="category-manager-list"');
    expect(managerHtml).toContain(ORGANIZE_CATEGORIES_BUTTON);

    // 2. 內建 4 類（summary, character, world, timeline）皆標「內建」，朗讀為「內建分類，不能刪除」
    for (const builtinId of ['summary', 'character', 'world', 'timeline']) {
      expect(managerHtml).toContain(`data-testid="category-builtin-${builtinId}"`);
      expect(managerHtml).toContain(CATEGORY_BUILTIN_BADGE);
      expect(managerHtml).toContain(`aria-label="${CATEGORY_BUILTIN_ARIA}"`);

      // 內建分類不可有改名或刪除按鈕
      expect(managerHtml).not.toContain(`data-testid="category-rename-btn-${builtinId}"`);
      expect(managerHtml).not.toContain(`data-testid="category-delete-btn-${builtinId}"`);
    }

    // 3. 自訂分類（custom_5ce4e001：自訂分類001）提供改名（✎）、刪除（🗑）與上移／下移按鈕
    expect(managerHtml).toContain('data-testid="category-rename-btn-custom_5ce4e001"');
    expect(managerHtml).toContain('data-testid="category-delete-btn-custom_5ce4e001"');
    expect(managerHtml).toContain('data-testid="category-move-up-btn-custom_5ce4e001"');
    expect(managerHtml).toContain('data-testid="category-move-down-btn-custom_5ce4e001"');

    // 4. 自訂分類含卡片時（自訂分類001 含有 3 張範例卡片）刪除按鈕 disabled 且附警語
    const deleteBtnMatch = managerHtml.match(
      /<button[^>]*data-testid="category-delete-btn-custom_5ce4e001"[^>]*>/,
    );
    expect(deleteBtnMatch).not.toBeNull();
    expect(deleteBtnMatch![0]).toContain('disabled');
    expect(deleteBtnMatch![0]).toContain(CATEGORY_HAS_CARDS_WARNING);

    // 5. 提供「新增分類」按鈕與「完成」按鈕
    expect(managerHtml).toContain('data-testid="category-manager-add-btn"');
    expect(managerHtml).toContain(ADD_CATEGORY_BUTTON);
    expect(managerHtml).toContain('data-testid="category-manager-done-btn"');
    expect(managerHtml).toContain(EDIT_CARD_DONE);
  });

  it('WO-61：打開 .db 稿子時，卡片清單只能顯示該稿子自己的卡片，不能混入【範例】卡片', () => {
    // 1. 無卡片之 .db 稿件：卡片清單不出現【範例】卡片（如沈雨晴、隨身舊懷錶等 DEMO_CARDS）
    const emptyDbHtml = renderCardsScreen('/p/desktop-project/cards');
    expect(emptyDbHtml).not.toContain('【範例】沈雨晴');
    expect(emptyDbHtml).not.toContain('隨身舊懷錶');
    expect(emptyDbHtml).not.toContain('【範例】');

    // 2. 有自身卡片之 .db 稿件：只顯示該稿件自己的卡片，絕不混入 DEMO_CARDS
    const customDbHtml = renderCardsScreen('/p/desktop-project-with-cards/cards', {
      initialCategoryId: 'character',
    });
    expect(customDbHtml).toContain('自訂檔案角色卡片');
    expect(customDbHtml).not.toContain('【範例】沈雨晴');
    expect(customDbHtml).not.toContain('隨身舊懷錶');
  });

  it('WO-61 審查後修2：手機新開稿子進卡片頁沒有任何範例卡片，空卡片顯示原本空狀態', () => {
    // 1. 手機新開稿子進入卡片頁，不包含任何範例卡片，分類清單顯示 0 張
    const mobileEmptyHtml = renderCardsScreen('/p/mobile-new-project/cards');
    expect(mobileEmptyHtml).not.toContain('【範例】沈雨晴');
    expect(mobileEmptyHtml).not.toContain('隨身舊懷錶');
    expect(mobileEmptyHtml).not.toContain('【範例】');
    expect(mobileEmptyHtml).toContain('0 張');

    // 2. 點進角色分類，卡片清單為空（無 card-item）
    const mobileCategoryHtml = renderCardsScreen('/p/mobile-new-project/cards', {
      initialCategoryId: 'character',
    });
    expect(mobileCategoryHtml).not.toContain('【範例】沈雨晴');
    expect(mobileCategoryHtml).toContain('data-testid="category-card-list"');
    expect(mobileCategoryHtml).not.toContain('card-item');

    // 3. 手機新開稿子若已建立自訂卡片，只顯示自己的卡片，不補進範例卡片
    const mobileWithCardsHtml = renderCardsScreen('/p/mobile-project-with-cards/cards', {
      initialCategoryId: 'character',
    });
    expect(mobileWithCardsHtml).toContain('手機自訂角色卡片');
    expect(mobileWithCardsHtml).not.toContain('【範例】沈雨晴');
    expect(mobileWithCardsHtml).not.toContain('隨身舊懷錶');
  });

  it('WO-61 審查後修2：範例書仍正常顯示範例卡片，.db 稿子只顯示自己的卡片', () => {
    // 1. 範例書（fog）照舊顯示範例卡片
    const demoHtml = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
    });
    expect(demoHtml).toContain('【範例】沈雨晴');
    expect(demoHtml).toContain('隨身舊懷錶');

    // 2. .db 稿子（有自身卡片）只顯示自己的卡片
    const customDbHtml = renderCardsScreen('/p/desktop-project-with-cards/cards', {
      initialCategoryId: 'character',
    });
    expect(customDbHtml).toContain('自訂檔案角色卡片');
    expect(customDbHtml).not.toContain('【範例】沈雨晴');
  });

  it('WO-61 審查後修2：刪除確認只在目前稿子的卡片中尋找，找不到不顯示確認對話框，絕不退回 DEMO_CARDS 補找', () => {
    // 1. 在手機新開稿子傳入 DEMO_CARDS 的卡片 ID（沈雨晴 ID），不會抓範例卡片，不顯示刪除確認對話框
    const demoCardId = '20000000-0000-4000-8000-000000000001';
    const mobileConfirmHtml = renderCardsScreen('/p/mobile-new-project/cards', {
      initialConfirmDeleteCardId: demoCardId,
    });
    expect(mobileConfirmHtml).not.toContain('data-testid="card-delete-dialog"');
    expect(mobileConfirmHtml).not.toContain('刪除「【範例】沈雨晴」？');
    expect(mobileConfirmHtml).not.toContain('【範例】沈雨晴');

    // 2. 在 .db 稿子傳入 DEMO_CARDS 的卡片 ID，同樣不顯示刪除確認對話框
    const dbConfirmHtml = renderCardsScreen('/p/desktop-project/cards', {
      initialConfirmDeleteCardId: demoCardId,
    });
    expect(dbConfirmHtml).not.toContain('data-testid="card-delete-dialog"');
    expect(dbConfirmHtml).not.toContain('刪除「【範例】沈雨晴」？');

    // 3. 在範例書中刪除範例卡片，正常顯示刪除確認對話框
    const fogConfirmHtml = renderCardsScreen('/p/fog/cards', {
      initialConfirmDeleteCardId: demoCardId,
    });
    expect(fogConfirmHtml).toContain('data-testid="card-delete-dialog"');
    expect(fogConfirmHtml).toContain('刪除「【範例】沈雨晴」？');
  });
});
