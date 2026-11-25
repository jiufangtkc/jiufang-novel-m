import { settleImportedLogs, writingDayKey, type GoalSchedule, createSchedule, withClock, applyWordDelta } from '../domain/dailyGoal';
import { MIN_DAILY_GOAL } from '../domain/dailyGoal';
import { appSpace } from './browserSpace';
import { isBookRemoved, markBookRemoved } from './removedBooks';
import type { StoredBook } from './appSpace';
import { externalFileFromStored, type BookFileMark } from '../domain/bookTitle';
import type { BookMetaRead, BookMetaWritable } from './bookMeta';
import { generateUuidV4, isPositiveSafeInteger, isValidUuidV4 } from './extensionMeta';
import { readFileProject, writeFileProject, type FileCard, type FileLog, type FileProjectInfo } from './projectFile';
import type { TimelineRead } from './timelineMeta';
import type { TransferEvent, TransferRead } from './transferMeta';
import {
  browserDeliveryEnv,
  downloadFile,
  shouldPreferDownload,
  type DeliveryEnv,
} from './fileDelivery';
import { DatabaseOpenError, hasSqliteHeader } from './openDbError';
import { openMemoryDb, type MemoryDb } from './wasmDb';

export type { StoredBook };

/** WO-116：進行中的寫入（以稿子代號分組），刪除時要等它們結束才刪，避免刪完又被寫回。 */
const inflightPuts = new Map<string, Set<Promise<unknown>>>();
/** WO-135：每本稿寫入佇列尾端，確保同一本稿的讀取-改寫-寫入依序執行，且失敗不鎖死後續寫入。 */
const bookWriteTails = new Map<string, Promise<void>>();

async function serializeBookWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = bookWriteTails.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  bookWriteTails.set(key, current);
  if (previous) {
    await previous;
  }
  try {
    return await task();
  } finally {
    release();
    if (bookWriteTails.get(key) === current) {
      bookWriteTails.delete(key);
    }
  }
}

async function putBookDirect(book: StoredBook): Promise<void> {
  // 已從這個裝置刪掉的稿子不再寫回 App 空間（自動暫存、離頁寫回都經過這裡）。
  if (isBookRemoved(book.key)) return;
  const pending = (async () => {
    await (await appSpace()).put(book);
  })();
  let set = inflightPuts.get(book.key);
  if (!set) {
    set = new Set();
    inflightPuts.set(book.key, set);
  }
  set.add(pending);
  try {
    await pending;
  } finally {
    set.delete(pending);
    if (set.size === 0) inflightPuts.delete(book.key);
  }
}

export async function putBook(book: StoredBook): Promise<void> {
  if (isBookRemoved(book.key)) return;
  await serializeBookWrite(book.key, () => putBookDirect(book));
}

/**
 * WO-116：從這個裝置的 App 空間刪掉這份稿子的副本（OPFS 與 IndexedDB 備援，只刪這個鍵）。
 * 先登記為已刪除（擋住之後的寫入與讀回），等已開始的寫入結束，再刪，最後確認兩邊都讀不到。
 * 刪不掉或確認仍存在會丟錯，呼叫端不能假報完成。不碰使用者另存在別處的檔案。
 */
export async function removeBook(key: string): Promise<void> {
  if (!key) return;
  markBookRemoved(key);
  const queued = bookWriteTails.get(key);
  if (queued) await queued;
  const running = inflightPuts.get(key);
  if (running) await Promise.allSettled([...running]);
  const space = await appSpace();
  await space.remove(key);
  if (await space.get(key)) throw new Error('這個裝置上的稿子副本沒有刪乾淨');
}

export async function getBook(key: string): Promise<StoredBook | null> {
  return (await appSpace()).get(key);
}

export async function listBooks(): Promise<StoredBook[]> {
  return (await appSpace()).list();
}

