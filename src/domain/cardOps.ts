import type { FileCard } from '../db/projectFile';

export const DEFAULT_CARD_COLOR = '#3C3F41';
export const CARD_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/** 檢查色碼是否符合電腦版 #rrggbb 格式（大小寫皆可，不接受 3 碼或其他格式）。 */
export function isValidCardColor(color: unknown): color is string {
  return typeof color === 'string' && CARD_COLOR_REGEX.test(color);
}

function fallbackUuidV4(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 產生不與現有卡片 ID 重複的 UUID。 */
export function generateCardId(existingIds: Iterable<string> = []): string {
  const existing = new Set<string>(existingIds);
  for (let i = 0; i < 1000; i++) {
    const id =
      typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : fallbackUuidV4();
    if (!existing.has(id)) return id;
  }
  return fallbackUuidV4();
}

export interface FileCardTreeNode {
  card: FileCard;
  children: FileCardTreeNode[];
  level: number;
}

/**
 * 將平面 FileCard[] 建立為不限層數的樹狀結構：
 * - 若指定 category 則只針對該分類建樹；未指定則依各卡自身分類與父子關係建樹
 * - 孤兒卡片（parent_id 不存在或跨分類）自動作為頂層（level 0），不遺漏
 * - 循環參照（如 A→A、A→B→A）自動打斷並提升為頂層，不當機、不重複、不遺漏
 * - 層數不設限（level 0, 1, 2, 3, ...）
 */
export function buildFileCardTree(
  cards: readonly FileCard[],
  category?: string,
): FileCardTreeNode[] {
  const filtered = category !== undefined ? cards.filter((c) => c.category === category) : [...cards];

  const indexed = filtered.map((card, index) => ({ card, index }));
  indexed.sort((a, b) => a.card.sort_order - b.card.sort_order || a.index - b.index);
  const sortedCards = indexed.map((item) => item.card);

  const cardMap = new Map<string, FileCard>();
  for (const card of sortedCards) {
    cardMap.set(card.id, card);
  }

  const hasValidSameCategoryParent = (card: FileCard): boolean => {
    if (!card.parent_id) return false;
    const parent = cardMap.get(card.parent_id);
    if (!parent) return false;
    return parent.category === card.category;
  };

  const inCycleIds = new Set<string>();
  for (const startCard of sortedCards) {
    if (inCycleIds.has(startCard.id)) continue;
    const path: string[] = [];
    const visitedOnPath = new Set<string>();
    let curr: FileCard | undefined = startCard;

    while (curr && hasValidSameCategoryParent(curr)) {
      path.push(curr.id);
      visitedOnPath.add(curr.id);
      const nextId = curr.parent_id!;

      if (visitedOnPath.has(nextId)) {
        const cycleStart = path.indexOf(nextId);
        for (let i = cycleStart; i < path.length; i++) {
          inCycleIds.add(path[i]!);
        }
        break;
      }
      if (inCycleIds.has(nextId)) {
        break;
      }
      curr = cardMap.get(nextId);
    }
  }

  const childrenMap = new Map<string, FileCard[]>();
  const roots: FileCard[] = [];

  for (const card of sortedCards) {
    if (hasValidSameCategoryParent(card) && !inCycleIds.has(card.id)) {
      const pid = card.parent_id!;
      const list = childrenMap.get(pid) ?? [];
      list.push(card);
      childrenMap.set(pid, list);
    } else {
      roots.push(card);
    }
  }

  const assembledIds = new Set<string>();

  function assemble(card: FileCard, level: number): FileCardTreeNode {
    assembledIds.add(card.id);
    const rawChildren = childrenMap.get(card.id) ?? [];
    const children: FileCardTreeNode[] = [];
    for (const child of rawChildren) {
      if (!assembledIds.has(child.id)) {
        children.push(assemble(child, level + 1));
      }
    }
    return {
      card,
      children,
      level,
    };
  }

  const result: FileCardTreeNode[] = [];
  for (const root of roots) {
    if (!assembledIds.has(root.id)) {
      result.push(assemble(root, 0));
    }
  }

  for (const card of sortedCards) {
    if (!assembledIds.has(card.id)) {
      result.push(assemble(card, 0));
    }
  }

  return result;
}

export interface AddCardInput {
  id?: string;
  parentId?: string | null;
  category?: string;
  title?: string;
  content?: string;
  color?: string;
  isCollapsed?: boolean | number;
}

/**
 * 新增頂層卡片或子卡片：
 * - 新卡 id 用 UUID（若未指定或重複則自動產生）
 * - 子卡片強制繼承上層（父卡）的 category
 * - 預設顏色 #3C3F41；若傳入不合格色碼則使用預設色 #3C3F41
 * - 排在同層最後，既有卡片完全不變動
 */
export function addCard(cards: readonly FileCard[], input: AddCardInput): FileCard[] {
  const parentId = input.parentId ?? null;
  let category = input.category ?? '';

  if (parentId !== null) {
    const parent = cards.find((c) => c.id === parentId);
    if (!parent) {
      return [...cards];
    }
    category = parent.category;
  } else if (!category) {
    return [...cards];
  }

  const existingIds = new Set(cards.map((c) => c.id));
  const id =
    typeof input.id === 'string' && input.id.trim() !== '' && !existingIds.has(input.id)
      ? input.id
      : generateCardId(existingIds);

  const color = isValidCardColor(input.color) ? input.color : DEFAULT_CARD_COLOR;
  const is_collapsed = input.isCollapsed ? 1 : 0;

  const siblings = cards.filter(
    (c) => c.category === category && (c.parent_id ?? null) === parentId,
  );
  const nextSortOrder =
    siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.sort_order)) + 1;

  const newCard: FileCard = {
    id,
    parent_id: parentId,
    category,
    title: input.title ?? '',
    content: input.content ?? '',
    color,
    is_collapsed,
    sort_order: nextSortOrder,
  };

  return [...cards, newCard];
}

