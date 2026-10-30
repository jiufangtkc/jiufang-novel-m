/** 書名最多 40 字。中文字、標點、英文字母、表情符號都算 1 字。 */
export const BOOK_TITLE_MAX = 40;

/** 打到這個字數才顯示「38／40」。 */
export const BOOK_TITLE_COUNT_FROM = 35;

const ILLEGAL_FILENAME = /[/\\:*?"<>|]/g;

const FULLWIDTH_FILENAME: Record<string, string> = {
  '/': '／',
  '\\': '＼',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜',
};

export type TitleSavePending = 'export' | 'resave' | null;

export interface BookFileMark {
  titleInFile: string | null;
  hasExternalFile: boolean;
  titleSavePending: TitleSavePending;
}

export interface BookFileMemory {
  title: string;
  filename?: string | null;
  hasExternalFile?: boolean;
  titleInFile?: string | null;
  titleSavePending?: TitleSavePending;
}

/** 一個完整字元算 1。家庭這種組合表情不要從中間切開。 */
function textUnits(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((part) => part.segment);
  }
  return Array.from(value);
}

export function countBookTitle(value: string): number {
  return textUnits(value).length;
}

export function clipBookTitle(value: string): { text: string; truncated: boolean } {
  const chars = textUnits(value);
  if (chars.length <= BOOK_TITLE_MAX) return { text: value, truncated: false };
  return { text: chars.slice(0, BOOK_TITLE_MAX).join(''), truncated: true };
}

/** 留白或只打空白，書名用「未命名稿子」。 */
export function resolvedBookTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '未命名稿子';
  return clipBookTitle(trimmed).text;
}