export interface ImportedBook {
  key: string;
  filename: string;
  title: string;
  info: FileProjectInfo;
  tree: ReturnType<typeof readFileProject>['tree'];
  cards: FileCard[];
  logs: FileLog[];
  wordCount: number;
  schedule: GoalSchedule;
  bytes: Uint8Array;
  hasExternalFile: boolean;
  titleInFile: string | null;
  titleSavePending: BookFileMark['titleSavePending'];
  /** WO-100：檔內附加表的匯入事件。 */
  transfer: TransferRead;
  /** WO-128：檔內附加表的時間線資料狀態。 */
  timeline: TimelineRead;
  /** WO-137：檔內附加表的固定身分證讀取結果。 */
  bookMeta?: BookMetaRead;
  /** WO-137：此稿件在記憶體／中繼層的有效固定身分證（舊檔未存前先於記憶體／.json 暫配）。 */
  bookUuid?: string;
  bookCreatedAtMs?: number;
  originBookUuid?: string | null;
  bookMetaPersisted?: boolean;
}

export type BookIdentityFallback = Partial<
  Pick<StoredBook, 'bookUuid' | 'bookCreatedAtMs' | 'originBookUuid' | 'bookMetaPersisted'>
>;

export type StoredBookMark = BookFileMark & BookIdentityFallback;

function resolveLoadedBookIdentity(
  bookMeta: BookMetaRead,
  now: Date,
  fallback?: BookIdentityFallback,
): {
  bookUuid: string;
  bookCreatedAtMs: number;
  originBookUuid: string | null;
  bookMetaPersisted: boolean;
} {
  if (bookMeta.kind === 'ok') {
    return {
      bookUuid: bookMeta.meta.bookUuid,
      bookCreatedAtMs: bookMeta.meta.createdAtMs,
      originBookUuid: bookMeta.meta.originBookUuid,
      bookMetaPersisted: true,
    };
  }
  const fallbackUuid = isValidUuidV4(fallback?.bookUuid) ? fallback.bookUuid : generateUuidV4();
  const fallbackCreatedAt = isPositiveSafeInteger(fallback?.bookCreatedAtMs)
    ? fallback.bookCreatedAtMs
    : Math.max(1, Math.trunc(now.getTime()));
  const fallbackOrigin = isValidUuidV4(fallback?.originBookUuid) ? fallback.originBookUuid : null;
  return {
    bookUuid: fallbackUuid,
    bookCreatedAtMs: fallbackCreatedAt,
    originBookUuid: fallbackOrigin,
    bookMetaPersisted: false,
  };
}

/** 從檔案裡的寫作紀錄排出每日目標結算狀態（WO-69 單元測試也用來核對重開結果）。 */
export function scheduleFromLogs(logs: readonly FileLog[], dailyTarget: number, now: Date): GoalSchedule {
  const goal = Math.max(MIN_DAILY_GOAL, Math.trunc(dailyTarget) || 1000);
  const today = writingDayKey(now, 0);
  const past = logs.filter((log) => log.date < today);
  let schedule = createSchedule({ defaultGoal: goal, dayEndHour: 0 });
  schedule = {
    ...schedule,
    settled: settleImportedLogs(
      past.map((log) => ({ date: log.date, wordCount: log.word_count })),
      goal,
    ),
  };
  schedule = withClock(schedule, now);
  const todayLog = logs.find((log) => log.date === today);
  if (todayLog) schedule = applyWordDelta(schedule, todayLog.word_count, now);
  return schedule;
}

