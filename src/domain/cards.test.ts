import { describe, expect, it } from 'vitest';
import {
  DEMO_CARD_CATEGORIES,
  DEMO_CARDS,
  DEMO_CATEGORIES_META_RAW,
  DEMO_CATEGORY_ORDER_RAW,
  DEMO_CUSTOM_CATEGORY_ID,
  DEMO_CUSTOM_CATEGORY_NAME,
  type CardCategory,
  type DemoCard,
} from '../data/demoCards';
import { parseCategoriesMeta, parseCategoryOrder } from './cardCategories';
import {
  adjustColorForDarkTheme,
  buildCardTree,
  cardsViewReducer,
  cardVisualStyles,
  contrastRatio,
  countCardsInCategory,
  DEFAULT_CARD_COLOR,
  filterVisibleCategories,
  flattenVisibleCards,
  HIDDEN_CATEGORY_IDS,
  initialCardsViewState,
  isCategoryHidden,
  isDefaultCardColor,
  parseHexColor,
  shouldResetForProject,
  sRgbLuminance,
  type CardsViewState,
} from './cards';

const SHEN_CARD_ID = '20000000-0000-4000-8000-000000000001';
const WATCH_CARD_ID = '20000000-0000-4000-8000-000000000002';
const PHOTO_CARD_ID = '20000000-0000-4000-8000-000000000003';
const LU_CARD_ID = '20000000-0000-4000-8000-000000000004';
const CHEN_CARD_ID = '20000000-0000-4000-8000-000000000005';
const WORLD_LONG_CARD_ID = '30000000-0000-4000-8000-000000000001';

describe('資料集卡片分類與卡片數（WO-45、WO-53）', () => {
  it('五個分類各含 3～5 張卡片', () => {
    const categories = filterVisibleCategories(DEMO_CARD_CATEGORIES);
    expect(categories.map((c) => c.name)).toEqual([
      '本書綱要',
      '角色',
      '世界觀',
      '時間軸',
      '自訂分類001',
    ]);

    expect(countCardsInCategory(DEMO_CARDS, 'summary')).toBe(3);
    expect(countCardsInCategory(DEMO_CARDS, 'character')).toBe(5);
    expect(countCardsInCategory(DEMO_CARDS, 'world')).toBe(4);
    expect(countCardsInCategory(DEMO_CARDS, 'timeline')).toBe(3);
    expect(countCardsInCategory(DEMO_CARDS, DEMO_CUSTOM_CATEGORY_ID)).toBe(3);

    for (const cat of categories) {
      const count = countCardsInCategory(DEMO_CARDS, cat.id);
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
    }
  });

  it('角色分類總數為 5 張，符合「角色　5」規範', () => {
    const charCount = countCardsInCategory(DEMO_CARDS, 'character');
    expect(charCount).toBe(5);
  });
});

describe('子卡片層級與收合（WO-45）', () => {
  it('至少有一張卡片擁有兩層子卡片（共三層），且最多三層', () => {
    const tree = buildCardTree(DEMO_CARDS, 'character');
    const shenNode = tree.find((node) => node.card.id === SHEN_CARD_ID);
    expect(shenNode).toBeDefined();
    expect(shenNode!.level).toBe(0);
    expect(shenNode!.children.length).toBe(1);

    const watchNode = shenNode!.children[0];
    expect(watchNode.card.id).toBe(WATCH_CARD_ID);
    expect(watchNode.level).toBe(1);
    expect(watchNode.children.length).toBe(1);

    const photoNode = watchNode.children[0];
    expect(photoNode.card.id).toBe(PHOTO_CARD_ID);
    expect(photoNode.level).toBe(2);
    expect(photoNode.children.length).toBe(0);
  });

  it('預設全部展開時列出所有卡片', () => {
    const tree = buildCardTree(DEMO_CARDS, 'character');
    const collapsed = new Set<string>();
    const rows = flattenVisibleCards(tree, collapsed);

    expect(rows.map((r) => r.card.id)).toEqual([
      SHEN_CARD_ID,
      WATCH_CARD_ID,
      PHOTO_CARD_ID,
      LU_CARD_ID,
      CHEN_CARD_ID,
    ]);
    expect(rows[0].level).toBe(0);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[0].isExpanded).toBe(true);

    expect(rows[1].level).toBe(1);
    expect(rows[1].hasChildren).toBe(true);
    expect(rows[1].isExpanded).toBe(true);

    expect(rows[2].level).toBe(2);
    expect(rows[2].hasChildren).toBe(false);
    expect(rows[2].isExpanded).toBe(false);
  });

  it('收合頂層卡片時，其底下所有子卡片皆隱藏', () => {
    const tree = buildCardTree(DEMO_CARDS, 'character');
    const collapsed = new Set<string>([SHEN_CARD_ID]);
    const rows = flattenVisibleCards(tree, collapsed);

    expect(rows.map((r) => r.card.id)).toEqual([SHEN_CARD_ID, LU_CARD_ID, CHEN_CARD_ID]);
    expect(rows[0].isExpanded).toBe(false);
  });

  it('收合第二層卡片時，僅隱藏第三層子卡片', () => {
    const tree = buildCardTree(DEMO_CARDS, 'character');
    const collapsed = new Set<string>([WATCH_CARD_ID]);
    const rows = flattenVisibleCards(tree, collapsed);

    expect(rows.map((r) => r.card.id)).toEqual([SHEN_CARD_ID, WATCH_CARD_ID, LU_CARD_ID, CHEN_CARD_ID]);
    expect(rows[0].isExpanded).toBe(true);
    expect(rows[1].isExpanded).toBe(false);
  });
});

