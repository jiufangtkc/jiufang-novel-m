/**
 * 版面判斷純函式與型別定義（WO-54）
 *
 * 判斷規則（只看視窗寬高，不看機型）：
 * 1. 寬 > 高且高 < 500 → phone-landscape（手機橫拿）
 * 2. 否則寬 < 600 → phone-portrait（手機直拿）
 * 3. 600 ≤ 寬 ≤ 1023 → medium（中等）
 * 4. 寬 ≥ 1024 → wide（寬版）
 *    - 1024 ≤ 寬 ≤ 1279 為 one-side（左右側欄一次只開一邊）
 *    - 寬 ≥ 1280 為 both（三欄可全開）
 */

export type LayoutMode = 'phone-portrait' | 'phone-landscape' | 'medium' | 'wide';
export type WideColumns = 'one-side' | 'both';
export type PointerMode = 'touch' | 'mouse';

export interface LayoutResolution {
  mode: LayoutMode;
  wideColumns: WideColumns | null;
}

export interface PreviousLayoutContext {
  width?: number;
  height?: number;
  mode?: LayoutMode;
}

/** 寬版單側開啟上限（1024–1279） */
export const WIDE_ONE_SIDE_MIN = 1024;
export const WIDE_BOTH_MIN = 1280;
export const MEDIUM_MIN_WIDTH = 600;
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

/**
 * 依據寬高計算版面模式與寬版欄位模式
 *
 * 包含 Android Chrome 鍵盤彈出防誤判規則：
 * 若先前是 phone-portrait 且寬度沒變時，一律維持 phone-portrait（不論高度變高或變矮，例如直持打字時鍵盤與候選字列彈出收合）；
 * 寬度改變（真正轉向螢幕）才重新判斷。
 */
export function resolveLayoutMode(
  width: number,
  height: number,
  previous?: PreviousLayoutContext,
): LayoutResolution {
  // 檢查 Android Chrome 鍵盤彈出防誤判規則：
  // 先前是 phone-portrait 且寬度沒變時，一律維持 phone-portrait（不論高度變高或變矮）
  const isWidthUnchangedFromPortrait =
    previous?.mode === 'phone-portrait' &&
    previous.width !== undefined &&
    width === previous.width;

  // 寬 > 高且高 < 500 → 手機橫拿（但在直拿打字寬度未變情境下一律維持 phone-portrait）
  if (width > height && height < PHONE_LANDSCAPE_MAX_HEIGHT) {
    if (isWidthUnchangedFromPortrait) {
      return {
        mode: 'phone-portrait',
        wideColumns: null,
      };
    }
    return {
      mode: 'phone-landscape',
      wideColumns: null,
    };
  }

  // 否則寬 < 600 → 手機直拿
  if (width < MEDIUM_MIN_WIDTH) {
    return {
      mode: 'phone-portrait',
      wideColumns: null,
    };
  }

  // 600 ≤ 寬 ≤ 1023 → 中等
  if (width < WIDE_ONE_SIDE_MIN) {
    return {
      mode: 'medium',
      wideColumns: null,
    };
  }

  // 寬 ≥ 1024 → 寬版
  return {
    mode: 'wide',
    wideColumns: width >= WIDE_BOTH_MIN ? 'both' : 'one-side',
  };
}

/**
 * 取得版面模式
 */
export function getLayoutMode(
  width: number,
  height: number,
  previous?: PreviousLayoutContext,
): LayoutMode {
  return resolveLayoutMode(width, height, previous).mode;
}

/**
 * 取得寬版欄位模式（非寬版時為 null）
 */
export function getWideColumns(width: number): WideColumns | null {
  if (width < WIDE_ONE_SIDE_MIN) return null;
  return width >= WIDE_BOTH_MIN ? 'both' : 'one-side';
}

/**
 * 指標判斷（純函式）
 * 依 (pointer: coarse) 或 (any-pointer: coarse) 判斷：
 * 只要任一指標為粗略（觸控螢幕、觸控筆、具備觸控能力的筆電／平板），即判定為 touch；
 * 純滑鼠（無粗略指標）判定為 mouse。
 */
export function resolvePointerMode(input: {
  pointerCoarse?: boolean;
  anyPointerCoarse?: boolean;
}): PointerMode {
  if (Boolean(input.pointerCoarse || input.anyPointerCoarse)) {
    return 'touch';
  }
  return 'mouse';
}

/**
 * 各版面正文限寬用字數設定（WO-55）
 * 手機直拿 N=19、手機橫拿與中等 N=30、寬版 N=36
 */
export const LAYOUT_EDITOR_LIMITS: Record<
  LayoutMode,
  { chars: number; padding: number; fontSize: number }
> = {
  'phone-portrait': { chars: 19, padding: 16, fontSize: 18 },
  'phone-landscape': { chars: 30, padding: 16, fontSize: 18 },
  medium: { chars: 30, padding: 40, fontSize: 20 },
  wide: { chars: 36, padding: 40, fontSize: 18 },
};

/**
 * 依字數 N 產生正文限寬 CSS calc 表示式
 * 公式：max-width: calc(N * (1em + 0.5px))
 */
export function getEditorMaxWidthCalc(n: number): string {
  return `calc(${n} * (1em + 0.5px))`;
}

