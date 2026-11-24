/**
 * WO-65：寫作 ↔ 資料集「來回記住位置」與卡片未完成編輯的本機記憶。
 *
 * - 每本書一份，存在這個裝置的 localStorage，鍵名為 `jiufang-novel-m.nav-memory.v1:<書 id>`，
 *   內容也帶 `version: 1`。不寫進 .db，不影響存檔內容或電腦版。
 * - 讀到壞 JSON、欄位型別不符或舊版本，就當作沒有記憶（該段忽略），不當機。
 * - 讀寫 localStorage 失敗時，仍保留這次開著時的記憶體內容，正在編輯的字不會因此消失。
 * - 卡片草稿以「書 id ＋ 卡片 id」分開記，只放標題、內容、顏色；不是正式卡片，
 *   要等按「完成」才經既有的 actions.updateCard 寫回。
 */
import { findNode, type ChapterNode } from '../data/demo';
import { locateNode } from '../domain/chapterOps';

export const NAV_MEMORY_VERSION = 1;
export const NAV_MEMORY_PREFIX = 'jiufang-novel-m.nav-memory.v1:';

export interface NavMemoryStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** 寫作頁：篇章、游標／選取、捲動、離開前鍵盤狀態。 */
export interface WritePlace {
  chapterId: string;
  /** 離開時是不是停在那一章的正文（false＝停在目錄頁） */
  chapterOpen: boolean;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  /** 記下捲動位置時正文框的寬度與可捲動高度（寬度不同時依比例換算，0＝未記） */
  scrollWidth: number;
  scrollMax: number;
  /** 離開前正文是不是正在打字（鍵盤開著） */
  keyboard: boolean;
  /** 那一章被刪時，用來在目錄找附近的項目（依序：前一個、後一個、上一層） */
  nearIds: string[];
}

/** 資料集與看卡片共用：分類、卡片、展開、各自的捲動位置。 */
export interface CardsPlace {
  categoryId: string | null;
  cardId: string | null;
  /** 收合的卡片 id（沒在清單裡的就是展開） */
  collapsedIds: string[];
  categoryScroll: number;
  listScroll: number;
  previewScroll: number;
}

export interface CardDraft {
  title: string;
  content: string;
  color: string;
  /** WO-128：時間軸事件卡未完成編輯的故事時間（可選，舊草稿無此欄則退回卡片原值）。 */
  storyTime?: string;
  /** WO-128：時間軸事件卡未完成編輯的連章代號（可選，null 代表「還沒寫進任何章」）。 */
  chapterId?: string | null;
}

export interface NavMemory {
  version: typeof NAV_MEMORY_VERSION;
  write: WritePlace | null;
  cards: CardsPlace | null;
  /** 卡片 id → 還沒按「完成」的內容；有草稿就代表那張卡片正在編輯中 */
  drafts: Record<string, CardDraft>;
}

export function emptyNavMemory(): NavMemory {
  return { version: NAV_MEMORY_VERSION, write: null, cards: null, drafts: {} };
}

export function emptyCardsPlace(): CardsPlace {
  return {
    categoryId: null,
    cardId: null,
    collapsedIds: [],
    categoryScroll: 0,
    listScroll: 0,
    previewScroll: 0,
  };
}

/** 這次開著時的最新記憶；localStorage 寫不進去時仍以這裡為準。 */
const memoryCache = new Map<string, NavMemory>();

export function navMemoryKey(bookId: string): string {
  return `${NAV_MEMORY_PREFIX}${bookId}`;
}

