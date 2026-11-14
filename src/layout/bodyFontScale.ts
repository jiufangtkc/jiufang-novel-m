import { measureCaret } from '../editor/caret';
import { LAYOUT_EDITOR_LIMITS, type LayoutMode } from './layoutMode';

/**
 * 正文字級（WO-96）。只乘在寫作頁與專注模式的正文上。
 * 存在這個瀏覽器，不寫進 .db，也不寫介面字級那把預留的鍵。
 */

export const BODY_FONT_SCALE_STORAGE_KEY = 'jiufang-novel-m.body-font-scale.v1';

export const BODY_FONT_SCALE_STEPS = [90, 100, 110, 120, 130, 140, 150, 175, 200] as const;

export type BodyFontScale = (typeof BODY_FONT_SCALE_STEPS)[number];

export const BODY_FONT_SCALE_DEFAULT: BodyFontScale = 100;

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

export function isBodyFontScale(value: number): value is BodyFontScale {
  return (BODY_FONT_SCALE_STEPS as readonly number[]).includes(value);
}

/** 只接受整數百分比，而且要在九個檔位裡。其他都當作沒存過。 */
export function parseBodyFontScale(raw: string | null): BodyFontScale | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return isBodyFontScale(value) ? value : null;
}

export function readBodyFontScale(store: { getItem(key: string): string | null }): BodyFontScale {
  return parseBodyFontScale(store.getItem(BODY_FONT_SCALE_STORAGE_KEY)) ?? BODY_FONT_SCALE_DEFAULT;
}

/** 只寫正文字級。不寫介面字級，也不碰稿子。 */
export function commitBodyFontScale(
  store: { setItem(key: string, value: string): void },
  scale: number,
): void {
  if (!isBodyFontScale(scale)) return;
  store.setItem(BODY_FONT_SCALE_STORAGE_KEY, String(scale));
}

export function stepBodyFontScale(current: number, direction: 1 | -1): BodyFontScale {
  const index = isBodyFontScale(current) ? BODY_FONT_SCALE_STEPS.indexOf(current) : BODY_FONT_SCALE_STEPS.indexOf(BODY_FONT_SCALE_DEFAULT);
  const next = index + direction;
  if (next < 0 || next >= BODY_FONT_SCALE_STEPS.length) {
    return BODY_FONT_SCALE_STEPS[index] ?? BODY_FONT_SCALE_DEFAULT;
  }
  return BODY_FONT_SCALE_STEPS[next] ?? BODY_FONT_SCALE_DEFAULT;
}

/** 方向鍵：上、右加一檔，下、左減一檔。已經到頭就不動。 */
export function bodyFontScaleAfterArrow(current: number, key: string): BodyFontScale | null {
  if (key !== 'ArrowUp' && key !== 'ArrowRight' && key !== 'ArrowDown' && key !== 'ArrowLeft') {
    return null;
  }
  const direction = key === 'ArrowUp' || key === 'ArrowRight' ? 1 : -1;
  const next = stepBodyFontScale(current, direction);
  const normalized = isBodyFontScale(current) ? current : BODY_FONT_SCALE_DEFAULT;
  return next === normalized ? null : next;
}

export function bodyFontScaleLabel(scale: number): string {
  const value = isBodyFontScale(scale) ? scale : BODY_FONT_SCALE_DEFAULT;
  if (value === 100) return '100%（標準）';
  return `${value}%`;
}

function readUnderHundred(value: number): string {
  if (value <= 0) return DIGITS[0];
  if (value < 10) return DIGITS[value] ?? String(value);
  if (value === 10) return '十';
  if (value < 20) return `十${DIGITS[value % 10] ?? ''}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${DIGITS[tens] ?? ''}十${ones ? DIGITS[ones] ?? '' : ''}`;
}

/** 一百多的餘數：110 念「一百一十」，不是「一百十」。 */
function readAfterHundred(value: number): string {
  if (value < 10) return `零${DIGITS[value] ?? ''}`;
  if (value < 20) return `一十${value === 10 ? '' : DIGITS[value % 10] ?? ''}`;
  return readUnderHundred(value);
}

