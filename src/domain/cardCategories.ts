export const CATEGORY_SUMMARY = 'summary';
export const CATEGORY_CHARACTER = 'character';
export const CATEGORY_WORLD = 'world';
export const CATEGORY_TIMELINE = 'timeline';
export const CATEGORY_AI_CHAT = 'ai_chat';

export const BUILTIN_CATEGORY_CODES = [
  CATEGORY_SUMMARY,
  CATEGORY_CHARACTER,
  CATEGORY_WORLD,
  CATEGORY_TIMELINE,
  CATEGORY_AI_CHAT,
] as const;

export type BuiltinCategoryCode = (typeof BUILTIN_CATEGORY_CODES)[number];

export const VISIBLE_BUILTIN_CATEGORY_CODES = [
  CATEGORY_SUMMARY,
  CATEGORY_CHARACTER,
  CATEGORY_WORLD,
  CATEGORY_TIMELINE,
] as const;

export type VisibleBuiltinCategoryCode = (typeof VISIBLE_BUILTIN_CATEGORY_CODES)[number];

export const BUILTIN_CATEGORY_NAMES: Readonly<Record<BuiltinCategoryCode, string>> = {
  summary: '本書綱要',
  character: '角色',
  world: '世界觀',
  timeline: '時間軸',
  ai_chat: 'AI 對話紀錄',
};

export const CUSTOM_CATEGORY_PREFIX = 'custom_';
export const CUSTOM_CATEGORY_REGEX = /^custom_[0-9a-f]{8}$/;
const META_CUSTOM_CATEGORY_KEY_REGEX = /^custom_[0-9a-z]{8}$/;

const BUILTIN_SET = new Set<string>(BUILTIN_CATEGORY_CODES);
const VISIBLE_BUILTIN_SET = new Set<string>(VISIBLE_BUILTIN_CATEGORY_CODES);

export function isBuiltinCategory(code: string): code is BuiltinCategoryCode {
  return BUILTIN_SET.has(code);
}

export function isVisibleBuiltinCategory(code: string): code is VisibleBuiltinCategoryCode {
  return VISIBLE_BUILTIN_SET.has(code);
}

export function isCustomCategory(code: string): boolean {
  return typeof code === 'string' && code.startsWith(CUSTOM_CATEGORY_PREFIX) && code.length > CUSTOM_CATEGORY_PREFIX.length;
}

export function isStandardCustomCategoryCode(code: string): boolean {
  return typeof code === 'string' && CUSTOM_CATEGORY_REGEX.test(code);
}

/** 判斷是否為手機版隱藏的分類（如電腦版 AI 對話紀錄 ai_chat）。 */
export function isHiddenCategory(code: string | null | undefined): boolean {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (!trimmed) return false;
  return trimmed === CATEGORY_AI_CHAT || trimmed.toLowerCase() === CATEGORY_AI_CHAT;
}

function defaultRandomHex8(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

/**
 * 產生不與現有分類代碼重複的自訂分類代碼：custom_ 加 8 碼小寫十六進位。
 */
export function generateCustomCategoryCode(
  existingCodes: Iterable<string> = [],
  randomHex8: () => string = defaultRandomHex8,
): string {
  const existing = new Set<string>(existingCodes);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const rawHex = randomHex8().toLowerCase().replace(/[^0-9a-f]/g, '').padEnd(8, '0').slice(0, 8);
    const candidate = `${CUSTOM_CATEGORY_PREFIX}${rawHex}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  for (let fallback = 0; fallback <= 0xffffffff; fallback++) {
    const candidate = `${CUSTOM_CATEGORY_PREFIX}${fallback.toString(16).padStart(8, '0')}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('無法產生不重複的自訂分類代碼');
}

export const createCustomCategoryCode = generateCustomCategoryCode;

export interface ParsedCategoryArray {
  /** 原始字串（含 null），未改動或不可改寫時原樣寫回 */
  readonly raw: string | null;
  /** 是否可安全改寫（非法 JSON 或非陣列型別時為 false） */
  readonly writable: boolean;
  /** 是否經過修改 */
  readonly dirty: boolean;
  /** 解析出的分類代碼（僅字串項目） */
  readonly codes: readonly string[];
  /** 原始 JSON 陣列完整元素（含可能的非字串未知元素） */
  readonly rawElements: readonly unknown[];
}

export function parseCategoryArray(raw: string | null | undefined): ParsedCategoryArray {
  if (raw === null || raw === undefined) {
    return {
      raw: null,
      writable: true,
      dirty: false,
      codes: [],
      rawElements: [],
    };
  }
  if (typeof raw !== 'string') {
    return {
      raw: null,
      writable: false,
      dirty: false,
      codes: [],
      rawElements: [],
    };
  }
  if (raw === '') {
    return {
      raw: '',
      writable: true,
      dirty: false,
      codes: [],
      rawElements: [],
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        raw,
        writable: false,
        dirty: false,
        codes: [],
        rawElements: [],
      };
    }
    const rawElements = [...parsed];
    const codes = rawElements.filter((item): item is string => typeof item === 'string');
    return {
      raw,
      writable: true,
      dirty: false,
      codes,
      rawElements,
    };
  } catch {
    return {
      raw,
      writable: false,
      dirty: false,
      codes: [],
      rawElements: [],
    };
  }
}