function browserStore(): NavMemoryStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function resolveStore(store: NavMemoryStore | null | undefined): NavMemoryStore | null {
  return store === undefined ? browserStore() : store;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function parseWrite(raw: unknown): WritePlace | null {
  if (!isObject(raw)) return null;
  const { chapterId, chapterOpen, selectionStart, selectionEnd, scrollTop, keyboard, nearIds } = raw;
  if (typeof chapterId !== 'string' || !chapterId) return null;
  if (typeof chapterOpen !== 'boolean' || typeof keyboard !== 'boolean') return null;
  if (!isCount(selectionStart) || !isCount(selectionEnd) || !isCount(scrollTop)) return null;
  if (!Array.isArray(nearIds) || !nearIds.every((id) => typeof id === 'string')) return null;
  return {
    chapterId,
    chapterOpen,
    selectionStart: Math.floor(selectionStart),
    selectionEnd: Math.floor(Math.max(selectionStart, selectionEnd)),
    scrollTop,
    scrollWidth: isCount(raw.scrollWidth) ? raw.scrollWidth : 0,
    scrollMax: isCount(raw.scrollMax) ? raw.scrollMax : 0,
    keyboard,
    nearIds: [...nearIds],
  };
}

function parseCards(raw: unknown): CardsPlace | null {
  if (!isObject(raw)) return null;
  const { categoryId, cardId, collapsedIds, categoryScroll, listScroll, previewScroll } = raw;
  if (!isStringOrNull(categoryId) || !isStringOrNull(cardId)) return null;
  if (!Array.isArray(collapsedIds) || !collapsedIds.every((id) => typeof id === 'string')) return null;
  if (!isCount(categoryScroll) || !isCount(listScroll) || !isCount(previewScroll)) return null;
  return {
    categoryId: categoryId || null,
    cardId: cardId || null,
    collapsedIds: [...collapsedIds],
    categoryScroll,
    listScroll,
    previewScroll,
  };
}

function parseDrafts(raw: unknown): Record<string, CardDraft> {
  if (!isObject(raw)) return {};
  const drafts: Record<string, CardDraft> = {};
  for (const [cardId, value] of Object.entries(raw)) {
    if (!cardId || !isObject(value)) continue;
    const { title, content, color, storyTime, chapterId } = value;
    if (typeof title !== 'string' || typeof content !== 'string' || typeof color !== 'string') continue;
    const draft: CardDraft = { title, content, color };
    if (typeof storyTime === 'string') {
      draft.storyTime = storyTime;
    }
    if (chapterId === null || typeof chapterId === 'string') {
      draft.chapterId = chapterId === '' ? null : chapterId;
    }
    drafts[cardId] = draft;
  }
  return drafts;
}

/** 解析存下來的文字；壞資料、舊版本一律回傳空白記憶。各段型別不符只忽略該段。 */
export function parseNavMemory(raw: string | null): NavMemory {
  if (!raw) return emptyNavMemory();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyNavMemory();
  }
  if (!isObject(parsed) || parsed.version !== NAV_MEMORY_VERSION) return emptyNavMemory();
  return {
    version: NAV_MEMORY_VERSION,
    write: parseWrite(parsed.write),
    cards: parseCards(parsed.cards),
    drafts: parseDrafts(parsed.drafts),
  };
}

function cloneMemory(memory: NavMemory): NavMemory {
  return {
    version: NAV_MEMORY_VERSION,
    write: memory.write ? { ...memory.write, nearIds: [...memory.write.nearIds] } : null,
    cards: memory.cards ? { ...memory.cards, collapsedIds: [...memory.cards.collapsedIds] } : null,
    drafts: Object.fromEntries(Object.entries(memory.drafts).map(([id, draft]) => [id, { ...draft }])),
  };
}

/** 讀某本書的記憶。這次開著時寫過的以記憶體為準；剛開 App 時從 localStorage 讀。 */
export function readNavMemory(bookId: string, store?: NavMemoryStore | null): NavMemory {
  if (!bookId) return emptyNavMemory();
  const cached = memoryCache.get(bookId);
  if (cached) return cloneMemory(cached);
  const target = resolveStore(store);
  let raw: string | null = null;
  if (target) {
    try {
      raw = target.getItem(navMemoryKey(bookId));
    } catch {
      raw = null;
    }
  }
  const memory = parseNavMemory(raw);
  memoryCache.set(bookId, memory);
  return cloneMemory(memory);
}

