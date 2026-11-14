import type { DeviceKind } from '../layout/inputMode';
import type { PointerMode } from '../layout/layoutMode';

/**
 * 設定頁「外觀」組用字（WO-94、WO-96）。
 * 裝置稱呼跟操作方式同一套：手機「這支手機」、電腦「這台電腦」、
 * 平板「這台平板」、分不出來「這個裝置」。不另寫一套。
 */

export const APPEARANCE_SECTION = '外觀';

/** 外觀組由上到下。介面字級還沒做，不畫、也不放灰色佔位。 */
export const APPEARANCE_ROW_ORDER = ['body-font-scale', 'input-mode'] as const;

export const BODY_FONT_SCALE_TITLE = '正文字級';
export const BODY_FONT_DECREASE = 'A−';
export const BODY_FONT_INCREASE = 'A＋';
export const BODY_FONT_DECREASE_ARIA = '縮小正文字級';
export const BODY_FONT_INCREASE_ARIA = '放大正文字級';
export const BODY_FONT_PREVIEW = '月台上的狐狸';

export const INPUT_MODE_TITLE = '操作方式';
export const INPUT_MODE_TOUCH = '用手指點';
export const INPUT_MODE_MOUSE = '用滑鼠';
export const INPUT_MODE_TOUCH_CAPTION = '列和按鈕比較寬，好點中';
export const INPUT_MODE_MOUSE_CAPTION = '列和按鈕比較窄，一個畫面看得到比較多';

const TOUCH_ARIA_HINT = '列和按鈕比較寬';
const MOUSE_ARIA_HINT = '列和按鈕比較窄';

export function deviceKindPhrase(kind: DeviceKind): string {
  if (kind === 'phone') return '這支手機';
  if (kind === 'computer') return '這台電腦';
  if (kind === 'tablet') return '這台平板';
  return '這個裝置';
}

export function bodyFontScaleDescription(kind: DeviceKind): string {
  return `調整寫作時正文的字有多大。只會套用在${deviceKindPhrase(kind)}。`;
}

export function inputModeDescription(kind: DeviceKind): string {
  return `依你操作的方式調整列和按鈕的間距。要調正文的字有多大，請用上面的「正文字級」。只會套用在${deviceKindPhrase(kind)}。`;
}

export function inputModeName(mode: PointerMode): string {
  return mode === 'mouse' ? INPUT_MODE_MOUSE : INPUT_MODE_TOUCH;
}

export function inputModeCaption(mode: PointerMode): string {
  return mode === 'mouse' ? INPUT_MODE_MOUSE_CAPTION : INPUT_MODE_TOUCH_CAPTION;
}

/** 朗讀：操作方式，目前是用滑鼠。 */
export function inputModeGroupAria(mode: PointerMode): string {
  return `${INPUT_MODE_TITLE}，目前是${inputModeName(mode)}`;
}

/** 朗讀選項。已選取與尚未選取的句子不同。 */
export function inputModeOptionAria(mode: PointerMode, selected: boolean): string {
  const name = inputModeName(mode);
  const hint = mode === 'mouse' ? MOUSE_ARIA_HINT : TOUCH_ARIA_HINT;
  if (selected) return `${name}，已選取，${hint}`;
  return `${name}，${hint}，點兩下改成這個`;
}
