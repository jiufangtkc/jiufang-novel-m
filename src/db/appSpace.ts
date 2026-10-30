export interface StoredBook {
  key: string;
  filename: string;
  title: string;
  bytes: Uint8Array;
  /** 上次寫進外部檔案時的書名。沒有外部檔案時不記。 */
  titleInFile?: string | null;
  hasExternalFile?: boolean;
  titleSavePending?: 'export' | 'resave' | null;
}

export interface AppSpace {
  put(book: StoredBook): Promise<void>;
  get(key: string): Promise<StoredBook | null>;
  list(): Promise<StoredBook[]>;
}

export interface ByteDirectory {
  write(name: string, bytes: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array | null>;
  list(): Promise<string[]>;
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
      })));
    },
    async get(key) {
      const bytes = await dir.read(dataName(key));
      if (!bytes) return null;
      const metaBytes = await dir.read(metaName(key));
      const meta = metaBytes
        ? JSON.parse(new TextDecoder().decode(metaBytes)) as {
          filename?: string;
          title?: string;
          titleInFile?: string | null;
          hasExternalFile?: boolean;
          titleSavePending?: 'export' | 'resave' | null;
        }
        : {};
      const pending = meta.titleSavePending === 'export' || meta.titleSavePending === 'resave'
        ? meta.titleSavePending
        : null;
      return {
        key,
        filename: meta.filename || '未命名.db',
        title: meta.title || '未命名',
        bytes,
        titleInFile: meta.titleInFile ?? null,
        hasExternalFile: typeof meta.hasExternalFile === 'boolean' ? meta.hasExternalFile : undefined,
        titleSavePending: pending,
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
  };
}

export function createMemoryAppSpace(): AppSpace {
  return createDirectoryAppSpace(createMemoryDirectory());
}

/** 先寫主空間（OPFS），失敗才退到備援（IndexedDB）。讀取以主空間為準。 */
export function createMirroredSpace(primary: AppSpace, backup: AppSpace): AppSpace {
  return {
    async put(book) {
      try {
        await primary.put(book);
      } catch {
        await backup.put(book);
        return;
      }
      try {
        await backup.put(book);
      } catch {
        // 備援寫不進時，主空間已經有這份稿。
      }
    },
    async get(key) {
      try {
        const found = await primary.get(key);
        if (found) return found;
      } catch {
        // 主空間讀不到就改看備援。
      }
      return backup.get(key);
    },
    async list() {
      const merged = new Map<string, StoredBook>();
      try {
        for (const book of await backup.list()) merged.set(book.key, book);
      } catch {
        // 備援沒有也不影響主空間。
      }
      try {
        for (const book of await primary.list()) merged.set(book.key, book);
      } catch {
        // 主空間暫時不可用。
      }
      return [...merged.values()];
    },
  };
}
