import type { ChapterNode } from '../data/demo';
import { countWords } from './wordCount';

/** WO-138 決-1：一次刪掉 100 字以上自動收進刪稿暫存區。 */
export const TRASH_AUTO_MIN_WORDS = 100;

/** WO-138 決-3：刪稿暫存區雙上限（先到為準）。 */
export const TRASH_MAX_ITEMS = 50;
export const TRASH_MAX_WORDS = 50_000;

/** WO-138：接近上限提醒門檻。 */
export const TRASH_NEAR_ITEMS = 40;
export const TRASH_NEAR_WORDS = 40_000;

/** 前後文錨點擷取與定位參數（UTF-16 字元數）。 */
export const TRASH_ANCHOR_LENGTH = 40;
export const TRASH_SHORT_ANCHOR_LENGTH = 12;
export const TRASH_MIN_SHORT_ANCHOR_LENGTH = 4;
export const TRASH_UNIQUE_SINGLE_ANCHOR_MIN_LENGTH = 10;

export interface TrashItem {
  itemId: string;
  chapterId: string | null;
  chapterTitleSnapshot: string;
  content: string;
  wordCount: number;
  beforeAnchor: string;
  afterAnchor: string;
  charOffset: number;
  reason: string;
  deletedAtMs: number;
  sortOrder: number;
}

export interface CreateTrashItemInput {
  itemId: string;
  chapterId: string | null;
  chapterTitleSnapshot: string;
  content: string;
  wordCount?: number;
  beforeAnchor?: string;
  afterAnchor?: string;
  charOffset?: number;
  reason?: string;
  deletedAtMs: number;
  sortOrder?: number;
}

export interface SelectionSnapshot {
  start: number;
  end: number;
  beforeLength: number;
}

export interface TrashAnchorInfo {
  deletedText: string;
  wordCount: number;
  beforeAnchor: string;
  afterAnchor: string;
  charOffset: number;
}

export type TrashInsertResult =
  | {
      kind: 'added';
      item: TrashItem;
      items: TrashItem[];
      evictedCount: number;
      evictedIds: string[];
    }
  | {
      kind: 'blocked-full';
      items: TrashItem[];
      reason: 'exceeds-max-words' | 'all-annotated';
    };

export interface TrashUsageSummary {
  count: number;
  totalWords: number;
  nearLimit: boolean;
  atLimit: boolean;
  hasEvictable: boolean;
}

export type TrashPutBackPlacement = 'original' | 'end';

export interface TrashPutBackPlan {
  nextBody: string;
  insertStart: number;
  insertEnd: number;
  placement: TrashPutBackPlacement;
}

export interface WritableTargetNode {
  node: ChapterNode;
  chapterTitle: string;
  parentChapterTitle: string | null;
}