describe('AI 對話紀錄分類過濾（WO-45）', () => {
  it('HIDDEN_CATEGORY_IDS 包含 AI 對話紀錄相關識別碼', () => {
    expect(HIDDEN_CATEGORY_IDS.has('ai_chat')).toBe(true);
    expect(HIDDEN_CATEGORY_IDS.has('ai_dialogue')).toBe(true);
    expect(HIDDEN_CATEGORY_IDS.has('AI對話紀錄')).toBe(true);
    expect(HIDDEN_CATEGORY_IDS.has('AI 對話紀錄')).toBe(true);
  });

  it('若分類資料裡出現 AI 對話紀錄，清單完全不顯示它', () => {
    const mixedCategories: CardCategory[] = [
      { id: 'summary', name: '本書綱要', sort_order: 1 },
      { id: 'ai_chat', name: 'AI 對話紀錄', sort_order: 2 },
      { id: 'character', name: '角色', sort_order: 3 },
      { id: 'custom_ai', name: 'AI對話紀錄', sort_order: 4 },
      { id: DEMO_CUSTOM_CATEGORY_ID, name: DEMO_CUSTOM_CATEGORY_NAME, sort_order: 5 },
    ];

    const visible = filterVisibleCategories(mixedCategories);
    expect(visible.map((c) => c.id)).toEqual(['summary', 'character', DEMO_CUSTOM_CATEGORY_ID]);
    expect(visible.some((c) => isCategoryHidden(c.id) || isCategoryHidden(c.name))).toBe(false);
  });

  it('範例分類清單預設不含 AI 對話紀錄', () => {
    const demoVisible = filterVisibleCategories(DEMO_CARD_CATEGORIES);
    expect(demoVisible.some((c) => c.name.includes('AI'))).toBe(false);
  });
});

