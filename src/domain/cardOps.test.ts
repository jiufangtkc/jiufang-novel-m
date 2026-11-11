import { describe, expect, it } from 'vitest';
import type { FileCard } from '../db/projectFile';
import {
  addCard,
  addSubCard,
  buildFileCardTree,
  DEFAULT_CARD_COLOR,
  deleteCard,
  isDescendantOrSelf,
  isValidCardColor,
  moveCardDown,
  moveCardToParent,
  moveCardUp,
  reorderSiblingCards,
  toggleCardCollapsed,
  updateCardColor,
  updateCardContent,
  updateCardTitle,
} from './cardOps';

function makeSampleCard(overrides: Partial<FileCard> & { id: string }): FileCard {
  return {
    parent_id: null,
    category: 'character',
    title: '【範例】卡片',
    content: '【範例】內容',
    color: DEFAULT_CARD_COLOR,
    is_collapsed: 0,
    sort_order: 0,
    ...overrides,
  };
}

describe('平面卡片純函式（cardOps）', () => {
  it('建樹支援不限層數（4 層以上）、孤兒與循環參照不當機且不遺漏', () => {
    const cards: FileCard[] = [
      makeSampleCard({ id: 'lv1', parent_id: null, sort_order: 0, title: '【範例】第 1 層' }),
      makeSampleCard({ id: 'lv2', parent_id: 'lv1', sort_order: 0, title: '【範例】第 2 層' }),
      makeSampleCard({ id: 'lv3', parent_id: 'lv2', sort_order: 0, title: '【範例】第 3 層' }),
      makeSampleCard({ id: 'lv4', parent_id: 'lv3', sort_order: 0, title: '【範例】第 4 層' }),
      makeSampleCard({ id: 'lv5', parent_id: 'lv4', sort_order: 0, title: '【範例】第 5 層' }),
      makeSampleCard({ id: 'orphan', parent_id: 'missing-parent', sort_order: 1, title: '【範例】孤兒卡' }),
      makeSampleCard({ id: 'cyc-a', parent_id: 'cyc-b', sort_order: 2, title: '【範例】循環 A' }),
      makeSampleCard({ id: 'cyc-b', parent_id: 'cyc-a', sort_order: 3, title: '【範例】循環 B' }),
      makeSampleCard({ id: 'cyc-child', parent_id: 'cyc-a', sort_order: 0, title: '【範例】循環下子卡' }),
    ];

    const tree = buildFileCardTree(cards, 'character');
    // 頂層應包含 lv1、orphan、cyc-a、cyc-b
    expect(tree.map((n) => n.card.id)).toEqual(['lv1', 'orphan', 'cyc-a', 'cyc-b']);

    const n1 = tree[0]!;
    const n2 = n1.children[0]!;
    const n3 = n2.children[0]!;
    const n4 = n3.children[0]!;
    const n5 = n4.children[0]!;
    expect([n1.level, n2.level, n3.level, n4.level, n5.level]).toEqual([0, 1, 2, 3, 4]);
    expect(n5.card.id).toBe('lv5');

    // 循環節點下的正常子孫不會遺漏
    const cycANode = tree.find((n) => n.card.id === 'cyc-a')!;
    expect(cycANode.children.map((c) => c.card.id)).toEqual(['cyc-child']);
  });

  it('新增卡片與子卡片：UUID 產生、子卡繼承上層分類、預設顏色 #3C3F41', () => {
    let cards: FileCard[] = [];
    cards = addCard(cards, {
      category: 'custom_c15c6bd8',
      title: '【範例】父卡',
      content: '【範例】父卡內容',
    });
    expect(cards).toHaveLength(1);
    const parent = cards[0]!;
    expect(parent.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(parent.color).toBe('#3C3F41');
    expect(parent.category).toBe('custom_c15c6bd8');
    expect(parent.sort_order).toBe(0);

    cards = addSubCard(cards, parent.id, {
      title: '【範例】子卡',
      color: '#41040d',
    });
    expect(cards).toHaveLength(2);
    const child = cards[1]!;
    expect(child.parent_id).toBe(parent.id);
    expect(child.category).toBe('custom_c15c6bd8');
    expect(child.color).toBe('#41040d');
    expect(child.sort_order).toBe(0);
  });

  it('顏色檢查（P0-5 相關）：只接受 #rrggbb 並保留原大小寫，不合格色碼不寫入', () => {
    expect(isValidCardColor('#41040d')).toBe(true);
    expect(isValidCardColor('#3C3F41')).toBe(true);
    expect(isValidCardColor('#fff')).toBe(false);
    expect(isValidCardColor('41040d')).toBe(false);
    expect(isValidCardColor('rgb(1,2,3)')).toBe(false);
    expect(isValidCardColor('')).toBe(false);

    let cards: FileCard[] = [
      makeSampleCard({ id: 'c1', color: '#41040d' }),
    ];

    // 不合格色碼不寫入
    cards = updateCardColor(cards, 'c1', '#fff');
    expect(cards[0]!.color).toBe('#41040d');
    cards = updateCardColor(cards, 'c1', 'invalid');
    expect(cards[0]!.color).toBe('#41040d');

    // 合格色碼寫入並維持傳入的大小寫
    cards = updateCardColor(cards, 'c1', '#AbCdEf');
    expect(cards[0]!.color).toBe('#AbCdEf');
  });

  it('修改標題、內容、收合與刪除（連同多層子孫一起刪除）', () => {
    const aiCard = makeSampleCard({
      id: 'ai-1',
      category: 'ai_chat',
      title: '【範例】AI 對話',
      color: '#123456',
    });
    let cards: FileCard[] = [
      aiCard,
      makeSampleCard({ id: 'p1', category: 'summary', title: '【範例】根' }),
      makeSampleCard({ id: 'p1-1', parent_id: 'p1', category: 'summary', title: '【範例】子' }),
      makeSampleCard({ id: 'p1-1-1', parent_id: 'p1-1', category: 'summary', title: '【範例】孫' }),
      makeSampleCard({ id: 'p2', category: 'summary', title: '【範例】另一張' }),
    ];

    cards = updateCardTitle(cards, 'p2', '【範例】改後標題');
    cards = updateCardContent(cards, 'p2', '【範例】改後內容');
    cards = toggleCardCollapsed(cards, 'p2');
    expect(cards.find((c) => c.id === 'p2')).toMatchObject({
      title: '【範例】改後標題',
      content: '【範例】改後內容',
      is_collapsed: 1,
    });
    // ai_chat 卡片原物件參照完全沒動
    expect(cards[0]).toBe(aiCard);

    // 刪除 p1 時連同 p1-1、p1-1-1 一併刪除
    cards = deleteCard(cards, 'p1');
    expect(cards.map((c) => c.id)).toEqual(['ai-1', 'p2']);
    expect(cards[0]).toBe(aiCard);
  });

  it('同層上下移與 sort_order 重排：只動受影響同層，ai_chat 與其他卡片一個欄位都不動', () => {
    const aiCard = makeSampleCard({
      id: 'ai-keep',
      category: 'ai_chat',
      sort_order: 99,
      title: '【範例】AI 原樣保留',
    });
    const childCard = makeSampleCard({
      id: 'sub-keep',
      parent_id: 's1',
      category: 'summary',
      sort_order: 5,
    });
    const s1 = makeSampleCard({ id: 's1', category: 'summary', sort_order: 0 });
    const s2 = makeSampleCard({ id: 's2', category: 'summary', sort_order: 10 });
    const s3 = makeSampleCard({ id: 's3', category: 'summary', sort_order: 20 });

    let cards: FileCard[] = [aiCard, childCard, s1, s2, s3];

    cards = moveCardUp(cards, 's3');
    expect(cards.find((c) => c.id === 's1')?.sort_order).toBe(0);
    expect(cards.find((c) => c.id === 's3')?.sort_order).toBe(1);
    expect(cards.find((c) => c.id === 's2')?.sort_order).toBe(2);
    // 非同層卡片與 ai_chat 卡片連 sort_order 與物件參照都不變
    expect(cards[0]).toBe(aiCard);
    expect(cards[1]).toBe(childCard);
    expect(cards[0]!.sort_order).toBe(99);
    expect(cards[1]!.sort_order).toBe(5);

    cards = moveCardDown(cards, 's1');
    expect(cards.find((c) => c.id === 's3')?.sort_order).toBe(0);
    expect(cards.find((c) => c.id === 's1')?.sort_order).toBe(1);
    expect(cards.find((c) => c.id === 's2')?.sort_order).toBe(2);

    cards = reorderSiblingCards(cards, 'summary', null, ['s2', 's1', 's3']);
    expect(cards.find((c) => c.id === 's2')?.sort_order).toBe(0);
    expect(cards.find((c) => c.id === 's1')?.sort_order).toBe(1);
    expect(cards.find((c) => c.id === 's3')?.sort_order).toBe(2);
    expect(cards[0]).toBe(aiCard);
  });

  it('移動卡片時防止移到自己或自己子孫底下', () => {
    const cards: FileCard[] = [
      makeSampleCard({ id: 'root', parent_id: null, category: 'character' }),
      makeSampleCard({ id: 'child', parent_id: 'root', category: 'character' }),
      makeSampleCard({ id: 'grandchild', parent_id: 'child', category: 'character' }),
      makeSampleCard({ id: 'other', parent_id: null, category: 'character' }),
    ];

    expect(isDescendantOrSelf(cards, 'root', 'root')).toBe(true);
    expect(isDescendantOrSelf(cards, 'root', 'child')).toBe(true);
    expect(isDescendantOrSelf(cards, 'root', 'grandchild')).toBe(true);
    expect(isDescendantOrSelf(cards, 'root', 'other')).toBe(false);
    expect(isDescendantOrSelf(cards, 'child', null)).toBe(false);

    // 嘗試把 root 移到 grandchild 底下應被拒絕，原樣不動
    const blocked = moveCardToParent(cards, 'root', 'grandchild');
    expect(blocked.find((c) => c.id === 'root')?.parent_id).toBeNull();

    // 把 child 移到 other 底下應成功
    const moved = moveCardToParent(cards, 'child', 'other');
    expect(moved.find((c) => c.id === 'child')?.parent_id).toBe('other');
  });
});
