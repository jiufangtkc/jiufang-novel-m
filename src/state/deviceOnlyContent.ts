import type { DemoProject } from '../data/demo';
import type { KeyValueStore } from '../domain/outline';
import { LIVE_DRAFT_KEY, loadLiveDraft } from '../editor/liveDraft';
import { deviceKeysOf } from './removeFromDevice';
import { readNavMemory } from './navMemory';
import type { DeviceOnlyProbe } from '../domain/duplicateOpen';

/**
 * WO-143 審查必修 3：只存在這個裝置、還沒存回檔案的內容。
 * 刪除（取代、留下一份）會把這些一起清掉（見 removeFromDevice.removeLocalStorageDataOf），所以要先算進「還有還沒存回檔案的改動」：
 * - 卡片草稿（位置記憶 navMemory 的 drafts；編輯卡片後跳去章節時會寫在這裡，不會設 dirtySinceFileSave）。
 *   有草稿就代表那張卡片正在編輯中，一律當作有（寧可多問一次）。
 * - 尚未併入正文的即時草稿（liveDraft，屬於這份稿子才算）。內容壞掉讀不出來時也當作有。
 * 位置記憶與捲動位置本身不是使用者輸入的字，不算。
 * 這裡讀本機儲存，所以做成工廠函式，純函式（duplicateOpen.ts）只依賴注入的探測函式。
 */
export function createDeviceOnlyProbe(store: KeyValueStore | null): DeviceOnlyProbe {
  return (project: Pick<DemoProject, 'id' | 'dbKey'>): boolean => {
    const ids = deviceKeysOf(project);
    try {
      for (const id of ids) {
        const memory = readNavMemory(id, store);
        if (Object.keys(memory.drafts).length > 0) return true;
      }
      if (store) {
        const raw = store.getItem(LIVE_DRAFT_KEY);
        if (raw) {
          const draft = loadLiveDraft(store);
          if (!draft) return true; // 讀不出來：無法確認，當作有
          if (ids.includes(draft.projectId)) return true;
        }
      }
    } catch {
      return true; // 讀取失敗：無法確認，當作有
    }
    return false;
  };
}

/** 瀏覽器本機儲存；沒有或不能用時為 null。 */
export function browserDeviceStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
