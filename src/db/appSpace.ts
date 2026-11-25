import { isPositiveSafeInteger, isValidUuidV4 } from './extensionMeta';

export interface StoredBook {
  key: string;
  filename: string;
  title: string;
  bytes: Uint8Array;
  /** 上次寫進外部檔案時的書名。沒有外部檔案時不記。 */
  titleInFile?: string | null;
  hasExternalFile?: boolean;
  titleSavePending?: 'export' | 'resave' | null;
  /** WO-132 嚴-3：寫入暫存空間時的時間戳與遞增版本號（選填，向下相容舊資料）。 */
  savedAt?: number;
  revision?: number;
  /** WO-137：待寫入或快取的稿件固定身分證（記於 .json 中繼，不直接改動舊 .db 本體）。 */
  bookUuid?: string;
  bookCreatedAtMs?: number;
  originBookUuid?: string | null;
  bookMetaPersisted?: boolean;
}

export interface AppSpace {
  put(book: StoredBook): Promise<void>;
  get(key: string): Promise<StoredBook | null>;
  list(): Promise<StoredBook[]>;
  /** WO-116：只刪 App 自己空間裡這個鍵的副本（稿子本體與中繼資料）。沒有這個鍵視為已刪；絕不碰使用者另存的檔案。 */
  remove(key: string): Promise<void>;
}

export interface ByteDirectory {
  write(name: string, bytes: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array | null>;
  list(): Promise<string[]>;
  /** WO-116：只刪這個名稱的項目；不存在視為已刪。 */
  remove(name: string): Promise<void>;
}

export function createMemoryDirectory(): ByteDirectory {
  const files = new Map<string, Uint8Array>();
  return {
    async write(name, bytes) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      files.set(name, copy);
    },
    async read(name) {
      const found = files.get(name);
      if (!found) return null;
      const copy = new Uint8Array(found.byteLength);
      copy.set(found);
      return copy;
    },
    async list() {
      return [...files.keys()];
    },
    async remove(name) {
      files.delete(name);
    },
  };
}

/** 一本書一個資料夾項目：稿子本體與書名。瀏覽器實作指向 OPFS。 */
export function createDirectoryAppSpace(dir: ByteDirectory): AppSpace {
  const dataName = (key: string) => `${key}.db`;
  const metaName = (key: string) => `${key}.json`;
  return {
    async put(book) {
      await dir.write(dataName(book.key), book.bytes);
      await dir.write(metaName(book.key), new TextEncoder().encode(JSON.stringify({
        filename: book.filename,
        title: book.title,
        titleInFile: book.titleInFile ?? null,
        hasExternalFile: book.hasExternalFile,
        titleSavePending: book.titleSavePending ?? null,
        ...(typeof book.savedAt === 'number' ? { savedAt: book.savedAt } : {}),
        ...(typeof book.revision === 'number' ? { revision: book.revision } : {}),
        ...(isValidUuidV4(book.bookUuid) ? { bookUuid: book.bookUuid } : {}),
        ...(isPositiveSafeInteger(book.bookCreatedAtMs) ? { bookCreatedAtMs: book.bookCreatedAtMs } : {}),
        ...(book.originBookUuid !== undefined ? { originBookUuid: book.originBookUuid } : {}),
        ...(typeof book.bookMetaPersisted === 'boolean' ? { bookMetaPersisted: book.bookMetaPersisted } : {}),
        byteLength: book.bytes.byteLength,
      })));
    },
    async get(key) {
      const bytes = await dir.read(dataName(key));
      if (!bytes) return null;
      const metaBytes = await dir.read(metaName(key));
      let meta: {
        filename?: string;
        title?: string;
        titleInFile?: string | null;
        hasExternalFile?: boolean;
        titleSavePending?: 'export' | 'resave' | null;
        savedAt?: number;
        revision?: number;
        bookUuid?: string;
        bookCreatedAtMs?: number;
        originBookUuid?: string | null;
        bookMetaPersisted?: boolean;
        byteLength?: number;
      } = {};
      if (metaBytes) {
        try {
          meta = JSON.parse(new TextDecoder().decode(metaBytes)) as typeof meta;
        } catch {
          return null;
        }
        if (typeof meta.byteLength === 'number' && bytes.byteLength !== meta.byteLength) {
          // 半套寫入（本體長度與中繼資料不符），交由另一側備援接手。
          return null;
        }
      }
      const pending = meta.titleSavePending === 'export' || meta.titleSavePending === 'resave'
        ? meta.titleSavePending
        : null;
      const validBookUuid = isValidUuidV4(meta.bookUuid) ? meta.bookUuid : undefined;
      const validCreatedAt = isPositiveSafeInteger(meta.bookCreatedAtMs) ? meta.bookCreatedAtMs : undefined;
      const validOriginUuid = meta.originBookUuid === null || isValidUuidV4(meta.originBookUuid)
        ? meta.originBookUuid
        : undefined;
      return {
        key,
        filename: meta.filename || '未命名.db',
        title: meta.title || '未命名',
        bytes,
        titleInFile: meta.titleInFile ?? null,
        hasExternalFile: typeof meta.hasExternalFile === 'boolean' ? meta.hasExternalFile : undefined,
        titleSavePending: pending,
        ...(typeof meta.savedAt === 'number' ? { savedAt: meta.savedAt } : {}),
        ...(typeof meta.revision === 'number' ? { revision: meta.revision } : {}),
        ...(validBookUuid ? { bookUuid: validBookUuid } : {}),
        ...(validCreatedAt ? { bookCreatedAtMs: validCreatedAt } : {}),
        ...(validOriginUuid !== undefined ? { originBookUuid: validOriginUuid } : {}),
        ...(typeof meta.bookMetaPersisted === 'boolean' ? { bookMetaPersisted: meta.bookMetaPersisted } : {}),
      };
    },
    async list() {
      const names = await dir.list();
      const keys = names.filter((name) => name.endsWith('.db')).map((name) => name.slice(0, -3));
      const books: StoredBook[] = [];
      for (const key of keys) {
        const book = await this.get(key);
        if (book) books.push(book);
      }
      return books;
    },
    async remove(key) {
      // 先刪本體再刪中繼資料：中途失敗時本體還在（會丟錯），不會留下「沒有本體卻被列出」的狀況。
      await dir.remove(dataName(key));
      await dir.remove(metaName(key));
    },
  };
}

