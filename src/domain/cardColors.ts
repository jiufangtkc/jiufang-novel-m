export const DEFAULT_CARD_COLOR = '#3C3F41';
export const CARD_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * 依據 Qt QColorDialog 標準 48 色演算法產出顏色清單（48 項）：
 * for (int g = 0; g < 4; ++g)
 *   for (int r = 0; r < 4; ++r)
 *     for (int b = 0; b < 3; ++b)
 *       standardRgb[i++] = qRgb(r * 255 / 3, g * 255 / 3, b * 255 / 2);
 */
function buildQtStandard48Colors(): string[] {
  const colors: string[] = [];
  for (let g = 0; g < 4; ++g) {
    for (let r = 0; r < 4; ++r) {
      for (let b = 0; b < 3; ++b) {
        const red = Math.floor((r * 255) / 3)
          .toString(16)
          .padStart(2, '0');
        const green = Math.floor((g * 255) / 3)
          .toString(16)
          .padStart(2, '0');
        const blue = Math.floor((b * 255) / 2)
          .toString(16)
          .padStart(2, '0');
        colors.push(`#${red}${green}${blue}`);
      }
    }
  }
  return colors;
}

export const QT_STANDARD_48_COLORS: readonly string[] = Object.freeze(buildQtStandard48Colors());

const STANDARD_COLORS_SET = new Set<string>(
  QT_STANDARD_48_COLORS.map((c) => c.toLowerCase()),
);

/** 檢查色碼是否符合 #rrggbb 格式（大小寫皆可）。 */
export function isValidCardColor(color: unknown): color is string {
  return typeof color === 'string' && CARD_COLOR_REGEX.test(color);
}

/** 規整化色碼為 #rrggbb 小寫格式；若不符合則回傳 null。 */
export function normalizeHexColor(color: string | null | undefined): string | null {
  if (typeof color !== 'string') return null;
  const trimmed = color.trim();
  if (!CARD_COLOR_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** 檢查是否為卡片預設色（#3C3F41，不分大小寫；空字串或 null/undefined 亦視為預設色）。 */
export function isDefaultCardColor(color: string | null | undefined): boolean {
  if (!color || typeof color !== 'string') return true;
  const trimmed = color.trim();
  if (!trimmed) return true;
  return trimmed.toLowerCase() === DEFAULT_CARD_COLOR.toLowerCase();
}

/**
 * 規整化欲儲存之卡片顏色：
 * - 預設色（#3C3F41，不分大小寫）或空值存成 '#3C3F41'
 * - 其餘合格色碼存成 '#rrggbb' 小寫
 * - 若非合格色碼則回退至 '#3C3F41'
 */
export function formatCardColorForSave(color: string | null | undefined): string {
  if (!color || isDefaultCardColor(color)) {
    return DEFAULT_CARD_COLOR;
  }
  const trimmed = color.trim();
  if (isValidCardColor(trimmed)) {
    return trimmed.toLowerCase();
  }
  return DEFAULT_CARD_COLOR;
}

/** 檢查是否為 Qt 標準 48 色之一。 */
export function isQtStandardColor(color: string): boolean {
  if (!isValidCardColor(color)) return false;
  return STANDARD_COLORS_SET.has(color.toLowerCase());
}

/**
 * 電腦版／寬版／中等／手機橫拿網格：8 欄 6 列。
 * 在 Qt QColorWell 中，第 col 欄（0..7）包含第 col*6 至 col*6+5 個顏色。
 * 橫向每一列包含各欄同 row 之顏色：grid[row][col] = QT_STANDARD_48_COLORS[col * 6 + row]。
 */
export function getDesktopColorGrid(): string[][] {
  const rows = 6;
  const cols = 8;
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowColors: string[] = [];
    for (let c = 0; c < cols; c++) {
      rowColors.push(QT_STANDARD_48_COLORS[c * rows + r]!);
    }
    grid.push(rowColors);
  }
  return grid;
}

/**
 * 手機直拿網格：每排 6 色、共 8 排（電腦一欄＝手機一排）。
 * grid[row][col] = QT_STANDARD_48_COLORS[row * 6 + col]。
 */
export function getPhoneColorGrid(): string[][] {
  const rows = 8;
  const cols = 6;
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowColors: string[] = [];
    for (let c = 0; c < cols; c++) {
      rowColors.push(QT_STANDARD_48_COLORS[r * cols + c]!);
    }
    grid.push(rowColors);
  }
  return grid;
}
