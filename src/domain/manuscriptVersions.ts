import { countWords } from './wordCount';

/** WO-140 決-2：每章（或每一幕）稿子版本數量上限。 */
export const MANUSCRIPT_VERSION_CHAPTER_LIMIT = 20;

/** 回到舊版前自動保存的預設備註文字（與介面文案一致，不計入手寫備註）。 */
export const MANUSCRIPT_VERSION_AUTO_NOTE = '回到舊版前自動保存';

/** 版本來源：手動存版或回到舊版前自動保存。 */
export type ManuscriptVersionSource = 'manual' | 'auto-before-restore';

/** 單一寫入單元（章或幕）的稿子版本快照，對應 jiufangm_chapter_versions 資料列。 */
export interface ManuscriptVersion {
  version_id: string;
  chapter_id: string;
  chapter_title_snapshot: string;
  content: string;
  word_count: number;
  note: string;
  source: ManuscriptVersionSource;
  saved_at_ms: number;
  sort_order: number;
}

/** 建立版本時的輸入參數；word_count 一律由 countWords(content) 計算。 */
export interface CreateManuscriptVersionInput {
  version_id: string;
  chapter_id: string;
  chapter_title_snapshot?: string;
  content: string;
  note?: string;
  source?: ManuscriptVersionSource;
  saved_at_ms: number;
  sort_order?: number;
}

export type SaveManualVersionResult =
  | {
      kind: 'saved';
      version: ManuscriptVersion;
      versions: ManuscriptVersion[];
      evictedVersions: ManuscriptVersion[];
      evictedCount: number;
      noticeCode: 'saved' | 'saved-evicted-oldest';
    }
  | {
      kind: 'duplicate';
      versions: ManuscriptVersion[];
      latestVersion: ManuscriptVersion;
      reasonCode: 'duplicate-latest';
    }
  | {
      kind: 'blocked-full';
      versions: ManuscriptVersion[];
      reasonCode: 'all-manual-noted-full';
    };

export type SaveAutoVersionResult =
  | {
      kind: 'saved';
      version: ManuscriptVersion;
      versions: ManuscriptVersion[];
      evictedVersions: ManuscriptVersion[];
      evictedCount: number;
      overLimit: boolean;
      noticeCode:
        | 'auto-saved'
        | 'auto-saved-evicted-oldest'
        | 'auto-saved-over-limit';
    }
  | {
      kind: 'reused-latest';
      version: ManuscriptVersion;
      versions: ManuscriptVersion[];
      evictedVersions: [];
      evictedCount: 0;
      overLimit: boolean;
      noticeCode: 'reused-latest';
    }
  | {
      kind: 'blocked-full';
      versions: ManuscriptVersion[];
      reasonCode: 'all-manual-noted-full';
    };

export type UpdateVersionNoteResult =
  | {
      kind: 'updated';
      version: ManuscriptVersion;
      versions: ManuscriptVersion[];
      becameManualProtected: boolean;
      clearedManualProtection: boolean;
    }
  | {
      kind: 'not-found';
      versions: ManuscriptVersion[];
    };

export type DiscardVersionResult =
  | {
      kind: 'discarded';
      versions: ManuscriptVersion[];
      removed: ManuscriptVersion;
    }
  | {
      kind: 'not-found';
      versions: ManuscriptVersion[];
      removed: null;
    };

export type RestoreDiscardedVersionResult =
  | {
      kind: 'restored';
      version: ManuscriptVersion;
      versions: ManuscriptVersion[];
      evictedVersions: ManuscriptVersion[];
      evictedCount: number;
    }
  | {
      kind: 'already-exists';
      version: ManuscriptVersion;
      versions: ManuscriptVersion[];
    }
  | {
      kind: 'blocked-full';
      versions: ManuscriptVersion[];
      reasonCode: 'all-manual-noted-full';
    };

export interface ChapterVersionSummary {
  count: number;
  limit: number;
  manualNotedCount: number;
  evictableCount: number;
  isFull: boolean;
  isAllManualNotedFull: boolean;
  isOverLimit: boolean;
}

