import { formatProjectUpdatedLabel } from '../domain/formatCalendarDate';
import { formatInteger } from '../domain/formatNumber';
import { formatLastExportLabel } from '../domain/saveClock';

/** 九方審過的介面文案（改前改後表 V1）。 */

export const MANUSCRIPT_NOT_FOUND = '找不到這份稿子。請回首頁重新開啟。';

// WO-97：設定頁「隱私說明」標題（入口列與子頁共用）與九方定稿六句加 WO-107 查字典補句（第二句後），共七句，一句一段
export const PRIVACY_TITLE = '隱私說明';
export const PRIVACY_PARAGRAPHS: readonly string[] = [
  'JiufangM 不用註冊，也不用登入。',
  '您的稿子、卡片和寫作紀錄只存在您自己的裝置裡，不會傳到我們這邊或任何伺服器。',
  '只有按「查字典」時例外：您選取的詞會送到教育部辭典網站查詢，稿子其他內容不會送出。',
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

/** WO-121：開檔讀取中，所有開稿按鈕（首頁、檔案頁、歡迎導覽）統一顯示這句（九方已核准，單一省略號字元）。 */
export const OPEN_FILE_BUSY = '正在開啟…';

/** 開稿按鈕目前該顯示的字：忙碌中顯示 OPEN_FILE_BUSY，否則是原本的名稱。 */
export function openButtonLabel(busy: boolean, idleLabel: string): string {
  return busy ? OPEN_FILE_BUSY : idleLabel;
}

/** WO-123（暫定，待九方審定）：存檔選位置視窗回 AbortError 時的提示（真正按取消也會出現，程式分不出來）。 */
export const SAVE_PICKER_ABORTED_TOAST = '如果剛才有選位置，請把選檔視窗縮小一點再試一次。';

export const OPEN_DB_HINT ='請選擇使用九方編輯器編寫的 .db 稿件檔。';

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
export const TREE_INLINE_ADD_VOLUME = '＋ 新增卷';
export const TREE_INLINE_ADD_CHAPTER = '＋ 在這卷新增章';
export const TREE_INLINE_ADD_SCENE = '＋ 在這章新增幕';
/** WO-124b：長篇新稿的三層範例名稱。第一章結尾保留一個全形空白（U+3000），方便接續輸入副標。與匯入預設章名、手動新增的「新卷」「幕 1 新幕」分開。 */
export const NEW_NOVEL_VOLUME_TITLE = '第一卷';
export const NEW_NOVEL_CHAPTER_TITLE = '第一章　';
export const NEW_NOVEL_SCENE_TITLE = '第一幕';
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

/** 達標字樣（WO-101 定稿）：接在「今天 N／M 字」後面，中間是全形空白 U+3000，不加驚嘆號。 */
export const DAILY_PROGRESS_MET_TEXT = '達標了';
/** 達標朗讀尾句（WO-101 定稿）。 */
export const DAILY_PROGRESS_MET_ARIA = '已經達標';

/**
 * 進度條朗讀第一段（WO-101 定稿）：「今天寫了 N 字」。四位數以上加千分位。
 * 達標與否不在這一段說，達標尾句由 dailyProgressAriaLabel 接在最後。
 */
export function dailyProgressWordsLabel(words: number | string): string {
  const formatted = typeof words === 'number' ? formatInteger(words) : words;
  return `今天寫了 ${formatted} 字`;
}

/**
 * 進度條朗讀第二段（九方 2026-11-11 定案，WO-101 沿用）。
 * 「每日目標 N 字」。四位數以上加千分位。
 */
export function dailyProgressGoalLabel(goal: number | string): string {
  const formatted = typeof goal === 'number' ? formatInteger(goal) : goal;
  return `每日目標 ${formatted} 字`;
}

/**
 * 進度條畫面字（WO-101 定稿），完整與鍵盤開啟的精簡模式共用：
 * 未達標「今天 320／1,000 字」；達標「今天 1,020／1,000 字　達標了」。
 */
export function dailyProgressDisplayLabel(words: number, goal: number, met: boolean): string {
  const base = todayWordsLabel(words, goal);
  return met ? `${base}\u3000${DAILY_PROGRESS_MET_TEXT}` : base;
}

/**
 * 進度條朗讀（WO-101 定稿），完整與精簡模式共用，不拿畫面字串來念：
 * 未達標「今天寫了 320 字，每日目標 1,000 字」；
 * 達標「今天寫了 1,020 字，每日目標 1,000 字，已經達標」。不用「／」或裝飾符號。
 */
export function dailyProgressAriaLabel(words: number, goal: number, met: boolean): string {
  const base = `${dailyProgressWordsLabel(words)}，${dailyProgressGoalLabel(goal)}`;
  return met ? `${base}，${DAILY_PROGRESS_MET_ARIA}` : base;
}

/**
 * 寬版頁首右側今天字數（WO-102）。與進度條同一個目標、同一個達標判斷，用字沿用定稿函式。
 * 有有效目標：畫面字同進度條（達標後接「　達標了」），另給獨立朗讀句（不念「／」）。
 * 沒有有效目標：沿用原本「今天 N 字」，aria 為 null（不判達標）。
 */
export function topbarTodayWords(
  words: number,
  goal: number | string | null | undefined,
  met: boolean,
): { display: string; aria: string | null } {
  if (typeof goal === 'number' && Number.isFinite(goal) && goal > 0) {
    return {
      display: dailyProgressDisplayLabel(words, goal, met),
      aria: dailyProgressAriaLabel(words, goal, met),
    };
  }
  return { display: todayWordsLabel(words, goal), aria: null };
}

/** 紀錄頁與寬版統計右欄的小標（九方定案：記錄）。 */
export const VISUAL_WRITING_RECORD = '視覺化的寫作記錄';

/** 設定頁「寫作過程紀錄」說明，與紀錄頁列出的項目一致。 */
export const SETTINGS_WRITING_LOG_HINT = '每日字數、寫作時間、匯入紀錄';

/**
 * WO-60 統計與寫作紀錄預留匯入匯出次數、檔案頁三組分組標題（九方 2026-11-12 定案）。
 */
export const FILES_GROUP_SAVE = '存檔';
export const FILES_GROUP_OPEN_CLOSE = '開啟與關閉';
export const FILES_GROUP_IMPORT_EXPORT = '匯出';
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
/** WO-126（暫定，交九方審）：匯入視窗標題。 */
export const IMPORT_DIALOG_TITLE = IMPORT_TEXT_FILE_BUTTON;
/** WO-126（暫定，交九方審）：例子欄位標題。 */
export const IMPORT_EXAMPLE_LABEL = '你的章名長什麼樣？';
/** WO-126（暫定，交九方審）：例子欄位說明。 */
export const IMPORT_EXAMPLE_HINT = '可以填「01章」或「Chapter 1」。留白就自動判斷。';
/** WO-126（暫定，交九方審）：前往預覽。 */
export const IMPORT_PREVIEW_BUTTON = '看分章預覽';
/** WO-126（暫定，交九方審）：找到章名的預覽句。 */
export function importPreviewFound(count: number, firstTitle: string): string {
  return `找到 ${count} 章，第一章是『${firstTitle}』`;
}
/** WO-126（暫定，交九方審）：填了例子卻找不到。 */
export const IMPORT_PREVIEW_NOT_FOUND = '找不到符合這個例子的章名';
/** WO-126（暫定，交九方審）：未找到章名時，確定匯入會放成一章的提示。 */
export const IMPORT_PREVIEW_ONE_CHAPTER_HINT = '確定匯入後，全文會放在一章，章名是「第一章　」。';
/** WO-126（暫定，交九方審）：依預覽建立新稿。 */
export const IMPORT_CONFIRM_BUTTON = '確定匯入';
/** WO-126（暫定，交九方審）：回到欄位改例子。 */
export const IMPORT_BACK_BUTTON = '回去改例子';
/** WO-126（暫定，交九方審）：直接以全文建立單章。 */
export const IMPORT_NO_SPLIT_BUTTON = '不分章（全部放成一章）';
/** WO-126（暫定，交九方審）：關閉視窗。 */
export const IMPORT_CANCEL_BUTTON = TREE_CANCEL;
/** WO-126（暫定，交九方審）：預覽章名清單的朗讀標籤。 */
export const IMPORT_PREVIEW_LIST_ARIA = '前幾章的章名';

export const EXPORT_FULL_TEXT_BUTTON = '匯出全文';
/** WO-103（暫定，交九方審，暫定第 9 條）：不做 Markdown，只承諾已開放的格式與範圍。 */
export const EXPORT_FULL_TEXT_HINT = '把全文或自選章節匯出成一個 Word 或 TXT 檔';

/*
 * WO-103 匯出選單與自選章節清單用字。「Word」「TXT」「全文」「自選章節」為九方指定；
 * 其餘標題、欄位、按鈕、提示與朗讀文字全部「暫定，交九方審」（逐字列在交接）。
 */
export const EXPORT_DIALOG_TITLE = '匯出稿子';
export const EXPORT_FORMAT_LEGEND = '檔案格式';
export const EXPORT_FORMAT_DOCX = 'Word（.docx）';
export const EXPORT_FORMAT_TXT = 'TXT（.txt）';
export const EXPORT_SCOPE_LEGEND = '匯出範圍';
export const EXPORT_SCOPE_ALL = '全文';
export const EXPORT_SCOPE_SELECTED = '自選章節';
export const EXPORT_CONFIRM = '匯出';
export const EXPORT_CANCEL = '取消';
export const EXPORT_WORKING = '正在準備檔案，請稍候。';
export const EXPORT_DEVICE_FAIL = '這個裝置目前無法匯出，請稍後再試。';
export const EXPORT_NO_CHAPTERS = '這份稿子還沒有章，先新增一章再匯出。';
export const EXPORT_EMPTY_SELECTION = '請先選要匯出的章。';
/** 自選章節：已選了幾章／幾幕的摘要（暫定）。 */
export function exportSelectionSummary(chapters: number, scenes: number): string {
  if (chapters === 0 && scenes === 0) return EXPORT_EMPTY_SELECTION;
  return scenes > 0 ? `已選 ${chapters} 章、${scenes} 幕` : `已選 ${chapters} 章`;
}
export const EXPORT_PICK_CHAPTERS = '選擇章節';
/** 手勢失效（iPhone 等瀏覽器在檔案備妥後拒絕直接分享）時，請使用者再點一次。 */
export const EXPORT_READY_HINT = '檔案已備妥，請按「儲存檔案」。';
export const EXPORT_SAVE_FILE = '儲存檔案';
export const EXPORT_PICKER_TITLE = '自選章節';
export const EXPORT_SELECT_ALL = '全選';
export const EXPORT_SELECT_NONE = '取消全選';
export const EXPORT_PICKER_DONE = '確定';
export const EXPORT_PICKER_CANCEL = '取消';
export const EXPORT_EXPAND = '展開';
export const EXPORT_COLLAPSE = '收合';
/** 部分選取時給朗讀用的補充（畫面另有半勾符號，不只靠顏色）。 */
export const EXPORT_PARTIAL_LABEL = '部分選取';

/**
 * WO-120（九方 2026-11-18 定案）：統計頁匯入說明，一行完整句。
 * 日期是第一筆匯入事件的寫作日（YYYY-MM-DD）：年份一定寫、月日不補 0、不加星期。
 * 格式不對（無法拆成年月日）時回傳 null，由畫面整行不顯示，不自行發明日期。
 */
export function statsImportedOnLine(dayKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `這份稿子是 ${year} 年 ${month} 月 ${day} 日從文字檔匯入的。`;
}

/** WO-120：寫作紀錄每日卡片，匯入那一天的一行。 */
export const LOG_IMPORTED_DAY_NOTE = '這天從文字檔匯入';

/** WO-113：正文貼上與複製、剪下的短暫提示。 */
export const EDITOR_PASTE_BLOCKED_TOAST = '匯入已經存在的稿子請用「匯入文字檔」，外部文字只能貼在資料卡片裡喔😊';
export const EDITOR_COPIED_TOAST = '已複製';
export const EDITOR_CUT_TOAST = '已剪下';

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

// WO-116：首頁最近清單右邊 X 的確認視窗（九方定版文案，逐字照用，不得改字）。
export const REMOVE_FROM_DEVICE_FALLBACK_TITLE = '未命名稿子';
export const removeFromDeviceTitle = (bookTitle: string): string =>
  `要從這個裝置刪掉「${bookTitle.trim() || REMOVE_FROM_DEVICE_FALLBACK_TITLE}」嗎？`;
export const REMOVE_FROM_DEVICE_BODY =
  '這份稿子存在這個裝置上的內容會一起刪掉，刪了就找不回來。你另存在別處的 .db 稿件檔不會受影響。';
export const REMOVE_FROM_DEVICE_CONFIRM = '刪掉';
export const REMOVE_FROM_DEVICE_CANCEL = '取消';
/** X 按鈕的朗讀標籤：說明按下去是刪掉這個裝置上的暫存，並可辨認是哪一份。 */
export const removeFromDeviceAria = (bookTitle: string): string =>
  `刪掉這個裝置上的暫存：${bookTitle.trim() || REMOVE_FROM_DEVICE_FALLBACK_TITLE}`;

// WO-122：寫作頁排版小工具。以下全部是「暫定用字」，待九方審稿；元件不可硬寫。
export const FORMAT_MORE_GLYPH = '⋯';
export const FORMAT_MORE_ARIA = '更多';
export const FORMAT_MENU_ITEM = '排版';
export const FORMAT_DIALOG_TITLE = '排版';
export const FORMAT_DIALOG_HINT = '選一個排版方式。';
export const FORMAT_KIND_INDENT = '段首加兩個全形空格';
export const FORMAT_KIND_STRIP_BLANK = '去除空行';
export const FORMAT_KIND_SPACE_PARAGRAPHS = '段落之間加空行';
export const FORMAT_SCOPE_TITLE = '要改哪裡？';
export const FORMAT_SCOPE_CHAPTER = '這一章';
export const FORMAT_SCOPE_BOOK = '全書';
export const FORMAT_BACK = '上一步';
export const FORMAT_CONFIRM_TITLE = '開始排版嗎？';
export const formatConfirmSentence = (scope: string, kind: string): string =>
  `要把${scope}的正文做「${kind}」嗎？只改正文，改完可以復原。`;
export const FORMAT_CONFIRM_BOOK_NOTE = '全書會一起改這本稿子裡所有章和幕的正文。';
export const FORMAT_UNDO_WARNING =
  '按「復原」會回到這次排版前，連排版後在這些正文新打的字也會一起還原。';
export const FORMAT_CANCEL = '取消';
export const FORMAT_START = '開始排版';
export const FORMAT_DONE = '排版好了';
export const FORMAT_UNDO_BUTTON = '復原';
export const FORMAT_UNDONE_TOAST = '已回到排版前的樣子。';
export const FORMAT_UNCHANGED_TOAST = '已經是這個樣子，不用再改。';
export const FORMAT_NO_TARGET_TOAST = '先打開一章或一幕，再來排版。';
export const FORMAT_COMPOSING_TOAST = '先把正在輸入的字打完，再來排版。';
export const FORMAT_STALE_TOAST = '稿子或章節換了，請重新選一次排版。';
export const FORMAT_UNDO_GONE_TOAST = '這次排版的內容已經不在，沒辦法復原了。';
export const FORMAT_NOTICE_CLOSE = '關閉';
export const FORMAT_NOTICE_CLOSE_ARIA = '關閉排版提示';
export const FORMAT_KIND_GROUP_ARIA = '排版方式';
export const FORMAT_SCOPE_GROUP_ARIA = '排版範圍';

// WO-127（暫定，待九方審）：設定頁「關於」區贊助連結用字與朗讀提示。
export const SPONSOR_BUTTON_LABEL = '贊助九方思想貓';
export const SPONSOR_DESCRIPTION =
  '編輯器M免費使用。如果它幫上你的忙，歡迎請作者喝杯咖啡。';
export const SPONSOR_NEW_TAB_HINT = '（另開新分頁）';

// WO-128（暫定，待九方審）：事件時間線與事件卡新欄位用字（樣張「新」標籤僅示意，正式版不輸出）。
export const TIMELINE_VIEW_CARDS = '卡片清單';
export const TIMELINE_VIEW_TIMELINE = '時間線';
export const TIMELINE_HEADING = '時間線';
export const timelineBookCrumb = (title: string): string => `・${title}`;
export const TIMELINE_ADD_EVENT = '新增事件';
export const TIMELINE_TAB_STORY = '故事順序';
export const TIMELINE_TAB_READING = '章節順序';
export const TIMELINE_TAB_DUAL = '雙軸對照';
export const TIMELINE_STORY_HINT = '照故事裡真正發生的先後排。按住右邊 ⠿ 拖曳換順序，點卡片打開。';
export const TIMELINE_READING_HINT = '照讀者讀到的先後排，跟著目錄的章走。';
export const TIMELINE_BADGE_FLASHBACK = '倒敘';
export const TIMELINE_BADGE_UNREVEALED = '尚未揭露';
export const TIMELINE_UNASSIGNED_LABEL = '還沒寫進任何章';
export const TIMELINE_LEGEND_FLASHBACK = '往回講更早的事';
export const TIMELINE_LEGEND_UNREVEALED = '還沒寫進章';
export const timelineStoryOrderPhone = (n: number): string => `故事裡第 ${n} 件`;
export const timelineStoryOrderWide = (n: number): string => `故事第 ${n} 件`;
export const timelineReadingOrderWide = (n: number): string => `讀者第 ${n} 件`;
export const TIMELINE_READER_NOT_YET = '讀者還沒讀到';
export const timelineUnassignedSectionCount = (n: number): string => `（${n}）`;
export const EVENT_STORY_TIME_LABEL = '故事時間';
export const EVENT_STORY_TIME_PLACEHOLDER = '例如：十年前・冬';
export const EVENT_STORY_TIME_HELP =
  '隨你寫，例如「第三年春」「案發當晚 23:40」。只是標示，先後順序在時間線上拖曳決定。';
export const EVENT_STORY_TIME_EMPTY = '尚未填寫';
export const EVENT_CHAPTER_LABEL = '出現在哪一章';
export const EVENT_CHAPTER_NONE_NOTE = '先記著，之後再放';
export const timelineJumpToChapter = (label: string): string => `跳到${label}`;
export const TIMELINE_DUAL_TOP_TITLE = '故事真實順序';
export const TIMELINE_DUAL_TOP_DESC = '左到右＝故事裡發生的先後，拖曳卡片換順序';
export const TIMELINE_DUAL_BOTTOM_TITLE = '讀者讀到的順序';
export const TIMELINE_DUAL_BOTTOM_DESC =
  '左到右＝章節順序，跟著目錄走；改章請到卡片裡選「出現在哪一章」';
export const TIMELINE_DUAL_LEGEND_NORMAL = '照順序往下讀';
export const TIMELINE_DUAL_LEGEND_FLASHBACK = '倒敘：讀者後讀到、故事裡更早發生';
export const TIMELINE_DUAL_LEGEND_UNASSIGNED = '還沒寫進任何章（尚未揭露）';
export const TIMELINE_DUAL_LEGEND_CROSSING = '線交叉越多，敘事跳得越多';
export const TIMELINE_DUAL_TIP_INTRO = '點一下卡片，兩邊同一件事一起亮起來。';
export const timelineDualTipDetail = (
  title: string,
  storyN: number,
  chapterLabel?: string | null,
): string =>
  chapterLabel && chapterLabel.trim() !== ''
    ? `「${title}」故事裡第 ${storyN} 件，讀者到${chapterLabel}才讀到。`
    : `「${title}」故事裡第 ${storyN} 件，還沒寫進任何章。`;
export const TIMELINE_OPEN_CARD = '開啟卡片';
export const TIMELINE_EMPTY_HINT = '這個時間軸還沒有事件。按右上角「新增事件」開始排時間線。';
export const TIMELINE_BACK_ARIA = '返回時間軸卡片清單';
// WO-128（暫定，待九方審）
export const TIMELINE_BACK_TO_TIMELINE_ARIA = '返回時間線';
export const timelineDragHandleAria = (title: string): string =>
  `「${title}」的拖曳把手，按一下可用上移或下移調整順序`;
export const timelineMovedLiveAnnouncement = (title: string, pos: number, total: number): string =>
  `已將「${title}」移到故事裡第 ${pos} 件，共 ${total} 件`;
export const timelineSelectedDockLabel = (title: string): string => `已選「${title}」`;

// WO-129（暫定，待九方審）：改版說明視窗與設定頁入口用字。
export const WHATS_NEW_TITLE = '這一版新增了什麼';
export const WHATS_NEW_CONFIRM = '知道了';
export const WHATS_NEW_SETTINGS_TITLE = '看改版內容';
export const WHATS_NEW_SETTINGS_HINT = '看看這一版和之前改了什麼';
export const WHATS_NEW_PREVIOUS_TOGGLE = '之前的版本';
export const WHATS_NEW_EMPTY_CURRENT = '這一版沒有另外列出更新項目。';
export const whatsNewVersionLabel = (version: string): string => `版本 ${version}`;

// WO-130（暫定，待九方審）：自動存檔與頁首存檔標示用字。
export const AUTOSAVE_UNSAVED_BADGE = '還沒存成檔案';
export function autosaveUnsavedAria(canWriteBack: boolean): string {
  return canWriteBack ? '還沒存成檔案，點一下儲存專案' : '還沒存成檔案，點一下另存專案';
}
export const AUTOSAVE_RESUME_BADGE = '點一下恢復自動存檔';
export const AUTOSAVE_RESUME_ARIA = '點一下恢復自動存檔，允許後每 5 分鐘自動存回檔案';
export const AUTOSAVE_FAILED_BADGE = '自動存檔沒成功';
export const AUTOSAVE_FAILED_ARIA = '自動存檔沒成功，點一下手動存檔';
export function autosavedAtLabel(timeText: string): string {
  return `已自動存檔 ${timeText}`;
}
export function lastFileSavedLabel(timeText: string): string {
  return `上次存檔 ${timeText}`;
}
export const AUTOSAVE_RESUMED_TOAST = '已恢復自動存檔';
export const AUTOSAVE_FAILED_TOAST = '自動存檔沒成功，稿子還在暫存空間，請手動存一次。';
