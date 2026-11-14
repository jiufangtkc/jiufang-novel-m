import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BODY_FONT_SCALE_DEFAULT,
  BODY_FONT_SCALE_STEPS,
  BODY_FONT_SCALE_STORAGE_KEY,
  bodyFontScaleAfterArrow,
  bodyFontScaleAria,
  bodyFontScaleLabel,
  bodyPreviewFontPx,
  commitBodyFontScale,
  nextCaretScrollTop,
  parseBodyFontScale,
  readBodyFontPercent,
  readBodyFontScale,
  shouldRestoreCaretLine,
  stepBodyFontScale,
} from './bodyFontScale';

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe('WO-96：正文字級檔位與本機儲存', () => {
  it('九個檔位，預設 100', () => {
    expect(BODY_FONT_SCALE_STEPS).toEqual([90, 100, 110, 120, 130, 140, 150, 175, 200]);
    expect(BODY_FONT_SCALE_DEFAULT).toBe(100);
  });

  it('按鈕一下跳一檔，90 不能再小，200 不能再大', () => {
    expect(stepBodyFontScale(100, 1)).toBe(110);
    expect(stepBodyFontScale(100, -1)).toBe(90);
    expect(stepBodyFontScale(150, 1)).toBe(175);
    expect(stepBodyFontScale(175, -1)).toBe(150);
    expect(stepBodyFontScale(175, 1)).toBe(200);
    expect(stepBodyFontScale(90, -1)).toBe(90);
    expect(stepBodyFontScale(200, 1)).toBe(200);
    expect(stepBodyFontScale(115, 1)).toBe(110);
  });

  it('方向鍵上與右加一檔，下與左減一檔，到頭與其他鍵不動', () => {
    expect(bodyFontScaleAfterArrow(120, 'ArrowUp')).toBe(130);
    expect(bodyFontScaleAfterArrow(120, 'ArrowRight')).toBe(130);
    expect(bodyFontScaleAfterArrow(120, 'ArrowDown')).toBe(110);
    expect(bodyFontScaleAfterArrow(120, 'ArrowLeft')).toBe(110);
    expect(bodyFontScaleAfterArrow(90, 'ArrowDown')).toBeNull();
    expect(bodyFontScaleAfterArrow(200, 'ArrowUp')).toBeNull();
    expect(bodyFontScaleAfterArrow(100, 'Enter')).toBeNull();
    expect(bodyFontScaleAfterArrow(100, 'Tab')).toBeNull();
  });

  it('沒存過或不認得就用 100，存檔只寫整數百分比', () => {
    const store = memoryStore({ 'jiufang-novel-m.ui-font-scale.v1': '140' });
    expect(readBodyFontScale(store)).toBe(100);
    expect(parseBodyFontScale(null)).toBeNull();
    expect(parseBodyFontScale('80')).toBeNull();
    expect(parseBodyFontScale('120%')).toBeNull();
    expect(parseBodyFontScale('120.0')).toBeNull();
    expect(parseBodyFontScale(' 175 ')).toBe(175);
    commitBodyFontScale(store, 120);
    expect(store.data[BODY_FONT_SCALE_STORAGE_KEY]).toBe('120');
    expect(store.data['jiufang-novel-m.ui-font-scale.v1']).toBe('140');
    expect(readBodyFontScale(store)).toBe(120);
    commitBodyFontScale(store, 80);
    expect(store.data[BODY_FONT_SCALE_STORAGE_KEY]).toBe('120');
    expect(Object.keys(store.data).sort()).toEqual([
      BODY_FONT_SCALE_STORAGE_KEY,
      'jiufang-novel-m.ui-font-scale.v1',
    ]);
  });

  it('不讀也不寫 .db 的 editor_font_size，程式裡沒有去改那個欄位', () => {
    const source = readFileSync(new URL('./bodyFontScale.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('editor_font_size');
    expect(source).not.toContain('ui-font-scale');
    expect(source).not.toContain('projectFile');
  });
});

describe('WO-96：正文字級用字與朗讀', () => {
  it('畫面上 100% 寫標準，其餘只寫百分比', () => {
    expect(bodyFontScaleLabel(90)).toBe('90%');
    expect(bodyFontScaleLabel(100)).toBe('100%（標準）');
    expect(bodyFontScaleLabel(120)).toBe('120%');
    expect(bodyFontScaleLabel(175)).toBe('175%');
    expect(bodyFontScaleLabel(200)).toBe('200%');
  });

  it('朗讀念出每一檔，100% 多念標準大小', () => {
    expect(readBodyFontPercent(90)).toBe('百分之九十');
    expect(readBodyFontPercent(110)).toBe('百分之一百一十');
    expect(readBodyFontPercent(120)).toBe('百分之一百二十');
    expect(readBodyFontPercent(130)).toBe('百分之一百三十');
    expect(readBodyFontPercent(140)).toBe('百分之一百四十');
    expect(readBodyFontPercent(150)).toBe('百分之一百五十');
    expect(readBodyFontPercent(175)).toBe('百分之一百七十五');
    expect(readBodyFontPercent(200)).toBe('百分之二百');
    expect(bodyFontScaleAria(120)).toBe('正文字級，目前是百分之一百二十，上下滑動可以調整');
    expect(bodyFontScaleAria(100)).toBe('正文字級，目前是百分之一百，標準大小，上下滑動可以調整');
    expect(bodyFontScaleAria(90)).toBe('正文字級，目前是百分之九十，上下滑動可以調整');
    expect(bodyFontScaleAria(200)).toBe('正文字級，目前是百分之二百，上下滑動可以調整');
  });

  it('預覽字級乘在各版面的基準上', () => {
    expect(bodyPreviewFontPx('phone-portrait', 100)).toBe(18);
    expect(bodyPreviewFontPx('phone-landscape', 100)).toBe(18);
    expect(bodyPreviewFontPx('medium', 100)).toBe(20);
    expect(bodyPreviewFontPx('wide', 100)).toBe(18);
    expect(bodyPreviewFontPx('phone-portrait', 90)).toBe(16.2);
    expect(bodyPreviewFontPx('phone-portrait', 200)).toBe(36);
    expect(bodyPreviewFontPx('medium', 200)).toBe(40);
    expect(bodyPreviewFontPx('wide', 120)).toBe(21.6);
  });
});

describe('WO-96：改字級後游標那一行留在原來的高度', () => {
  it('以游標那一行為錨點重算捲動，不會捲回開頭', () => {
    expect(nextCaretScrollTop(400, 0.5, 200, 2000)).toBe(300);
    expect(nextCaretScrollTop(40, 0.25, 200, 2000)).toBe(0);
    expect(nextCaretScrollTop(1800, 0.2, 200, 1900)).toBe(1700);
    expect(nextCaretScrollTop(10, 0, 0, 100)).toBe(0);
  });

  it('字級沒變，或游標已經換地方，就不要重捲', () => {
    expect(shouldRestoreCaretLine(null, 120, 40)).toBe(false);
    expect(shouldRestoreCaretLine({ selection: 40, scale: 100 }, 100, 40)).toBe(false);
    expect(shouldRestoreCaretLine({ selection: 40, scale: 100 }, 120, 40)).toBe(true);
    expect(shouldRestoreCaretLine({ selection: 40, scale: 100 }, 120, 0)).toBe(false);
  });

  it('游標量測會複製字級，字變大之後用新的字級重量', () => {
    const caret = readFileSync(new URL('../editor/caret.ts', import.meta.url), 'utf8');
    expect(caret).toContain("'fontSize'");
  });
});
