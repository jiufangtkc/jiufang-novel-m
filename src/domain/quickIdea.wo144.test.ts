import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FileCard } from '../db/projectFile';
import * as copy from '../copy/quickIdeaCopy';
import { addCard, moveCardToCategory } from './cardOps';
import {
  isHiddenCategory,
  parseCategoriesMeta,
  parseCategoryOrder,
  resolveVisibleCategories,
} from './cardCategories';
import { addQuickIdeaCard, findQuickIdeaCategory } from './quickIdea';
import { sortTimelineStoryCards } from './timeline';

/** 【範例】卡片：全部由程式產生，不使用真實稿子。 */
function card(id: string, category: string, extra: Partial<FileCard> = {}): FileCard {
  return {
    id,
    parent_id: null,
    category,
    title: `範例${id}`,
    content: `範例內容${id}`,
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 0,
    ...extra,
  };
}

const ORDER_DEFAULT = JSON.stringify(['summary', 'character', 'world', 'timeline', 'ai_chat']);
const IDEA_A = 'custom_aaaaaaaa';
const IDEA_B = 'custom_bbbbbbbb';

describe('WO-144 找或建「靈感」分類', () => {
  it('尚無「靈感」：新建自訂分類，排在可見分類最前，ai_chat 位置不變', () => {
    const r = addQuickIdeaCard(
      { cards: [card('c1', 'character'), card('ai1', 'ai_chat')], categoryOrder: ORDER_DEFAULT, categoriesMeta: '{}' },
      { title: '燈市', content: '' },
    );
    expect(r.kind).toBe('added');
    if (r.kind !== 'added') return;
    expect(r.createdCategory).toBe(true);
    const order = JSON.parse(r.categoryOrder!) as string[];
    // ai_chat 是隱藏分類，原有位置的元素保留；可見分類的先後是：靈感、本書綱要、角色、世界觀、時間軸
    expect(order).toContain('ai_chat');
    expect(order.filter((x) => x !== 'ai_chat')).toEqual([r.categoryCode, 'summary', 'character', 'world', 'timeline']);
    expect(r.categoryCode).toMatch(/^custom_[0-9a-f]{8}$/);
    expect(parseCategoriesMeta(r.categoriesMeta).names[r.categoryCode]).toBe('靈感');
    expect(resolveVisibleCategories({ categoryOrder: r.categoryOrder, categoriesMeta: r.categoriesMeta })[0]!.name).toBe('靈感');
  });

  it('隱藏的 ai_chat 與未知元素在原位保留', () => {
    const order = JSON.stringify(['summary', 'ai_chat', 42, 'character', 'world', 'timeline', 'mystery_x']);
    const r = addQuickIdeaCard({ cards: [], categoryOrder: order, categoriesMeta: '{}' }, { title: 'a', content: '' });
    if (r.kind !== 'added') throw new Error('應已新增');
    const next = JSON.parse(r.categoryOrder!) as unknown[];
    expect(next[1]).toBe('ai_chat');
    expect(next[2]).toBe(42);
    // 原索引不變：42 在 2、mystery_x 在 6（只檢查「仍存在」不夠）
    expect(next.indexOf(42)).toBe(2);
    expect(next.indexOf('mystery_x')).toBe(6);
    expect(next.filter((x) => typeof x === 'string' && x.startsWith('custom_'))).toHaveLength(1);
    const visible = resolveVisibleCategories({ categoryOrder: r.categoryOrder, categoriesMeta: r.categoriesMeta });
    expect(visible[0]!.id).toBe(r.categoryCode);
  });

  it('舊稿 ["summary","legacy","character"]：第一次存靈感後 legacy 仍在索引 1，靈感排可見最前', () => {
    const order = JSON.stringify(['summary', 'legacy', 'character']);
    const r = addQuickIdeaCard({ cards: [], categoryOrder: order, categoriesMeta: '{}' }, { title: 'x', content: '' });
    if (r.kind !== 'added') throw new Error('應已新增');
    const next = JSON.parse(r.categoryOrder!) as string[];
    expect(next.indexOf('legacy')).toBe(1);
    const visible = resolveVisibleCategories({ categoryOrder: r.categoryOrder, categoriesMeta: r.categoriesMeta });
    expect(visible[0]!.id).toBe(r.categoryCode);
    expect(visible.map((v) => v.id).filter((id) => id !== 'legacy')).toEqual([r.categoryCode, 'summary', 'character']);
  });

  it('已有「靈感」：沿用，不建第二個，也不改寫分類順序與名稱', () => {
    const meta = JSON.stringify({ [IDEA_A]: '靈感' });
    const order = JSON.stringify(['summary', 'character', IDEA_A, 'world', 'timeline', 'ai_chat']);
    const r = addQuickIdeaCard({ cards: [], categoryOrder: order, categoriesMeta: meta }, { title: '', content: '只有內容' });
    if (r.kind !== 'added') throw new Error('應已新增');
    expect(r.createdCategory).toBe(false);
    expect(r.categoryCode).toBe(IDEA_A);
    expect(r.categoryOrder).toBeUndefined();
    expect(r.categoriesMeta).toBeUndefined();
  });

  it('有兩個同名：用 category_order 先出現的那個', () => {
    const meta = JSON.stringify({ [IDEA_A]: '靈感', [IDEA_B]: '靈感' });
    const order = JSON.stringify([IDEA_B, 'summary', IDEA_A, 'ai_chat']);
    expect(findQuickIdeaCategory({ cards: [], categoryOrder: order, categoriesMeta: meta })).toBe(IDEA_B);
  });

  it('改名後再記：找不到名為「靈感」者就重建，舊分類卡片留在原處', () => {
    const meta = JSON.stringify({ [IDEA_A]: '點子' });
    const order = JSON.stringify(['summary', IDEA_A, 'ai_chat']);
    const old = card('o1', IDEA_A);
    const r = addQuickIdeaCard({ cards: [old], categoryOrder: order, categoriesMeta: meta }, { title: 'x', content: '' });
    if (r.kind !== 'added') throw new Error('應已新增');
    expect(r.createdCategory).toBe(true);
    expect(r.categoryCode).not.toBe(IDEA_A);
    expect(r.cards.find((c) => c.id === 'o1')).toBe(old);
    expect(parseCategoriesMeta(r.categoriesMeta).names[IDEA_A]).toBe('點子');
  });

  it('刪掉空的「靈感」後再記：重建', () => {
    const r = addQuickIdeaCard({ cards: [], categoryOrder: ORDER_DEFAULT, categoriesMeta: '{}' }, { title: 'x', content: '' });
    expect(r.kind === 'added' && r.createdCategory).toBe(true);
  });

  it('只讀取不寫入：findQuickIdeaCategory 找不到時回 null，不改任何輸入', () => {
    const cards = [card('c1', 'world')];
    const snapshot = JSON.stringify(cards);
    expect(findQuickIdeaCategory({ cards, categoryOrder: ORDER_DEFAULT, categoriesMeta: '{}' })).toBeNull();
    expect(JSON.stringify(cards)).toBe(snapshot);
  });
});

