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

/** 第 2 階段章節目錄。 */
export const TREE_ORGANIZE = '整理目錄';
export const TREE_DONE = '完成';
export const TREE_ADD_CHAPTER = '新增章';
export const TREE_ADD_VOLUME = '在下方新增一卷';
export const TREE_ADD_CHAPTER_BELOW = '在下方新增一章';
export const TREE_ADD_SCENE = '在這章裡新增幕';
export const TREE_RENAME = '改名';
export const TREE_NAME_NEW_CHAPTER = '幫新章取名';
export const TREE_SAVE_NAME = '確定';
export const TREE_START_WRITING = '開始寫';
export const TREE_CANCEL = '取消';
export const TREE_MOVE_UP = '上移';
export const TREE_MOVE_DOWN = '下移';
export const TREE_MORE = '更多';
export const TREE_MOVE_VOLUME = '移到別卷…';
export const TREE_MOVE_ROOT = '不放在任何卷';
export const TREE_DELETE_CHAPTER = '刪除';
export const TREE_DELETE_SCENE = '刪除';
export const TREE_DELETE_VOLUME = '刪除';
export const TREE_KEEP = '留著';
export const TREE_CONFIRM_DELETE = '刪除';
export const TREE_UNDO = '復原';
export const TREE_PROGRESS = '進度標記';
export const TREE_NEW_CHAPTER = '新章';
export const TREE_NEW_VOLUME = '新卷';
export const TREE_EMPTY_NAME = '名稱不能是空白';
export const TREE_DRAG_HINT = '只有按住 ≡ 才會拖，手指在其他地方滑就是捲動';
export const TREE_UNDO_HINT = '刪除後 10 秒內可以按「復原」。';
export const ARCHIVE_KEEP_FAIL = '這次沒留下舊版，正文沒受影響';
export const ARCHIVE_RESTORE_HELD = '現在的內容沒留成舊版，先不換';
export const ARCHIVE_DELETE_UNSAVED = '這次刪掉的內容找不回來，10 秒內可按「復原」';

export type ArchiveWriteKind = 'version' | 'delete' | 'restore';

/** 寫入失敗時要顯示的那一句。換版失敗與刪除失敗不能用同一句。 */
export function archiveWriteFailureMessage(kind: ArchiveWriteKind): string {
  if (kind === 'restore') return ARCHIVE_RESTORE_HELD;
  if (kind === 'delete') return ARCHIVE_DELETE_UNSAVED;
  return ARCHIVE_KEEP_FAIL;
}

/** 現在的正文沒留成舊版時，不換上那一版。 */
export function contentAfterVersionRestore(kept: boolean, current: string, restored: string): string {
  return kept ? restored : current;
}

/** 刪除確認是否顯示「之後找得回」那句。 */
export function deleteConfirmShowsRecoverable(archivePersistOk: boolean): boolean {
  return archivePersistOk;
}

/** 刪除確認底下的小字：手機與電腦各一句。 */
export function deleteRecoverableHint(computer: boolean): string {
  const device = computer ? '這台電腦' : '這支手機';
  return `最近刪除的 10 項會留在${device}，可從目錄最下方的「最近刪除」放回來`;
}

function isMacDesktop(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform;
  if (/Win/i.test(platform)) return false;
  if (/Linux/i.test(platform)) return false;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return false;
  return /Mac/i.test(platform) || /Macintosh/i.test(ua);
}

export function desktopUndoShortcut(): string {
  return isMacDesktop() ? '⌘＋Z' : 'Ctrl＋Z';
}

export function desktopMoveUpShortcut(): string {
  return isMacDesktop() ? '⌥＋↑' : 'Alt+↑';
}

export function desktopMoveDownShortcut(): string {
  return isMacDesktop() ? '⌥＋↓' : 'Alt+↓';
}

export function treeDesktopHint(): string {
  const undo = desktopUndoShortcut();
  return `滑過任一列會出現 ≡，可直接用滑鼠拖。F2 改名、Del 刪除、Alt+↑↓ 移動、${undo} 復原`;
}

export const TREE_FIND_VERSION = '找回舊版';
export const TREE_FIND_DELETED = '最近刪除';
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
export const NEW_BOOK_DEFAULT_TITLE = '未命名稿子';
export const TOAST_NEW_BOOK = '已開新稿子';
export const EDITOR_PLACEHOLDER = '從這裡開始寫';
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