export const parseCategoryOrder = parseCategoryArray;
export const parseExpandedCategories = parseCategoryArray;

export function serializeCategoryArray(parsed: ParsedCategoryArray): string | null {
  if (!parsed.writable || !parsed.dirty) {
    return parsed.raw;
  }
  return JSON.stringify(parsed.rawElements);
}

export const serializeCategoryOrder = serializeCategoryArray;
export const serializeExpandedCategories = serializeCategoryArray;

export interface ParsedCategoriesMeta {
  /** 原始字串（含 null），未改動或不可改寫時原樣寫回 */
  readonly raw: string | null;
  /** 是否可安全改寫（非法 JSON 或非物件型別時為 false） */
  readonly writable: boolean;
  /** 是否經過修改 */
  readonly dirty: boolean;
  /** 完整鍵值對（保留所有未知鍵與非字串未知值） */
  readonly entries: Readonly<Record<string, unknown>>;
  /** 分類代碼對應顯示名稱（僅字串值） */
  readonly names: Readonly<Record<string, string>>;
}

export function parseCategoriesMeta(raw: string | null | undefined): ParsedCategoriesMeta {
  if (raw === null || raw === undefined) {
    return {
      raw: null,
      writable: true,
      dirty: false,
      entries: {},
      names: {},
    };
  }
  if (typeof raw !== 'string') {
    return {
      raw: null,
      writable: false,
      dirty: false,
      entries: {},
      names: {},
    };
  }
  if (raw === '') {
    return {
      raw: '',
      writable: true,
      dirty: false,
      entries: {},
      names: {},
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        raw,
        writable: false,
        dirty: false,
        entries: {},
        names: {},
      };
    }
    const entries: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    const names: Record<string, string> = {};
    for (const [key, val] of Object.entries(entries)) {
      if (typeof val === 'string') {
        names[key] = val;
      }
    }
    return {
      raw,
      writable: true,
      dirty: false,
      entries,
      names,
    };
  } catch {
    return {
      raw,
      writable: false,
      dirty: false,
      entries: {},
      names: {},
    };
  }
}

export function serializeCategoriesMeta(meta: ParsedCategoriesMeta): string | null {
  if (!meta.writable || !meta.dirty) {
    return meta.raw;
  }
  return JSON.stringify(meta.entries);
}

/** 淺層更新或新增分類顯示名稱，保留所有其他鍵與未知值。 */
export function setCustomCategoryName(
  meta: ParsedCategoriesMeta,
  code: string,
  name: string,
): ParsedCategoriesMeta {
  if (!meta.writable) return meta;
  if (meta.entries[code] === name) return meta;
  return {
    ...meta,
    dirty: true,
    entries: { ...meta.entries, [code]: name },
    names: { ...meta.names, [code]: name },
  };
}

/** 淺層移除指定自訂分類名稱，保留所有其他鍵與未知值。 */
export function removeCustomCategoryName(
  meta: ParsedCategoriesMeta,
  code: string,
): ParsedCategoriesMeta {
  if (!meta.writable) return meta;
  if (!(code in meta.entries)) return meta;
  const entries = { ...meta.entries };
  delete entries[code];
  const names = { ...meta.names };
  delete names[code];
  return {
    ...meta,
    dirty: true,
    entries,
    names,
  };
}