describe('WO-144 新增靈感卡', () => {
  const meta = JSON.stringify({ [IDEA_A]: '靈感' });
  const order = JSON.stringify([IDEA_A, 'summary', 'character', 'world', 'timeline', 'ai_chat']);

  it('新卡排該分類頂層最前，既有頂層卡順位各加 1，子卡與其他分類不動', () => {
    const e1 = card('e1', IDEA_A, { sort_order: 0 });
    const e2 = card('e2', IDEA_A, { sort_order: 1 });
    const sub = card('s1', IDEA_A, { parent_id: 'e1', sort_order: 0 });
    const other = card('w1', 'world', { sort_order: 0 });
    const ai = card('ai1', 'ai_chat');
    const r = addQuickIdeaCard({ cards: [e1, e2, sub, other, ai], categoryOrder: order, categoriesMeta: meta }, { title: ' 新點子 ', content: '內文' });
    if (r.kind !== 'added') throw new Error('應已新增');
    const created = r.cards.find((c) => c.id === r.cardId)!;
    expect(created).toMatchObject({ category: IDEA_A, parent_id: null, title: '新點子', content: '內文', color: '#3C3F41', sort_order: 0 });
    expect(r.cards.find((c) => c.id === 'e1')!.sort_order).toBe(1);
    expect(r.cards.find((c) => c.id === 'e2')!.sort_order).toBe(2);
    expect(r.cards.find((c) => c.id === 's1')).toBe(sub);
    expect(r.cards.find((c) => c.id === 'w1')).toBe(other);
    expect(r.cards.find((c) => c.id === 'ai1')).toBe(ai);
    const sorted = r.cards.filter((c) => c.category === IDEA_A && !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    expect(sorted[0]!.id).toBe(r.cardId);
  });

  it('標題與內容都空白（含全空白字元）不建卡', () => {
    const cards = [card('c1', 'world')];
    expect(addQuickIdeaCard({ cards, categoryOrder: order, categoriesMeta: meta }, { title: '', content: '' }).kind).toBe('empty');
    expect(addQuickIdeaCard({ cards, categoryOrder: order, categoriesMeta: meta }, { title: '  ', content: '\n　' }).kind).toBe('empty');
  });

  it('只填標題或只填內容都可以存', () => {
    expect(addQuickIdeaCard({ cards: [], categoryOrder: order, categoriesMeta: meta }, { title: '只有標題', content: '' }).kind).toBe('added');
    expect(addQuickIdeaCard({ cards: [], categoryOrder: order, categoriesMeta: meta }, { title: '', content: '只有內容' }).kind).toBe('added');
  });

  it('其他分類的 addCard 行為不變（仍加在同層最後）', () => {
    const next = addCard([card('w1', 'world', { sort_order: 3 })], { category: 'world' });
    expect(next[1]!.sort_order).toBe(4);
  });
});

describe('WO-144 改分類 moveCardToCategory', () => {
  const visible = ['summary', 'character', 'world', 'timeline', IDEA_A];

  it('連同子孫改到目標分類，成為頂層並排在最後；不動 ai_chat 與其他卡', () => {
    const root = card('r', IDEA_A, { sort_order: 0 });
    const kid = card('k', IDEA_A, { parent_id: 'r', sort_order: 0 });
    const grand = card('g', IDEA_A, { parent_id: 'k', sort_order: 2 });
    const t1 = card('t1', 'character', { sort_order: 0 });
    const t2 = card('t2', 'character', { sort_order: 5 });
    const ai = card('ai', 'ai_chat');
    const next = moveCardToCategory([root, kid, grand, t1, t2, ai], 'r', 'character', visible);
    expect(next.find((c) => c.id === 'r')).toMatchObject({ category: 'character', parent_id: null, sort_order: 6 });
    expect(next.find((c) => c.id === 'k')).toMatchObject({ category: 'character', parent_id: 'r', sort_order: 0 });
    expect(next.find((c) => c.id === 'g')).toMatchObject({ category: 'character', parent_id: 'k', sort_order: 2 });
    expect(next.find((c) => c.id === 't1')).toBe(t1);
    expect(next.find((c) => c.id === 't2')).toBe(t2);
    expect(next.find((c) => c.id === 'ai')).toBe(ai);
  });

  it('子卡改分類會脫離原父卡成為目標分類頂層', () => {
    const root = card('r', IDEA_A);
    const kid = card('k', IDEA_A, { parent_id: 'r' });
    const next = moveCardToCategory([root, kid], 'k', 'world', visible);
    expect(next.find((c) => c.id === 'k')).toMatchObject({ category: 'world', parent_id: null });
    expect(next.find((c) => c.id === 'r')).toBe(root);
  });

  it('不可改到隱藏或不在可見清單的分類；同分類或找不到則不動', () => {
    const c = card('x', IDEA_A);
    expect(moveCardToCategory([c], 'x', 'ai_chat', visible)[0]).toBe(c);
    expect(moveCardToCategory([c], 'x', 'custom_deadbeef', visible)[0]).toBe(c);
    expect(moveCardToCategory([c], 'x', IDEA_A, visible)[0]).toBe(c);
    expect(moveCardToCategory([c], 'nope', 'world', visible)[0]).toBe(c);
    expect(isHiddenCategory('ai_chat')).toBe(true);
  });

  it('改進時間軸：時間線已有順序則補排在最後的 timelineOrder', () => {
    const e1 = card('e1', 'timeline', { timelineOrder: 0 });
    const e2 = card('e2', 'timeline', { timelineOrder: 1 });
    const idea = card('i', IDEA_A);
    const next = moveCardToCategory([e1, e2, idea], 'i', 'timeline', visible);
    expect(next.find((c) => c.id === 'i')).toMatchObject({ category: 'timeline', timelineOrder: 2, parent_id: null });
    expect(next.find((c) => c.id === 'e1')).toBe(e1);
  });

  it('改進時間軸：已排序與未排序事件並存時，新卡顯示順序在最後，原有事件相對順序不變', () => {
    const e1 = card('e1', 'timeline', { timelineOrder: 0, sort_order: 0 });
    const e2 = card('e2', 'timeline', { timelineOrder: 1, sort_order: 1 });
    const restored = card('rest', 'timeline', { sort_order: 2 }); // 復原回來、尚未排序
    const idea = card('i', IDEA_A);
    const before = sortTimelineStoryCards([e1, e2, restored]).map((c) => c.id);
    const next = moveCardToCategory([e1, e2, restored, idea], 'i', 'timeline', visible);
    const after = sortTimelineStoryCards(next).map((c) => c.id);
    expect(after).toEqual([...before, 'i']);
    expect(next.find((c) => c.id === 'i')!.timelineOrder).toBeUndefined();
    expect(next.find((c) => c.id === 'e1')).toBe(e1);
    expect(next.find((c) => c.id === 'e2')).toBe(e2);
    expect(next.find((c) => c.id === 'rest')).toBe(restored);
  });

  it('從清單新增時間軸卡：已排序與未排序並存時同樣排到顯示順序最後', () => {
    const e1 = card('e1', 'timeline', { timelineOrder: 0, sort_order: 0 });
    const restored = card('rest', 'timeline', { sort_order: 1 });
    const next = addCard([e1, restored], { category: 'timeline', id: 'added' });
    expect(sortTimelineStoryCards(next).map((c) => c.id)).toEqual(['e1', 'rest', 'added']);
  });

  it('改進時間軸：時間線尚無順序則不寫 timelineOrder', () => {
    const idea = card('i', IDEA_A);
    const next = moveCardToCategory([card('e1', 'timeline'), idea], 'i', 'timeline', visible);
    expect(next.find((c) => c.id === 'i')!.timelineOrder).toBeUndefined();
  });

  it('從時間軸改走：離開時間軸，時間線欄位保留', () => {
    const ev = card('ev', 'timeline', { timelineOrder: 4, storyTime: '第三夜', chapterId: 'ch1' });
    const next = moveCardToCategory([ev], 'ev', IDEA_A, visible);
    expect(next[0]).toMatchObject({ category: IDEA_A, timelineOrder: 4, storyTime: '第三夜', chapterId: 'ch1' });
  });
});

describe('WO-144 不因開檔而改寫、用字與接線守衛', () => {
  it('分類解析與找靈感都是純讀取：parse 後 raw 與 dirty 不變', () => {
    const o = parseCategoryOrder(ORDER_DEFAULT);
    resolveVisibleCategories({ categoryOrder: o, categoriesMeta: '{}', cards: [] });
    findQuickIdeaCategory({ cards: [], categoryOrder: ORDER_DEFAULT, categoriesMeta: '{}' });
    expect(o.dirty).toBe(false);
    expect(o.raw).toBe(ORDER_DEFAULT);
  });

  it('暫定用字與核准表一致', () => {
    expect(copy.QUICK_IDEA_OPEN_LABEL).toBe('記靈感');
    expect(copy.QUICK_IDEA_SHEET_TITLE).toBe('記靈感');
    expect(copy.QUICK_IDEA_TITLE_LABEL).toBe('標題（可不填）');
    expect(copy.QUICK_IDEA_CONTENT_LABEL).toBe('內容');
    expect(copy.QUICK_IDEA_CANCEL).toBe('取消');
    expect(copy.QUICK_IDEA_SAVE).toBe('存起來');
    expect(copy.QUICK_IDEA_EMPTY_HINT).toBe('請先寫一點再存。');
    expect(copy.quickIdeaSheetHint('春燈')).toBe('會先放進這本《春燈》的「靈感」分類，之後再歸到角色或世界觀。');
    expect(copy.QUICK_IDEA_SAVED_NOTICE).toBe('已存成靈感卡片。');
    expect(copy.QUICK_IDEA_NOTICE_ACTION).toBe('去看看');
    expect(copy.QUICK_IDEA_CATEGORY_NAME).toBe('靈感');
    expect(copy.QUICK_IDEA_CATEGORY_LIST_HINT).toBe('隨手記下的卡片會先放在「靈感」裡，之後再歸到下面的分類。');
    expect(copy.QUICK_IDEA_LIST_HINT).toBe('新記的會排在最上面。確定這則屬於誰或哪裡之後，按「改分類」即可。');
    expect(copy.QUICK_IDEA_MOVE_BUTTON).toBe('改分類');
    expect(copy.QUICK_IDEA_MOVE_TITLE).toBe('改分類');
    expect(copy.QUICK_IDEA_MOVE_HINT).toBe('要把這張卡放到哪個分類？');
  });

  it('元件不硬寫句子，且沒有簡體字或常見中國用語', () => {
    const files = [
      '../components/QuickIdeaSheet.tsx',
      '../components/QuickIdeaNotice.tsx',
      '../components/QuickIdeaMoveSheet.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/[㐀-鿿]/u);
    }
    const all = Object.values(copy).map((v) => (typeof v === 'string' ? v : '')).join('');
    // 比對樣本以碼位表示（避免原始碼出現簡體字）：軟數據設點擊創這個們為（簡體）、預設、資訊、檔案夾、影片等中國用語
    const cp = (...codes: number[]) => String.fromCodePoint(...codes);
    const simplifiedChars = cp(0x8f6f, 0x6570, 0x636e, 0x8bbe, 0x70b9, 0x51fb, 0x521b, 0x8fd9, 0x4e2a, 0x4eec, 0x4e3a);
    const mainlandTerms = [
      cp(0x9ed8, 0x8ba4),
      cp(0x4fe1, 0x606f),
      cp(0x6587, 0x4ef6, 0x5939),
      cp(0x89c6, 0x9891),
    ];
    expect(all).not.toMatch(new RegExp(`[${simplifiedChars}]|${mainlandTerms.join('|')}`));
  });

  it('EditorPane：頁首燈泡與「⋯」選單項共用 openQuickIdea', () => {
    const src = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(src).toContain("id: 'quick-idea-open'");
    expect(src).toContain('onSelect: openQuickIdea');
    // 返工 B：橫拿打字時共用開啟函式不開
    expect(src).toMatch(/const openQuickIdea = \(\) => \{\s*const entry = tryEnterQuickIdea\(/);
    expect(src).toContain('onClick={openQuickIdea}');
    expect(src).toContain('aria-label={QUICK_IDEA_OPEN_LABEL}');
    expect(src).toContain('keepBodyFocusOnPointerDown(ref.current, event)');
  });
});
