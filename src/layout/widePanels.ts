/**
 * 電腦寬版（wide）正文欄寬與三欄容量（WO-W36）
 *
 * - 正文一行看得見的字數：預設 36；若「左右側欄都展開」仍放得下 40 字就用 40。
 *   限寬 = N 個字的內容寬 + 左右內距 80px（內距不算進字數）。
 * - 側欄分成兩件事：
 *   1. 使用者的選擇（希望展開哪幾欄）：存在本機，只在使用者操作時更新。
 *   2. 實際顯示：依目前視窗放不放得下 36 個看得見的字決定，放不下就暫時收起。
 *      暫時收起不是使用者收合，不寫進選擇。
 */

import type { SidePanelName, SidePanelsState } from './sidePanels';

/** 本機偏好鍵：只記電腦寬版左右側欄的使用者選擇。不寫進書稿、專案或 .db。 */
export const WIDE_PANELS_STORAGE_KEY = 'wo-w36-wide-panels-v1';

/** 導覽欄寬度（global.css 的 nav-rail） */
export const WIDE_NAV_RAIL_WIDTH = 72;
/** 單一側欄占用：320 寬 + 1px 邊線 */
export const WIDE_SIDE_PANEL_OUTER = 321;
/** 正文左右內距合計（各 40px） */
export const WIDE_EDITOR_PADDING_TOTAL = 80;
/** 正文區塊本身（editor-pane）額外占用的左右空間。目前沒有，量測後若有再填。 */
export const WIDE_EDITOR_PANE_EXTRA = 0;
export const WIDE_CHARS_BASE = 36;
export const WIDE_CHARS_LARGE = 40;
/** 正文基準字級（wide，100% 時 18px） */
export const WIDE_BODY_FONT_PX = 18;
/** 正文字距 */
export const BODY_LETTER_SPACING_PX = 0.5;

const EPSILON = 1e-6;

/** 單字配置寬 q = 字級 + 字距 */
export function bodyCharAdvance(scalePercent: number): number {
  return (WIDE_BODY_FONT_PX * scalePercent) / 100 + BODY_LETTER_SPACING_PX;
}

/** 容納 N 個看得見的字，正文外框（含左右內距）至少要多寬 */
export function wideBodyBoxWidth(chars: number, scalePercent: number): number {
  return chars * bodyCharAdvance(scalePercent) + WIDE_EDITOR_PADDING_TOTAL;
}

/** 視窗寬扣掉導覽欄與指定側欄後，正文外框可得寬度 */
export function wideBodyAvailable(
  viewportWidth: number,
  panels: SidePanelsState,
): number {
  return (
    viewportWidth -
    WIDE_NAV_RAIL_WIDTH -
    (panels.left ? WIDE_SIDE_PANEL_OUTER : 0) -
    (panels.right ? WIDE_SIDE_PANEL_OUTER : 0) -
    WIDE_EDITOR_PANE_EXTRA
  );
}

function fits(viewportWidth: number, panels: SidePanelsState, chars: number, scale: number): boolean {
  return wideBodyAvailable(viewportWidth, panels) + EPSILON >= wideBodyBoxWidth(chars, scale);
}

/**
 * 正文一行字數：以「兩側欄都展開」預留後仍容得下 40 字為準。
 * 不看側欄目前是否收合，所以收合或展開資料集不會讓字數跳動。
 */
export function wideChars(viewportWidth: number, scalePercent: number): 36 | 40 {
  return fits(viewportWidth, { left: true, right: true }, WIDE_CHARS_LARGE, scalePercent)
    ? WIDE_CHARS_LARGE
    : WIDE_CHARS_BASE;
}

/** 正文限寬的 CSS 表示式（與 global.css 等價：N 字內容寬 + 左右內距 80px） */
export function wideEditorMaxWidthCalc(chars: number): string {
  return `calc(${chars} * (1em + 0.5px) + ${WIDE_EDITOR_PADDING_TOTAL}px)`;
}

export interface WideFitInput {
  /** 使用者希望展開的側欄 */
  wanted: SidePanelsState;
  /** 兩側都放不下時，誰先保留（使用者最後手動打開的那一邊，預設左） */
  prefer: SidePanelName;
  viewportWidth: number;
  scalePercent: number;
  /** one-side（1024–1279）一次只開一側 */
  oneSide: boolean;
}

/**
 * 依容量算出實際顯示的側欄：
 * 正文至少要保有 36 個看得見的字。放不下時，先讓「沒被優先」的那側讓位（預設右側資料集先讓），
 * 單側也放不下就全收。
 */
export function fitWidePanels(input: WideFitInput): SidePanelsState {
  const { wanted, prefer, viewportWidth, scalePercent, oneSide } = input;
  const ok = (p: SidePanelsState) => fits(viewportWidth, p, WIDE_CHARS_BASE, scalePercent);
  if (wanted.left && wanted.right) {
    const both = { left: true, right: true };
    if (!oneSide && ok(both)) return both;
    const order: SidePanelName[] = prefer === 'right' ? ['right', 'left'] : ['left', 'right'];
    for (const side of order) {
      const only = { left: side === 'left', right: side === 'right' };
      if (ok(only)) return only;
    }
    return { left: false, right: false };
  }
  if (wanted.left || wanted.right) {
    return ok(wanted) ? { left: wanted.left, right: wanted.right } : { left: false, right: false };
  }
  return { left: false, right: false };
}

/** 沒存過時：左目錄、右資料集都希望展開 */
export const WIDE_PANELS_DEFAULT: SidePanelsState = { left: true, right: true };

/** 只接受 {"left":布林,"right":布林}，其他一律當作沒存過 */
export function parseWidePanels(raw: string | null): SidePanelsState | null {
  if (raw == null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { left, right } = value as Record<string, unknown>;
    if (typeof left !== 'boolean' || typeof right !== 'boolean') return null;
    return { left, right };
  } catch {
    return null;
  }
}

/** 讀本機選擇。讀不到或格式不符就用預設，不中斷操作。 */
export function loadWidePanels(
  store: { getItem(key: string): string | null } | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): SidePanelsState {
  if (!store) return { ...WIDE_PANELS_DEFAULT };
  try {
    return parseWidePanels(store.getItem(WIDE_PANELS_STORAGE_KEY)) ?? { ...WIDE_PANELS_DEFAULT };
  } catch {
    return { ...WIDE_PANELS_DEFAULT };
  }
}

/** 寫入使用者選擇。寫不進去（例如私人瀏覽）就只在這一頁生效。 */
export function saveWidePanels(
  panels: SidePanelsState,
  store: { setItem(key: string, value: string): void } | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): boolean {
  if (!store) return false;
  try {
    store.setItem(WIDE_PANELS_STORAGE_KEY, JSON.stringify({ left: panels.left, right: panels.right }));
    return true;
  } catch {
    return false;
  }
}