function compareStringsBinary(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 列表排序：最新在前（deletedAtMs DESC, sortOrder DESC, itemId DESC）。 */
export function compareTrashItemsDesc(a: TrashItem, b: TrashItem): number {
  return (
    b.deletedAtMs - a.deletedAtMs ||
    b.sortOrder - a.sortOrder ||
    compareStringsBinary(b.itemId, a.itemId)
  );
}

/** 清理排序：最舊在前（deletedAtMs ASC, sortOrder ASC, itemId ASC）。 */
export function compareTrashItemsAsc(a: TrashItem, b: TrashItem): number {
  return (
    a.deletedAtMs - b.deletedAtMs ||
    a.sortOrder - b.sortOrder ||
    compareStringsBinary(a.itemId, b.itemId)
  );
}

/** 回傳依最新在前排好的新陣列，不修改原陣列。 */
export function sortTrashItems(items: readonly TrashItem[]): TrashItem[] {
  return [...items].sort(compareTrashItemsDesc);
}

/** 計算同一毫秒內的下一個穩定 sortOrder。 */
export function nextTrashSortOrder(items: readonly TrashItem[], deletedAtMs: number): number {
  let maxOrder = -1;
  for (const item of items) {
    if (item.deletedAtMs === deletedAtMs && item.sortOrder > maxOrder) {
      maxOrder = item.sortOrder;
    }
  }
  return maxOrder + 1;
}

/** 正規化並驗證單筆刪稿項目；核心欄位損壞時回傳 null。 */
export function normalizeTrashItem(raw: unknown): TrashItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.itemId !== 'string' || candidate.itemId.trim() === '') return null;
  if (typeof candidate.content !== 'string' || candidate.content === '') return null;
  if (typeof candidate.deletedAtMs !== 'number' || !Number.isSafeInteger(candidate.deletedAtMs) || candidate.deletedAtMs < 1) {
    return null;
  }

  const chapterId =
    typeof candidate.chapterId === 'string' && candidate.chapterId !== ''
      ? candidate.chapterId
      : null;
  const chapterTitleSnapshot =
    typeof candidate.chapterTitleSnapshot === 'string' ? candidate.chapterTitleSnapshot : '';
  const wordCount =
    typeof candidate.wordCount === 'number' && Number.isSafeInteger(candidate.wordCount) && candidate.wordCount >= 0
      ? candidate.wordCount
      : countWords(candidate.content);
  const beforeAnchor = typeof candidate.beforeAnchor === 'string' ? candidate.beforeAnchor : '';
  const afterAnchor = typeof candidate.afterAnchor === 'string' ? candidate.afterAnchor : '';
  const charOffset =
    typeof candidate.charOffset === 'number' && Number.isSafeInteger(candidate.charOffset) && candidate.charOffset >= 0
      ? candidate.charOffset
      : 0;
  const reason = typeof candidate.reason === 'string' ? candidate.reason : '';
  const sortOrder =
    typeof candidate.sortOrder === 'number' && Number.isSafeInteger(candidate.sortOrder) && candidate.sortOrder >= 0
      ? candidate.sortOrder
      : 0;

  return {
    itemId: candidate.itemId,
    chapterId,
    chapterTitleSnapshot,
    content: candidate.content,
    wordCount,
    beforeAnchor,
    afterAnchor,
    charOffset,
    reason,
    deletedAtMs: candidate.deletedAtMs,
    sortOrder,
  };
}