function isPinnedOrderElement(
  element: unknown,
  knownEditableSet: ReadonlySet<string>,
): boolean {
  if (typeof element !== 'string') return true;
  if (isHiddenCategory(element)) return true;
  if (isVisibleBuiltinCategory(element) || isCustomCategory(element) || knownEditableSet.has(element)) {
    return false;
  }
  return true;
}

/**
 * 重算 category_order：
 * - 非法 JSON（writable = false）時不改動
 * - 隱藏分類（ai_chat）與手機不認得的代碼／非字串元素原位保留，絕不刪掉
 */
export function rebuildCategoryOrder(
  order: ParsedCategoryArray,
  nextVisibleCodes: readonly string[],
  knownCustomCodes: Iterable<string> = [],
): ParsedCategoryArray {
  if (!order.writable) return order;

  const dedupedVisible: string[] = [];
  const seenVisible = new Set<string>();
  for (const code of nextVisibleCodes) {
    if (!code || isHiddenCategory(code) || seenVisible.has(code)) continue;
    seenVisible.add(code);
    dedupedVisible.push(code);
  }

  const knownEditable = new Set<string>([...knownCustomCodes, ...dedupedVisible]);

  if (order.rawElements.length === 0) {
    const fullList = [...dedupedVisible];
    if (!fullList.includes(CATEGORY_AI_CHAT)) {
      const timelineIdx = fullList.indexOf(CATEGORY_TIMELINE);
      if (timelineIdx !== -1) {
        fullList.splice(timelineIdx + 1, 0, CATEGORY_AI_CHAT);
      } else {
        fullList.push(CATEGORY_AI_CHAT);
      }
    }
    return {
      ...order,
      dirty: true,
      codes: fullList,
      rawElements: fullList,
    };
  }

  const nextElements: unknown[] = [];
  let visibleCursor = 0;

  for (let i = 0; i < order.rawElements.length; i++) {
    const existing = order.rawElements[i];
    if (isPinnedOrderElement(existing, knownEditable)) {
      nextElements.push(existing);
    } else if (visibleCursor < dedupedVisible.length) {
      nextElements.push(dedupedVisible[visibleCursor++]);
    }
  }

  while (visibleCursor < dedupedVisible.length) {
    nextElements.push(dedupedVisible[visibleCursor++]);
  }

  const nextCodes = nextElements.filter((item): item is string => typeof item === 'string');
  return {
    ...order,
    dirty: true,
    codes: nextCodes,
    rawElements: nextElements,
  };
}

/** 在 category_order 最後附加新分類代碼（若尚未存在），保留既有 ai_chat 與未知項目。 */
export function appendCategoryToOrder(
  order: ParsedCategoryArray,
  code: string,
): ParsedCategoryArray {
  if (!order.writable || !code) return order;
  if (order.codes.includes(code)) return order;

  if (order.rawElements.length === 0) {
    const base: string[] = [...BUILTIN_CATEGORY_CODES];
    if (!base.includes(code as BuiltinCategoryCode)) {
      base.push(code);
    }
    return {
      ...order,
      dirty: true,
      codes: base,
      rawElements: base,
    };
  }

  const rawElements = [...order.rawElements, code];
  const codes = [...order.codes, code];
  return {
    ...order,
    dirty: true,
    codes,
    rawElements,
  };
}

/** 從 category_order 移除指定自訂分類代碼（保護 ai_chat 與內建／未知分類不被誤刪）。 */
export function removeCategoryFromOrder(
  order: ParsedCategoryArray,
  code: string,
): ParsedCategoryArray {
  if (!order.writable || !code || isHiddenCategory(code)) return order;
  if (!order.codes.includes(code)) return order;
  const rawElements = order.rawElements.filter((item) => item !== code);
  const codes = rawElements.filter((item): item is string => typeof item === 'string');
  return {
    ...order,
    dirty: true,
    codes,
    rawElements,
  };
}