/** 新增子卡片（自動繼承父卡分類，預設顏色 #3C3F41）。 */
export function addSubCard(
  cards: readonly FileCard[],
  parentId: string,
  input: Omit<AddCardInput, 'parentId' | 'category'> = {},
): FileCard[] {
  return addCard(cards, { ...input, parentId });
}

export interface UpdateCardPatch {
  title?: string;
  content?: string;
  color?: string;
  is_collapsed?: number | boolean;
}

/**
 * 更新指定卡片的標題、內容、顏色或收合狀態：
 * - 色碼只接受 #rrggbb（大小寫原樣保留），不合格色碼不寫入
 * - 只動目標卡片，其他卡片（包含 ai_chat 卡片）原物件參照與欄位完全不動
 */
export function updateCard(
  cards: readonly FileCard[],
  cardId: string,
  patch: UpdateCardPatch,
): FileCard[] {
  let changed = false;
  const next = cards.map((card) => {
    if (card.id !== cardId) return card;

    const nextTitle = patch.title !== undefined ? patch.title : card.title;
    const nextContent = patch.content !== undefined ? patch.content : card.content;
    const nextColor =
      patch.color !== undefined && isValidCardColor(patch.color) ? patch.color : card.color;
    const nextCollapsed =
      patch.is_collapsed !== undefined ? (patch.is_collapsed ? 1 : 0) : card.is_collapsed;

    if (
      nextTitle === card.title &&
      nextContent === card.content &&
      nextColor === card.color &&
      nextCollapsed === card.is_collapsed
    ) {
      return card;
    }

    changed = true;
    return {
      ...card,
      title: nextTitle,
      content: nextContent,
      color: nextColor,
      is_collapsed: nextCollapsed,
    };
  });

  return changed ? next : [...cards];
}

export function updateCardTitle(
  cards: readonly FileCard[],
  cardId: string,
  title: string,
): FileCard[] {
  return updateCard(cards, cardId, { title });
}

export function updateCardContent(
  cards: readonly FileCard[],
  cardId: string,
  content: string,
): FileCard[] {
  return updateCard(cards, cardId, { content });
}

