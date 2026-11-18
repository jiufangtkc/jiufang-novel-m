import { describe, expect, it } from 'vitest';
import type { FileCard } from '../db/projectFile';
import { deleteCard, updateCard } from './cardOps';
import {
  archiveCardDeletion,
  archiveCardRestore,
  DELETED_CARD_LIMIT,
  deletedFromCard,
  forgetDeletedCard,
  placeRecoveredCard,
  rememberDeletedCard,
  restoreDeletedCardToEnd,
  restoreDeletedCardToOrigin,
} from './cardArchive';
import { emptyArchive } from './chapterVersions';

function makeCard(
  id: string,
  category: string,
  title: string,
  parentId: string | null = null,
  sortOrder = 0,
  content = `【範例】${title}`,
): FileCard {
  return {
    id,
    category,
    parent_id: parentId,
    title,
    content,
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: sortOrder,
  };
}

describe('WO-53 卡片最近刪除（cardArchive）', () => {
  it('WO-53：刪除帶子孫的卡片時建立 DeletedCardRecord，記錄整棵子樹、原母卡、原分類與前後鄰居', () => {
    const cards: FileCard[] = [
      makeCard('c-1', 'character', '角色一', null, 0),
      makeCard('c-2', 'character', '角色二', null, 1),
      makeCard('c-2-1', 'character', '角色二配件', 'c-2', 0),
      makeCard('c-2-1-1', 'character', '配件細節', 'c-2-1', 0),
      makeCard('c-3', 'character', '角色三', null, 2),
    ];

    const record = deletedFromCard(cards, 'c-2', 1000, 'del-c2');
    expect(record).not.toBeNull();
    expect(record!.id).toBe('del-c2');
    expect(record!.rootCardId).toBe('c-2');
    expect(record!.title).toBe('角色二');
    expect(record!.category).toBe('character');
    expect(record!.parentId).toBeNull();
    expect(record!.index).toBe(1);
    expect(record!.beforeIds).toEqual(['c-1']);
    expect(record!.afterIds).toEqual(['c-3']);
    expect(record!.cards.map((c) => c.id)).toEqual(['c-2', 'c-2-1', 'c-2-1-1']);

    // 隱藏分類 ai_chat 拒絕建立刪除紀錄
    const hiddenCards: FileCard[] = [makeCard('ai-1', 'ai_chat', '對話紀錄', null, 0)];
    expect(deletedFromCard(hiddenCards, 'ai-1')).toBeNull();
  });

  it('WO-53：最多保留 10 筆（第 11 筆擠掉最舊的），復原後從清單移除', () => {
    expect(DELETED_CARD_LIMIT).toBe(10);
    let archive = emptyArchive();
    expect(archive.deletedCards).toEqual([]);

    for (let i = 0; i <= 10; i += 1) {
      const id = `card-${i}`;
      const record = deletedFromCard(
        [makeCard(id, 'character', `範例角色 ${i}`)],
        id,
        100 + i,
        `del-${i}`,
      )!;
      archive = archiveCardDeletion(archive, record);
    }

    expect(archive.deletedCards).toHaveLength(10);
    expect(archive.deletedCards![0]?.id).toBe('del-10');
    expect(archive.deletedCards!.some((item) => item.id === 'del-0')).toBe(false);

    // 復原後從清單移除
    archive = archiveCardRestore(archive, 'del-10');
    expect(archive.deletedCards).toHaveLength(9);
    expect(archive.deletedCards!.some((item) => item.id === 'del-10')).toBe(false);

    // 也可依 rootCardId 移除
    const remaining = forgetDeletedCard(archive.deletedCards, 'card-9');
    expect(remaining.some((item) => item.rootCardId === 'card-9')).toBe(false);

    // 同 id 重複寫入時去重並移到最前面
    const dup = deletedFromCard([makeCard('card-5', 'character', '範例角色 5')], 'card-5', 999, 'del-5')!;
    const deduped = rememberDeletedCard(remaining, dup);
    expect(deduped[0]?.id).toBe('del-5');
    expect(deduped.filter((item) => item.id === 'del-5')).toHaveLength(1);
  });

  it('WO-53：復原回原位（原母卡還在）時，只把被刪卡與子孫補回 currentCards，不覆蓋這段期間對其他卡片的修改', () => {
    const initial: FileCard[] = [
      makeCard('parent-1', 'character', '沈雨晴', null, 0),
      makeCard('child-1', 'character', '隨身舊懷錶', 'parent-1', 0),
      makeCard('child-2', 'character', '舊鑰匙', 'parent-1', 1),
      makeCard('child-2-1', 'character', '鑰匙刻痕', 'child-2', 0),
      makeCard('child-3', 'character', '筆記本', 'parent-1', 2),
    ];

    const record = deletedFromCard(initial, 'child-2', 2000, 'del-child-2')!;
    let current = deleteCard(initial, 'child-2');

    // 刪除期間使用者修改了其他卡片（例如改了 child-1 的標題與內容）並新增了另一張卡
    current = updateCard(current, 'child-1', {
      title: '【範例】修好發條的舊懷錶',
      content: '【範例】這段期間使用者改過的正文，復原時絕不能被快照覆蓋。',
    });

    const restored = restoreDeletedCardToOrigin(current, record);

    // 檢查這段期間改過的其他卡片內容完好無損
    const updatedChild1 = restored.find((c) => c.id === 'child-1')!;
    expect(updatedChild1.title).toBe('【範例】修好發條的舊懷錶');
    expect(updatedChild1.content).toContain('這段期間使用者改過的正文');

    // 檢查被刪卡與子孫已補回原母卡下，且順序位於 child-1 與 child-3 之間
    const restoredChild2 = restored.find((c) => c.id === 'child-2')!;
    const restoredGrandChild = restored.find((c) => c.id === 'child-2-1')!;
    expect(restoredChild2.parent_id).toBe('parent-1');
    expect(restoredGrandChild.parent_id).toBe('child-2');

    const siblingsUnderParent = restored
      .filter((c) => c.category === 'character' && c.parent_id === 'parent-1')
      .sort((a, b) => a.sort_order - b.sort_order);
    expect(siblingsUnderParent.map((c) => c.id)).toEqual(['child-1', 'child-2', 'child-3']);
    expect(siblingsUnderParent.map((c) => c.sort_order)).toEqual([0, 1, 2]);
  });

  it('WO-53：原母卡已刪時，復原自動轉為該分類頂層卡放到末尾（子孫結構保留）', () => {
    const initial: FileCard[] = [
      makeCard('p1', 'character', '角色甲', null, 0),
      makeCard('p1-c1', 'character', '角色甲子卡', 'p1', 0),
      makeCard('p1-c1-g1', 'character', '角色甲孫卡', 'p1-c1', 0),
      makeCard('p2', 'character', '角色乙', null, 1),
    ];

    // 先刪子卡 p1-c1
    const record = deletedFromCard(initial, 'p1-c1', 3000, 'del-sub')!;
    let current = deleteCard(initial, 'p1-c1');
    // 接著連母卡 p1 也刪了
    current = deleteCard(current, 'p1');

    const restored = placeRecoveredCard(current, record, false);
    const root = restored.find((c) => c.id === 'p1-c1')!;
    const grand = restored.find((c) => c.id === 'p1-c1-g1')!;

    expect(root.category).toBe('character');
    expect(root.parent_id).toBeNull();
    expect(grand.parent_id).toBe('p1-c1');

    const topLevel = restored
      .filter((c) => c.category === 'character' && c.parent_id === null)
      .sort((a, b) => a.sort_order - b.sort_order);
    expect(topLevel.map((c) => c.id)).toEqual(['p2', 'p1-c1']);
    expect(topLevel.map((c) => c.sort_order)).toEqual([0, 1]);
  });

  it('WO-53：原分類已刪時，復原自動轉為第一個可見分類（不含 ai_chat）的頂層卡放到末尾', () => {
    const initial: FileCard[] = [
      makeCard('s1', 'summary', '綱要一', null, 0),
      makeCard('cust-1', 'custom_5ce4e001', '自訂母卡', null, 0),
      makeCard('cust-1-1', 'custom_5ce4e001', '自訂子卡', 'cust-1', 0),
    ];

    const record = deletedFromCard(initial, 'cust-1', 4000, 'del-cust')!;
    const currentAfterCategoryRemoved: FileCard[] = [makeCard('s1', 'summary', '綱要一', null, 0)];

    // 傳入包含 ai_chat 在第一位的可見分類驗證：必須跳過 ai_chat，落入第一個可見分類 summary
    const restored = restoreDeletedCardToOrigin(currentAfterCategoryRemoved, record, {
      validCategoryIds: ['ai_chat', 'summary', 'character', 'world', 'timeline'],
    });

    const restoredRoot = restored.find((c) => c.id === 'cust-1')!;
    const restoredChild = restored.find((c) => c.id === 'cust-1-1')!;
    expect(restoredRoot.category).toBe('summary');
    expect(restoredRoot.parent_id).toBeNull();
    expect(restoredChild.category).toBe('summary');
    expect(restoredChild.parent_id).toBe('cust-1');

    const summaryTop = restored
      .filter((c) => c.category === 'summary' && c.parent_id === null)
      .sort((a, b) => a.sort_order - b.sort_order);
    expect(summaryTop.map((c) => c.id)).toEqual(['s1', 'cust-1']);
  });

  it('WO-53：atEnd = true 或極端情況 id 碰撞時，放到分類頂層末尾且絕不產生重複 id', () => {
    const initial: FileCard[] = [
      makeCard('c1', 'character', '角色一', null, 0),
      makeCard('c2', 'character', '角色二', null, 1),
      makeCard('c2-sub', 'character', '角色二子卡', 'c2', 0),
    ];

    const record = deletedFromCard(initial, 'c2', 5000, 'del-c2')!;

    // 極端情況：initial 中仍存在 c2 與 c2-sub，直接復原不可產生重複 id
    const restored = restoreDeletedCardToEnd(initial, record);
    const ids = restored.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(restored).toHaveLength(5);

    // 新復原出來的根卡與子卡應維持正確的父子關聯
    const newCards = restored.filter((c) => !['c1', 'c2', 'c2-sub'].includes(c.id));
    expect(newCards).toHaveLength(2);
    const newRoot = newCards.find((c) => c.parent_id === null)!;
    const newSub = newCards.find((c) => c.parent_id !== null)!;
    expect(newRoot).toBeDefined();
    expect(newSub.parent_id).toBe(newRoot.id);
  });
});