/** 更新 expanded_categories 中某分類的展開狀態，未變動時不設 dirty，保留其他未知項與 ai_chat。 */
export function setCategoryExpanded(
  expanded: ParsedCategoryArray,
  code: string,
  isExpanded: boolean,
): ParsedCategoryArray {
  if (!expanded.writable || !code) return expanded;
  const exists = expanded.codes.includes(code);
  if (isExpanded && exists) return expanded;
  if (!isExpanded && !exists) return expanded;

  const rawElements = isExpanded
    ? [...expanded.rawElements, code]
    : expanded.rawElements.filter((item) => item !== code);
  const codes = rawElements.filter((item): item is string => typeof item === 'string');
  return {
    ...expanded,
    dirty: true,
    codes,
    rawElements,
  };
}

/** 取得分類顯示名稱：優先取 categories_meta，內建分類取固定中文名，未知則回傳代碼本身。 */
export function getCategoryDisplayName(
  code: string,
  categoriesMeta?: ParsedCategoriesMeta | Readonly<Record<string, string>> | string | null,
): string {
  let namesMap: Readonly<Record<string, string>> = {};
  if (typeof categoriesMeta === 'string' || categoriesMeta === null || categoriesMeta === undefined) {
    namesMap = parseCategoriesMeta(categoriesMeta).names;
  } else if ('names' in categoriesMeta && 'writable' in categoriesMeta) {
    namesMap = (categoriesMeta as ParsedCategoriesMeta).names;
  } else {
    namesMap = categoriesMeta as Readonly<Record<string, string>>;
  }

  const customName = namesMap[code];
  if (typeof customName === 'string' && customName.trim() !== '') {
    return customName;
  }
  if (isBuiltinCategory(code)) {
    return BUILTIN_CATEGORY_NAMES[code];
  }
  return code;
}

export interface ResolvedCategoryItem {
  id: string;
  name: string;
  sort_order: number;
  isBuiltin: boolean;
  isCustom: boolean;
  isOrphan: boolean;
}

/**
 * 推導手機畫面顯示的分類清單：
 * - 隱藏分類（ai_chat）一律過濾不顯示
 * - 有卡片用到、但不在 category_order 的分類代碼（ai_chat 除外），自動附在最後，避免卡片變孤兒
 */
export function resolveVisibleCategories(options: {
  categoryOrder?: string | null | ParsedCategoryArray;
  categoriesMeta?: string | null | ParsedCategoriesMeta;
  cards?: readonly { category: string }[];
} = {}): ResolvedCategoryItem[] {
  const order =
    typeof options.categoryOrder === 'object' && options.categoryOrder !== null
      ? options.categoryOrder
      : parseCategoryOrder(options.categoryOrder);

  const meta =
    typeof options.categoriesMeta === 'object' && options.categoriesMeta !== null
      ? options.categoriesMeta
      : parseCategoriesMeta(options.categoriesMeta);

  const baseCodes: string[] =
    order.codes.length > 0 ? [...order.codes] : [...VISIBLE_BUILTIN_CATEGORY_CODES];

  for (const metaKey of Object.keys(meta.names)) {
    if (META_CUSTOM_CATEGORY_KEY_REGEX.test(metaKey) && !baseCodes.includes(metaKey)) {
      baseCodes.push(metaKey);
    }
  }

  const orderedSet = new Set<string>(order.codes);
  const resultCodes: Array<{ code: string; isOrphan: boolean }> = [];
  const seen = new Set<string>();

  for (const code of baseCodes) {
    if (!code || isHiddenCategory(code) || seen.has(code)) continue;
    seen.add(code);
    resultCodes.push({ code, isOrphan: false });
  }

  for (const card of options.cards ?? []) {
    const code = card.category;
    if (!code || typeof code !== 'string' || isHiddenCategory(code) || seen.has(code)) continue;
    seen.add(code);
    resultCodes.push({ code, isOrphan: !orderedSet.has(code) });
  }

  return resultCodes.map(({ code, isOrphan }, index) => ({
    id: code,
    name: getCategoryDisplayName(code, meta),
    sort_order: index + 1,
    isBuiltin: isBuiltinCategory(code),
    isCustom: isCustomCategory(code),
    isOrphan,
  }));
}