function compareStringsBinary(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** 判斷來源是否為合法的版本來源。 */
export function isManuscriptVersionSource(
  value: unknown,
): value is ManuscriptVersionSource {
  return value === 'manual' || value === 'auto-before-restore';
}

/** 清單排序：最新在前（saved_at_ms DESC, sort_order DESC, version_id DESC）。 */
export function compareManuscriptVersionsDesc(
  a: ManuscriptVersion,
  b: ManuscriptVersion,
): number {
  return (
    b.saved_at_ms - a.saved_at_ms ||
    b.sort_order - a.sort_order ||
    compareStringsBinary(b.version_id, a.version_id)
  );
}

/** 清理排序：最舊在前（saved_at_ms ASC, sort_order ASC, version_id ASC）。 */
export function compareManuscriptVersionsAsc(
  a: ManuscriptVersion,
  b: ManuscriptVersion,
): number {
  return (
    a.saved_at_ms - b.saved_at_ms ||
    a.sort_order - b.sort_order ||
    compareStringsBinary(a.version_id, b.version_id)
  );
}

/** 回傳依最新在前排好的新陣列，不修改原陣列。 */
export function sortManuscriptVersions(
  versions: readonly ManuscriptVersion[],
): ManuscriptVersion[] {
  return [...versions].sort(compareManuscriptVersionsDesc);
}

/** 計算同一毫秒內的下一個穩定 sort_order。 */
export function nextManuscriptVersionSortOrder(
  versions: readonly ManuscriptVersion[],
  savedAtMs: number,
): number {
  let maxOrder = -1;
  for (const item of versions) {
    if (item.saved_at_ms === savedAtMs && item.sort_order > maxOrder) {
      maxOrder = item.sort_order;
    }
  }
  return maxOrder + 1;
}

/**
 * 判斷版本是否具有手寫備註（受保護，不自動清理）。
 * 僅當 source === 'manual' 且 note 去除前後空白後非空時為 true；
 * 回到舊版前自動保存的自動備註不計入手寫備註。
 */
export function hasManualNote(
  version: Pick<ManuscriptVersion, 'source' | 'note'>,
): boolean {
  return version.source === 'manual' && version.note.trim() !== '';
}

/** 判斷版本是否可在滿上限時被自動清理。 */
export function isEvictableVersion(
  version: Pick<ManuscriptVersion, 'source' | 'note'>,
): boolean {
  return !hasManualNote(version);
}

/** 建立正規化後的 ManuscriptVersion；字數一律以 countWords 計算。 */
export function createManuscriptVersion(
  input: CreateManuscriptVersionInput,
): ManuscriptVersion {
  const source: ManuscriptVersionSource =
    input.source === 'auto-before-restore' ? 'auto-before-restore' : 'manual';
  const sortOrder = isNonNegativeSafeInteger(input.sort_order)
    ? input.sort_order
    : 0;
  return {
    version_id: input.version_id,
    chapter_id: input.chapter_id,
    chapter_title_snapshot: input.chapter_title_snapshot ?? '',
    content: input.content,
    word_count: countWords(input.content),
    note: input.note ?? '',
    source,
    saved_at_ms: input.saved_at_ms,
    sort_order: sortOrder,
  };
}

/** 正規化並驗證單筆稿子版本；核心欄位不合法時回傳 null（允許空白章 content === ''）。 */
export function normalizeManuscriptVersion(
  raw: unknown,
): ManuscriptVersion | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.version_id !== 'string' ||
    candidate.version_id.trim() === ''
  ) {
    return null;
  }
  if (
    typeof candidate.chapter_id !== 'string' ||
    candidate.chapter_id.trim() === ''
  ) {
    return null;
  }
  if (typeof candidate.content !== 'string') {
    return null;
  }
  if (!isManuscriptVersionSource(candidate.source)) {
    return null;
  }
  if (!isPositiveSafeInteger(candidate.saved_at_ms)) {
    return null;
  }

  const chapterTitleSnapshot =
    typeof candidate.chapter_title_snapshot === 'string'
      ? candidate.chapter_title_snapshot
      : '';
  const wordCount = isNonNegativeSafeInteger(candidate.word_count)
    ? candidate.word_count
    : countWords(candidate.content);
  const note = typeof candidate.note === 'string' ? candidate.note : '';
  const sortOrder = isNonNegativeSafeInteger(candidate.sort_order)
    ? candidate.sort_order
    : 0;

  return {
    version_id: candidate.version_id,
    chapter_id: candidate.chapter_id,
    chapter_title_snapshot: chapterTitleSnapshot,
    content: candidate.content,
    word_count: wordCount,
    note,
    source: candidate.source,
    saved_at_ms: candidate.saved_at_ms,
    sort_order: sortOrder,
  };
}

