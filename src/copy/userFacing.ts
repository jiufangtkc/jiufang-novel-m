/** 九方審過的介面文案（改前改後表 V1）。 */

export const MANUSCRIPT_NOT_FOUND = '找不到這份稿子。請回首頁重新開啟。';

export const CHAPTER_NOT_FOUND = '找不到這一章。請從目錄重新選。';

export const OPEN_DB_FAIL =
  '這個檔案打不開。請選擇使用九方編輯器編寫的 .db 稿件檔。';

export const OPEN_DB_HINT = '請選擇使用九方編輯器編寫的 .db 稿件檔。';

export const SAVE_PERMISSION_DENIED = '沒有寫入權限，請再按一次並選「允許」。';

export const SAVE_PARTIAL_FAIL = '存檔失敗。稿件目前仍在 APP 暫存空間。';

export const SAVE_FATAL_FAIL = '存檔失敗。稿件目前仍在 APP 暫存空間。';

export const STASH_FAIL = '暫存沒成功，請再按一次「立刻暫存稿子」';

/** 第 2 階段章節目錄。文字先照草案，之後再給九方審。 */
export const TREE_ORGANIZE = '整理目錄';
export const TREE_DONE = '完成';
export const TREE_ADD_CHAPTER = '新增章';
export const TREE_ADD_VOLUME = '在下方新增一卷';
export const TREE_ADD_CHAPTER_BELOW = '在下方新增一章';
export const TREE_ADD_SCENE = '在這章裡新增幕';
export const TREE_RENAME = '改名';
export const TREE_SAVE_NAME = '儲存名稱';
export const TREE_CANCEL = '取消';
export const TREE_MOVE_UP = '上移';
export const TREE_MOVE_DOWN = '下移';
export const TREE_MORE = '更多';
export const TREE_MOVE_VOLUME = '移到別卷…';
export const TREE_MOVE_ROOT = '移到最上層';
export const TREE_DELETE_CHAPTER = '刪除這章…';
export const TREE_DELETE_SCENE = '刪除這幕…';
export const TREE_DELETE_VOLUME = '刪除這卷…';
export const TREE_KEEP = '留著';
export const TREE_CONFIRM_DELETE = '刪除';
export const TREE_UNDO = '復原';
export const TREE_PROGRESS = '改進度';
export const TREE_NEW_CHAPTER = '新章';
export const TREE_NEW_VOLUME = '新卷';
export const TREE_EMPTY_NAME = '名稱不能是空白';
export const TREE_DRAG_HINT = '只有按住 ≡ 才會拖，手指在其他地方滑就是捲動';
export const TREE_DESKTOP_HINT =
  '滑過任一列會出現 ≡，可直接用滑鼠拖。F2 改名、Del 刪除、Alt+↑↓ 移動、Ctrl+Z 復原';
export const TREE_UNDO_HINT = '刪除後 10 秒內可以按「復原」。';
export const TREE_DELETE_RECOVERABLE = '之後仍可從目錄最下方的「找回刪掉的章」放回來。';
/** 舊版或刪除紀錄寫入 IndexedDB 失敗時的提示（草案，待九方審）。 */
export const ARCHIVE_KEEP_FAIL = '這次沒留下舊版。';

/** 刪除確認是否顯示「之後找得回」那句。 */
export function deleteConfirmShowsRecoverable(archivePersistOk: boolean): boolean {
  return archivePersistOk;
}
export const TREE_FIND_VERSION = '找回之前的版本';
export const TREE_FIND_DELETED = '找回刪掉的章';
export const TREE_VERSION_EMPTY = '這一章還沒有舊版。';
export const TREE_VERSION_PREVIEW = '預覽';
export const TREE_VERSION_READONLY = '這一版只能看，按「用這一版」才會換上。';
export const TREE_RESTORE_VERSION = '用這一版';
export const TREE_PUT_BACK = '放回原位置';
export const TREE_PUT_END = '放到最後面';
export const TREE_PREV_CHAPTER = '上一章';
export const TREE_NEXT_CHAPTER = '下一章';
export const NEW_BOOK_SHAPE = '這份稿子的形式';
export const NEW_BOOK_NOVEL = '長篇（卷章幕）';
export const NEW_BOOK_SINGLE = '單篇（短篇、散文）';
export const TREE_KIND_CHAPTER = '章';
export const TREE_KIND_SCENE = '幕';
export const TREE_KIND_VOLUME = '卷';

export function treeDeleteQuestion(title: string): string {
  return `刪除「${title}」？`;
}

export function treeDeletedToast(title: string): string {
  return `已刪除「${title}」`;
}

export function treeMovedToast(title: string): string {
  return `已移動「${title}」`;
}

export function treeAddedToast(title: string): string {
  return `已新增「${title}」`;
}

export function treeSelectedHint(title: string): string {
  return `已選「${title}」·按住右邊 ≡ 拖曳，或用下方按鈕`;
}

export function treeDeleteImpact(chapters: number, scenes: number, words: string): string {
  const parts: string[] = [];
  if (chapters > 0) parts.push(`${chapters} 章`);
  if (scenes > 0) parts.push(`${scenes} 幕`);
  if (parts.length === 0) return `共 ${words} 字，會一起刪除。`;
  return `裡面有 ${parts.join('、')}、共 ${words} 字，會一起刪除。`;
}

export function versionRowLabel(when: string, words: string): string {
  return `${when} · ${words} 字`;
}

export function treeMoreSummary(kind: string, chapters: number, scenes: number, words: string): string {
  if (kind === TREE_KIND_VOLUME) return `${kind} · ${chapters} 章 · ${scenes} 幕 · 共 ${words} 字`;
  if (kind === TREE_KIND_SCENE) return `${kind} · 共 ${words} 字`;
  return `${kind} · ${scenes} 幕 · 共 ${words} 字`;
}
