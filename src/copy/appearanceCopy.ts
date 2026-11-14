import type { DeviceKind } from '../layout/inputMode';
import type { PointerMode } from '../layout/layoutMode';

/**
 * 設定頁「外觀」組用字（WO-94，文案第 7 節與規格 G）。
 * 「正文字級」那一列與說明裡指向上面字級的句子，等外觀-3 再加。
 * 現在先不寫那句，避免指到還沒有的開關。
 */

export const APPEARANCE_SECTION = '外觀';

/**
 * 外觀組由上到下。正文字級還沒做，畫面不畫那一列，也不放灰色佔位。
 * 外觀-3 要畫在操作方式上方，就畫這個順序的第一列。
 */
export const APPEARANCE_ROW_ORDER = ['body-font-scale', 'input-mode'] as const;

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

export function inputModeDescription(kind: DeviceKind): string {
  return `依你操作的方式調整列和按鈕的間距。只會套用在${deviceKindPhrase(kind)}。`;
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