/**
 * 合法化、依 version_id 去重並依最新在前排序版本清單。
 * 遵守決-3：不針對 chapter_id 做孤兒過濾或清除。
 */
export function normalizeManuscriptVersions(
  rawList: unknown,
): ManuscriptVersion[] {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set<string>();
  const items: ManuscriptVersion[] = [];
  for (const entry of rawList) {
    const item = normalizeManuscriptVersion(entry);
    if (!item || seen.has(item.version_id)) continue;
    seen.add(item.version_id);
    items.push(item);
  }
  return sortManuscriptVersions(items);
}

/** 篩出指定章（或幕）的所有版本並依最新在前排序。 */
export function versionsForChapter(
  versions: readonly ManuscriptVersion[],
  chapterId: string,
): ManuscriptVersion[] {
  return sortManuscriptVersions(
    versions.filter((item) => item.chapter_id === chapterId),
  );
}

/** 取得指定章（或幕）最新一筆版本；尚無版本時回傳 null。 */
export function latestVersionForChapter(
  versions: readonly ManuscriptVersion[],
  chapterId: string,
): ManuscriptVersion | null {
  let latest: ManuscriptVersion | null = null;
  for (const item of versions) {
    if (item.chapter_id !== chapterId) continue;
    if (latest === null || compareManuscriptVersionsDesc(item, latest) < 0) {
      latest = item;
    }
  }
  return latest;
}

/** 判斷目前正文是否與該章最新一版正文完全相同。 */
export function isDuplicateOfLatestVersion(
  versions: readonly ManuscriptVersion[],
  chapterId: string,
  content: string,
): boolean {
  const latest = latestVersionForChapter(versions, chapterId);
  return latest !== null && latest.content === content;
}

/** 從同一章清單挑出最舊且可自動清理的版本索引；找不到則回傳 -1。 */
function findOldestEvictableIndex(
  items: readonly ManuscriptVersion[],
  canEvict: (item: ManuscriptVersion) => boolean = isEvictableVersion,
): number {
  let oldestIndex = -1;
  for (let i = 0; i < items.length; i += 1) {
    const candidate = items[i]!;
    if (!canEvict(candidate)) continue;
    if (
      oldestIndex < 0 ||
      compareManuscriptVersionsAsc(candidate, items[oldestIndex]!) < 0
    ) {
      oldestIndex = i;
    }
  }
  return oldestIndex;
}

/** 依每章上限嘗試清出名額（僅清符合條件的最舊者）；不修改傳入陣列。 */
function evictChapterVersionsToFit(
  chapterVersions: readonly ManuscriptVersion[],
  targetMaxExisting: number,
  canEvict: (item: ManuscriptVersion) => boolean = isEvictableVersion,
): {
  remaining: ManuscriptVersion[];
  evicted: ManuscriptVersion[];
} {
  const remaining = [...chapterVersions];
  const evicted: ManuscriptVersion[] = [];
  while (remaining.length > targetMaxExisting) {
    const oldestIndex = findOldestEvictableIndex(remaining, canEvict);
    if (oldestIndex < 0) break;
    const [removed] = remaining.splice(oldestIndex, 1);
    evicted.push(removed!);
  }
  return { remaining, evicted };
}

