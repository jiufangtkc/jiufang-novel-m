import type { FileCard } from '../db/projectFile';
import { QUICK_IDEA_CATEGORY_NAME } from '../copy/quickIdeaCopy';
import { addCard } from './cardOps';
import {
  addCustomCategory,
  isCustomCategory,
  isVisibleBuiltinCategory,
  parseCategoriesMeta,
  parseCategoryOrder,
  rebuildCategoryOrder,
  resolveVisibleCategories,
  serializeCategoryOrder,
} from './cardCategories';

/**
 * WO-144 隨手記靈感。
 * 靈感卡放在自訂分類「靈感」（顯示名稱恰好為「靈感」）；不是內建分類，不新增代碼、不改存檔格式。
 * 這裡全是純函式：只有呼叫端在使用者按「存起來」並拿到 added 結果後才把結果寫進稿子，
 * 所以打開舊稿、只看資料集、只開記入畫面或按取消都不會改檔。
 */

export interface QuickIdeaBookState {
  readonly cards: readonly FileCard[];
  readonly categoryOrder?: string | null;
  readonly categoriesMeta?: string | null;
}

/**
 * 在可見自訂分類裡找顯示名稱恰好為「靈感」的分類代碼；有多個時取 category_order 裡先出現的那個。
 * 找不到回傳 null（不建立、不改資料）。
 */
export function findQuickIdeaCategory(book: QuickIdeaBookState): string | null {
  const visible = resolveVisibleCategories({
    categoryOrder: book.categoryOrder,
    categoriesMeta: book.categoriesMeta,
    cards: book.cards,
  });
  const found = visible.find(
    (item) => isCustomCategory(item.id) && item.name === QUICK_IDEA_CATEGORY_NAME,
  );
  return found ? found.id : null;
}

export type AddQuickIdeaResult =
  | { kind: 'empty' }
  | { kind: 'failed' }
  | {
      kind: 'added';
      cards: FileCard[];
      cardId: string;
      categoryCode: string;
      createdCategory: boolean;
      /** 只有新建「靈感」分類時才有值；沿用既有分類時為 undefined（不需要改寫）。 */
      categoryOrder?: string | null;
      categoriesMeta?: string;
    };

export function isQuickIdeaBlank(title: string, content: string): boolean {
  return title.trim() === '' && content.trim() === '';
}

/**
 * 新增一張靈感卡：
 * - 標題與內容都空白 → empty，不建卡
 * - 沿用既有「靈感」分類；沒有才新建（排在可見分類最前，ai_chat 與未知元素原位保留）
 * - 新卡是該分類頂層、無父卡、預設顏色，排在該分類頂層最前（既有頂層卡 sort_order 各加 1）
 * - 其他分類、ai_chat 卡片原物件參照不變
 */
export function addQuickIdeaCard(
  book: QuickIdeaBookState,
  input: { title: string; content: string },
): AddQuickIdeaResult {
  if (isQuickIdeaBlank(input.title, input.content)) return { kind: 'empty' };

  let categoryCode = findQuickIdeaCategory(book);
  let createdCategory = false;
  let nextOrderRaw: string | null | undefined;
  let nextMetaRaw: string | undefined;

  if (!categoryCode) {
    const order = parseCategoryOrder(book.categoryOrder);
    const meta = parseCategoriesMeta(book.categoriesMeta);
    const visible = resolveVisibleCategories({
      categoryOrder: order,
      categoriesMeta: meta,
      cards: book.cards,
    });
    const created = addCustomCategory({
      name: QUICK_IDEA_CATEGORY_NAME,
      categoryOrder: order,
      categoriesMeta: meta,
      existingCodes: [...order.codes, ...book.cards.map((c) => c.category)],
    });
    if (!created.added) return { kind: 'failed' };
    // 名稱真的寫進 categories_meta 才算建好（meta 不是合法 JSON 物件時改寫不了）
    if (parseCategoriesMeta(created.nextCategoriesMeta).names[created.code] !== QUICK_IDEA_CATEGORY_NAME) {
      return { kind: 'failed' };
    }
    // 只把能重排的分類（內建可見＋自訂）交給 rebuildCategoryOrder；
    // 未知代碼（如舊稿的 legacy）不放進可重排清單，才會依既有規則留在原槽位。
    const reorderable = visible.filter((item) => item.isCustom || isVisibleBuiltinCategory(item.id));
    const nextVisible = [created.code, ...reorderable.map((item) => item.id)];
    const knownCustom = [created.code, ...reorderable.filter((item) => item.isCustom).map((item) => item.id)];
    const rebuilt = rebuildCategoryOrder(order, nextVisible, knownCustom);
    categoryCode = created.code;
    createdCategory = true;
    nextOrderRaw = serializeCategoryOrder(rebuilt);
    nextMetaRaw = created.nextCategoriesMeta;
  }

  const added = addCard(book.cards, {
    category: categoryCode,
    parentId: null,
    title: input.title.trim(),
    content: input.content.trim(),
  });
  if (added.length !== book.cards.length + 1) return { kind: 'failed' };
  const newCard = added[added.length - 1]!;

  const cards = added.map((card) => {
    if (card === newCard) return { ...card, sort_order: 0 };
    if (card.category === categoryCode && (card.parent_id ?? null) === null) {
      return { ...card, sort_order: card.sort_order + 1 };
    }
    return card;
  });

  return {
    kind: 'added',
    cards,
    cardId: newCard.id,
    categoryCode,
    createdCategory,
    ...(createdCategory ? { categoryOrder: nextOrderRaw, categoriesMeta: nextMetaRaw } : {}),
  };
}
