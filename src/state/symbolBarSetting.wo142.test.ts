import { beforeEach, describe, expect, it } from 'vitest';
import {
  readSymbolBarStored,
  resetSymbolBarSession,
  resolveSymbolBarEnabled,
  SYMBOL_BAR_STORAGE_KEY,
  writeSymbolBarSetting,
} from './symbolBarSetting';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    dump: () => Object.fromEntries(data),
  };
}

describe('WO-142 符號列設定', () => {
  beforeEach(() => resetSymbolBarSession());

  it('key 固定為 jiufang-novel-m.symbol-bar.v1', () => {
    expect(SYMBOL_BAR_STORAGE_KEY).toBe('jiufang-novel-m.symbol-bar.v1');
  });

  it('未存過：手指裝置開、滑鼠裝置關', () => {
    const store = fakeStorage();
    const stored = readSymbolBarStored(store);
    expect(stored).toBeNull();
    expect(resolveSymbolBarEnabled(stored, 'touch')).toBe(true);
    expect(resolveSymbolBarEnabled(stored, 'mouse')).toBe(false);
  });

  it('存過就覆蓋預設（兩種裝置都一樣）', () => {
    expect(resolveSymbolBarEnabled(true, 'mouse')).toBe(true);
    expect(resolveSymbolBarEnabled(false, 'touch')).toBe(false);
    expect(readSymbolBarStored(fakeStorage({ [SYMBOL_BAR_STORAGE_KEY]: '1' }))).toBe(true);
    expect(readSymbolBarStored(fakeStorage({ [SYMBOL_BAR_STORAGE_KEY]: '0' }))).toBe(false);
  });

  it('壞值或讀取出錯都當作沒存過', () => {
    expect(readSymbolBarStored(fakeStorage({ [SYMBOL_BAR_STORAGE_KEY]: 'yes' }))).toBeNull();
    expect(readSymbolBarStored(fakeStorage({ [SYMBOL_BAR_STORAGE_KEY]: '' }))).toBeNull();
    expect(
      readSymbolBarStored({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBeNull();
    expect(readSymbolBarStored(null)).toBeNull();
  });

  it('寫入存成 1／0，並通知監聽者；存不進去也不會丟錯', () => {
    const store = fakeStorage();
    writeSymbolBarSetting(true, store);
    expect(store.dump()[SYMBOL_BAR_STORAGE_KEY]).toBe('1');
    writeSymbolBarSetting(false, store);
    expect(store.dump()[SYMBOL_BAR_STORAGE_KEY]).toBe('0');
    expect(() =>
      writeSymbolBarSetting(true, {
        getItem: () => null,
        setItem: () => {
          throw new Error('full');
        },
      }),
    ).not.toThrow();
  });
});