function splitChapterVersions(
  versions: readonly ManuscriptVersion[],
  chapterId: string,
  excludeVersionId?: string,
): {
  chapterItems: ManuscriptVersion[];
  otherItems: ManuscriptVersion[];
} {
  const chapterItems: ManuscriptVersion[] = [];
  const otherItems: ManuscriptVersion[] = [];
  for (const item of versions) {
    if (excludeVersionId && item.version_id === excludeVersionId) continue;
    if (item.chapter_id === chapterId) {
      chapterItems.push(item);
    } else {
      otherItems.push(item);
    }
  }
  return { chapterItems, otherItems };
}

/**
 * 手動存成版本：
 * 1. 與該章最新一版內容完全相同時不重複存入。
 * 2. 該章滿 20 份時，先清最舊且無手寫備註者（含自動保存）；不影響其他章。
 * 3. 若 20 份皆有手寫備註，不更動既有清單，拒絕新增並回傳 all-manual-noted-full。
 */
export function saveManualVersion(
  existing: readonly ManuscriptVersion[],
  input: Omit<CreateManuscriptVersionInput, 'source'>,
): SaveManualVersionResult {
  const latest = latestVersionForChapter(existing, input.chapter_id);
  if (latest !== null && latest.content === input.content) {
    return {
      kind: 'duplicate',
      versions: sortManuscriptVersions(existing),
      latestVersion: latest,
      reasonCode: 'duplicate-latest',
    };
  }

  const sortOrder = isNonNegativeSafeInteger(input.sort_order)
    ? input.sort_order
    : nextManuscriptVersionSortOrder(existing, input.saved_at_ms);

  const newVersion = createManuscriptVersion({
    ...input,
    source: 'manual',
    sort_order: sortOrder,
  });

  const { chapterItems, otherItems } = splitChapterVersions(
    existing,
    newVersion.chapter_id,
    newVersion.version_id,
  );
  const { remaining, evicted } = evictChapterVersionsToFit(
    chapterItems,
    MANUSCRIPT_VERSION_CHAPTER_LIMIT - 1,
  );

  if (remaining.length + 1 > MANUSCRIPT_VERSION_CHAPTER_LIMIT) {
    return {
      kind: 'blocked-full',
      versions: sortManuscriptVersions(existing),
      reasonCode: 'all-manual-noted-full',
    };
  }

  const versions = sortManuscriptVersions([
    ...otherItems,
    ...remaining,
    newVersion,
  ]);

  return {
    kind: 'saved',
    version: newVersion,
    versions,
    evictedVersions: evicted,
    evictedCount: evicted.length,
    noticeCode: evicted.length > 0 ? 'saved-evicted-oldest' : 'saved',
  };
}

/**
 * 回到舊版前的自動保存：
 * 1. 若目前正文與該章最新一版完全相同，沿用最新一版、不重複建立。
 * 2. 若該章滿上限，先清最舊且無手寫備註者（含先前自動保存，使連續還原上限收斂在 21）。
 * 3. 若清完仍滿 20（20 份皆有手寫備註），自動保存必定留下，暫留第 21 份並標記 overLimit。
 */