/**
 * 檢查分類是否可以刪除：
 * - 內建分類（summary, character, world, timeline, ai_chat）不可刪除
 * - 自訂分類若含有卡片不可刪除（必須先將卡片移走或刪除）
 */
export function canDeleteCategory(
  code: string,
  cards: readonly { category: string }[] = [],
): { canDelete: boolean; reason?: string } {
  if (!code || isBuiltinCategory(code) || !isCustomCategory(code)) {
    return { canDelete: false, reason: '內建分類，不能刪除' };
  }
  const hasCards = cards.some((c) => c.category === code);
  if (hasCards) {
    return {
      canDelete: false,
      reason: '分類內還有卡片，要先把卡片移走或刪掉才能刪除',
    };
  }
  return { canDelete: true };
}

/**
 * 刪除自訂分類：
 * - 只有沒有卡片的自訂分類才能刪除
 * - 從 category_order 與 categories_meta 移除自己的鍵
 * - 若傳入 expandedCategories 亦一併移除
 * - 隱藏分類（ai_chat）與未知鍵／非字串元素原樣保留
 */
export function deleteCustomCategory(params: {
  code: string;
  categoryOrder?: string | null | ParsedCategoryArray;
  categoriesMeta?: string | null | ParsedCategoriesMeta;
  cards?: readonly { category: string }[];
  expandedCategories?: string | null | ParsedCategoryArray;
}): {
  nextCategoryOrder: string | null;
  nextCategoriesMeta: string;
  nextExpandedCategories?: string | null;
  deleted: boolean;
  reason?: string;
} {
  const { code, cards = [] } = params;
  const order =
    typeof params.categoryOrder === 'object' && params.categoryOrder !== null
      ? params.categoryOrder
      : parseCategoryOrder(params.categoryOrder);

  const meta =
    typeof params.categoriesMeta === 'object' && params.categoriesMeta !== null
      ? params.categoriesMeta
      : parseCategoriesMeta(params.categoriesMeta);

  const check = canDeleteCategory(code, cards);
  if (!check.canDelete) {
    return {
      nextCategoryOrder: serializeCategoryOrder(order),
      nextCategoriesMeta: serializeCategoriesMeta(meta) ?? '{}',
      nextExpandedCategories: params.expandedCategories !== undefined
        ? serializeExpandedCategories(
            typeof params.expandedCategories === 'object' && params.expandedCategories !== null
              ? params.expandedCategories
              : parseExpandedCategories(params.expandedCategories),
          )
        : undefined,
      deleted: false,
      reason: check.reason,
    };
  }

  const nextOrder = removeCategoryFromOrder(order, code);
  const nextMeta = removeCustomCategoryName(meta, code);

  let nextExpanded: string | null | undefined = undefined;
  if (params.expandedCategories !== undefined) {
    const expanded =
      typeof params.expandedCategories === 'object' && params.expandedCategories !== null
        ? params.expandedCategories
        : parseExpandedCategories(params.expandedCategories);
    const updatedExpanded = removeCategoryFromOrder(expanded, code);
    nextExpanded = serializeExpandedCategories(updatedExpanded);
  }

  return {
    nextCategoryOrder: serializeCategoryOrder(nextOrder),
    nextCategoriesMeta: serializeCategoriesMeta(nextMeta) ?? '{}',
    nextExpandedCategories: nextExpanded,
    deleted: true,
  };
}

/**
 * 改名自訂分類：
 * - 內建分類不可改名
 * - 分類名稱不可為空字串或純空白
 * - 僅更新 categories_meta 中對應的鍵，保留其餘未知鍵與 ai_chat
 */
export function renameCustomCategory(params: {
  code: string;
  newName: string;
  categoriesMeta?: string | null | ParsedCategoriesMeta;
}): {
  nextCategoriesMeta: string;
  renamed: boolean;
  reason?: string;
} {
  const { code, newName } = params;
  const meta =
    typeof params.categoriesMeta === 'object' && params.categoriesMeta !== null
      ? params.categoriesMeta
      : parseCategoriesMeta(params.categoriesMeta);

  if (!code || isBuiltinCategory(code) || !isCustomCategory(code)) {
    return {
      nextCategoriesMeta: serializeCategoriesMeta(meta) ?? '{}',
      renamed: false,
      reason: '內建分類不能改名',
    };
  }

  const trimmed = newName.trim();
  if (!trimmed) {
    return {
      nextCategoriesMeta: serializeCategoriesMeta(meta) ?? '{}',
      renamed: false,
      reason: '名稱不能是空白',
    };
  }

  const nextMeta = setCustomCategoryName(meta, code, trimmed);
  return {
    nextCategoriesMeta: serializeCategoriesMeta(nextMeta) ?? '{}',
    renamed: true,
  };
}

