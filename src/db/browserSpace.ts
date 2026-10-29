import type { StoredBook } from './appSpace';
import { createDirectoryAppSpace, createMirroredSpace, type AppSpace, type ByteDirectory } from './appSpace';
import { openAppDatabase } from './appDatabase';

function idbSpace(): AppSpace {
  return {
    async put(book) {
      const database = await openAppDatabase();
      try {
        await idbRequest(database, 'readwrite', (store) => store.put(book, book.key));
      } finally {
        database.close();
      }
    },
    async get(key) {
      const database = await openAppDatabase();
      try {
        const value = await idbRequest<StoredBook | undefined>(database, 'readonly', (store) => store.get(key));
        return value ?? null;
      } finally {
        database.close();
      }
    },
    async list() {
      const database = await openAppDatabase();
      try {
        const value = await idbRequest<StoredBook[]>(database, 'readonly', (store) => store.getAll());
        return value ?? [];
      } finally {
        database.close();
      }
    },
  };
}

function idbRequest<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = database.transaction('files', mode);
  const request = run(transaction.objectStore('files'));
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('讀寫失敗'));
  });
}

function opfsDirectory(): ByteDirectory {
  const ready = (async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('books', { create: true });
  })();
  return {
    async write(name, bytes) {
      const dir = await ready;
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await writable.write(copy);
      await writable.close();
    },
    async read(name) {
      const dir = await ready;
      try {
        const handle = await dir.getFileHandle(name);
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    async list() {
      const dir = await ready;
      const names: string[] = [];
      for await (const name of dir.keys()) names.push(name);
      return names;
    },
  };
}

let spacePromise: Promise<AppSpace> | null = null;

/** App 自己的稿子空間。有 OPFS 就放那裡，並在 IndexedDB 留一份備援。 */
export function appSpace(): Promise<AppSpace> {
  if (!spacePromise) {
    spacePromise = (async () => {
      const backup = idbSpace();
      if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
        try {
          return createMirroredSpace(createDirectoryAppSpace(opfsDirectory()), backup);
        } catch {
          return backup;
        }
      }
      return backup;
    })();
  }
  return spacePromise;
}
