import type { DemoProject } from '../data/demo';
import { removeBook } from '../db/library';
import { markBookRemoved, unmarkBookRemoved } from '../db/removedBooks';
import { loadProjects, saveProjects, type KeyValueStore } from '../domain/outline';
import { clearStoredWritingCardsView } from '../domain/writingCards';
import { LIVE_DRAFT_KEY, loadLiveDraft } from '../editor/liveDraft';
import { treePlaceKey } from '../screens/treeScroll';
import { forgetProjectsInDeviceRecord } from './deviceSaveRecord';
import {
  EXPORT_EVENTS_KEY,
  IMPORT_EVENTS_KEY,
  readExportEvents,
  readImportEvents,
  withoutProject,
} from './importEvents';
import { forgetNavMemory } from './navMemory';

/**
 * WO-116：首頁最近清單按「刪掉」之後，把這份稿子從這個裝置拿掉。
 *
 * 只刪 App 自己管理的東西（瀏覽器本機儲存裡這份稿子的鍵、App 空間 OPFS／IndexedDB 裡這個鍵的副本），
 * 以稿子代號判斷，不以書名批次刪；絕不碰使用者另存在「檔案」或別處的 .db。
 */

/** 這份稿子在 App 裡用到的代號：稿子代號與 App 空間副本鍵（升格成檔案後兩者可能不同）。 */
export function deviceKeysOf(project: Pick<DemoProject, 'id' | 'dbKey'>): string[] {
  return [...new Set([project.id, project.dbKey].filter((key): key is string => Boolean(key)))];
}

type RemovableStore = KeyValueStore & { removeItem?(key: string): void };

function dropKey(store: RemovableStore, key: string): void {
  if (typeof store.removeItem === 'function') store.removeItem(key);
  else store.setItem(key, '');
}

/**
 * 清掉瀏覽器本機儲存裡屬於這幾個代號的內容（同步）。其他稿子的資料一律保留。
 * 任何一步寫不進去都會丟錯（其餘步驟仍會試完）。
 */
export function removeLocalStorageDataOf(store: RemovableStore, ids: readonly string[]): void {
  const failures: unknown[] = [];
  const attempt = (run: () => void) => {
    try {
      run();
    } catch (error) {
      failures.push(error);
    }
  };
  const idSet = new Set(ids);

  // 本機稿子清單：只拿掉這份；最後一份也要寫入空陣列。
  attempt(() => {
    const stored = loadProjects(store);
    if (stored) saveProjects(store, stored.filter((project) => !idSet.has(project.id)));
  });
  // 即時草稿：核對稿子代號，只有屬於目標稿才清。
  attempt(() => {
    const draft = loadLiveDraft(store);
    if (draft && idSet.has(draft.projectId)) dropKey(store, LIVE_DRAFT_KEY);
  });
  // 裝置紀錄：saveMeta／logsById／goalById／startedById／tourGoalById。
  attempt(() => forgetProjectsInDeviceRecord(store, ids));
  // 匯入、匯出事件對這份稿子代號的對應。
  attempt(() => {
    for (const id of ids) {
      const imports = readImportEvents(store);
      const nextImports = withoutProject(imports, id);
      if (nextImports !== imports) store.setItem(IMPORT_EVENTS_KEY, JSON.stringify(nextImports));
      const exports = readExportEvents(store);
      const nextExports = withoutProject(exports, id);
      if (nextExports !== exports) store.setItem(EXPORT_EVENTS_KEY, JSON.stringify(nextExports));
    }
  });
  // 每本書自己的位置記憶、卡片草稿、目錄位置、卡片閱讀位置。
  for (const id of ids) {
    attempt(() => forgetNavMemory(id, store));
    attempt(() => dropKey(store, treePlaceKey(id)));
    attempt(() =>
      clearStoredWritingCardsView(id, {
        getItem: (key) => store.getItem(key),
        setItem: (key, value) => store.setItem(key, value),
        removeItem: (key) => dropKey(store, key),
      }),
    );
  }
  if (failures.length > 0) throw failures[0] instanceof Error ? failures[0] : new Error('無法清掉這個裝置上的暫存');
}

/**
 * 從這個裝置刪掉一份稿子。回傳 true 才代表真的刪完；失敗時回 false，已登記的「已刪除」會取消，稿子照舊可用。
 * 順序：先登記（擋住進行中的讀取與寫回）→ 刪 App 空間副本（最容易失敗，失敗就整體中止、本機儲存原封不動）
 * → 清本機儲存。
 */
export async function removeProjectFromDevice(input: {
  project: Pick<DemoProject, 'id' | 'dbKey'>;
  store: RemovableStore | null;
  /** 測試可替換；預設刪 App 空間（OPFS 與 IndexedDB 備援）裡該鍵的副本。 */
  removeCopy?: (key: string) => Promise<void>;
}): Promise<boolean> {
  const ids = deviceKeysOf(input.project);
  const removeCopy = input.removeCopy ?? removeBook;
  for (const id of ids) markBookRemoved(id);
  try {
    for (const id of ids) await removeCopy(id);
    if (input.store) removeLocalStorageDataOf(input.store, ids);
    return true;
  } catch {
    for (const id of ids) unmarkBookRemoved(id);
    return false;
  }
}