/**
 * 在可見分類清單中上移／下移分類：
 * - 調整順序後重新計算 category_order
 * - 隱藏分類（ai_chat）與未知元素位置保留不被破壞
 */
export function moveCategoryInOrder(params: {
  code: string;
  direction: 'up' | 'down';
  categoryOrder?: string | null | ParsedCategoryArray;
  categoriesMeta?: string | null | ParsedCategoriesMeta;
  cards?: readonly { category: string }[];
}): {
  nextCategoryOrder: string | null;
  moved: boolean;
} {
  const order =
    typeof params.categoryOrder === 'object' && params.categoryOrder !== null
      ? params.categoryOrder
      : parseCategoryOrder(params.categoryOrder);

  const meta =
    typeof params.categoriesMeta === 'object' && params.categoriesMeta !== null
      ? params.categoriesMeta
      : parseCategoriesMeta(params.categoriesMeta);

  const visible = resolveVisibleCategories({
    categoryOrder: order,
    categoriesMeta: meta,
    cards: params.cards,
  });

  const index = visible.findIndex((item) => item.id === params.code);
  if (index === -1) {
    return { nextCategoryOrder: serializeCategoryOrder(order), moved: false };
  }

  const targetIndex = params.direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= visible.length) {
    return { nextCategoryOrder: serializeCategoryOrder(order), moved: false };
  }

  const nextCodes = visible.map((v) => v.id);
  const temp = nextCodes[index]!;
  nextCodes[index] = nextCodes[targetIndex]!;
  nextCodes[targetIndex] = temp;

  const knownCustomCodes = visible.filter((v) => v.isCustom).map((v) => v.id);
  const nextOrder = rebuildCategoryOrder(order, nextCodes, knownCustomCodes);

  return {
    nextCategoryOrder: serializeCategoryOrder(nextOrder),
    moved: true,
  };
}

/**
 * 新增自訂分類：
 * - 產生不重複的 custom_＋8 碼小寫十六進位代碼
 * - 加入 category_order
 * - 將名稱寫進 categories_meta
 */
export function addCustomCategory(params: {
  name: string;
  categoryOrder?: string | null | ParsedCategoryArray;
  categoriesMeta?: string | null | ParsedCategoriesMeta;
  existingCodes?: Iterable<string>;
}): {
  code: string;
  nextCategoryOrder: string | null;
  nextCategoriesMeta: string;
  added: boolean;
  reason?: string;
} {
  const trimmed = params.name.trim();
  const order =
    typeof params.categoryOrder === 'object' && params.categoryOrder !== null
      ? params.categoryOrder
      : parseCategoryOrder(params.categoryOrder);

  const meta =
    typeof params.categoriesMeta === 'object' && params.categoriesMeta !== null
      ? params.categoriesMeta
      : parseCategoriesMeta(params.categoriesMeta);

  if (!trimmed) {
    return {
      code: '',
      nextCategoryOrder: serializeCategoryOrder(order),
      nextCategoriesMeta: serializeCategoriesMeta(meta) ?? '{}',
      added: false,
      reason: '名稱不能是空白',
    };
  }

  const existing = new Set<string>(params.existingCodes ?? order.codes);
  for (const key of Object.keys(meta.entries)) {
    existing.add(key);
  }

  const code = generateCustomCategoryCode(existing);
  const nextOrder = appendCategoryToOrder(order, code);
  const nextMeta = setCustomCategoryName(meta, code, trimmed);

  return {
    code,
    nextCategoryOrder: serializeCategoryOrder(nextOrder),
    nextCategoriesMeta: serializeCategoriesMeta(nextMeta) ?? '{}',
    added: true,
  };
}


