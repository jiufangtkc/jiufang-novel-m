import { settleImportedLogs, writingDayKey, type GoalSchedule, createSchedule, withClock, applyWordDelta } from '../domain/dailyGoal';
import { MIN_DAILY_GOAL } from '../domain/dailyGoal';
import { readFileProject, writeFileProject, type FileCard, type FileLog, type FileProjectInfo } from './projectFile';
import { openMemoryDb } from './wasmDb';

const DB_NAME = 'jiufang-novel-m';
const STORE = 'files';

export interface StoredBook {
  key: string;
  filename: string;
  title: string;
  bytes: Uint8Array;
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('無法打開手機上的儲存空間'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openStore();
  try {
    const transaction = database.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    const result = await new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('讀寫失敗'));
    });
    return result;
  } finally {
    database.close();
  }
}

export async function putBook(book: StoredBook): Promise<void> {
  await withStore('readwrite', (store) => store.put(book, book.key));
}

export async function getBook(key: string): Promise<StoredBook | null> {
  const value = await withStore<StoredBook | undefined>('readonly', (store) => store.get(key));
  return value ?? null;
}

export async function listBooks(): Promise<StoredBook[]> {
  const value = await withStore<StoredBook[]>('readonly', (store) => store.getAll());
  return value ?? [];
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
}

function scheduleFromLogs(logs: readonly FileLog[], dailyTarget: number, now: Date): GoalSchedule {
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
    const db = await openMemoryDb(item.bytes);
    try {
      const loaded = readFileProject(db.sql);
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
      });
    } finally {
      db.close();
    }
  }
  return books;
}

export async function importBook(filename: string, bytes: Uint8Array, now = new Date()): Promise<ImportedBook> {
  const db = await openMemoryDb(bytes);
  try {
    const loaded = readFileProject(db.sql);
    const exported = db.exportBytes();
    const key = `file-${now.getTime()}`;
    const book: ImportedBook = {
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
    };
    await putBook({ key, filename: book.filename, title: book.title, bytes: exported });
    return book;
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
): Promise<Uint8Array> {
  const existing = await getBook(key);
  const db = await openMemoryDb(existing?.bytes ?? new Uint8Array());
  try {
    writeFileProject(db.sql, info, tree, cards, logs);
    const exported = db.exportBytes();
    await putBook({ key, filename, title, bytes: exported });
    return exported;
  } finally {
    db.close();
  }
}

export async function exportBook(key: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const book = await getBook(key);
  if (!book) return null;
  return { filename: book.filename, bytes: book.bytes };
}

export async function shareDatabase(filename: string, bytes: Uint8Array): Promise<'shared' | 'downloaded'> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], filename.endsWith('.db') ? filename : `${filename}.db`, {
    type: 'application/octet-stream',
  });
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: '交回電腦' });
    return 'shared';
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
