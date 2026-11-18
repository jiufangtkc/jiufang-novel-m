import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARD_COLOR,
  formatCardColorForSave,
  getDesktopColorGrid,
  getPhoneColorGrid,
  isDefaultCardColor,
  isQtStandardColor,
  isValidCardColor,
  normalizeHexColor,
  QT_STANDARD_48_COLORS,
} from './cardColors';

describe('WO-61 卡片顏色標準 48 色與排版網格（cardColors）', () => {
  it('WO-61：Qt 標準基本色清單共 48 色，首色為 #000000、末色為 #ffffff', () => {
    expect(QT_STANDARD_48_COLORS).toHaveLength(48);
    expect(QT_STANDARD_48_COLORS[0]).toBe('#000000');
    expect(QT_STANDARD_48_COLORS[47]).toBe('#ffffff');
    expect(DEFAULT_CARD_COLOR).toBe('#3C3F41');

    // 每一項皆符合 #rrggbb 格式
    for (const color of QT_STANDARD_48_COLORS) {
      expect(isValidCardColor(color)).toBe(true);
      expect(isQtStandardColor(color)).toBe(true);
    }
  });

  it('WO-61：電腦版／寬版／中等／手機橫拿為 8 欄 6 列網格', () => {
    const desktopGrid = getDesktopColorGrid();
    expect(desktopGrid).toHaveLength(6); // 6 列
    for (const row of desktopGrid) {
      expect(row).toHaveLength(8); // 8 欄
    }

    // 第一列包含各欄第 0 個顏色
    expect(desktopGrid[0]![0]).toBe('#000000');
    expect(desktopGrid[0]![1]).toBe('#aa0000');
    expect(desktopGrid[0]![2]).toBe('#005500');
    expect(desktopGrid[0]![3]).toBe('#aa5500');
    expect(desktopGrid[0]![4]).toBe('#00aa00');
    expect(desktopGrid[0]![5]).toBe('#aaaa00');
    expect(desktopGrid[0]![6]).toBe('#00ff00');
    expect(desktopGrid[0]![7]).toBe('#aaff00');
  });

  it('WO-61：手機直拿為每排 6 色、共 8 排（電腦一欄＝手機一排）', () => {
    const phoneGrid = getPhoneColorGrid();
    expect(phoneGrid).toHaveLength(8); // 8 排
    for (const row of phoneGrid) {
      expect(row).toHaveLength(6); // 每排 6 色
    }

    // 第一排即為電腦版第 0 欄的 6 個顏色
    expect(phoneGrid[0]).toEqual([
      '#000000',
      '#00007f',
      '#0000ff',
      '#550000',
      '#55007f',
      '#5500ff',
    ]);
    // 第 8 排即為電腦版第 7 欄的 6 個顏色
    expect(phoneGrid[7]).toEqual([
      '#aaff00',
      '#aaff7f',
      '#aaffff',
      '#ffff00',
      '#ffff7f',
      '#ffffff',
    ]);
  });

  it('WO-61：色碼格式驗證與規整化', () => {
    expect(isValidCardColor('#3C3F41')).toBe(true);
    expect(isValidCardColor('#ffaa00')).toBe(true);
    expect(isValidCardColor('#FFAA00')).toBe(true);
    expect(isValidCardColor('#123')).toBe(false);
    expect(isValidCardColor('red')).toBe(false);
    expect(isValidCardColor('')).toBe(false);
    expect(isValidCardColor(null)).toBe(false);

    expect(normalizeHexColor('#3C3F41')).toBe('#3c3f41');
    expect(normalizeHexColor(' #ffaa00 ')).toBe('#ffaa00');
    expect(normalizeHexColor('invalid')).toBeNull();

    // 預設色不是 48 色之一
    expect(isQtStandardColor(DEFAULT_CARD_COLOR)).toBe(false);
  });

  it('WO-61：色票存檔規範：「預設（不加色）」存 #3C3F41，其餘存 #rrggbb', () => {
    // 預設色與空值存為 #3C3F41
    expect(formatCardColorForSave(DEFAULT_CARD_COLOR)).toBe('#3C3F41');
    expect(formatCardColorForSave('#3c3f41')).toBe('#3C3F41');
    expect(formatCardColorForSave('')).toBe('#3C3F41');
    expect(formatCardColorForSave(null)).toBe('#3C3F41');
    expect(formatCardColorForSave(undefined)).toBe('#3C3F41');

    // 選色後存為小寫 #rrggbb
    expect(formatCardColorForSave('#FFAA00')).toBe('#ffaa00');
    expect(formatCardColorForSave('#0055ff')).toBe('#0055ff');

    // 不合格色碼回退至 #3C3F41
    expect(formatCardColorForSave('invalid-color')).toBe('#3C3F41');
    expect(formatCardColorForSave('#123')).toBe('#3C3F41');
  });

  it('WO-61：不在 48 色中的既有顏色能識別並保留，不被強制轉為預設色', () => {
    // 例如電腦版自訂色 #1a2b4c、#7f8c8d
    const customColor = '#1a2b4c';
    expect(isValidCardColor(customColor)).toBe(true);
    expect(isQtStandardColor(customColor)).toBe(false);
    expect(isDefaultCardColor(customColor)).toBe(false);

    // 存檔時保留該自訂色，不被改掉
    expect(formatCardColorForSave(customColor)).toBe('#1a2b4c');
    expect(formatCardColorForSave('#1A2B4C')).toBe('#1a2b4c');
  });
});
