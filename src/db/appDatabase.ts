const DB_NAME = 'jiufang-novel-m';
const DB_VERSION = 2;

export function openAppDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('files')) database.createObjectStore('files');
      if (!database.objectStoreNames.contains('file-targets')) database.createObjectStore('file-targets');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('無法打開這支裝置上的儲存空間'));
  });
}
