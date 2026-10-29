import {
  emptyArchive,
  type BookArchive,
} from '../domain/chapterVersions';

/**
 * 章的舊版與刪掉的章。
 * 桌面版 snapshots.project_data 的格式這裡對不上，不能寫進 .db，否則桌面版可能打不開。
 * 因此放在 App 自己的 IndexedDB，不新增桌面版不認識的表或欄位，也不會跟著匯出的 .db 走。
 */
const DB_NAME = 'jiufang-novel-m-versions';
const STORE = 'books';

export interface ArchiveBacking {
  read(bookId: string): Promise<BookArchive>;
  write(bookId: string, archive: BookArchive): Promise<void>;
}

export interface ArchiveClient {
  read(bookId: string): Promise<BookArchive>;
  update(bookId: string, recipe: (current: BookArchive) => BookArchive): Promise<BookArchive>;
  subscribe(listener: (bookId: string, archive: BookArchive) => void): () => void;
}

function normalize(value: unknown): BookArchive {
  if (!value || typeof value !== 'object') return emptyArchive();
  const record = value as Partial<BookArchive>;
  return {
    versions: record.versions ?? {},
    deleted: Array.isArray(record.deleted) ? record.deleted : [],
  };
}

export function createArchiveClient(backing: ArchiveBacking): ArchiveClient {
  const cache = new Map<string, BookArchive>();
  const tails = new Map<string, Promise<unknown>>();
  const listeners = new Set<(bookId: string, archive: BookArchive) => void>();

  function enqueue<T>(bookId: string, job: () => Promise<T>): Promise<T> {
    const prev = tails.get(bookId) ?? Promise.resolve();
    const run = prev.then(job, job);
    tails.set(
      bookId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return {
    read(bookId) {
      return enqueue(bookId, async () => {
        if (cache.has(bookId)) return cache.get(bookId)!;
        const data = normalize(await backing.read(bookId));
        if (!cache.has(bookId)) cache.set(bookId, data);
        return cache.get(bookId)!;
      });
    },
    update(bookId, recipe) {
      return enqueue(bookId, async () => {
        const current = cache.get(bookId) ?? normalize(await backing.read(bookId));
        const next = recipe(current);
        cache.set(bookId, next);
        await backing.write(bookId, next);
        for (const listener of listeners) listener(bookId, next);
        return next;
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function openVersionsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('無法打開舊版儲存空間'));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function versionsDb(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openVersionsDb().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function idbBacking(): ArchiveBacking {
  return {
    async read(bookId) {
      const database = await versionsDb();
      return new Promise((resolve, reject) => {
        const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(bookId);
        request.onsuccess = () => resolve(normalize(request.result));
        request.onerror = () => reject(request.error ?? new Error('讀不到舊版'));
      });
    },
    async write(bookId, archive) {
      const database = await versionsDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).put(archive, bookId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('舊版沒寫入'));
      });
    },
  };
}

const memory = new Map<string, BookArchive>();

const backing: ArchiveBacking =
  typeof indexedDB === 'undefined'
    ? {
        async read(bookId) {
          return memory.get(bookId) ?? emptyArchive();
        },
        async write(bookId, archive) {
          memory.set(bookId, archive);
        },
      }
    : idbBacking();

export const bookArchive = createArchiveClient(backing);
