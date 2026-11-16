import { formatProjectUpdatedLabel } from '../domain/formatCalendarDate';
import { formatInteger } from '../domain/formatNumber';
import { formatLastExportLabel } from '../domain/saveClock';

/** 九方審過的介面文案（改前改後表 V1）。 */

export const MANUSCRIPT_NOT_FOUND = '找不到這份稿子。請回首頁重新開啟。';

// WO-97：設定頁「隱私說明」標題（入口列與子頁共用）與九方定稿六句，一句一段
export const PRIVACY_TITLE = '隱私說明';
export const PRIVACY_PARAGRAPHS: readonly string[] = [
  'JiufangM 不用註冊，也不用登入。',
  '您的稿子、卡片和寫作紀錄只存在您自己的裝置裡，不會傳到我們這邊或任何伺服器。',
  '您用「儲存」存成 .db 檔時，檔案會存到您自己選的地方，像是「檔案」App 或 iCloud 雲碟。',
  '我們不收集您的姓名、聯絡方式或稿子內容，也不放廣告。',
  '網站放在 Cloudflare 上，Cloudflare 只會留一般網站都有的連線紀錄，裡面沒有稿子內容。',
  '清除瀏覽器資料或刪掉 App 時，沒有另外存成 .db 檔的稿子可能會不見，記得定期存檔。',
];

/**
 * WO-95：同一句拆成三段，只把「回首頁」做成連結；三段接起來必須與 MANUSCRIPT_NOT_FOUND 一字不差，不是新用字。
 */
export const MANUSCRIPT_NOT_FOUND_BEFORE_LINK = '找不到這份稿子。請';
export const MANUSCRIPT_NOT_FOUND_LINK = '回首頁';
export const MANUSCRIPT_NOT_FOUND_AFTER_LINK = '重新開啟。';

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

/**
 * 檔案頁、首頁對同一台裝置的稱呼。
 * 手機說「這支手機」；電腦與平板說「這個裝置」。
 */
export function localDevicePhrase(notPhone: boolean): string {
  return notPhone ? '這個裝置' : '這支手機';
}

export function stashDraftHint(notPhone: boolean): string {
  return `立刻存進${localDevicePhrase(notPhone)}的 App 空間，防止掉字`;
}

/** 從本機儲存空間載入、還沒有編輯時間時，稿子上留的標記。畫面再換成上面那套稱呼。 */
export const STORED_ON_PHONE_LABEL = '已在手機';

