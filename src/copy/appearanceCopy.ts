import type { ThemeId } from '../layout/deviceTheme';
import type { DeviceKind } from '../layout/inputMode';
import type { PointerMode } from '../layout/layoutMode';

/**
 * 設定頁「外觀」組用字（WO-94、WO-96、WO-101）。
 * WO-101：外觀組三列（主題、正文字級、操作方式）的「只會套用在……」一律寫「這個裝置」，
 * 不再依裝置換字。deviceKindPhrase 保留給其他需要依裝置換字的地方，外觀組不用。
 */

export const APPEARANCE_SECTION = '外觀';

/** 外觀組由上到下：主題、正文字級、操作方式。介面字級還沒做，不畫、也不放灰色佔位。 */
export const APPEARANCE_ROW_ORDER = ['theme', 'body-font-scale', 'input-mode'] as const;

/* ---------- 主題（WO-101，九方 2026-11-16 定稿） ---------- */

export const THEME_TITLE = '主題';
export const THEME_DESCRIPTION =
  '換整個 App 的顏色。每一套的正文欄都跟四周不同色，一看就知道哪裡可以打字。只會套用在這個裝置。';
/** 朗讀：主題選項群組名。 */
export const THEME_GROUP_ARIA = '主題，只會套用在這個裝置';

/** 名稱。「（預設）」是全形括號，不論有沒有選取都一直顯示。 */
export const THEME_NAMES: Record<ThemeId, string> = {
  forest: '森林綠（預設）',
  celadon: '青瓷',
  classic: '經典深藍',
};

/** 選項小字：不加句號、20 字內。 */
export const THEME_CAPTIONS: Record<ThemeId, string> = {
  forest: '深墨綠四周、森林綠正文欄、淺青綠按鈕',
  celadon: '深藍青四周、天青正文欄、淺天青按鈕',
  classic: '深灰四周、深藍正文欄、亮藍按鈕',
};

/** 朗讀：各選項。選取狀態由 radio 自己念，不在這裡寫「已選取」或第幾項。 */
export const THEME_OPTION_ARIA: Record<ThemeId, string> = {
  forest: '森林綠，預設主題。深墨綠四周、森林綠正文欄、淺青綠按鈕。選了馬上換成這套顏色',
  celadon: '青瓷主題。深藍青四周、天青正文欄、淺天青按鈕。選了馬上換成這套顏色',
  classic: '經典深藍主題。深灰四周、深藍正文欄、亮藍按鈕。選了馬上換成這套顏色',
};

/** 換完主題後只朗讀、畫面不出提示。 */
export const THEME_CHANGED_ANNOUNCE: Record<ThemeId, string> = {
  forest: '已換成森林綠主題',
  celadon: '已換成青瓷主題',
  classic: '已換成經典深藍主題',
};

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

/** WO-101：外觀組統一寫「這個裝置」，不依裝置換字。 */
export const BODY_FONT_SCALE_DESCRIPTION = '調整寫作時正文的字有多大。只會套用在這個裝置。';

/** WO-101：外觀組統一寫「這個裝置」，不依裝置換字。 */
export const INPUT_MODE_DESCRIPTION =
  '依你操作的方式調整列和按鈕的間距。要調正文的字有多大，請用上面的「正文字級」。只會套用在這個裝置。';

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