export function saveAutoVersionBeforeRestore(
  existing: readonly ManuscriptVersion[],
  input: Omit<CreateManuscriptVersionInput, 'source'>,
): SaveAutoVersionResult {
  const latest = latestVersionForChapter(existing, input.chapter_id);
  if (latest !== null && latest.content === input.content) {
    const chapterCount = existing.filter(
      (item) => item.chapter_id === input.chapter_id,
    ).length;
    return {
      kind: 'reused-latest',
      version: latest,
      versions: sortManuscriptVersions(existing),
      evictedVersions: [],
      evictedCount: 0,
      overLimit: chapterCount > MANUSCRIPT_VERSION_CHAPTER_LIMIT,
      noticeCode: 'reused-latest',
    };
  }

  const sortOrder = isNonNegativeSafeInteger(input.sort_order)
    ? input.sort_order
    : nextManuscriptVersionSortOrder(existing, input.saved_at_ms);

  const autoVersion = createManuscriptVersion({
    ...input,
    note: input.note ?? MANUSCRIPT_VERSION_AUTO_NOTE,
    source: 'auto-before-restore',
    sort_order: sortOrder,
  });

  const { chapterItems, otherItems } = splitChapterVersions(
    existing,
    autoVersion.chapter_id,
    autoVersion.version_id,
  );
  const { remaining, evicted } = evictChapterVersionsToFit(
    chapterItems,
    MANUSCRIPT_VERSION_CHAPTER_LIMIT - 1,
  );

  const nextChapterCount = remaining.length + 1;
  if (nextChapterCount > MANUSCRIPT_VERSION_CHAPTER_LIMIT + 1) {
    return {
      kind: 'blocked-full',
      versions: sortManuscriptVersions(existing),
      reasonCode: 'all-manual-noted-full',
    };
  }
  const overLimit = nextChapterCount > MANUSCRIPT_VERSION_CHAPTER_LIMIT;
  const versions = sortManuscriptVersions([
    ...otherItems,
    ...remaining,
    autoVersion,
  ]);

  const noticeCode = overLimit
    ? 'auto-saved-over-limit'
    : evicted.length > 0
      ? 'auto-saved-evicted-oldest'
      : 'auto-saved';

  return {
    kind: 'saved',
    version: autoVersion,
    versions,
    evictedVersions: evicted,
    evictedCount: evicted.length,
    overLimit,
    noticeCode,
  };
}

/**
 * 補上或修改版本備註：
 * - 把自動保存（auto-before-restore）改寫為不同的非空白文字時，轉為 source: 'manual' 並受手寫保護。
 * - 清空備註（空字串或純空白）時正規化為空字串 '' 並解除手寫保護。
 */
export function updateManuscriptVersionNote(
  versions: readonly ManuscriptVersion[],
  versionId: string,
  nextNote: string,
): UpdateVersionNoteResult {
  const index = versions.findIndex((item) => item.version_id === versionId);
  if (index < 0) {
    return {
      kind: 'not-found',
      versions: sortManuscriptVersions(versions),
    };
  }

  const target = versions[index]!;
  const wasProtected = hasManualNote(target);
  const trimmedNext = nextNote.trim();

  let updatedSource: ManuscriptVersionSource = target.source;
  let updatedNote = '';

  if (trimmedNext === '') {
    updatedNote = '';
    updatedSource = target.source;
  } else if (target.source === 'auto-before-restore') {
    if (trimmedNext !== target.note.trim()) {
      updatedSource = 'manual';
      updatedNote = nextNote;
    } else {
      updatedSource = 'auto-before-restore';
      updatedNote = target.note;
    }
  } else {
    updatedSource = 'manual';
    updatedNote = nextNote;
  }

  const updatedVersion: ManuscriptVersion = {
    ...target,
    note: updatedNote,
    source: updatedSource,
  };
  const nowProtected = hasManualNote(updatedVersion);
  const nextList = versions.map((item, i) =>
    i === index ? updatedVersion : item,
  );

  return {
    kind: 'updated',
    version: updatedVersion,
    versions: sortManuscriptVersions(nextList),
    becameManualProtected: !wasProtected && nowProtected,
    clearedManualProtection: wasProtected && !nowProtected,
  };
}

/** 丟掉指定版本，並回傳被移除的完整版本物件供 10 秒內復原使用。 */
export function discardManuscriptVersion(
  versions: readonly ManuscriptVersion[],
  versionId: string,
): DiscardVersionResult {
  const target = versions.find((item) => item.version_id === versionId);
  if (!target) {
    return {
      kind: 'not-found',
      versions: sortManuscriptVersions(versions),
      removed: null,
    };
  }
  const remaining = versions.filter((item) => item.version_id !== versionId);
  return {
    kind: 'discarded',
    versions: sortManuscriptVersions(remaining),
    removed: target,
  };
}