/** 首頁與檔案頁的「上次編輯」。有時間就顯示時間。 */
export function lastEditDisplay(options: {
  updatedLabel: string;
  notPhone: boolean;
  lastEditMs: number | null;
  now?: Date;
}): string {
  if (options.lastEditMs != null) {
    return formatLastExportLabel(options.lastEditMs, options.now ?? new Date());
  }
  if (options.updatedLabel === STORED_ON_PHONE_LABEL) {
    return `已在${localDevicePhrase(options.notPhone)}`;
  }
  return formatProjectUpdatedLabel(options.updatedLabel, options.now ?? new Date());
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

/** 改書名（第 117～150 列）。 */
export const BOOK_RENAME_TITLE = '改書名';
export const BOOK_TITLE_PLACEHOLDER = '輸入書名';
export const BOOK_TITLE_BLANK_HINT = '留白會用「未命名稿子」';
export const BOOK_RENAMED_TOAST = '已改書名';
export const BOOK_RENAME_FAIL = '書名沒改成，請再改一次';
export const BOOK_TITLE_LIMIT_HINT = '最多 40 個字，多的字沒有貼上';
export const BOOK_SAVE_HINT_EXPORT = '下次另存時，檔名也會換成新書名';
export const BOOK_SAVE_HINT_RESAVE = '下次按「儲存專案」，會用新書名另存一份';
export const BOOK_SECTION = '這份稿子';
export const BOOK_TITLE_LABEL = '書名';
export const BOOK_GOAL_LABEL = '寫作目標';
export const SETTINGS_EDIT_GOAL_ARIA = '修改寫作目標';
export const ASK_SAVE_AS_TITLE = '要不要現在另存？';
export const ASK_SAVE_LATER = '等一下';
export const ASK_SAVE_NOW = '現在另存';
export const TITLE_PENDING_EXPORT = '書名改過了，還沒另存。原本的檔案裡還是舊書名';
export const TITLE_PENDING_RESAVE = '書名改過了，下次按「儲存專案」會用新書名另存一份，舊檔留著';
export const TOAST_SAVED_UNDER_NEW_TITLE = '已用新書名另存一份';
export const STATS_HEADING = '寫作統計';
export const BOOK_TITLE_HOVER_HINT = '點一下可以改書名';
export const DB_FILE_TYPE_LABEL = '九方編輯器稿件檔';
export const UNTITLED_MANUSCRIPT = '未命名稿子';

export function bookTitleAria(title: string): string {
  return `書名：${title}，可以改`;
}

export function bookTitleCount(length: number): string {
  return `${length}／40`;
}

/** 設定頁目標卡兩行。標題與數字之間用全形空白，數字與「字」不拆行。 */
export function settingsBookGoalLine(formattedCount: string): string {
  return `全書目標\u3000${formattedCount}\u00A0字`;
}

export function settingsDailyGoalLine(formattedCount: string): string {
  return `每日目標\u3000${formattedCount}\u00A0字`;
}

export function askSaveAsBody(title: string): string {
  return `書名改成《${title}》了。原本的檔案裡還是舊書名，另存一份新檔才會用新書名。`;
}

export function askSaveAsFilename(name: string): string {
  return `新檔名：${name}`;
}

export function titlePendingNotice(pending: 'export' | 'resave' | null | undefined): string | null {
  if (pending === 'export') return TITLE_PENDING_EXPORT;
  if (pending === 'resave') return TITLE_PENDING_RESAVE;
  return null;
}

export function currentFileLine(filename: string): string {
  return `檔案：${filename}`;
}
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
  const shown = title.replace(/\u3000+$/u, '').trimEnd();
  return `已新增「${shown}」`;
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

/** 第 3 階段資料集卡片試看版（WO-45、WO-50）。 */
export const SAMPLE_CARDS_NOTICE = '範例卡片，之後會換成這份稿子的卡片';
export const CARDS_HEADING = '資料集';
export const BACK_TO_CATEGORIES_ARIA = '返回分類清單';
export const BACK_TO_CARDS_ARIA = '返回卡片清單';
export const EMPTY_CARD_CONTENT_MESSAGE = '這張卡片還沒有內容。';
export const UNTITLED_CARD_TITLE = '未命名卡片';

/**
 * 取得卡片標題；若為空字串或僅含空白字元，則顯示「未命名卡片」（九方 14:34 定案）。
 */
export function displayCardTitle(title?: string | null): string {
  if (!title) return UNTITLED_CARD_TITLE;
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : UNTITLED_CARD_TITLE;
}

/** 分類列朗讀與畫面同一句「N 張」。 */
export function categoryRowAria(name: string, count: number): string {
  return `${name}，${cardsCountLabel(count)}`;
}

export function cardCollapseAria(title: string): string {
  return `收合「${displayCardTitle(title)}」子卡片`;
}

export function cardExpandAria(title: string): string {
  return `展開「${displayCardTitle(title)}」子卡片`;
}

export function cardDetailAria(title: string): string {
  return `看「${displayCardTitle(title)}」卡片內容`;
}

/** 寫作時看卡片（WO-50，暫用名稱列入待審文字）。 */
export const VIEW_CARDS_BUTTON = '看卡片';
export const CLOSE_CARDS_ARIA = '關閉資料集';

/** 寫作頁與版面按鈕文案（九方 2026-11-11 定案）。 */
export const TREE_DRAWER_BUTTON = '目錄';
/** 手機直拿寫作頁拇指區：回到目錄頁（與頂列返回相同，非展開抽屜）。 */
export const BACK_TO_CHAPTER_TREE_ARIA = '返回目錄';
export const OPEN_CHAPTER_TREE_ARIA = '展開目錄';
export const CLOSE_CHAPTER_TREE_ARIA = '收合目錄';
export const FOCUS_MODE_ENTER_BUTTON = '專注模式';
export const FOCUS_MODE_EXIT_BUTTON = '離開專注模式';
export const FLOATING_CHAPTER_TREE_ARIA = '展開目錄';
export const FLOATING_VIEW_CARDS_ARIA = '看卡片';
export const CARDS_PANEL_ARIA = '資料集';

/** 今天字數統計標籤（九方 2026-11-11 定案）。有每日目標顯示「今天 N／M 字」，無目標顯示「今天 N 字」。四位數以上加千分位。 */
export function todayWordsLabel(words: number | string, goal?: number | string | null): string {
  const displayWords = typeof words === 'number' ? formatInteger(words) : words;
  const hasGoal =
    goal !== undefined &&
    goal !== null &&
    goal !== '' &&
    (typeof goal !== 'number' || (Number.isFinite(goal) && goal > 0));

  if (hasGoal) {
    const displayGoal = typeof goal === 'number' ? formatInteger(goal) : goal;
    return `今天 ${displayWords}／${displayGoal} 字`;
  }
  return `今天 ${displayWords} 字`;
}

/** 資料集與看卡片依四種版面調整（九方 2026-11-11 定案）。 */
export const CARDS_READONLY_BADGE = '只能看';
export const CARDS_EMPTY_CATEGORY_HINT = '請選擇分類';
/** WO-74：寫作頁看卡片，這份稿子還沒有任何卡片時的說明。 */
export const WRITING_CARDS_EMPTY_BOOK_HINT = '這份稿子還沒有卡片，可到資料集新增。';
/** 已選分類但此分類尚無卡片時的說明（WO-73）。 */
export const CARDS_EMPTY_IN_CATEGORY_HINT = '這個分類還沒有卡片。';
export const CARDS_EMPTY_CARD_HINT = '請選擇卡片';
export const CARDS_COLUMN_CATEGORIES = '分類';
export const CARDS_COLUMN_CARDS = '卡片清單';
export const CARDS_COLUMN_CONTENT = '卡片內容';

/** 手機橫拿資料集右側預覽在整份稿子皆無正文時之提示（九方 2026-11-11 定案）。 */
export const CARDS_PREVIEW_EMPTY_HINT = '這份稿子還沒有正文。';

/** 子卡片數量標籤（九方 2026-11-11 定案）。中間為全形空白（U+3000）。 */
export function cardsSubcardsCountLabel(count: number): string {
  return `子卡片\u3000${formatInteger(count)} 張`;
}

/** 分類或卡片數量標籤（九方 2026-11-11 定案）。 */
export function cardsCountLabel(count: number): string {
  return `${count} 張`;
}

/**
 * 每日進度條底列字數標籤（九方 2026-11-11 定案）。
 * 未達標：「今天寫了 N 字」；達標時：「✦ 今天寫了 N 字，已達標」。四位數以上加千分位。
 */
export function dailyProgressWordsLabel(words: number | string, met: boolean): string {
  const formatted = typeof words === 'number' ? formatInteger(words) : words;
  return met ? `✦ 今天寫了 ${formatted} 字，已達標` : `今天寫了 ${formatted} 字`;
}

/**
 * 每日進度條底列目標標籤（九方 2026-11-11 定案）。
 * 顯示「每日目標 N 字」。四位數以上加千分位。
 */
export function dailyProgressGoalLabel(goal: number | string): string {
  const formatted = typeof goal === 'number' ? formatInteger(goal) : goal;
  return `每日目標 ${formatted} 字`;
}

/** 進度條朗讀，與畫面上兩句一致，數字帶千分位。 */
export function dailyProgressAriaLabel(words: number, goal: number, met: boolean): string {
  return `${dailyProgressWordsLabel(words, met)}，${dailyProgressGoalLabel(goal)}`;
}

/** 打字時底列精簡數字：千分位，並帶「字」。 */
export function dailyProgressCompactLabel(words: number, goal: number): string {
  return `${formatInteger(words)}／${formatInteger(goal)} 字`;
}

/** 紀錄頁與寬版統計右欄的小標（九方定案：記錄）。 */
export const VISUAL_WRITING_RECORD = '視覺化的寫作記錄';

/** 設定頁「寫作過程紀錄」說明，與紀錄頁列出的項目一致。 */
export const SETTINGS_WRITING_LOG_HINT = '每日字數、寫作時間、匯入匯出、大量刪除';

/**
 * WO-60 統計與寫作紀錄預留匯入匯出次數、檔案頁三組分組標題（九方 2026-11-12 定案）。
 */
export const FILES_GROUP_SAVE = '存檔';
export const FILES_GROUP_OPEN_CLOSE = '開啟與關閉';
export const FILES_GROUP_IMPORT_EXPORT = '匯入與匯出';
export const PREPARING_BADGE = '準備中';
export const FEATURE_IN_PREPARATION = '功能還在準備中。';

export const IMPORT_TEXT_FILE_BUTTON = '匯入文字檔';
/** WO-99：匯入一律開成新稿子，不加進目前這份（原「把文字檔的內容加進這份稿子」）。 */
export const IMPORT_TEXT_FILE_HINT = '把文字檔的內容開成新稿子';
/** WO-99：匯入時第一個章名前有文字，放在最前面這一章。 */
export const IMPORT_PREFACE_TITLE = '前言';
/** WO-99：整份沒有章名時那一章的章名，逐字沿用小說型新稿子的首章名（末尾為全形空白）。 */
export const IMPORT_DEFAULT_CHAPTER_TITLE = '第一章\u3000';
/** WO-99：讀不出來或不支援的編碼，一律這一句。 */
export const IMPORT_TEXT_UNREADABLE = '這個文字檔讀不出來，請另存成 UTF-8 文字檔後再試一次。';
/** WO-99：匯入處理中，按鈕下方小字改成這一句。 */
export const IMPORT_TEXT_WORKING = '正在匯入文字檔，請稍候。';
/** WO-99：這台裝置存不下新稿子時（不建立稿子、不計次）。 */
export const IMPORT_TEXT_STORAGE_FAIL = '這台裝置存不下這份稿子，這次沒有匯入。';
export const EXPORT_FULL_TEXT_BUTTON = '匯出全文';
export const EXPORT_FULL_TEXT_HINT = '把整份稿子匯出成一個 TXT 或 Markdown 檔';

export const STATS_IMPORT_EXPORT_HEADING = '匯入與匯出';
export const STATS_IMPORT_EXPORT_SCOPE_HINT = '只算匯入文字檔、匯出全文的次數';
export const STATS_IMPORT_COUNT_LABEL = '匯入 次數';
export const STATS_EXPORT_COUNT_LABEL = '匯出 次數';

/**
 * 寫作過程紀錄卡匯入次數標籤。中間使用全形空白（U+3000）。
 * 未開放或未指定次數時顯示「匯入　— 次」。
 */
export function logImportCountLabel(count?: number | string | null): string {
  if (count === null || count === undefined || count === '—') {
    return '匯入\u3000— 次';
  }
  const formatted = typeof count === 'number' ? formatInteger(count) : count;
  return `匯入\u3000${formatted} 次`;
}

/**
 * 寫作過程紀錄卡匯出次數標籤。中間使用全形空白（U+3000）。
 * 未開放或未指定次數時顯示「匯出　— 次」。
 */
export function logExportCountLabel(count?: number | string | null): string {
  if (count === null || count === undefined || count === '—') {
    return '匯出\u3000— 次';
  }
  const formatted = typeof count === 'number' ? formatInteger(count) : count;
  return `匯出\u3000${formatted} 次`;
}



// WO-98：寫作頁頁首「好幾天沒存檔」提醒。N 為實際完整經過天數（滿 24 小時一天）。
export const staleSaveReminder = (days: number): string => `已經 ${days} 天沒存檔了`;
/** 朗讀標籤：與畫面同一句。 */
export const staleSaveReminderAria = (days: number): string => `已經 ${days} 天沒存檔了`;