export function updateCardColor(
  cards: readonly FileCard[],
  cardId: string,
  color: string,
): FileCard[] {
  if (!isValidCardColor(color)) {
    return [...cards];
  }
  return updateCard(cards, cardId, { color });
}

export function updateCardCollapsed(
  cards: readonly FileCard[],
  cardId: string,
  collapsed: boolean | number,
): FileCard[] {
  return updateCard(cards, cardId, { is_collapsed: collapsed ? 1 : 0 });
}

export function toggleCardCollapsed(cards: readonly FileCard[], cardId: string): FileCard[] {
  const target = cards.find((c) => c.id === cardId);
  if (!target) return [...cards];
  return updateCardCollapsed(cards, cardId, target.is_collapsed ? 0 : 1);
}

/** 找出指定卡片及其所有層級的子孫卡片 ID 集合（含循環參照防護）。 */
export function collectCardAndDescendantIds(
  cards: readonly FileCard[],
  rootCardId: string,
): Set<string> {
  const toDelete = new Set<string>();
  if (!cards.some((c) => c.id === rootCardId)) return toDelete;

  const childrenByParent = new Map<string, string[]>();
  for (const card of cards) {
    if (card.parent_id) {
      const list = childrenByParent.get(card.parent_id) ?? [];
      list.push(card.id);
      childrenByParent.set(card.parent_id, list);
    }
  }

  const queue: string[] = [rootCardId];
  toDelete.add(rootCardId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = childrenByParent.get(currentId) ?? [];
    for (const childId of children) {
      if (!toDelete.has(childId)) {
        toDelete.add(childId);
        queue.push(childId);
      }
    }
  }

  return toDelete;
}

/** 刪除指定卡片及其所有子孫卡片；其他卡片一個欄位都不動。 */
export function deleteCard(cards: readonly FileCard[], cardId: string): FileCard[] {
  const idsToRemove = collectCardAndDescendantIds(cards, cardId);
  if (idsToRemove.size === 0) return [...cards];
  return cards.filter((card) => !idsToRemove.has(card.id));
}

/**
 * 檢查 targetParentId 是否為 cardId 本身或其子孫節點（防止將卡片移到自己或子孫底下造成循環）。
 */
export function isDescendantOrSelf(
  cards: readonly FileCard[],
  cardId: string,
  targetParentId: string | null,
): boolean {
  if (targetParentId === null) return false;
  if (targetParentId === cardId) return true;

  const descendants = collectCardAndDescendantIds(cards, cardId);
  if (descendants.has(targetParentId)) return true;

  const cardMap = new Map<string, FileCard>();
  for (const card of cards) {
    cardMap.set(card.id, card);
  }

  const visited = new Set<string>();
  let currId: string | null = targetParentId;
  while (currId) {
    if (currId === cardId) return true;
    if (visited.has(currId)) break;
    visited.add(currId);
    currId = cardMap.get(currId)?.parent_id ?? null;
  }

  return false;
}

/**
 * 將卡片移至新的父卡（或設為 null 提升為頂層）：
 * - 禁止移到自己或自己的子孫底下（遇到時原樣回傳）
 * - 只更新受影響的卡片，其他分類與 ai_chat 卡片完全不動
 */
export function moveCardToParent(
  cards: readonly FileCard[],
  cardId: string,
  newParentId: string | null,
): FileCard[] {
  const target = cards.find((c) => c.id === cardId);
  if (!target) return [...cards];
  if ((target.parent_id ?? null) === newParentId) return [...cards];
  if (isDescendantOrSelf(cards, cardId, newParentId)) return [...cards];

  let nextCategory = target.category;
  if (newParentId !== null) {
    const newParent = cards.find((c) => c.id === newParentId);
    if (!newParent) return [...cards];
    nextCategory = newParent.category;
  }

  const targetSiblings = cards.filter(
    (c) => c.id !== cardId && c.category === nextCategory && (c.parent_id ?? null) === newParentId,
  );
  const nextSortOrder =
    targetSiblings.length === 0
      ? 0
      : Math.max(...targetSiblings.map((s) => s.sort_order)) + 1;

  const subtreeIds =
    nextCategory !== target.category
      ? collectCardAndDescendantIds(cards, cardId)
      : new Set<string>([cardId]);

  return cards.map((card) => {
    if (card.id === cardId) {
      return {
        ...card,
        parent_id: newParentId,
        category: nextCategory,
        sort_order: nextSortOrder,
      };
    }
    if (subtreeIds.has(card.id) && card.category !== nextCategory) {
      return {
        ...card,
        category: nextCategory,
      };
    }
    return card;
  });
}