/**
 * 復原剛丟掉的版本（10 秒內復原丟掉）：
 * - 原樣放回原 version_id、時間、排序、備註與來源，並恢復排序位置。
 * - 放回後 ≤ 20 份時直接放回。
 * - 放回後為 21 份且結果清單裡仍有非手寫保護的「回到舊版前自動保存」時，允許暫留 21 份且不清掉該自動保存。
 * - 否則（超過 21 份，或 21 份卻無上述自動保存作為暫留理由），先清最舊且無手寫備註的非自動保存者；清不了則回傳 blocked-full，不丟掉另一份自動保存來換位子。
 */
export function restoreDiscardedManuscriptVersion(
  versions: readonly ManuscriptVersion[],
  discarded: ManuscriptVersion,
): RestoreDiscardedVersionResult {
  const existingItem = versions.find(
    (item) => item.version_id === discarded.version_id,
  );
  if (existingItem) {
    return {
      kind: 'already-exists',
      version: existingItem,
      versions: sortManuscriptVersions(versions),
    };
  }

  const { chapterItems, otherItems } = splitChapterVersions(
    versions,
    discarded.chapter_id,
  );
  const nextCount = chapterItems.length + 1;
  const hasAutoBeforeRestoreInResult = [...chapterItems, discarded].some(
    (item) => item.source === 'auto-before-restore' && !hasManualNote(item),
  );

  if (nextCount <= MANUSCRIPT_VERSION_CHAPTER_LIMIT) {
    return {
      kind: 'restored',
      version: discarded,
      versions: sortManuscriptVersions([...otherItems, ...chapterItems, discarded]),
      evictedVersions: [],
      evictedCount: 0,
    };
  }

  if (
    nextCount === MANUSCRIPT_VERSION_CHAPTER_LIMIT + 1 &&
    hasAutoBeforeRestoreInResult
  ) {
    return {
      kind: 'restored',
      version: discarded,
      versions: sortManuscriptVersions([...otherItems, ...chapterItems, discarded]),
      evictedVersions: [],
      evictedCount: 0,
    };
  }

  const maxAfterRestore = hasAutoBeforeRestoreInResult
    ? MANUSCRIPT_VERSION_CHAPTER_LIMIT + 1
    : MANUSCRIPT_VERSION_CHAPTER_LIMIT;
  const { remaining, evicted } = evictChapterVersionsToFit(
    chapterItems,
    maxAfterRestore - 1,
    (item) => isEvictableVersion(item) && item.source !== 'auto-before-restore',
  );

  if (remaining.length + 1 > maxAfterRestore) {
    return {
      kind: 'blocked-full',
      versions: sortManuscriptVersions(versions),
      reasonCode: 'all-manual-noted-full',
    };
  }

  const nextVersions = sortManuscriptVersions([
    ...otherItems,
    ...remaining,
    discarded,
  ]);
  return {
    kind: 'restored',
    version: discarded,
    versions: nextVersions,
    evictedVersions: evicted,
    evictedCount: evicted.length,
  };
}

/** 統計指定章節的版本數量與手寫保護摘要。 */
export function summarizeChapterVersions(
  versions: readonly ManuscriptVersion[],
  chapterId: string,
): ChapterVersionSummary {
  const chapterItems = versions.filter((item) => item.chapter_id === chapterId);
  const count = chapterItems.length;
  let manualNotedCount = 0;
  for (const item of chapterItems) {
    if (hasManualNote(item)) manualNotedCount += 1;
  }
  const evictableCount = count - manualNotedCount;
  const isFull = count >= MANUSCRIPT_VERSION_CHAPTER_LIMIT;
  return {
    count,
    limit: MANUSCRIPT_VERSION_CHAPTER_LIMIT,
    manualNotedCount,
    evictableCount,
    isFull,
    isAllManualNotedFull: isFull && evictableCount === 0,
    isOverLimit: count > MANUSCRIPT_VERSION_CHAPTER_LIMIT,
  };
}