/** 合法化、去重並依最新在前排序刪稿清單。 */
export function normalizeTrashItems(rawList: unknown): TrashItem[] {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set<string>();
  const items: TrashItem[] = [];
  for (const entry of rawList) {
    const item = normalizeTrashItem(entry);
    if (!item || seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    items.push(item);
  }
  return sortTrashItems(items);
}

/** 建立正規化後的 TrashItem。 */
export function createTrashItem(input: CreateTrashItemInput): TrashItem {
  const chapterId = input.chapterId && input.chapterId !== '' ? input.chapterId : null;
  const wordCount =
    typeof input.wordCount === 'number' && Number.isSafeInteger(input.wordCount) && input.wordCount >= 0
      ? input.wordCount
      : countWords(input.content);
  const charOffset =
    typeof input.charOffset === 'number' && Number.isSafeInteger(input.charOffset) && input.charOffset >= 0
      ? input.charOffset
      : 0;
  const sortOrder =
    typeof input.sortOrder === 'number' && Number.isSafeInteger(input.sortOrder) && input.sortOrder >= 0
      ? input.sortOrder
      : 0;

  return {
    itemId: input.itemId,
    chapterId,
    chapterTitleSnapshot: input.chapterTitleSnapshot,
    content: input.content,
    wordCount,
    beforeAnchor: input.beforeAnchor ?? '',
    afterAnchor: input.afterAnchor ?? '',
    charOffset,
    reason: input.reason ?? '',
    deletedAtMs: input.deletedAtMs,
    sortOrder,
  };
}

/**
 * 計算被刪掉的原文範圍：選取快照優先，驗證不合則退回頭尾共同前後綴 diff。
 */
export function extractDeletedRange(
  before: string,
  after: string,
  selection?: SelectionSnapshot | null,
): { start: number; end: number } {
  if (
    selection &&
    selection.end > selection.start &&
    selection.start >= 0 &&
    selection.end <= before.length &&
    selection.beforeLength === before.length
  ) {
    const prefix = before.slice(0, selection.start);
    const suffix = before.slice(selection.end);
    const minAfterLength = selection.start + (before.length - selection.end);
    if (
      minAfterLength <= after.length &&
      after.startsWith(prefix) &&
      after.endsWith(suffix)
    ) {
      return { start: selection.start, end: selection.end };
    }
  }

  let start = 0;
  const minLength = Math.min(before.length, after.length);
  while (start < minLength && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { start, end: endBefore };
}

/** 從刪前原文與被刪範圍擷取全文、字數、前後文錨點與位移。 */
export function extractTrashAnchor(text: string, delStart: number, delEnd: number): TrashAnchorInfo {
  const safeStart = Math.max(0, Math.min(delStart, text.length));
  const safeEnd = Math.max(safeStart, Math.min(delEnd, text.length));
  const deletedText = text.slice(safeStart, safeEnd);
  return {
    deletedText,
    wordCount: countWords(deletedText),
    beforeAnchor: text.slice(Math.max(0, safeStart - TRASH_ANCHOR_LENGTH), safeStart),
    afterAnchor: text.slice(safeEnd, Math.min(text.length, safeEnd + TRASH_ANCHOR_LENGTH)),
    charOffset: safeStart,
  };
}

/** 判斷單次刪除字數是否達到自動收集門檻（100 字）。 */
export function shouldAutoCaptureDeletion(wordCount: number): boolean {
  return wordCount >= TRASH_AUTO_MIN_WORDS;
}

/** 判斷刪稿項目是否已註記原因（純空白視為未註記）。 */
export function isTrashAnnotated(item: Pick<TrashItem, 'reason'>): boolean {
  return item.reason.trim() !== '';
}

/** 計算目前暫存區使用量與上限提醒狀態。 */
export function summarizeTrashUsage(items: readonly TrashItem[]): TrashUsageSummary {
  const count = items.length;
  const totalWords = items.reduce((sum, item) => sum + item.wordCount, 0);
  const atLimit = count >= TRASH_MAX_ITEMS || totalWords >= TRASH_MAX_WORDS;
  const nearLimit = !atLimit && (count >= TRASH_NEAR_ITEMS || totalWords >= TRASH_NEAR_WORDS);
  const hasEvictable = items.some((item) => !isTrashAnnotated(item));
  return { count, totalWords, nearLimit, atLimit, hasEvictable };
}

/**
 * 依雙上限（50 則或合計 50,000 字）加入新刪稿：
 * - 超過上限時，反覆挑最舊且未註記原因者清理。
 * - 有註記原因者絕不自動清理；若清完無註記仍放不下，不動任何既有項目，回傳 blocked-full。
 */
export function insertTrashItemWithLimit(
  existing: readonly TrashItem[],
  newItem: TrashItem,
): TrashInsertResult {
  const remaining = existing.filter((item) => item.itemId !== newItem.itemId);
  let totalWords = remaining.reduce((sum, item) => sum + item.wordCount, 0) + newItem.wordCount;
  const evictedIds: string[] = [];

  while (remaining.length + 1 > TRASH_MAX_ITEMS || totalWords > TRASH_MAX_WORDS) {
    let oldestIndex = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      if (isTrashAnnotated(candidate)) continue;
      if (oldestIndex < 0 || compareTrashItemsAsc(candidate, remaining[oldestIndex]!) < 0) {
        oldestIndex = i;
      }
    }
    if (oldestIndex < 0) {
      return {
        kind: 'blocked-full',
        items: sortTrashItems(existing),
        reason: newItem.wordCount > TRASH_MAX_WORDS ? 'exceeds-max-words' : 'all-annotated',
      };
    }
    const [evicted] = remaining.splice(oldestIndex, 1);
    totalWords -= evicted!.wordCount;
    evictedIds.push(evicted!.itemId);
  }

  const items = sortTrashItems([...remaining, newItem]);
  return {
    kind: 'added',
    item: newItem,
    items,
    evictedCount: evictedIds.length,
    evictedIds,
  };
}

/** 判斷節點類型是否為可寫正文節點（同時相容手機版 file／scene 與電腦版 chapter）。 */
export function isWritableNodeType(type: string | undefined): boolean {
  return type === 'file' || type === 'scene' || type === 'chapter';
}

/** 收集所有仍存活的可寫節點 ID（章 file／chapter 與幕 scene）。 */
export function collectAliveWritableNodeIds(nodes: readonly ChapterNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly ChapterNode[]) => {
    for (const node of list) {
      if (isWritableNodeType(node.type) && typeof node.id === 'string' && node.id !== '') {
        ids.add(node.id);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

/** 驗證原章或原幕是否仍存在於目前目錄樹中（改章名仍視為同一章，相容電腦版 chapter）。 */
export function isTrashOriginalNodeAlive(
  nodes: readonly ChapterNode[],
  chapterId: string | null | undefined,
): ChapterNode | null {
  if (typeof chapterId !== 'string' || chapterId === '') return null;
  const walk = (list: readonly ChapterNode[]): ChapterNode | null => {
    for (const node of list) {
      if (node.id === chapterId && isWritableNodeType(node.type)) return node;
      if (node.children?.length) {
        const found = walk(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes);
}

/** 依目錄寫作順序列出目前所有可放回的章與幕（含所屬章名供幕附註）。 */
export function listWritableTargetNodes(nodes: readonly ChapterNode[]): WritableTargetNode[] {
  const result: WritableTargetNode[] = [];
  const walk = (list: readonly ChapterNode[], currentChapterTitle: string | null) => {
    for (const node of list) {
      const nodeType = node.type as string;
      if (nodeType === 'file' || nodeType === 'chapter') {
        result.push({
          node,
          chapterTitle: node.title,
          parentChapterTitle: null,
        });
        if (node.children?.length) {
          walk(node.children, node.title);
        }
      } else if (nodeType === 'scene') {
        result.push({
          node,
          chapterTitle: node.title,
          parentChapterTitle: currentChapterTitle,
        });
        if (node.children?.length) {
          walk(node.children, currentChapterTitle);
        }
      } else if (node.children?.length) {
        walk(node.children, currentChapterTitle);
      }
    }
  };
  walk(nodes, null);
  return result;
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle === '') return [];
  const positions: number[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx < 0) break;
    positions.push(idx);
    cursor = idx + 1;
  }
  return positions;
}

function pickClosestPosition(positions: readonly number[], targetOffset: number): number {
  let best = positions[0]!;
  let bestDist = Math.abs(best - targetOffset);
  for (let i = 1; i < positions.length; i += 1) {
    const pos = positions[i]!;
    const dist = Math.abs(pos - targetOffset);
    if (dist < bestDist) {
      best = pos;
      bestDist = dist;
    }
  }
  return best;
}

function insertAtPosition(
  body: string,
  seam: number,
  content: string,
  placement: TrashPutBackPlacement,
): TrashPutBackPlan {
  const nextBody = body.slice(0, seam) + content + body.slice(seam);
  return {
    nextBody,
    insertStart: seam,
    insertEnd: seam + content.length,
    placement,
  };
}

/** 固定放在目標章節最末（依既有尾端換行補妥段落分隔）。 */
export function appendToChapterEndPlan(
  body: string,
  content: string,
  placement: TrashPutBackPlacement = 'end',
): TrashPutBackPlan {
  let separator = '';
  if (body !== '') {
    if (body.endsWith('\n\n')) separator = '';
    else if (body.endsWith('\n')) separator = '\n';
    else separator = '\n\n';
  }
  const insertStart = body.length + separator.length;
  return {
    nextBody: body + separator + content,
    insertStart,
    insertEnd: insertStart + content.length,
    placement,
  };
}

/**
 * 計算「放回原章」位置與寫回內容：
 * 1. 完整雙錨點命中 → 取最接近 charOffset 的接縫處。
 * 2. 近端短雙錨點（各取至多 12 字元，兩側各至少 4 字元）命中 → 取最接近 charOffset 的接縫處。
 * 3. 章首／章尾／空章／單側長錨點（>= 10 字元）唯一命中。
 * 4. 皆對不上 → 放回本章最末（placement = 'end'）。
 */
export function computePutBackPlan(
  body: string,
  item: Pick<TrashItem, 'content' | 'beforeAnchor' | 'afterAnchor' | 'charOffset'>,
): TrashPutBackPlan {
  const { content, beforeAnchor, afterAnchor, charOffset } = item;

  // 步驟 1：完整雙錨點
  if (beforeAnchor !== '' && afterAnchor !== '') {
    const fullMatches = findAllOccurrences(body, beforeAnchor + afterAnchor);
    if (fullMatches.length > 0) {
      const seams = fullMatches.map((idx) => idx + beforeAnchor.length);
      return insertAtPosition(body, pickClosestPosition(seams, charOffset), content, 'original');
    }

    // 步驟 2：近端短雙錨點容錯
    const beforeTail = beforeAnchor.slice(-TRASH_SHORT_ANCHOR_LENGTH);
    const afterHead = afterAnchor.slice(0, TRASH_SHORT_ANCHOR_LENGTH);
    if (
      beforeTail.length >= TRASH_MIN_SHORT_ANCHOR_LENGTH &&
      afterHead.length >= TRASH_MIN_SHORT_ANCHOR_LENGTH
    ) {
      const shortMatches = findAllOccurrences(body, beforeTail + afterHead);
      if (shortMatches.length > 0) {
        const seams = shortMatches.map((idx) => idx + beforeTail.length);
        return insertAtPosition(body, pickClosestPosition(seams, charOffset), content, 'original');
      }
    }
  }

  // 步驟 3a：原先在章首
  if (beforeAnchor === '' && afterAnchor !== '') {
    const fullAfter = findAllOccurrences(body, afterAnchor);
    if (fullAfter.length > 0) {
      return insertAtPosition(body, pickClosestPosition(fullAfter, charOffset), content, 'original');
    }
    const shortAfter = afterAnchor.slice(0, TRASH_SHORT_ANCHOR_LENGTH);
    if (shortAfter.length >= TRASH_MIN_SHORT_ANCHOR_LENGTH) {
      const shortMatches = findAllOccurrences(body, shortAfter);
      if (shortMatches.length > 0) {
        return insertAtPosition(body, pickClosestPosition(shortMatches, charOffset), content, 'original');
      }
    }
  }

  // 步驟 3b：原先在章尾
  if (afterAnchor === '' && beforeAnchor !== '') {
    const fullBefore = findAllOccurrences(body, beforeAnchor);
    if (fullBefore.length > 0) {
      const seams = fullBefore.map((idx) => idx + beforeAnchor.length);
      return insertAtPosition(body, pickClosestPosition(seams, charOffset), content, 'original');
    }
    const shortBefore = beforeAnchor.slice(-TRASH_SHORT_ANCHOR_LENGTH);
    if (shortBefore.length >= TRASH_MIN_SHORT_ANCHOR_LENGTH) {
      const shortMatches = findAllOccurrences(body, shortBefore);
      if (shortMatches.length > 0) {
        const seams = shortMatches.map((idx) => idx + shortBefore.length);
        return insertAtPosition(body, pickClosestPosition(seams, charOffset), content, 'original');
      }
    }
  }

  // 步驟 3c：整章原本清空，且目前也為空
  if (beforeAnchor === '' && afterAnchor === '' && body === '') {
    return insertAtPosition(body, 0, content, 'original');
  }

  // 步驟 3d：單側長錨點唯一命中
  if (beforeAnchor.length >= TRASH_UNIQUE_SINGLE_ANCHOR_MIN_LENGTH) {
    const beforeMatches = findAllOccurrences(body, beforeAnchor);
    if (beforeMatches.length === 1) {
      return insertAtPosition(body, beforeMatches[0]! + beforeAnchor.length, content, 'original');
    }
  }
  if (afterAnchor.length >= TRASH_UNIQUE_SINGLE_ANCHOR_MIN_LENGTH) {
    const afterMatches = findAllOccurrences(body, afterAnchor);
    if (afterMatches.length === 1) {
      return insertAtPosition(body, afterMatches[0]!, content, 'original');
    }
  }

  // 步驟 4：對不上時放在該章最末
  return appendToChapterEndPlan(body, content, 'end');
}