describe('色彩視覺與暗色對比調亮（WO-45、WO-53）', () => {
  const darkBgLum = sRgbLuminance(0x25, 0x25, 0x26); // #252526

  it('太暗的顏色在畫面上調亮至對比至少 3:1，原始資料維持不變', () => {
    const rawDarkColor = '#1a2b4c'; // 深藍色
    const adjusted = adjustColorForDarkTheme(rawDarkColor, 3.0);

    expect(adjusted).not.toBe(rawDarkColor);

    // 檢查調亮後的對比度 >= 3:1
    const [r, g, b] = [
      parseInt(adjusted.slice(1, 3), 16),
      parseInt(adjusted.slice(3, 5), 16),
      parseInt(adjusted.slice(5, 7), 16),
    ];
    const adjustedLum = sRgbLuminance(r, g, b);
    const ratio = contrastRatio(adjustedLum, darkBgLum);
    expect(ratio).toBeGreaterThanOrEqual(3.0);

    // 原始卡片資料維持原值
    const darkCard = DEMO_CARDS.find((c) => c.id === WATCH_CARD_ID);
    expect(darkCard?.color).toBe(rawDarkColor);
  });

  it('足夠明亮的顏色維持原值不更動', () => {
    const brightBlue = '#61afef';
    expect(adjustColorForDarkTheme(brightBlue, 3.0)).toBe(brightBlue);

    const brightGreen = '#98c379';
    expect(adjustColorForDarkTheme(brightGreen, 3.0)).toBe(brightGreen);
  });

  it('沒設顏色或為電腦版預設色 #3C3F41（不分大小寫）時 cardVisualStyles 回傳 null', () => {
    expect(cardVisualStyles('')).toBeNull();
    expect(cardVisualStyles(null)).toBeNull();
    expect(cardVisualStyles(undefined)).toBeNull();
    expect(cardVisualStyles('#3C3F41')).toBeNull();
    expect(cardVisualStyles('#3c3f41')).toBeNull();
    expect(isDefaultCardColor('#3C3F41')).toBe(true);
    expect(isDefaultCardColor('#3c3f41')).toBe(true);
    expect(isDefaultCardColor('')).toBe(true);
    expect(isDefaultCardColor('#61afef')).toBe(false);
  });

  it('有設顏色時產生 4px 左色條與淡底', () => {
    const styles = cardVisualStyles('#61afef');
    expect(styles).not.toBeNull();
    expect(styles?.borderLeft).toBe('4px solid #61afef');
    expect(styles?.backgroundImage).toContain('rgba(');
    expect(styles?.backgroundImage).toContain('0.1');
    expect(styles?.backgroundColor).toBe('var(--panel)');
    expect(styles?.dotColor).toBe('#61afef');
  });

  it('範例卡片至少具備三種非預設顏色且有預設色（#3C3F41）卡片', () => {
    const nonDefaultColors = new Set(
      DEMO_CARDS.map((c) => c.color).filter((c) => !isDefaultCardColor(c)),
    );
    expect(nonDefaultColors.size).toBeGreaterThanOrEqual(3);

    const defaultColored = DEMO_CARDS.filter((c) => c.color === DEFAULT_CARD_COLOR);
    expect(defaultColored.length).toBeGreaterThanOrEqual(1);
  });

  it('至少有一張長內容卡片用於測試捲動與兩行摘要', () => {
    const longCard = DEMO_CARDS.find((c) => c.id === WORLD_LONG_CARD_ID);
    expect(longCard).toBeDefined();
    expect(longCard!.content.length).toBeGreaterThan(300);
    expect(longCard!.content).toContain('\n\n');
  });
});

