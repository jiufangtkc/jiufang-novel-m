/**
 * WO-143：重複開啟同一本稿子、首頁同名並列、「留下這一份」的新用字。
 * 全部是「暫定用字」，待九方審；元件與測試只引用這裡的常數，不硬寫字串。
 * 「○○」＝書名，用函式帶入；書名空白時用「未命名稿子」。
 */
export const DUPLICATE_FALLBACK_TITLE = '未命名稿子';
const nameOf = (bookTitle: string): string => bookTitle.trim() || DUPLICATE_FALLBACK_TITLE;

// 同一本（same-book）
export const sameBookTitle = (bookTitle: string): string => `這個裝置上已經有「${nameOf(bookTitle)}」了`;
export const SAME_BOOK_BODY =
  '你剛才選的檔，和這個裝置上已有的稿子是同一本。要打開原本那份，還是用剛選的檔換成這個裝置上的那份？';
export const SAME_BOOK_DIFFERS_NOTE =
  '注意：兩份的內容不一樣。打開原本那份，看到的是這個裝置上的版本，不是剛選的檔。';
export const SAME_BOOK_OPEN_EXISTING = '打開原本那份';
export const SAME_BOOK_REPLACE = '用剛選的檔取代';
export const DUPLICATE_CANCEL = '取消';

// 取代前二次確認（原本那份有未存回檔案的改動才出現）
export const replaceConfirmTitle = (bookTitle: string): string =>
  `要用剛選的檔取代這個裝置上的「${nameOf(bookTitle)}」嗎？`;
export const replaceConfirmBody = (bookTitle: string): string =>
  `這個裝置上的「${nameOf(bookTitle)}」還有還沒存回檔案的改動。取代後，那些改動會從這個裝置拿掉，刪了就找不回來。你另存在別處的 .db 稿件檔不會受影響。`;
export const REPLACE_CONFIRM = '取代';
export const REPLACE_CONFIRM_CANCEL = '取消';

// 只是書名相同（same-title）
export const sameTitleTitle = (bookTitle: string): string => `這個裝置上已經有一本也叫「${nameOf(bookTitle)}」`;
export const sameTitleBody = (bookTitle: string): string =>
  `剛才選的檔和已有的那本都叫「${nameOf(bookTitle)}」，但看起來不是同一份。要打開已有的那本，還是把剛選的檔另外留下來？`;
export const SAME_TITLE_OPEN_EXISTING = '打開已有的那本';
export const SAME_TITLE_KEEP_SEPARATE = '另外留下';

// 首頁多份並列的小標示
export const BADGE_SAME_BOOK = '同一本的另一份';
export const BADGE_SAME_TITLE = '書名相同，但不是同一份檔';
export const filenameLine = (filename: string): string => `檔名：${filename}`;

// 刪除確認多一句（附在既有內文後，既有標題與內文不動）
export const removeAlsoSameTitleNote = (bookTitle: string): string =>
  `這個裝置上還有其他也叫「${nameOf(bookTitle)}」的稿子，這次只刪你現在選的這一份。`;

// 留下一份、刪其他
export const KEEP_ONE_BUTTON = '留下這一份，刪掉同一本的其他份';
export const keepOneTitle = (bookTitle: string): string =>
  `留下這一份「${nameOf(bookTitle)}」，刪掉這個裝置上同一本的其他份嗎？`;
export const keepOneBody = (count: number): string =>
  `其他 ${count} 份會從這個裝置拿掉，刪了就找不回來。你另存在別處的 .db 稿件檔不會受影響。`;
export const KEEP_ONE_UNSAVED_NOTE = '其中有的還有還沒存回檔案的改動。';
export const KEEP_ONE_CONFIRM = '刪掉其他份';
export const KEEP_ONE_CANCEL = '取消';

// 提示
export const REPLACE_OLD_REMOVE_FAILED =
  '剛選的檔已經開好了，但這個裝置上原本那份沒能刪掉，兩份都還在，可以回首頁處理。';
export const KEEP_ONE_PARTIAL_FAILED = '有幾份沒能刪掉，已刪掉的不會回復，其餘還在，請再試一次。';