function limitFilenameChars(value: string, max: number): string {
  const chars = textUnits(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/** Windows 不允許的裝置名稱。COM1、LPT1 這類含 1 到 9。 */
function avoidReservedBasename(base: string): string {
  const dot = base.indexOf('.');
  const head = dot === -1 ? base : base.slice(0, dot);
  if (!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(head)) return base;
  const rest = dot === -1 ? '' : base.slice(dot);
  return `${head}_${rest}`;
}

function stripFilenameEdges(value: string): string {
  const trimmed = value.replace(/^[\s\u3000]+/u, '').replace(/[\s\u3000]+$/u, '');
  return trimmed.replace(/\.+$/u, '').replace(/[\s\u3000]+$/u, '');
}

/**
 * 產生檔名時，不能用的字改成全形，並去掉控制字元與結尾的句點、空白。
 * 書名裡的全形空白、表情符號留著。只剩標點時改成全形句點，避免檔名變成未命名稿子。
 * Windows 保留名稱後面加底線，畫面上的書名不改。
 */
export function sanitizeDbBasename(title: string): string {
  const replaced = title.replace(ILLEGAL_FILENAME, (char) => FULLWIDTH_FILENAME[char] ?? '');
  const noControls = replaced.replace(/[\u0000-\u001f\u007f]/g, '');
  let cleaned = stripFilenameEdges(noControls);
  if (!cleaned) cleaned = stripFilenameEdges(noControls.replace(/\./g, '．'));
  const limited = limitFilenameChars(cleaned, 80) || '未命名稿子';
  return limitFilenameChars(avoidReservedBasename(limited), 80);
}

/** 舊版檔名是把不能用的字直接刪掉。比對時要認得，避免舊檔被誤判成書名不同。 */
export function legacySanitizeDbBasename(title: string): string {
  const trimmed = title
    .replace(ILLEGAL_FILENAME, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.slice(0, 80) || '未命名';
}

/** 去掉 .db，以及另存檔名結尾的 _年月日-時分。 */
export function filenameStem(filename: string): string {
  let name = filename.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (name.toLowerCase().endsWith('.db')) name = name.slice(0, -3);
  return name.replace(/_\d{8}-\d{4}$/, '');
}

export function titleMatchesFilename(title: string, filename: string): boolean {
  const stem = filenameStem(filename);
  if (!stem) return false;
  const sanitized = sanitizeDbBasename(title);
  if (stem === sanitized || stem === legacySanitizeDbBasename(title)) return true;
  const reserved = avoidReservedBasename(stem);
  return reserved !== stem && reserved === sanitized;
}

export function shouldSaveUnderNewName(input: {
  hasExternalFile: boolean;
  titleInFile: string | null;
  title: string;
  filename: string | null;
}): boolean {
  if (!input.hasExternalFile || !input.filename || input.titleInFile == null) return false;
  if (input.title === input.titleInFile) return false;
  return !titleMatchesFilename(input.title, input.filename);
}

export type RenameFollowUp =
  | { kind: 'unchanged' }
  | { kind: 'renamed'; title: string; askSaveAs: boolean; pending: TitleSavePending };

/** 改完書名後，這份稿子要記下的狀態，以及要不要當場問另存。 */
export function bookAfterRename(
  book: BookFileMemory,
  rawTitle: string,
  canWriteBack: boolean,
): { book: BookFileMemory; followUp: RenameFollowUp } {
  const title = resolvedBookTitle(rawTitle);
  if (title === book.title) return { book, followUp: { kind: 'unchanged' } };
  const hasExternalFile = Boolean(book.hasExternalFile);
  const titleInFile = book.titleInFile ?? null;
  const sameAsFile = hasExternalFile && titleInFile != null && title === titleInFile;
  let pending: TitleSavePending = null;
  let askSaveAs = false;
  if (hasExternalFile && !sameAsFile) {
    if (!canWriteBack) {
      askSaveAs = true;
      pending = book.titleSavePending === 'export' ? 'export' : null;
    } else if (shouldSaveUnderNewName({
      hasExternalFile,
      titleInFile,
      title,
      filename: book.filename ?? null,
    })) {
      pending = 'resave';
    }
  }
  return {
    book: {
      ...book,
      title,
      titleSavePending: pending,
    },
    followUp: { kind: 'renamed', title, askSaveAs, pending },
  };
}

export function bookAfterDeferSave(book: BookFileMemory): BookFileMemory {
  return { ...book, titleSavePending: 'export' };
}

export function bookAfterExternalSave(book: BookFileMemory): BookFileMemory {
  return {
    ...book,
    hasExternalFile: true,
    titleInFile: book.title,
    titleSavePending: null,
  };
}

/** 舊的 App 空間沒有這幾個欄位時，用稿子編號判斷是不是從 .db 開進來的。 */
export function externalFileFromStored(input: {
  key: string;
  hasExternalFile?: boolean;
  titleInFile?: string | null;
  title: string;
  titleSavePending?: string | null;
}): BookFileMark {
  const pending: TitleSavePending =
    input.titleSavePending === 'export' || input.titleSavePending === 'resave'
      ? input.titleSavePending
      : null;
  if (typeof input.hasExternalFile === 'boolean') {
    return {
      hasExternalFile: input.hasExternalFile,
      titleInFile: input.hasExternalFile ? (input.titleInFile ?? input.title) : null,
      titleSavePending: input.hasExternalFile ? pending : null,
    };
  }
  const imported = input.key.startsWith('file-');
  return {
    hasExternalFile: imported,
    titleInFile: imported ? input.title : null,
    titleSavePending: null,
  };
}

export type TitleEditSurface = 'card' | 'inline';
export type TitleEditVia = 'confirm' | 'cancel' | 'outside';

/**
 * 卡片（手機改書名、設定頁小視窗）點外面＝取消。
 * 電腦原地輸入框點外面＝確定；框裡是空白時點外面＝還原原書名。
 */
export function commitBookTitleEdit(input: {
  surface: TitleEditSurface;
  via: TitleEditVia;
  raw: string;
  previous: string;
}): { action: 'cancel' } | { action: 'unchanged' } | { action: 'apply'; title: string } {
  if (input.via === 'cancel') return { action: 'cancel' };
  if (input.via === 'outside' && input.surface === 'card') return { action: 'cancel' };
  if (input.via === 'outside' && input.surface === 'inline' && input.raw.trim() === '') {
    return { action: 'cancel' };
  }
  const title = resolvedBookTitle(input.raw);
  if (title === input.previous) return { action: 'unchanged' };
  return { action: 'apply', title };
}

/** 章名不能空白。點外面＝確定；空白時點外面＝還原舊章名。 */
export function commitInlineChapterTitle(via: TitleEditVia, raw: string): 'cancel' | 'apply' | 'blank' {
  if (via === 'cancel') return 'cancel';
  if (raw.trim() === '') return via === 'outside' ? 'cancel' : 'blank';
  return 'apply';
}
