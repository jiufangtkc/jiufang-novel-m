import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DELETE_UNSAVED,
  ARCHIVE_KEEP_FAIL,
  ARCHIVE_RESTORE_HELD,
  EDITOR_PLACEHOLDER,
  NEW_BOOK_DEFAULT_TITLE,
  OPEN_DB_FAIL,
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  SAVE_PERMISSION_DENIED,
  TOAST_NEW_BOOK,
  TREE_FIND_DELETED,
  TREE_FIND_VERSION,
  TREE_KIND_CHAPTER,
  TREE_KIND_SCENE,
  TREE_KIND_VOLUME,
  TREE_NAME_NEW_CHAPTER,
  TREE_PROGRESS,
  TREE_SAVE_NAME,
  TREE_START_WRITING,
  deleteRecoverableHint,
  treeMoreSummary,
} from './userFacing';

describe('九方審過的文案', () => {
  it('開檔失敗的句子一字不差', () => {
    expect(OPEN_DB_FAIL).toBe('這個檔案打不開。請選擇使用九方編輯器編寫的 .db 稿件檔。');
    expect(SAVE_PERMISSION_DENIED).toBe('沒有寫入權限，請再按一次並選「允許」。');
    expect(SAVE_FATAL_FAIL).toBe('存檔失敗。稿件目前仍在 APP 暫存空間。');
    expect(SAVE_PARTIAL_FAIL).toBe(SAVE_FATAL_FAIL);
  });
});