/** 寫入某本書的記憶；localStorage 寫不進去時仍留在記憶體。回傳是否已寫進本機儲存。 */
export function writeNavMemory(bookId: string, memory: NavMemory, store?: NavMemoryStore | null): boolean {
  if (!bookId) return false;
  const next = cloneMemory(memory);
  memoryCache.set(bookId, next);
  const target = resolveStore(store);
  if (!target) return false;
  try {
    target.setItem(navMemoryKey(bookId), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * WO-116：這本書從這個裝置刪掉時，清掉它的位置記憶與卡片草稿（記憶體與本機儲存，只動這一本的鍵）。
 * 沒有 removeItem 的儲存改寫成空字串（讀回時等同沒有記憶）。寫不進去會丟錯，由呼叫端處理。
 */
export function forgetNavMemory(bookId: string, store?: NavMemoryStore | null): void {
  if (!bookId) return;
  memoryCache.delete(bookId);
  const target = resolveStore(store);
  if (!target) return;
  if (typeof target.removeItem === 'function') target.removeItem(navMemoryKey(bookId));
  else target.setItem(navMemoryKey(bookId), '');
}

function updateNavMemory(
  bookId: string,
  update: (memory: NavMemory) => NavMemory,
  store?: NavMemoryStore | null,
): NavMemory {
  const next = update(readNavMemory(bookId, store));
  writeNavMemory(bookId, next, store);
  return next;
}

/* ---------------- 寫作頁 ---------------- */

export function readWritePlace(bookId: string, store?: NavMemoryStore | null): WritePlace | null {
  return readNavMemory(bookId, store).write;
}

export function saveWritePlace(
  bookId: string,
  place: Omit<WritePlace, 'nearIds' | 'scrollWidth' | 'scrollMax'> &
    Partial<Pick<WritePlace, 'nearIds' | 'scrollWidth' | 'scrollMax'>>,
  store?: NavMemoryStore | null,
): void {
  updateNavMemory(
    bookId,
    (memory) => ({
      ...memory,
      write: {
        ...place,
        scrollWidth: place.scrollWidth ?? 0,
        scrollMax: place.scrollMax ?? 0,
        selectionEnd: Math.max(place.selectionStart, place.selectionEnd),
        nearIds: place.nearIds ?? (memory.write?.chapterId === place.chapterId ? memory.write.nearIds : []),
      },
    }),
    store,
  );
}

/** 只改「離開時是不是停在正文」；目錄頁用，不動游標與捲動。 */
export function markWriteChapterOpen(bookId: string, open: boolean, store?: NavMemoryStore | null): void {
  const current = readWritePlace(bookId, store);
  if (!current || current.chapterOpen === open) return;
  updateNavMemory(bookId, (memory) => ({ ...memory, write: memory.write ? { ...memory.write, chapterOpen: open } : null }), store);
}

/** 那一章附近的項目：前一個、後一個、上一層（目錄定位用）。 */
export function nearIdsOf(nodes: readonly ChapterNode[], id: string): string[] {
  const location = locateNode(nodes, id);
  if (!location) return [];
  const siblings = location.parentId ? (findNode(nodes, location.parentId)?.children ?? []) : nodes;
  const ids = [siblings[location.index - 1]?.id, siblings[location.index + 1]?.id, location.parentId ?? undefined];
  return ids.filter((value): value is string => typeof value === 'string' && value !== id);
}

/** 那一章已不在時，找仍存在的附近項目；都不在就回傳 null。 */
export function aliveNearId(nodes: readonly ChapterNode[], place: WritePlace | null): string | null {
  if (!place) return null;
  if (findNode(nodes, place.chapterId)) return place.chapterId;
  return place.nearIds.find((id) => findNode(nodes, id)) ?? null;
}

/**
 * 按「寫作」或收起資料集抽屜時要去哪裡：
 * - 離開時在那一章正文、那一章仍在：直接回那一章
 * - 那一章被刪了：回目錄（目錄會停在附近）
 * - 離開時就在目錄，或沒有記憶：回目錄
 */
export function writeReturnPath(
  bookId: string,
  nodes: readonly ChapterNode[],
  store?: NavMemoryStore | null,
): string {
  const base = `/p/${bookId}/write`;
  const place = readWritePlace(bookId, store);
  if (!place || !place.chapterOpen) return base;
  const node = findNode(nodes, place.chapterId);
  return node && node.type !== 'folder' ? `${base}/${place.chapterId}` : base;
}

/**
 * 放回捲動：正文框寬度和記下時相同就放回同一個位置；寬度不同（例如手機橫拿目錄抽屜讓位、轉向）時，
 * 依可捲動高度的比例換算，停在差不多同一段。
 */
export function scrollTopToRestore(
  place: Pick<WritePlace, 'scrollTop' | 'scrollWidth' | 'scrollMax'>,
  clientWidth: number,
  scrollMax: number,
): number {
  if (!place.scrollWidth || !place.scrollMax || place.scrollWidth === clientWidth) return place.scrollTop;
  return Math.round((place.scrollTop / place.scrollMax) * Math.max(0, scrollMax));
}

/** 回到寫作頁要放回的游標、選取與捲動（只在同一章時給，且限制在正文長度內）。 */
export function caretToRestore(
  place: WritePlace | null,
  chapterId: string,
  textLength: number,
): {
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  scrollWidth: number;
  scrollMax: number;
  keyboard: boolean;
} | null {
  if (!place || place.chapterId !== chapterId) return null;
  const clamp = (value: number) => Math.max(0, Math.min(value, textLength));
  return {
    selectionStart: clamp(place.selectionStart),
    selectionEnd: clamp(place.selectionEnd),
    scrollTop: place.scrollTop,
    scrollWidth: place.scrollWidth,
    scrollMax: place.scrollMax,
    keyboard: place.keyboard,
  };
}

/* ---------------- 資料集與看卡片 ---------------- */

export function readCardsPlace(bookId: string, store?: NavMemoryStore | null): CardsPlace | null {
  return readNavMemory(bookId, store).cards;
}

export function patchCardsPlace(
  bookId: string,
  patch: Partial<CardsPlace>,
  store?: NavMemoryStore | null,
): CardsPlace {
  const next = updateNavMemory(
    bookId,
    (memory) => ({ ...memory, cards: { ...(memory.cards ?? emptyCardsPlace()), ...patch } }),
    store,
  );
  return next.cards ?? emptyCardsPlace();
}

/**
 * 換分類或換卡片時一起改的欄位：換分類就從清單頂端開始、換卡片就從內容頂端開始。
 * 同一個分類或同一張卡片不動捲動位置。
 */
export function selectionPatch(
  previous: CardsPlace | null,
  categoryId: string | null,
  cardId: string | null,
): Partial<CardsPlace> {
  const patch: Partial<CardsPlace> = { categoryId, cardId };
  if ((previous?.categoryId ?? null) !== categoryId) patch.listScroll = 0;
  if ((previous?.cardId ?? null) !== cardId) patch.previewScroll = 0;
  return patch;
}

/** 記憶裡的卡片還在不在；不在（被刪了）就回原分類清單並提示。 */
export function resolveRememberedCard(
  place: CardsPlace | null,
  existingCardIds: ReadonlySet<string>,
): { categoryId: string | null; cardId: string | null; cardDeleted: boolean } {
  if (!place) return { categoryId: null, cardId: null, cardDeleted: false };
  if (place.cardId && !existingCardIds.has(place.cardId)) {
    return { categoryId: place.categoryId, cardId: null, cardDeleted: true };
  }
  return { categoryId: place.categoryId, cardId: place.cardId, cardDeleted: false };
}

/* ---------------- 卡片草稿 ---------------- */

export function getCardDraft(bookId: string, cardId: string, store?: NavMemoryStore | null): CardDraft | null {
  if (!cardId) return null;
  return readNavMemory(bookId, store).drafts[cardId] ?? null;
}

export function saveCardDraft(
  bookId: string,
  cardId: string,
  draft: CardDraft,
  store?: NavMemoryStore | null,
): void {
  if (!bookId || !cardId) return;
  updateNavMemory(
    bookId,
    (memory) => ({ ...memory, drafts: { ...memory.drafts, [cardId]: { ...draft } } }),
    store,
  );
}

export function clearCardDraft(bookId: string, cardId: string, store?: NavMemoryStore | null): void {
  if (!bookId || !cardId) return;
  const memory = readNavMemory(bookId, store);
  if (!memory.drafts[cardId]) return;
  const drafts = { ...memory.drafts };
  delete drafts[cardId];
  writeNavMemory(bookId, { ...memory, drafts }, store);
}

/** 測試用：清掉這次開著時的記憶體（模擬關掉 App 再開）。 */
export function resetNavMemoryCache(): void {
  memoryCache.clear();
}