describe('色碼支援 3 碼與無效色碼防護（WO-49）', () => {
  it('parseHexColor 支援 #abc 展開為 #aabbcc，大小寫皆可', () => {
    expect(parseHexColor('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseHexColor('#ABC')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseHexColor('abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseHexColor('#f09')).toEqual([0xff, 0x00, 0x99]);
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#000')).toEqual([0, 0, 0]);
  });

  it('parseHexColor 支援標準 6 碼色碼', () => {
    expect(parseHexColor('#61afef')).toEqual([97, 175, 239]);
    expect(parseHexColor('61afef')).toEqual([97, 175, 239]);
  });

  it('無效色碼回傳 null 視為沒顏色', () => {
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
    expect(parseHexColor('#12')).toBeNull();
    expect(parseHexColor('#1234')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#gggggg')).toBeNull();
    expect(parseHexColor('invalid')).toBeNull();
  });
});

describe('卡片樹防循環參照（WO-49）', () => {
  it('卡片自己指向自己時，不造成無限遞迴，並作為頂層卡片顯示一次', () => {
    const loopCards: DemoCard[] = [
      {
        id: 'self-1',
        parent_id: 'self-1',
        category: 'summary',
        title: '自己指向自己的範例卡片',
        content: '範例內容',
        color: '#61afef',
        is_collapsed: 0,
        sort_order: 1,
      },
    ];

    const tree = buildCardTree(loopCards, 'summary');
    expect(tree.length).toBe(1);
    expect(tree[0].card.id).toBe('self-1');
    expect(tree[0].level).toBe(0);
    expect(tree[0].children.length).toBe(0);
  });

  it('兩張卡片互相參照（A→B→A）時，兩張卡片各作為頂層卡片顯示一次，不重複、不遺漏', () => {
    const cycleCards: DemoCard[] = [
      {
        id: 'card-a',
        parent_id: 'card-b',
        category: 'character',
        title: '範例卡片 A',
        content: '範例 A 內容',
        color: '#61afef',
        is_collapsed: 0,
        sort_order: 1,
      },
      {
        id: 'card-b',
        parent_id: 'card-a',
        category: 'character',
        title: '範例卡片 B',
        content: '範例 B 內容',
        color: '#e5c07b',
        is_collapsed: 0,
        sort_order: 2,
      },
    ];

    const tree = buildCardTree(cycleCards, 'character');
    expect(tree.length).toBe(2);
    expect(tree[0].card.id).toBe('card-a');
    expect(tree[0].level).toBe(0);
    expect(tree[0].children.length).toBe(0);

    expect(tree[1].card.id).toBe('card-b');
    expect(tree[1].level).toBe(0);
    expect(tree[1].children.length).toBe(0);

    const rows = flattenVisibleCards(tree, new Set());
    expect(rows.map((r) => r.card.id)).toEqual(['card-a', 'card-b']);
  });

  it('三張卡片環狀參照（A→B→C→A）並帶有一般子卡片時，循環卡片為頂層，子卡片正常掛載且不重複', () => {
    const complexCards: DemoCard[] = [
      {
        id: 'c-1',
        parent_id: 'c-3',
        category: 'world',
        title: '世界觀卡片 1',
        content: '範例內容 1',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 1,
      },
      {
        id: 'c-2',
        parent_id: 'c-1',
        category: 'world',
        title: '世界觀卡片 2',
        content: '範例內容 2',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 2,
      },
      {
        id: 'c-3',
        parent_id: 'c-2',
        category: 'world',
        title: '世界觀卡片 3',
        content: '範例內容 3',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 3,
      },
      {
        id: 'c-child',
        parent_id: 'c-1',
        category: 'world',
        title: '非循環子卡片',
        content: '子卡片範例內容',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 4,
      },
    ];

    const tree = buildCardTree(complexCards, 'world');
    expect(tree.length).toBe(3);
    const node1 = tree.find((n) => n.card.id === 'c-1');
    expect(node1).toBeDefined();
    expect(node1!.level).toBe(0);
    expect(node1!.children.length).toBe(1);
    expect(node1!.children[0].card.id).toBe('c-child');
    expect(node1!.children[0].level).toBe(1);

    const allRows = flattenVisibleCards(tree, new Set());
    expect(allRows.length).toBe(4);
    const ids = allRows.map((r) => r.card.id);
    expect(ids).toContain('c-1');
    expect(ids).toContain('c-2');
    expect(ids).toContain('c-3');
    expect(ids).toContain('c-child');
    expect(new Set(ids).size).toBe(4);
  });
});

describe('淡底顏色與疊加樣式（WO-49）', () => {
  it('左側色條與淡底均使用畫面調亮後的顏色，且以 linear-gradient 疊加在 var(--panel) 上', () => {
    const rawDarkColor = '#1a2b4c';
    const visual = cardVisualStyles(rawDarkColor);

    expect(visual).not.toBeNull();
    const adjusted = adjustColorForDarkTheme(rawDarkColor);
    expect(visual!.displayColor).toBe(adjusted);
    expect(visual!.borderLeft).toBe(`4px solid ${adjusted}`);

    const [r, g, b] = parseHexColor(adjusted)!;
    const expectedTint = `rgba(${r}, ${g}, ${b}, 0.10)`;
    expect(visual!.backgroundImage).toBe(`linear-gradient(${expectedTint}, ${expectedTint})`);
    expect(visual!.backgroundColor).toBe('var(--panel)');
    expect(visual!.dotColor).toBe(adjusted);

    // 原始卡片資料維持不變
    const darkCard = DEMO_CARDS.find((c) => c.id === WATCH_CARD_ID);
    expect(darkCard?.color).toBe(rawDarkColor);
  });
});

describe('畫面切換邏輯與純函式 cardsViewReducer（WO-49、WO-53）', () => {
  it('單元測試走完完整流程：分類清單→卡片清單→展開收合→卡片內容→返回卡片清單→返回分類清單', () => {
    // 1. 初始狀態（第一層：分類清單）
    let state = initialCardsViewState;
    expect(state.selectedCategoryId).toBeNull();
    expect(state.selectedCardId).toBeNull();
    expect(state.collapsedIds.size).toBe(0);

    // 2. 選取分類（進入第二層：卡片清單）
    state = cardsViewReducer(state, { type: 'SELECT_CATEGORY', categoryId: 'character' });
    expect(state.selectedCategoryId).toBe('character');
    expect(state.selectedCardId).toBeNull();

    // 3. 切換收合子卡片
    state = cardsViewReducer(state, { type: 'TOGGLE_COLLAPSE', cardId: SHEN_CARD_ID });
    expect(state.collapsedIds.has(SHEN_CARD_ID)).toBe(true);

    state = cardsViewReducer(state, { type: 'TOGGLE_COLLAPSE', cardId: SHEN_CARD_ID });
    expect(state.collapsedIds.has(SHEN_CARD_ID)).toBe(false);

    // 4. 選取卡片（進入第三層：卡片內容）
    state = cardsViewReducer(state, { type: 'SELECT_CARD', cardId: SHEN_CARD_ID });
    expect(state.selectedCategoryId).toBe('character');
    expect(state.selectedCardId).toBe(SHEN_CARD_ID);

    // 5. 返回卡片清單（回到第二層）
    state = cardsViewReducer(state, { type: 'BACK_TO_CARDS' });
    expect(state.selectedCategoryId).toBe('character');
    expect(state.selectedCardId).toBeNull();

    // 6. 返回分類清單（回到第一層）
    state = cardsViewReducer(state, { type: 'BACK_TO_CATEGORIES' });
    expect(state.selectedCategoryId).toBeNull();
    expect(state.selectedCardId).toBeNull();
  });

  it('切換稿子重置狀態：RESET_FOR_PROJECT 清空所有選取與收合狀態', () => {
    const dirtyState: CardsViewState = {
      selectedCategoryId: 'character',
      selectedCardId: SHEN_CARD_ID,
      collapsedIds: new Set([SHEN_CARD_ID, WATCH_CARD_ID]),
    };

    const resetState = cardsViewReducer(dirtyState, {
      type: 'RESET_FOR_PROJECT',
      projectId: 'second-project',
    });

    expect(resetState.selectedCategoryId).toBeNull();
    expect(resetState.selectedCardId).toBeNull();
    expect(resetState.collapsedIds.size).toBe(0);
  });

  it('shouldResetForProject 判斷僅在 projectId 確實改變時才需重置', () => {
    // 初次掛載或無前值時不重置，避免沖刷 initial 參數
    expect(shouldResetForProject(undefined, 'p1')).toBe(false);
    expect(shouldResetForProject(null, 'p1')).toBe(false);
    // 相同 projectId 不重置（含 React StrictMode 再次執行）
    expect(shouldResetForProject('p1', 'p1')).toBe(false);
    // 只有在 projectId 確實不同時才重置
    expect(shouldResetForProject('p1', 'p2')).toBe(true);
    expect(shouldResetForProject('p2', 'p1')).toBe(true);
  });

  it('WO-53 範例資料：分類代碼只有 summary／character／world／timeline／custom_xxxxxxxx；自訂分類001 由 categories_meta 提供，無「場景」；所有範例卡片 id 是 UUID、color 都是 #rrggbb', () => {
    const allowedCategories = new Set([
      'summary',
      'character',
      'world',
      'timeline',
      DEMO_CUSTOM_CATEGORY_ID,
    ]);
    expect(DEMO_CUSTOM_CATEGORY_ID).toMatch(/^custom_[0-9a-f]{8}$/);

    // 檢查範例分類設定
    const order = parseCategoryOrder(DEMO_CATEGORY_ORDER_RAW);
    expect(order.codes).toEqual([
      'summary',
      'character',
      'world',
      'timeline',
      'ai_chat',
      DEMO_CUSTOM_CATEGORY_ID,
    ]);

    const meta = parseCategoriesMeta(DEMO_CATEGORIES_META_RAW);
    expect(meta.names[DEMO_CUSTOM_CATEGORY_ID]).toBe('自訂分類001');

    // 分類清單與卡片名稱不可包含「場景」作為分類名
    for (const cat of DEMO_CARD_CATEGORIES) {
      expect(allowedCategories.has(cat.id)).toBe(true);
      expect(cat.name).not.toBe('場景');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const colorRegex = /^#[0-9a-fA-F]{6}$/;

    expect(DEMO_CARDS.length).toBe(18);
    for (const card of DEMO_CARDS) {
      expect(allowedCategories.has(card.category)).toBe(true);
      expect(card.id).toMatch(uuidRegex);
      if (card.parent_id !== null) {
        expect(card.parent_id).toMatch(uuidRegex);
      }
      expect(card.color).toMatch(colorRegex);
      expect(card.title.startsWith('【範例】')).toBe(true);
    }

    // 確認 cardsViewReducer 遇到舊分類代碼或舊卡片 ID 時退回預設
    const afterLegacyCat = cardsViewReducer(initialCardsViewState, {
      type: 'SELECT_CATEGORY',
      categoryId: 'worldview',
    });
    expect(afterLegacyCat.selectedCategoryId).toBeNull();

    const afterValidCat = cardsViewReducer(initialCardsViewState, {
      type: 'SELECT_CATEGORY',
      categoryId: 'character',
    });
    const afterLegacyCard = cardsViewReducer(afterValidCat, {
      type: 'SELECT_CARD',
      cardId: 'char-1',
    });
    expect(afterLegacyCard.selectedCardId).toBeNull();
  });
});