export async function loadStoredBooks(now = new Date()): Promise<ImportedBook[]> {
  const stored = await listBooks();
  const books: ImportedBook[] = [];
  for (const item of stored) {
    // WO-116：已刪稿子即使讀取在刪除前就開始，也不回傳。
    if (isBookRemoved(item.key)) continue;
    if (!hasSqliteHeader(item.bytes)) continue;
    let db: MemoryDb | null = null;
    try {
      db = await openMemoryDb(item.bytes);
      const loaded = readFileProject(db.sql);
      const mark = externalFileFromStored({
        key: item.key,
        hasExternalFile: item.hasExternalFile,
        titleInFile: item.titleInFile,
        title: loaded.info.title,
        titleSavePending: item.titleSavePending,
      });
      const identity = resolveLoadedBookIdentity(loaded.bookMeta, now, item);
      books.push({
        key: item.key,
        filename: item.filename,
        title: loaded.info.title,
        info: loaded.info,
        tree: loaded.tree,
        cards: loaded.cards,
        logs: loaded.logs,
        wordCount: loaded.wordCount,
        schedule: scheduleFromLogs(loaded.logs, loaded.info.dailyTargetWordCount, now),
        bytes: item.bytes,
        hasExternalFile: mark.hasExternalFile,
        titleInFile: mark.titleInFile,
        titleSavePending: mark.titleSavePending,
        transfer: loaded.transfer,
        timeline: loaded.timeline,
        bookMeta: loaded.bookMeta,
        ...identity,
      });
    } catch {
      // 單本暫存讀壞時略過，避免拖垮其餘已存稿件載入。
    } finally {
      db?.close();
    }
  }
  // 讀取期間才被刪掉的稿子也要濾掉。
  return books.filter((book) => !isBookRemoved(book.key));
}

/**
 * WO-100：把使用者選入的 .db 位元組讀成一份稿子（不寫入 App 本機）。
 * 回傳的 bytes 是重新匯出的位元組；原始位元組的指紋請在呼叫前另外算（本機事件對應用）。
 */
export async function readBookBytes(
  filename: string,
  bytes: Uint8Array,
  key: string,
  now = new Date(),
  fallbackIdentity?: BookIdentityFallback,
): Promise<ImportedBook> {
  if (!hasSqliteHeader(bytes)) {
    throw new DatabaseOpenError('not-jiufang');
  }
  let db: MemoryDb;
  try {
    db = await openMemoryDb(bytes);
  } catch {
    throw new DatabaseOpenError('not-jiufang');
  }
  try {
    const loaded = readFileProject(db.sql);
    const exported = db.exportBytes();
    const identity = resolveLoadedBookIdentity(loaded.bookMeta, now, fallbackIdentity);
    return {
      key,
      filename: filename || '未命名.db',
      title: loaded.info.title,
      info: loaded.info,
      tree: loaded.tree,
      cards: loaded.cards,
      logs: loaded.logs,
      wordCount: loaded.wordCount,
      schedule: scheduleFromLogs(loaded.logs, loaded.info.dailyTargetWordCount, now),
      bytes: exported,
      hasExternalFile: true,
      titleInFile: loaded.info.title,
      titleSavePending: null,
      transfer: loaded.transfer,
      timeline: loaded.timeline,
      bookMeta: loaded.bookMeta,
      ...identity,
    };
  } finally {
    db.close();
  }
}

export async function importBook(filename: string, bytes: Uint8Array, now = new Date()): Promise<ImportedBook> {
  const book = await readBookBytes(filename, bytes, `file-${now.getTime()}`, now);
  try {
    await putBook({
      key: book.key,
      filename: book.filename,
      title: book.title,
      bytes: book.bytes,
      hasExternalFile: true,
      titleInFile: book.info.title,
      titleSavePending: null,
      bookUuid: book.bookUuid,
      bookCreatedAtMs: book.bookCreatedAtMs,
      originBookUuid: book.originBookUuid,
      bookMetaPersisted: book.bookMetaPersisted,
    });
  } catch {
    throw new DatabaseOpenError('storage-failed');
  }
  return book;
}

/**
 * WO-100：在既有位元組（沒有就從空白庫）上差異寫入這份稿子，回傳新位元組。
 * 沿用原資料庫再差異寫入，未知表與未知欄留著；匯入事件與正文同一筆交易寫入。
 */
