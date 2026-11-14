import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_KIND_STORAGE_KEY,
  INPUT_MODE_STORAGE_KEY,
  commitInputMode,
  ensureInputMode,
  guessInputMode,
  inputModeAfterArrow,
  type DeviceSignals,
  type InputModeStore,
} from './inputMode';

function signals(overrides: Partial<DeviceSignals> = {}): DeviceSignals {
  return {
    hasMatchMedia: true,
    userAgent: '',
    maxTouchPoints: 0,
    anyPointerFine: false,
    hover: false,
    ...overrides,
  };
}

function memoryStore(seed: Record<string, string> = {}): InputModeStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

const YOGA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_TABLET_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ANDROID_PHONE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('WO-94：第一次猜測操作方式（C-2）', () => {
  it('沒有 matchMedia 時猜成這個裝置、用手指點', () => {
    expect(
      guessInputMode(
        signals({
          hasMatchMedia: false,
          userAgent: MAC_UA,
          anyPointerFine: true,
          hover: true,
        }),
      ),
    ).toEqual({ deviceKind: 'unknown', inputMode: 'touch' });
  });

  it('YOGA 7：有觸控螢幕仍猜成電腦、用滑鼠', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: YOGA_UA,
          maxTouchPoints: 10,
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 800,
        }),
      ),
    ).toEqual({ deviceKind: 'computer', inputMode: 'mouse' });
  });

  it('一般筆電與桌機加滑鼠猜成電腦、用滑鼠', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 768,
        }),
      ),
    ).toEqual({ deviceKind: 'computer', inputMode: 'mouse' });
    expect(
      guessInputMode(
        signals({
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 1080,
        }),
      ),
    ).toEqual({ deviceKind: 'computer', inputMode: 'mouse' });
  });

  it('iPhone 猜成手機、用手指點；就算回報細指標也不改', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: IPHONE_UA,
          maxTouchPoints: 5,
          anyPointerFine: false,
          hover: false,
          screenShortEdge: 390,
        }),
      ),
    ).toEqual({ deviceKind: 'phone', inputMode: 'touch' });
    expect(
      guessInputMode(
        signals({
          userAgent: IPHONE_UA,
          anyPointerFine: true,
          hover: false,
          screenShortEdge: 390,
        }),
      ),
    ).toEqual({ deviceKind: 'phone', inputMode: 'touch' });
  });

  it('iPad 單機猜成平板、用手指點；自稱 Mac 但有多點觸控也認得出來', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: IPAD_UA,
          maxTouchPoints: 5,
          anyPointerFine: false,
          hover: false,
          screenShortEdge: 768,
        }),
      ),
    ).toEqual({ deviceKind: 'tablet', inputMode: 'touch' });
    expect(
      guessInputMode(
        signals({
          userAgent: IPAD_AS_MAC_UA,
          maxTouchPoints: 5,
          anyPointerFine: false,
          hover: false,
          screenShortEdge: 834,
        }),
      ),
    ).toEqual({ deviceKind: 'tablet', inputMode: 'touch' });
  });

  it('iPad 接了觸控板猜成平板、用滑鼠；只有鍵盤仍用手指點', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: IPAD_AS_MAC_UA,
          maxTouchPoints: 5,
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 834,
        }),
      ),
    ).toEqual({ deviceKind: 'tablet', inputMode: 'mouse' });
    expect(
      guessInputMode(
        signals({
          userAgent: IPAD_UA,
          maxTouchPoints: 5,
          anyPointerFine: false,
          hover: false,
          screenShortEdge: 1024,
        }),
      ),
    ).toEqual({ deviceKind: 'tablet', inputMode: 'touch' });
  });

  it('Android 平板猜成平板、用手指點；接了滑鼠會猜成用滑鼠', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: ANDROID_TABLET_UA,
          maxTouchPoints: 5,
          anyPointerFine: false,
          hover: false,
          screenShortEdge: 800,
        }),
      ),
    ).toEqual({ deviceKind: 'tablet', inputMode: 'touch' });
    expect(
      guessInputMode(
        signals({
          userAgent: ANDROID_TABLET_UA,
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 800,
        }),
      ),
    ).toEqual({ deviceKind: 'computer', inputMode: 'mouse' });
  });

  it('Android 手機加觸控筆仍猜成手機、用手指點', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: ANDROID_PHONE_UA,
          maxTouchPoints: 1,
          anyPointerFine: true,
          hover: false,
          screenShortEdge: 412,
        }),
      ),
    ).toEqual({ deviceKind: 'phone', inputMode: 'touch' });
  });

  it('Mac 沒有觸控（maxTouchPoints 為 0）猜成電腦、用滑鼠', () => {
    expect(
      guessInputMode(
        signals({
          userAgent: MAC_UA,
          maxTouchPoints: 0,
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 900,
        }),
      ),
    ).toEqual({ deviceKind: 'computer', inputMode: 'mouse' });
  });

  it('用螢幕短邊，不看視窗：有滑過能力時就算短邊小於 600 仍是電腦', () => {
    expect(
      guessInputMode(
        signals({
          anyPointerFine: true,
          hover: true,
          screenShortEdge: 500,
        }),
      ),
    ).toEqual({ deviceKind: 'computer', inputMode: 'mouse' });
  });

  it('沒有細指標、不能滑過、短邊小於 600，猜成手機', () => {
    expect(
      guessInputMode(signals({ screenShortEdge: 390 })),
    ).toEqual({ deviceKind: 'phone', inputMode: 'touch' });
  });
});

