/**
 * WO-114：儲存專案／另存專案的鍵盤快速鍵。
 * Ctrl/Cmd+S → saveProject；Ctrl/Cmd+Shift+S → saveProjectAs。
 * 只重用既有 actions，不另寫任何存檔流程。
 */

export type SaveShortcutKind = 'save' | 'saveAs';

export type SaveShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
  preventDefault: () => void;
};

/** 判斷是否為本單的快速鍵；組字中或非精確鍵位回傳 null。 */
export function matchSaveShortcut(e: SaveShortcutEvent): SaveShortcutKind | null {
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.altKey) return null;
  if (e.ctrlKey === e.metaKey) return null; // 需要恰好一個 Ctrl 或 Cmd
  if (e.key !== 's' && e.key !== 'S') return null;
  return e.shiftKey ? 'saveAs' : 'save';
}

/** 畫面上是否有顯示中的對話框（[role="dialog"] 或開啟中的原生 dialog）。 */
export function hasOpenDialog(doc: Document = document): boolean {
  if (doc.querySelector('dialog[open]')) return true;
  const nodes = doc.querySelectorAll<HTMLElement>('[role="dialog"]');
  for (const el of Array.from(nodes)) {
    if (el.hidden || el.closest('[hidden]') || el.getAttribute('aria-hidden') === 'true') continue;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
    return true;
  }
  return false;
}

export type SaveShortcutDeps = {
  getActions: () => {
    saveProject: () => Promise<unknown>;
    saveProjectAs: () => Promise<unknown>;
  };
  isDialogOpen: () => boolean;
};

/** 建立 keydown 處理函式；內含處理中旗標，兩種快速鍵共用。 */
export function createSaveShortcutHandler(deps: SaveShortcutDeps) {
  let busy = false;
  return (e: SaveShortcutEvent): void => {
    const kind = matchSaveShortcut(e);
    if (!kind) return;
    e.preventDefault();
    if (e.repeat || busy || deps.isDialogOpen()) return;
    busy = true;
    const actions = deps.getActions();
    let result: Promise<unknown>;
    try {
      result = kind === 'save' ? actions.saveProject() : actions.saveProjectAs();
    } catch {
      busy = false;
      return;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  };
}