export function createMemoryAppSpace(): AppSpace {
  return createDirectoryAppSpace(createMemoryDirectory());
}

/** 比較兩個副本的新舊程度：優先比 revision，相同再比 savedAt。舊版無欄位視為 0。 */
export function isNewerStoredBook(candidate: StoredBook, current: StoredBook): boolean {
  const candRev = typeof candidate.revision === 'number' && Number.isFinite(candidate.revision) ? candidate.revision : 0;
  const curRev = typeof current.revision === 'number' && Number.isFinite(current.revision) ? current.revision : 0;
  if (candRev !== curRev) return candRev > curRev;
  const candAt = typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt) ? candidate.savedAt : 0;
  const curAt = typeof current.savedAt === 'number' && Number.isFinite(current.savedAt) ? current.savedAt : 0;
  return candAt > curAt;
}

/** 寫入主空間（OPFS）與備援（IndexedDB），至少一側完整成功才算成功；讀取與列表永遠取最新且完好的一份。 */
export function createMirroredSpace(primary: AppSpace, backup: AppSpace): AppSpace {
  const knownRevision = new Map<string, number>();

  const readSafe = async (space: AppSpace, key: string): Promise<StoredBook | null> => {
    try {
      return await space.get(key);
    } catch {
      return null;
    }
  };

  return {
    async put(book) {
      let baseRev = knownRevision.get(book.key);
      if (baseRev === undefined) {
        const [pExisting, bExisting] = await Promise.all([
          readSafe(primary, book.key),
          readSafe(backup, book.key),
        ]);
        baseRev = Math.max(
          pExisting?.revision ?? 0,
          bExisting?.revision ?? 0,
        );
      }
      const nextRev = Math.max(baseRev, book.revision ?? 0) + 1;
      knownRevision.set(book.key, nextRev);
      const versionedBook: StoredBook = {
        ...book,
        revision: nextRev,
        savedAt: Date.now(),
      };
      try {
        await primary.put(versionedBook);
      } catch {
        await backup.put(versionedBook);
        return;
      }
      try {
        await backup.put(versionedBook);
      } catch {
        // 備援寫不進時，主空間已經完整寫入最新版本。
      }
    },
    async get(key) {
      const [pBook, bBook] = await Promise.all([readSafe(primary, key), readSafe(backup, key)]);
      if (pBook && bBook) {
        return isNewerStoredBook(bBook, pBook) ? bBook : pBook;
      }
      return pBook ?? bBook;
    },
    async list() {
      const merged = new Map<string, StoredBook>();
      try {
        for (const book of await primary.list()) {
          const prev = merged.get(book.key);
          if (!prev || isNewerStoredBook(book, prev)) merged.set(book.key, book);
        }
      } catch {
        // 主空間暫時不可用。
      }
      try {
        for (const book of await backup.list()) {
          const prev = merged.get(book.key);
          if (!prev || isNewerStoredBook(book, prev)) merged.set(book.key, book);
        }
      } catch {
        // 備援沒有也不影響主空間。
      }
      return [...merged.values()];
    },
    /** WO-116：兩邊都要刪。任一邊刪不掉就丟錯（呼叫端不能假報已刪除）；兩邊都會試，不因一邊失敗就放著另一邊。 */
    async remove(key) {
      knownRevision.delete(key);
      const results = await Promise.allSettled([primary.remove(key), backup.remove(key)]);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason instanceof Error ? failed.reason : new Error('無法刪除這個裝置上的稿子副本');
    },
  };
}
