import type { FileCard } from '../db/projectFile';
import { isHiddenCategory, VISIBLE_BUILTIN_CATEGORY_CODES } from './cardCategories';
import { generateCardId } from './cardOps';
import {
  DELETED_CARD_LIMIT,
  type BookArchive,
  type DeletedCardRecord,
} from './chapterVersions';

export { DELETED_CARD_LIMIT, type DeletedCardRecord } from './chapterVersions';

function cloneCard(card: FileCard): FileCard {
  const next: FileCard = { ...card };
  if (card.extraColumns) {
    next.extraColumns = { ...card.extraColumns };
  }
  return next;
}

function effectiveParentId(card: FileCard, categoryCardsMap: ReadonlyMap<string, FileCard>): string | null {
  const pid = card.parent_id;
  if (!pid || pid === card.id) return null;
  if (!categoryCardsMap.has(pid)) return null;
  const visited = new Set<string>([card.id]);
  let curr: string | null = pid;
  while (curr) {
    if (visited.has(curr)) return null;
    visited.add(curr);
    const parent = categoryCardsMap.get(curr);
    if (!parent) break;
    curr = parent.parent_id;
  }
  return pid;
}

function collectSubtreeCards(categoryCards: readonly FileCard[], rootCard: FileCard): FileCard[] {
  const categoryMap = new Map<string, FileCard>(categoryCards.map((c) => [c.id, c]));
  const childrenByParent = new Map<string, FileCard[]>();
  for (const card of categoryCards) {
    const pid = effectiveParentId(card, categoryMap);
    if (!pid) continue;
    const list = childrenByParent.get(pid) ?? [];
    list.push(card);
    childrenByParent.set(pid, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  const result: FileCard[] = [cloneCard(rootCard)];
  const visited = new Set<string>([rootCard.id]);
  const walk = (parentId: string) => {
    const children = childrenByParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      result.push(cloneCard(child));
      walk(child.id);
    }
  };
  walk(rootCard.id);
  return result;
}

/**
 * 從準備刪除的卡片建立最近刪除紀錄（含該卡與所有子孫卡片的快照、原母卡、原分類與同層前後鄰居）。
 * 禁止對隱藏分類（ai_chat）建立刪除紀錄。
 */
export function deletedFromCard(
  cards: readonly FileCard[],
  cardId: string,
  deletedAt = Date.now(),
  recordId = `del-card-${deletedAt}-${cardId}`,
): DeletedCardRecord | null {
  const target = cards.find((c) => c.id === cardId);
  if (!target) return null;
  if (isHiddenCategory(target.category)) return null;

  const categoryCards = cards.filter((c) => c.category === target.category);
  const categoryMap = new Map<string, FileCard>(categoryCards.map((c) => [c.id, c]));
  const parentId = effectiveParentId(target, categoryMap);

  const siblings = categoryCards
    .filter((c) => effectiveParentId(c, categoryMap) === parentId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const index = Math.max(
    0,
    siblings.findIndex((c) => c.id === target.id),
  );

  const subtree = collectSubtreeCards(categoryCards, target);
  if (subtree[0]) {
    subtree[0] = { ...subtree[0], parent_id: parentId };
  }

  return {
    id: recordId,
    rootCardId: target.id,
    title: target.title,
    category: target.category,
    parentId,
    index,
    beforeIds: siblings
      .slice(0, index)
      .map((item) => item.id)
      .reverse(),
    afterIds: siblings.slice(index + 1).map((item) => item.id),
    cards: subtree,
    deletedAt,
  };
}

export const createDeletedCardRecord = deletedFromCard;

/** 最新的在最前面，同 id 去重，最多留 10 筆（DELETED_CARD_LIMIT）。 */
export function rememberDeletedCard(
  existing: readonly DeletedCardRecord[] | undefined,
  record: DeletedCardRecord,
): DeletedCardRecord[] {
  const list = existing ?? [];
  return [record, ...list.filter((item) => item.id !== record.id)].slice(0, DELETED_CARD_LIMIT);
}

/** 復原後從最近刪除清單移除。 */
export function forgetDeletedCard(
  existing: readonly DeletedCardRecord[] | undefined,
  id: string,
): DeletedCardRecord[] {
  const list = existing ?? [];
  return list.filter((item) => item.id !== id && item.rootCardId !== id);
}

export function archiveCardDeletion(archive: BookArchive, record: DeletedCardRecord): BookArchive {
  return {
    ...archive,
    deletedCards: rememberDeletedCard(archive.deletedCards, record),
  };
}

export function archiveCardRestore(archive: BookArchive, id: string): BookArchive {
  return {
    ...archive,
    deletedCards: forgetDeletedCard(archive.deletedCards, id),
  };
}

function neighborIndex(
  siblings: readonly { id: string }[],
  record: { index: number; beforeIds?: readonly string[]; afterIds?: readonly string[] },
): number {
  if (!record.beforeIds?.length && !record.afterIds?.length) {
    return Math.max(0, Math.min(record.index, siblings.length));
  }
  let beforeHit = -1;
  for (const id of record.beforeIds ?? []) {
    const found = siblings.findIndex((item) => item.id === id);
    if (found >= 0) {
      beforeHit = found;
      break;
    }
  }
  let afterHit = -1;
  for (const id of record.afterIds ?? []) {
    const found = siblings.findIndex((item) => item.id === id);
    if (found >= 0) {
      afterHit = found;
      break;
    }
  }
  if (beforeHit >= 0 && afterHit >= 0) return Math.min(beforeHit + 1, afterHit);
  if (afterHit >= 0) return afterHit;
  if (beforeHit >= 0) return beforeHit + 1;
  return siblings.length;
}

export interface PlaceRecoveredCardOptions {
  /** true 時強制放到目標分類頂層末尾；false（預設）時優先嘗試放回原位。 */
  atEnd?: boolean;
  /** 目前存在的分類代碼清單（可含或不含 ai_chat，內部會自動排除 ai_chat）。 */
  validCategoryIds?: readonly string[];
  /** 原分類已不存在時回退的分類代碼（預設取第一個可見分類，不含 ai_chat）。 */
  fallbackCategoryId?: string;
}

function resolveTargetCategory(
  currentCards: readonly FileCard[],
  originalCategory: string,
  options?: PlaceRecoveredCardOptions,
): { targetCategory: string; categoryExisted: boolean } {
  const builtInVisible: readonly string[] = VISIBLE_BUILTIN_CATEGORY_CODES;

  if (options?.validCategoryIds && options.validCategoryIds.length > 0) {
    const visibleIds = options.validCategoryIds.filter((id) => !isHiddenCategory(id));
    const fallback =
      options.fallbackCategoryId && !isHiddenCategory(options.fallbackCategoryId)
        ? options.fallbackCategoryId
        : (visibleIds[0] ?? builtInVisible[0] ?? 'summary');
    if (!isHiddenCategory(originalCategory) && visibleIds.includes(originalCategory)) {
      return { targetCategory: originalCategory, categoryExisted: true };
    }
    return { targetCategory: fallback, categoryExisted: false };
  }

  const fallback =
    options?.fallbackCategoryId && !isHiddenCategory(options.fallbackCategoryId)
      ? options.fallbackCategoryId
      : (builtInVisible[0] ?? 'summary');

  if (isHiddenCategory(originalCategory)) {
    return { targetCategory: fallback, categoryExisted: false };
  }

  const exists =
    builtInVisible.includes(originalCategory) ||
    currentCards.some((card) => card.category === originalCategory);

  if (exists) {
    return { targetCategory: originalCategory, categoryExisted: true };
  }
  return { targetCategory: fallback, categoryExisted: false };
}

/**
 * 將最近刪除的卡片（含子孫卡）復原回 `currentCards`：
 * 1. 原母卡還在且原分類還在（且 `atEnd = false`）：依 `beforeIds` / `afterIds` / `index` 放回原母卡下的原同層位置。
 * 2. 原母卡已被刪（但原分類還在）或 `atEnd = true`：轉為原分類頂層卡（`parent_id = null`），放到該分類頂層末尾。
 * 3. 原分類已不存在：轉為第一個可見分類（不含 `ai_chat`）的頂層卡（`parent_id = null`），放到末尾。
 *
 * 絕不覆寫這段期間使用者改過的其他卡片，且若極端情況發生 id 碰撞會自動換發新 UUID，絕不產生重複 id。
 */
export function placeRecoveredCard(
  currentCards: readonly FileCard[],
  record: DeletedCardRecord,
  atEndOrOptions: boolean | PlaceRecoveredCardOptions = false,
): FileCard[] {
  if (!record.cards || record.cards.length === 0) {
    return [...currentCards];
  }

  const options: PlaceRecoveredCardOptions =
    typeof atEndOrOptions === 'boolean' ? { atEnd: atEndOrOptions } : atEndOrOptions;
  const atEnd = Boolean(options.atEnd);

  const { targetCategory, categoryExisted } = resolveTargetCategory(
    currentCards,
    record.category,
    options,
  );

  // 檢查原母卡是否仍存在於目標分類中
  const parentStillExists =
    categoryExisted &&
    (record.parentId === null ||
      currentCards.some((c) => c.id === record.parentId && c.category === targetCategory));

  const placeAtOriginalPosition = !atEnd && categoryExisted && parentStillExists;
  const targetParentId: string | null = placeAtOriginalPosition ? record.parentId : null;

  // 處理極端情況下的 id 碰撞：若 currentCards 已有同 id，換發新 UUID 並同步更新子孫 parent_id
  const usedIds = new Set<string>(currentCards.map((c) => c.id));
  const idMap = new Map<string, string>();
  for (const snapshotCard of record.cards) {
    let nextId = snapshotCard.id;
    if (usedIds.has(nextId)) {
      nextId = generateCardId(usedIds);
    }
    usedIds.add(nextId);
    idMap.set(snapshotCard.id, nextId);
  }

  const rootOriginalId = record.rootCardId || record.cards[0]!.id;
  const restoredRootId = idMap.get(rootOriginalId) ?? rootOriginalId;

  const restoredCards: FileCard[] = record.cards.map((snapshotCard, idx) => {
    const cloned = cloneCard(snapshotCard);
    const mappedId = idMap.get(snapshotCard.id) ?? snapshotCard.id;
    const isRoot = snapshotCard.id === rootOriginalId || idx === 0;
    const mappedParentId = isRoot
      ? targetParentId
      : snapshotCard.parent_id && idMap.has(snapshotCard.parent_id)
        ? idMap.get(snapshotCard.parent_id)!
        : snapshotCard.parent_id;

    return {
      ...cloned,
      id: mappedId,
      category: targetCategory,
      parent_id: mappedParentId,
    };
  });

  const restoredRoot = restoredCards.find((c) => c.id === restoredRootId) ?? restoredCards[0]!;
  const restoredDescendants = restoredCards.filter((c) => c.id !== restoredRoot.id);

  // 找出目標分類中與 restoredRoot 同母卡的現有同層卡片
  const categoryCards = currentCards.filter((c) => c.category === targetCategory);
  const categoryMap = new Map<string, FileCard>(categoryCards.map((c) => [c.id, c]));
  const currentSiblings = categoryCards
    .filter((c) => effectiveParentId(c, categoryMap) === targetParentId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const insertIndex = placeAtOriginalPosition
    ? neighborIndex(currentSiblings, record)
    : currentSiblings.length;

  const clampedIndex = Math.max(0, Math.min(insertIndex, currentSiblings.length));
  const nextSiblings = [...currentSiblings];
  nextSiblings.splice(clampedIndex, 0, restoredRoot);

  // 重新編號該同層清單的 sort_order = 0..n-1
  const updatedSortOrderById = new Map<string, number>();
  nextSiblings.forEach((sibling, idx) => {
    updatedSortOrderById.set(sibling.id, idx);
  });

  const updatedRoot: FileCard = {
    ...restoredRoot,
    sort_order: updatedSortOrderById.get(restoredRoot.id) ?? clampedIndex,
  };

  // 更新 currentCards 中受影響的同層卡片 sort_order（其餘卡片維持原參照與內容不變）
  const result: FileCard[] = currentCards.map((card) => {
    if (!updatedSortOrderById.has(card.id)) return card;
    const nextSortOrder = updatedSortOrderById.get(card.id)!;
    if (card.sort_order === nextSortOrder) return card;
    return {
      ...card,
      sort_order: nextSortOrder,
    };
  });

  result.push(updatedRoot, ...restoredDescendants);
  return result;
}

export function restoreDeletedCardToOrigin(
  currentCards: readonly FileCard[],
  record: DeletedCardRecord,
  options?: Omit<PlaceRecoveredCardOptions, 'atEnd'>,
): FileCard[] {
  return placeRecoveredCard(currentCards, record, { ...options, atEnd: false });
}

export function restoreDeletedCardToEnd(
  currentCards: readonly FileCard[],
  record: DeletedCardRecord,
  options?: Omit<PlaceRecoveredCardOptions, 'atEnd'>,
): FileCard[] {
  return placeRecoveredCard(currentCards, record, { ...options, atEnd: true });
}