export async function writeBookBytes(
  base: Uint8Array | null | undefined,
  info: FileProjectInfo,
  tree: ImportedBook['tree'],
  cards: FileCard[],
  logs: FileLog[],
  importEvents?: Readonly<Record<string, TransferEvent>>,
  exportEvents?: Readonly<Record<string, TransferEvent>>,
  bookMeta?: BookMetaWritable,
): Promise<Uint8Array> {
  const db = await openMemoryDb(base ?? new Uint8Array());
  try {
    writeFileProject(db.sql, info, tree, cards, logs, importEvents, exportEvents, bookMeta);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

export async function saveBookBytes(
  key: string,
  filename: string,
  title: string,
  info: FileProjectInfo,
  tree: ImportedBook['tree'],
  cards: FileCard[],
  logs: FileLog[],
  bookkeeping?: StoredBookMark,
  persist = true,
  importEvents?: Readonly<Record<string, TransferEvent>>,
  exportEvents?: Readonly<Record<string, TransferEvent>>,
  bookMeta?: BookMetaWritable,
): Promise<Uint8Array> {
  return serializeBookWrite(key, async () => {
    const existing = await getBook(key);
    const exported = await writeBookBytes(existing?.bytes, info, tree, cards, logs, importEvents, exportEvents, bookMeta);
    if (!persist) return exported;
    const mark: StoredBookMark = bookkeeping ?? {
      titleInFile: existing?.titleInFile ?? null,
      hasExternalFile: Boolean(existing?.hasExternalFile),
      titleSavePending: existing?.titleSavePending ?? null,
      bookUuid: existing?.bookUuid,
      bookCreatedAtMs: existing?.bookCreatedAtMs,
      originBookUuid: existing?.originBookUuid,
      bookMetaPersisted: existing?.bookMetaPersisted,
    };
    await putBookDirect({
      key,
      filename,
      title,
      bytes: exported,
      titleInFile: mark.titleInFile,
      hasExternalFile: mark.hasExternalFile,
      titleSavePending: mark.titleSavePending,
      ...(isValidUuidV4(mark.bookUuid)
        ? { bookUuid: mark.bookUuid }
        : isValidUuidV4(existing?.bookUuid)
          ? { bookUuid: existing.bookUuid }
          : {}),
      ...(isPositiveSafeInteger(mark.bookCreatedAtMs)
        ? { bookCreatedAtMs: mark.bookCreatedAtMs }
        : isPositiveSafeInteger(existing?.bookCreatedAtMs)
          ? { bookCreatedAtMs: existing.bookCreatedAtMs }
          : {}),
      ...(mark.originBookUuid !== undefined
        ? { originBookUuid: mark.originBookUuid }
        : existing?.originBookUuid !== undefined
          ? { originBookUuid: existing.originBookUuid }
          : {}),
      ...(typeof mark.bookMetaPersisted === 'boolean'
        ? { bookMetaPersisted: mark.bookMetaPersisted }
        : typeof existing?.bookMetaPersisted === 'boolean'
          ? { bookMetaPersisted: existing.bookMetaPersisted }
          : {}),
    });
    return exported;
  });
}

export async function exportBook(key: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const book = await getBook(key);
  if (!book) return null;
  return { filename: book.filename, bytes: book.bytes };
}

export function databaseSharePayload(file: File): ShareData {
  return { files: [file] };
}

export async function shareDatabase(
  filename: string,
  bytes: Uint8Array,
  env: DeliveryEnv = browserDeliveryEnv(),
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], filename.endsWith('.db') ? filename : `${filename}.db`, {
    type: 'application/octet-stream',
  });
  const payload = databaseSharePayload(file);
  let canShare = false;
  try {
    canShare = Boolean(env.share && env.canShare?.(payload)) && !shouldPreferDownload(env);
  } catch {
    canShare = false;
  }
  if (canShare && env.share) {
    try {
      await env.share(payload);
      return 'shared';
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: unknown }).name === 'AbortError'
      ) {
        return 'cancelled';
      }
      // 分享遇到 NotAllowedError 或瀏覽器假支援時，降級走下載流程。
    }
  }
  return downloadFile(file, env);
}