export function readBodyFontPercent(scale: number): string {
  const value = isBodyFontScale(scale) ? scale : BODY_FONT_SCALE_DEFAULT;
  if (value === 100) return '百分之一百';
  if (value === 200) return '百分之二百';
  if (value < 100) return `百分之${readUnderHundred(value)}`;
  return `百分之一百${readAfterHundred(value - 100)}`;
}

/** 朗讀整句。100% 多念「標準大小」。 */
export function bodyFontScaleAria(scale: number): string {
  const value = isBodyFontScale(scale) ? scale : BODY_FONT_SCALE_DEFAULT;
  const percent = readBodyFontPercent(value);
  if (value === 100) {
    return `正文字級，目前是${percent}，標準大小，上下滑動可以調整`;
  }
  return `正文字級，目前是${percent}，上下滑動可以調整`;
}

/** 預覽字跟目前版面的正文一樣大。 */
export function bodyPreviewFontPx(mode: LayoutMode, scale: number): number {
  const base = LAYOUT_EDITOR_LIMITS[mode].fontSize;
  const value = isBodyFontScale(scale) ? scale : BODY_FONT_SCALE_DEFAULT;
  return (base * value) / 100;
}

export function applyBodyFontScale(scale: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root?.style?.setProperty) return;
  const value = isBodyFontScale(scale) ? scale : BODY_FONT_SCALE_DEFAULT;
  root.style.setProperty('--body-font-scale', String(value));
}

export interface BodyFontCaretAnchor {
  selection: number;
  /** 游標那一行的頂端，在可見區裡的位置。0 貼上緣，1 貼下緣。 */
  ratio: number;
  scale: number;
}

let caretAnchor: BodyFontCaretAnchor | null = null;

export function clearBodyFontCaretAnchor(): void {
  caretAnchor = null;
}

export function peekBodyFontCaretAnchor(): BodyFontCaretAnchor | null {
  return caretAnchor;
}

/** 字級改變前先記住游標那一行在畫面上的位置。 */
export function rememberBodyFontCaret(textarea: HTMLTextAreaElement, scale: number): void {
  try {
    const height = textarea.clientHeight;
    if (height <= 0) return;
    const measured = measureCaret(textarea);
    if (!measured) return;
    caretAnchor = {
      selection: textarea.selectionStart ?? 0,
      ratio: (measured.top - textarea.scrollTop) / height,
      scale: isBodyFontScale(scale) ? scale : BODY_FONT_SCALE_DEFAULT,
    };
  } catch {
    // 量不到就不要改捲動。
  }
}

export function shouldRestoreCaretLine(
  anchor: Pick<BodyFontCaretAnchor, 'selection' | 'scale'> | null,
  scale: number,
  selection: number,
): boolean {
  if (!anchor) return false;
  if (anchor.scale === scale) return false;
  return anchor.selection === selection;
}

export function bodyFontCaretNeedsScroll(scale: number, selection: number): boolean {
  return shouldRestoreCaretLine(caretAnchor, scale, selection);
}

/** 把游標那一行捲回原來的大概高度。不改選取範圍，也不改正文。 */
export function nextCaretScrollTop(
  caretTop: number,
  ratio: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  if (clientHeight <= 0) return 0;
  const raw = caretTop - ratio * clientHeight;
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.min(max, Math.max(0, raw));
}

export function applyBodyFontCaretAnchor(textarea: HTMLTextAreaElement, scale: number): boolean {
  const saved = caretAnchor;
  const selection = textarea.selectionStart ?? 0;
  if (!shouldRestoreCaretLine(saved, scale, selection) || !saved) return false;
  try {
    const height = textarea.clientHeight;
    if (height <= 0) return false;
    const measured = measureCaret(textarea);
    if (!measured) return false;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.scrollTop = nextCaretScrollTop(measured.top, saved.ratio, height, textarea.scrollHeight);
    if (textarea.selectionStart !== start || textarea.selectionEnd !== end) {
      textarea.setSelectionRange(start ?? 0, end ?? start ?? 0);
    }
    caretAnchor = { ...saved, scale };
    return true;
  } catch {
    return false;
  }
}