function getOrderedSiblings(
  cards: readonly FileCard[],
  category: string,
  parentId: string | null,
): FileCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .filter((item) => item.card.category === category && (item.card.parent_id ?? null) === parentId)
    .sort((a, b) => a.card.sort_order - b.card.sort_order || a.index - b.index)
    .map((item) => item.card);
}

function applySiblingOrder(
  cards: readonly FileCard[],
  orderedSiblings: readonly FileCard[],
): FileCard[] {
  const newOrderMap = new Map<string, number>();
  orderedSiblings.forEach((sibling, idx) => {
    newOrderMap.set(sibling.id, idx);
  });

  return cards.map((card) => {
    const nextOrder = newOrderMap.get(card.id);
    if (nextOrder === undefined || nextOrder === card.sort_order) {
      return card;
    }
    return {
      ...card,
      sort_order: nextOrder,
    };
  });
}

/**
 * 同層卡片上移一位並重排該同層的 sort_order：
 * - 只動受影響的同層（同 category 且同 parent_id）
 * - 其他層級與其他分類（含 ai_chat 卡片）一個欄位都不動（原物件參照不變）
 */
export function moveCardUp(cards: readonly FileCard[], cardId: string): FileCard[] {
  const target = cards.find((c) => c.id === cardId);
  if (!target) return [...cards];

  const siblings = getOrderedSiblings(cards, target.category, target.parent_id ?? null);
  const idx = siblings.findIndex((c) => c.id === cardId);
  if (idx <= 0) return [...cards];

  const reordered = [...siblings];
  const prev = reordered[idx - 1]!;
  reordered[idx - 1] = reordered[idx]!;
  reordered[idx] = prev;

  return applySiblingOrder(cards, reordered);
}

/**
 * 同層卡片下移一位並重排該同層的 sort_order：
 * - 只動受影響的同層（同 category 且同 parent_id）
 * - 其他層級與其他分類（含 ai_chat 卡片）一個欄位都不動（原物件參照不變）
 */
export function moveCardDown(cards: readonly FileCard[], cardId: string): FileCard[] {
  const target = cards.find((c) => c.id === cardId);
  if (!target) return [...cards];

  const siblings = getOrderedSiblings(cards, target.category, target.parent_id ?? null);
  const idx = siblings.findIndex((c) => c.id === cardId);
  if (idx === -1 || idx >= siblings.length - 1) return [...cards];

  const reordered = [...siblings];
  const next = reordered[idx + 1]!;
  reordered[idx + 1] = reordered[idx]!;
  reordered[idx] = next;

  return applySiblingOrder(cards, reordered);
}

/**
 * 依指定順序重排特定同層（category + parentId）的 sort_order：
 * - 只動該同層卡片，其他卡片（包含 ai_chat）一個欄位都不動
 */
export function reorderSiblingCards(
  cards: readonly FileCard[],
  category: string,
  parentId: string | null,
  orderedIds: readonly string[],
): FileCard[] {
  const siblings = getOrderedSiblings(cards, category, parentId);
  if (siblings.length <= 1) return [...cards];

  const siblingById = new Map(siblings.map((s) => [s.id, s]));
  const reordered: FileCard[] = [];
  const placed = new Set<string>();

  for (const id of orderedIds) {
    const found = siblingById.get(id);
    if (found && !placed.has(id)) {
      reordered.push(found);
      placed.add(id);
    }
  }
  for (const s of siblings) {
    if (!placed.has(s.id)) {
      reordered.push(s);
      placed.add(s.id);
    }
  }

  return applySiblingOrder(cards, reordered);
}