describe('章節目錄文案', () => {
  it('刪除確認與復原用臺灣用詞', async () => {
    const copy = await import('./userFacing');
    expect(copy.treeDeleteQuestion('第三章　地下道')).toBe('刪除「第三章　地下道」？');
    expect(copy.treeDeleteImpact(0, 2, '3,280')).toBe('裡面有 2 幕、共 3,280 字，會一起刪除。');
    expect(copy.TREE_KEEP).toBe('留著');
    expect(copy.TREE_ORGANIZE).toBe('整理目錄');
    expect(TREE_SAVE_NAME).toBe('確定');
    expect(TREE_NAME_NEW_CHAPTER).toBe('幫新章取名');
    expect(TREE_START_WRITING).toBe('開始寫');
    expect(TREE_PROGRESS).toBe('進度標記');
    expect(copy.TREE_MOVE_ROOT).toBe('不放在任何卷');
    expect(copy.TREE_DELETE_CHAPTER).toBe('刪除');
  });

  it('舊版、單篇與上下章的句子', async () => {
    const copy = await import('./userFacing');
    expect(ARCHIVE_KEEP_FAIL).toBe('這次沒留下舊版，正文沒受影響');
    expect(ARCHIVE_RESTORE_HELD).toBe('現在的內容沒留成舊版，先不換');
    expect(ARCHIVE_DELETE_UNSAVED).toBe('這次刪掉的內容找不回來，10 秒內可按「復原」');
    expect(copy.archiveWriteFailureMessage('version')).toBe(copy.ARCHIVE_KEEP_FAIL);
    expect(copy.archiveWriteFailureMessage('restore')).toBe(copy.ARCHIVE_RESTORE_HELD);
    expect(copy.archiveWriteFailureMessage('delete')).toBe(copy.ARCHIVE_DELETE_UNSAVED);
    expect(copy.contentAfterVersionRestore(false, '現在的字', '舊版的字')).toBe('現在的字');
    expect(copy.contentAfterVersionRestore(true, '現在的字', '舊版的字')).toBe('舊版的字');
    expect(copy.deleteConfirmShowsRecoverable(true)).toBe(true);
    expect(copy.deleteConfirmShowsRecoverable(false)).toBe(false);
    expect(TREE_FIND_VERSION).toBe('找回舊版');
    expect(TREE_FIND_DELETED).toBe('最近刪除');
    expect(deleteRecoverableHint(false)).toBe(
      '最近刪除的 10 項會留在這支手機，可從目錄最下方的「最近刪除」放回來',
    );
    expect(deleteRecoverableHint(true)).toBe(
      '最近刪除的 10 項會留在這台電腦，可從目錄最下方的「最近刪除」放回來',
    );
    expect(copy.TREE_PREV_CHAPTER).toBe('上一章');
    expect(copy.TREE_NEXT_CHAPTER).toBe('下一章');
    expect(copy.NEW_BOOK_NOVEL).toBe('長篇（卷章幕）');
    expect(copy.NEW_BOOK_SINGLE).toBe('單篇（短篇、散文）');
    expect(NEW_BOOK_DEFAULT_TITLE).toBe('未命名稿子');
    expect(TOAST_NEW_BOOK).toBe('已開新稿子');
    expect(EDITOR_PLACEHOLDER).toBe('從這裡開始寫');
    expect(copy.TREE_RESTORE_VERSION).toBe('用這一版');
    expect(copy.TREE_PUT_BACK).toBe('放回原位置');
    expect(copy.TREE_PUT_END).toBe('放到最後面');
    expect(copy.versionRowLabel('10月29日（四） 19:57', '120')).toBe('10月29日（四） 19:57 · 120 字');
  });

  it('改書名的句子', async () => {
    const copy = await import('./userFacing');
    expect(copy.BOOK_RENAME_TITLE).toBe('改書名');
    expect(copy.BOOK_TITLE_BLANK_HINT).toBe('留白會用「未命名稿子」');
    expect(copy.BOOK_TITLE_LIMIT_HINT).toBe('最多 40 個字，多的字沒有貼上');
    expect(copy.bookTitleCount(38)).toBe('38／40');
    expect(copy.BOOK_SECTION).toBe('這份稿子');
    expect(copy.BOOK_TITLE_LABEL).toBe('書名');
    expect(copy.BOOK_GOAL_LABEL).toBe('寫作目標');
    expect(copy.SETTINGS_EDIT_GOAL_ARIA).toBe('修改寫作目標');
    expect(copy.settingsBookGoalLine('100,000')).toBe('全書目標\u3000100,000\u00A0字');
    expect(copy.settingsDailyGoalLine('1,000')).toBe('每日目標\u30001,000\u00A0字');
    expect(copy.ASK_SAVE_AS_TITLE).toBe('要不要現在另存？');
    expect(copy.ASK_SAVE_LATER).toBe('等一下');
    expect(copy.ASK_SAVE_NOW).toBe('現在另存');
    expect(copy.askSaveAsBody('白狐')).toBe('書名改成《白狐》了。原本的檔案裡還是舊書名，另存一份新檔才會用新書名。');
    expect(copy.TITLE_PENDING_EXPORT).toBe('書名改過了，還沒另存。原本的檔案裡還是舊書名');
    expect(copy.TITLE_PENDING_RESAVE).toBe('書名改過了，下次按「儲存專案」會用新書名另存一份，舊檔留著');
    expect(copy.TOAST_SAVED_UNDER_NEW_TITLE).toBe('已用新書名另存一份');
    expect(copy.STATS_HEADING).toBe('寫作統計');
    expect(copy.DB_FILE_TYPE_LABEL).toBe('九方編輯器稿件檔');
    expect(copy.currentFileLine('白狐.db')).toBe('檔案：白狐.db');
    expect(copy.titlePendingNotice('export')).toBe(copy.TITLE_PENDING_EXPORT);
    expect(copy.titlePendingNotice(null)).toBeNull();
  });

  it('更多摘要：幕不寫幕數，卷要寫章數', () => {
    expect(treeMoreSummary(TREE_KIND_SCENE, 0, 0, '12')).toBe('幕 · 共 12 字');
    expect(treeMoreSummary(TREE_KIND_CHAPTER, 0, 2, '3,280')).toBe('章 · 2 幕 · 共 3,280 字');
    expect(treeMoreSummary(TREE_KIND_VOLUME, 3, 2, '3,280')).toBe('卷 · 3 章 · 2 幕 · 共 3,280 字');
  });

  it('資料集試看版文案（WO-45、WO-50 定案）', async () => {
    const copy = await import('./userFacing');
    expect(copy.SAMPLE_CARDS_NOTICE).toBe('範例卡片，之後會換成這份稿子的卡片');
    expect(copy.CARDS_HEADING).toBe('資料集');
    expect(copy.BACK_TO_CATEGORIES_ARIA).toBe('返回分類清單');
    expect(copy.BACK_TO_CARDS_ARIA).toBe('返回卡片清單');
    expect(copy.categoryRowAria('角色', 5)).toBe('角色，5 張卡片');
    expect(copy.cardCollapseAria('沈雨晴')).toBe('收合「沈雨晴」子卡片');
    expect(copy.cardExpandAria('沈雨晴')).toBe('展開「沈雨晴」子卡片');
    expect(copy.cardDetailAria('沈雨晴')).toBe('看「沈雨晴」卡片內容');
    expect(copy.VIEW_CARDS_BUTTON).toBe('看卡片');
    expect(copy.CLOSE_CARDS_ARIA).toBe('關閉資料集');
    expect(copy.EMPTY_CARD_CONTENT_MESSAGE).toBe('這張卡片還沒有內容。');
    expect(copy.UNTITLED_CARD_TITLE).toBe('未命名卡片');
    expect(copy.displayCardTitle('沈雨晴')).toBe('沈雨晴');
    expect(copy.displayCardTitle('')).toBe('未命名卡片');
    expect(copy.displayCardTitle('   ')).toBe('未命名卡片');
    expect(copy.displayCardTitle(null)).toBe('未命名卡片');
    expect(copy.cardDetailAria('')).toBe('看「未命名卡片」卡片內容');
    expect(copy.cardDetailAria('   ')).toBe('看「未命名卡片」卡片內容');
  });

  it('WO-56：四種版面資料集定案文字', async () => {
    const copy = await import('./userFacing');
    expect(copy.CARDS_READONLY_BADGE).toBe('只能看');
    expect(copy.CARDS_EMPTY_CATEGORY_HINT).toBe('請選擇分類');
    expect(copy.CARDS_EMPTY_IN_CATEGORY_HINT).toBe('這個分類還沒有卡片。');
    expect(copy.CARDS_EMPTY_CARD_HINT).toBe('請選擇卡片');
    expect(copy.CARDS_COLUMN_CATEGORIES).toBe('分類');
    expect(copy.CARDS_COLUMN_CARDS).toBe('卡片清單');
    expect(copy.CARDS_COLUMN_CONTENT).toBe('卡片內容');
    expect(copy.CARDS_PREVIEW_EMPTY_HINT).toBe('這份稿子還沒有正文。');
    expect(copy.cardsSubcardsCountLabel(2)).toBe('子卡片\u30002 張');
    expect(copy.cardsCountLabel(4)).toBe('4 張');
  });

  it('WO-57：介面用字常數定案（專注模式、收合目錄、展開目錄、資料集）', async () => {
    const copy = await import('./userFacing');
    expect(copy.FOCUS_MODE_ENTER_BUTTON).toBe('專注模式');
    expect(copy.FOCUS_MODE_EXIT_BUTTON).toBe('離開專注模式');
    expect(copy.CLOSE_CHAPTER_TREE_ARIA).toBe('收合目錄');
    expect(copy.FLOATING_CHAPTER_TREE_ARIA).toBe('展開目錄');
    expect(copy.CARDS_PANEL_ARIA).toBe('資料集');
    expect(copy.OPEN_CHAPTER_TREE_ARIA).toBe('展開目錄');
    expect(copy.BACK_TO_CHAPTER_TREE_ARIA).toBe('返回目錄');
    expect(copy.TREE_DRAWER_BUTTON).toBe('目錄');
    expect(copy.VIEW_CARDS_BUTTON).toBe('看卡片');
    expect(copy.CLOSE_CARDS_ARIA).toBe('關閉資料集');
  });

  it('WO-57：今天字數統計標籤（有目標、無目標、四位數千分位、0 字驗證）', async () => {
    const { todayWordsLabel } = await import('./userFacing');

    // 1. 有每日目標：全形斜線「／」，四位數以上加千分位
    expect(todayWordsLabel(620, 1000)).toBe('今天 620／1,000 字');
    expect(todayWordsLabel(1234, 10000)).toBe('今天 1,234／10,000 字');
    expect(todayWordsLabel(0, 1000)).toBe('今天 0／1,000 字');
    expect(todayWordsLabel(12345, 20000)).toBe('今天 12,345／20,000 字');
    expect(todayWordsLabel('620', '1,000')).toBe('今天 620／1,000 字');
    expect(todayWordsLabel('1,234', 10000)).toBe('今天 1,234／10,000 字');

    // 2. 沒設每日目標（無 goal 或 goal 為 null / undefined / 0）：顯示「今天 N 字」
    expect(todayWordsLabel(620)).toBe('今天 620 字');
    expect(todayWordsLabel(620, null)).toBe('今天 620 字');
    expect(todayWordsLabel(620, undefined)).toBe('今天 620 字');
    expect(todayWordsLabel(620, 0)).toBe('今天 620 字');
    expect(todayWordsLabel(0)).toBe('今天 0 字');
    expect(todayWordsLabel(0, null)).toBe('今天 0 字');
    expect(todayWordsLabel(1234)).toBe('今天 1,234 字');
    expect(todayWordsLabel(12345)).toBe('今天 12,345 字');
    expect(todayWordsLabel('1,234')).toBe('今天 1,234 字');
  });

  it('WO-59：資料集與底列用字定案（CARDS_PREVIEW_EMPTY_HINT、cardsSubcardsCountLabel 全形空白、DailyProgressBar 標籤函式）', async () => {
    const copy = await import('./userFacing');

    // 1. CARDS_PREVIEW_EMPTY_HINT 定案為「這份稿子還沒有正文。」
    expect(copy.CARDS_PREVIEW_EMPTY_HINT).toBe('這份稿子還沒有正文。');

    // 2. cardsSubcardsCountLabel(n) 中間使用全形空白 U+3000
    expect(copy.cardsSubcardsCountLabel(3)).toBe('子卡片\u30003 張');
    expect(copy.cardsSubcardsCountLabel(3)).toBe('子卡片\u{3000}3 張');
    expect(copy.cardsSubcardsCountLabel(1)).toBe('子卡片\u30001 張');
    expect(copy.cardsSubcardsCountLabel(1000)).toBe('子卡片\u30001,000 張');

    // 3. dailyProgressWordsLabel 未達標與達標前後綴、四位數千分位
    expect(copy.dailyProgressWordsLabel(300, false)).toBe('今天寫了 300 字');
    expect(copy.dailyProgressWordsLabel(300, true)).toBe('✦ 今天寫了 300 字，已達標');
    expect(copy.dailyProgressWordsLabel(12345, false)).toBe('今天寫了 12,345 字');
    expect(copy.dailyProgressWordsLabel(12345, true)).toBe('✦ 今天寫了 12,345 字，已達標');
    expect(copy.dailyProgressWordsLabel(0, false)).toBe('今天寫了 0 字');

    // 4. dailyProgressGoalLabel 每日目標與千分位
    expect(copy.dailyProgressGoalLabel(1000)).toBe('每日目標 1,000 字');
    expect(copy.dailyProgressGoalLabel(10000)).toBe('每日目標 10,000 字');
    expect(copy.dailyProgressGoalLabel(500)).toBe('每日目標 500 字');

    // 5. WO-56 其餘文字保持不變
    expect(copy.CARDS_READONLY_BADGE).toBe('只能看');
    expect(copy.CARDS_EMPTY_CATEGORY_HINT).toBe('請選擇分類');
    expect(copy.CARDS_EMPTY_IN_CATEGORY_HINT).toBe('這個分類還沒有卡片。');
    expect(copy.CARDS_EMPTY_CARD_HINT).toBe('請選擇卡片');
    expect(copy.CARDS_COLUMN_CATEGORIES).toBe('分類');
    expect(copy.CARDS_COLUMN_CARDS).toBe('卡片清單');
    expect(copy.CARDS_COLUMN_CONTENT).toBe('卡片內容');
    expect(copy.cardsCountLabel(4)).toBe('4 張');
  });

  it('WO-60：統計匯入匯出預留與檔案頁分組用字定案', async () => {
    const copy = await import('./userFacing');

    // 1. 檔案頁三組標題
    expect(copy.FILES_GROUP_SAVE).toBe('存檔');
    expect(copy.FILES_GROUP_OPEN_CLOSE).toBe('開啟與關閉');
    expect(copy.FILES_GROUP_IMPORT_EXPORT).toBe('匯入與匯出');
    expect(copy.FILES_GROUP_OPEN_CLOSE).not.toBe('開稿');

    // 2. 準備中標籤與提示
    expect(copy.PREPARING_BADGE).toBe('準備中');
    expect(copy.FEATURE_IN_PREPARATION).toBe('功能還在準備中。');

    // 3. 檔案頁按鈕與說明文字
    expect(copy.IMPORT_TEXT_FILE_BUTTON).toBe('匯入文字檔');
    expect(copy.IMPORT_TEXT_FILE_HINT).toBe('把文字檔的內容加進這份稿子');
    expect(copy.EXPORT_FULL_TEXT_BUTTON).toBe('匯出全文');
    expect(copy.EXPORT_FULL_TEXT_HINT).toBe('把整份稿子匯出成一個 TXT 或 Markdown 檔');

    // 4. 統計頁區塊與說明小字
    expect(copy.STATS_IMPORT_EXPORT_HEADING).toBe('匯入與匯出');
    expect(copy.STATS_IMPORT_EXPORT_SCOPE_HINT).toBe('只算匯入文字檔、匯出全文的次數');
    expect(copy.STATS_IMPORT_COUNT_LABEL).toBe('匯入 次數');
    expect(copy.STATS_EXPORT_COUNT_LABEL).toBe('匯出 次數');

    // 5. 紀錄卡匯入匯出標籤（全形空白與預設破折號）
    expect(copy.logImportCountLabel()).toBe('匯入\u3000— 次');
    expect(copy.logImportCountLabel(null)).toBe('匯入\u3000— 次');
    expect(copy.logImportCountLabel('—')).toBe('匯入\u3000— 次');
    expect(copy.logImportCountLabel(3)).toBe('匯入\u30003 次');
    expect(copy.logImportCountLabel(1000)).toBe('匯入\u30001,000 次');

    expect(copy.logExportCountLabel()).toBe('匯出\u3000— 次');
    expect(copy.logExportCountLabel(null)).toBe('匯出\u3000— 次');
    expect(copy.logExportCountLabel('—')).toBe('匯出\u3000— 次');
    expect(copy.logExportCountLabel(2)).toBe('匯出\u30002 次');
    expect(copy.logExportCountLabel(2000)).toBe('匯出\u30002,000 次');

    // 6. 新文字絕不可含有「.db」或「開稿」
    const newTexts = [
      copy.FILES_GROUP_SAVE,
      copy.FILES_GROUP_OPEN_CLOSE,
      copy.FILES_GROUP_IMPORT_EXPORT,
      copy.PREPARING_BADGE,
      copy.FEATURE_IN_PREPARATION,
      copy.IMPORT_TEXT_FILE_BUTTON,
      copy.IMPORT_TEXT_FILE_HINT,
      copy.EXPORT_FULL_TEXT_BUTTON,
      copy.EXPORT_FULL_TEXT_HINT,
      copy.STATS_IMPORT_EXPORT_HEADING,
      copy.STATS_IMPORT_EXPORT_SCOPE_HINT,
      copy.STATS_IMPORT_COUNT_LABEL,
      copy.STATS_EXPORT_COUNT_LABEL,
      copy.logImportCountLabel(),
      copy.logExportCountLabel(),
    ];
    for (const text of newTexts) {
      expect(text).not.toContain('.db');
      expect(text).not.toContain('開稿');
    }
  });
});