describe('WO-94：操作方式存在這個裝置，不跟著條件改', () => {
  const phone = signals({
    userAgent: IPHONE_UA,
    anyPointerFine: false,
    hover: false,
    screenShortEdge: 390,
  });
  const computer = signals({
    userAgent: MAC_UA,
    maxTouchPoints: 0,
    anyPointerFine: true,
    hover: true,
    screenShortEdge: 900,
  });

  it('第一次猜完立刻寫入，之後改條件也不變', () => {
    const store = memoryStore();
    const first = ensureInputMode(store, phone);
    expect(first).toEqual({ deviceKind: 'phone', inputMode: 'touch', guessed: true });
    expect(store.data[INPUT_MODE_STORAGE_KEY]).toBe('touch');
    expect(store.data[DEVICE_KIND_STORAGE_KEY]).toBe('phone');

    const second = ensureInputMode(store, computer);
    expect(second).toEqual({ deviceKind: 'phone', inputMode: 'touch', guessed: false });
    expect(store.data[INPUT_MODE_STORAGE_KEY]).toBe('touch');
    expect(store.data[DEVICE_KIND_STORAGE_KEY]).toBe('phone');
  });

  it('清掉儲存後會依新的條件重新猜一次', () => {
    const store = memoryStore();
    ensureInputMode(store, phone);
    delete store.data[INPUT_MODE_STORAGE_KEY];
    delete store.data[DEVICE_KIND_STORAGE_KEY];
    const again = ensureInputMode(store, computer);
    expect(again).toEqual({ deviceKind: 'computer', inputMode: 'mouse', guessed: true });
  });

  it('讀到不認得的操作方式，就當作沒存過並重新猜', () => {
    const store = memoryStore({
      [INPUT_MODE_STORAGE_KEY]: 'auto',
      [DEVICE_KIND_STORAGE_KEY]: 'phone',
    });
    const result = ensureInputMode(store, computer);
    expect(result).toEqual({ deviceKind: 'computer', inputMode: 'mouse', guessed: true });
    expect(store.data[INPUT_MODE_STORAGE_KEY]).toBe('mouse');
  });

  it('操作方式認得、裝置種類不認得時，不改使用者選過的操作方式', () => {
    const store = memoryStore({
      [INPUT_MODE_STORAGE_KEY]: 'mouse',
      [DEVICE_KIND_STORAGE_KEY]: 'laptop',
    });
    const result = ensureInputMode(store, phone);
    expect(result.inputMode).toBe('mouse');
    expect(result.guessed).toBe(false);
    expect(result.deviceKind).toBe('phone');
    expect(store.data[INPUT_MODE_STORAGE_KEY]).toBe('mouse');
  });

  it('改操作方式只寫 input-mode，不寫字級鍵，也不改裝置種類', () => {
    const store = memoryStore();
    ensureInputMode(store, phone);
    commitInputMode(store, 'mouse');
    expect(store.data[INPUT_MODE_STORAGE_KEY]).toBe('mouse');
    expect(store.data[DEVICE_KIND_STORAGE_KEY]).toBe('phone');
    expect(store.data['jiufang-novel-m.body-font-scale.v1']).toBeUndefined();
    expect(store.data['jiufang-novel-m.ui-font-scale.v1']).toBeUndefined();
    expect(Object.keys(store.data)).toEqual([INPUT_MODE_STORAGE_KEY, DEVICE_KIND_STORAGE_KEY]);
  });

  it('方向鍵在兩格之間切換', () => {
    expect(inputModeAfterArrow('touch', 'ArrowRight')).toBe('mouse');
    expect(inputModeAfterArrow('touch', 'ArrowDown')).toBe('mouse');
    expect(inputModeAfterArrow('mouse', 'ArrowLeft')).toBe('touch');
    expect(inputModeAfterArrow('mouse', 'ArrowUp')).toBe('touch');
    expect(inputModeAfterArrow('touch', 'ArrowLeft')).toBe('mouse');
    expect(inputModeAfterArrow('mouse', 'Enter')).toBeNull();
    expect(inputModeAfterArrow('touch', 'Tab')).toBeNull();
  });

  it('版面監聽不再跟著粗指標即時切換；實體鍵盤仍看精細指標', () => {
    const context = readFileSync(new URL('./layoutContext.tsx', import.meta.url), 'utf8');
    expect(context).not.toContain('(pointer: coarse)');
    expect(context).not.toContain('(any-pointer: coarse)');
    const keyboard = readFileSync(new URL('../editor/useWritingKeyboard.ts', import.meta.url), 'utf8');
    expect(keyboard).toContain('(pointer: fine)');
  });
});
