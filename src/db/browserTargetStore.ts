import { openAppDatabase } from './appDatabase';
import { diskFileFromHandle } from './browserDisk';
import { restoreTarget, targetRow, type SaveTarget, type StoredTargetRow, type TargetStore } from './fileTarget';

export function createBrowserTargetStore(): TargetStore {
  return {
    async load(bookKey) {
      const database = await openAppDatabase();
      try {
        const row = await request<StoredTargetRow | undefined>(database, 'readonly', (store) => store.get(bookKey));
        return restoreTarget(row ?? null, (handle) => diskFileFromHandle(handle as FileSystemFileHandle));
      } finally {
        database.close();
      }
    },
    async save(bookKey, target) {
      const database = await openAppDatabase();
      try {
        const row = targetRow(target, handleOf(target));
        await request(database, 'readwrite', (store) => store.put(row, bookKey));
      } finally {
        database.close();
      }
    },
  };
}

function handleOf(target: SaveTarget): unknown | null {
  const carrier = target.file as (DiskFileWithHandle | null);
  return carrier?.sourceHandle ?? null;
}

interface DiskFileWithHandle {
  sourceHandle?: unknown;
}

function request<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = database.transaction('file-targets', mode);
  const store = transaction.objectStore('file-targets');
  const pending = run(store);
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('無法記下檔案位置'));
  });
}
