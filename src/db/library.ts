import { settleImportedLogs, writingDayKey, type GoalSchedule, createSchedule, withClock, applyWordDelta } from '../domain/dailyGoal';
import { MIN_DAILY_GOAL } from '../domain/dailyGoal';
import { appSpace } from './browserSpace';
import { isBookRemoved, markBookRemoved } from './removedBooks';
import type { StoredBook } from './appSpace';
import { externalFileFromStored, type BookFileMark } from '../domain/bookTitle';
import { readFileProject, writeFileProject, type FileCard, type FileLog, type FileProjectInfo } from './projectFile';
import type { TimelineRead } from './timelineMeta';
import type { TransferEvent, TransferRead } from './transferMeta';
import { openMemoryDb } from './wasmDb';

export type { StoredBook };

/** WO-116：進行中的寫入（以稿子代號分組），刪除時要等它們結束才刪，避免刪完又被寫回。 */
const inflightPuts = new Map<string, Set<Promise<unknown>>>();

export async function putBook(book: StoredBook): Promise<void> {
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

/**
 * WO-116：從這個裝置的 App 空間刪掉這份稿子的副本（OPFS 與 IndexedDB 備援，只刪這個鍵）。
 * 先登記為已刪除（擋住之後的寫入與讀回），等已開始的寫入結束，再刪，最後確認兩邊都讀不到。
 * 刪不掉或確認仍存在會丟錯，呼叫端不能假報完成。不碰使用者另存在別處的檔案。
 */
export async function removeBook(key: string): Promise<void> {
  if (!key) return;
  markBookRemoved(key);
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
    const db = await openMemoryDb(item.bytes);
    try {
      const loaded = readFileProject(db.sql);
      const mark = externalFileFromStored({
        key: item.key,
        hasExternalFile: item.hasExternalFile,
        titleInFile: item.titleInFile,
        title: loaded.info.title,
        titleSavePending: item.titleSavePending,
      });
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
      });
    } finally {
      db.close();
    }
  }
  // 讀取期間才被刪掉的稿子也要濾掉。
  return books.filter((book) => !isBookRemoved(book.key));
}

/**
 * WO-100：把使用者選入的 .db 位元組讀成一份稿子（不寫入 App 本機）。
 * 回傳的 bytes 是重新匯出的位元組；原始位元組的指紋請在呼叫前另外算（本機事件對應用）。
 */
export async function readBookBytes(filename: string, bytes: Uint8Array, key: string, now = new Date()): Promise<ImportedBook> {
  const db = await openMemoryDb(bytes);
  try {
    const loaded = readFileProject(db.sql);
    const exported = db.exportBytes();
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
    };
  } finally {
    db.close();
  }
}

export async function importBook(filename: string, bytes: Uint8Array, now = new Date()): Promise<ImportedBook> {
  const book = await readBookBytes(filename, bytes, `file-${now.getTime()}`, now);
  await putBook({
    key: book.key,
    filename: book.filename,
    title: book.title,
    bytes: book.bytes,
    hasExternalFile: true,
    titleInFile: book.info.title,
    titleSavePending: null,
  });
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
): Promise<Uint8Array> {
  const db = await openMemoryDb(base ?? new Uint8Array());
  try {
    writeFileProject(db.sql, info, tree, cards, logs, importEvents, exportEvents);
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
  bookkeeping?: BookFileMark,
  persist = true,
  importEvents?: Readonly<Record<string, TransferEvent>>,
  exportEvents?: Readonly<Record<string, TransferEvent>>,
): Promise<Uint8Array> {
  const existing = await getBook(key);
  const exported = await writeBookBytes(existing?.bytes, info, tree, cards, logs, importEvents, exportEvents);
  if (!persist) return exported;
  const mark = bookkeeping ?? {
    titleInFile: existing?.titleInFile ?? null,
    hasExternalFile: existing?.hasExternalFile,
    titleSavePending: existing?.titleSavePending ?? null,
  };
  await putBook({
    key,
    filename,
    title,
    bytes: exported,
    titleInFile: mark.titleInFile,
    hasExternalFile: mark.hasExternalFile,
    titleSavePending: mark.titleSavePending,
  });
  return exported;
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
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], filename.endsWith('.db') ? filename : `${filename}.db`, {
    type: 'application/octet-stream',
  });
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share(databaseSharePayload(file));
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
