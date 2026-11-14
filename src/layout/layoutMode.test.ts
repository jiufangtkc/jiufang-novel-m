import { describe, expect, it } from 'vitest';
import { getLayoutMode, getWideColumns, resolveLayoutMode } from './layoutMode';

describe('WO-54：版面判斷純函式', () => {
  it('WO-54：手機橫拿（寬 > 高 且 高 < 500）', () => {
    // 標準手機橫拿
    const result = resolveLayoutMode(844, 390);
    expect(result.mode).toBe('phone-landscape');
    expect(result.wideColumns).toBeNull();

    // 寬版但高極矮（例如視窗拉成寬扁）
    expect(getLayoutMode(1200, 400)).toBe('phone-landscape');
  });

  it('WO-54：手機直拿（未達橫拿條件且寬 < 600）', () => {
    const result = resolveLayoutMode(390, 844);
    expect(result.mode).toBe('phone-portrait');
    expect(result.wideColumns).toBeNull();
  });

  it('WO-54：中等版面（600 ≤ 寬 ≤ 1023 且非手機橫拿）', () => {
    // 平板直拿標準尺寸
    const result = resolveLayoutMode(820, 1180);
    expect(result.mode).toBe('medium');
    expect(result.wideColumns).toBeNull();
  });

  it('WO-54：寬版 one-side（1024 ≤ 寬 ≤ 1279）', () => {
    // 平板橫拿標準尺寸
    const result = resolveLayoutMode(1180, 820);
    expect(result.mode).toBe('wide');
    expect(result.wideColumns).toBe('one-side');
    expect(getWideColumns(1180)).toBe('one-side');
  });

  it('WO-54：寬版 both（寬 ≥ 1280）', () => {
    // 電腦桌面標準尺寸
    const result = resolveLayoutMode(1440, 900);
    expect(result.mode).toBe('wide');
    expect(result.wideColumns).toBe('both');
    expect(getWideColumns(1440)).toBe('both');
  });

  describe('WO-54：邊界值驗證', () => {
    it('WO-54：499／500 高度邊界（手機橫拿判定門檻）', () => {
      // 寬 > 高：高 499 為手機橫拿
      expect(resolveLayoutMode(600, 499)).toEqual({
        mode: 'phone-landscape',
        wideColumns: null,
      });

      // 寬 > 高：高 500 則不符合高 < 500，依寬度 600 落入 medium
      expect(resolveLayoutMode(600, 500)).toEqual({
        mode: 'medium',
        wideColumns: null,
      });

      // 寬 550 高 499 為手機橫拿
      expect(resolveLayoutMode(550, 499)).toEqual({
        mode: 'phone-landscape',
        wideColumns: null,
      });

      // 寬 550 高 500 為手機直拿（寬 < 600）
      expect(resolveLayoutMode(550, 500)).toEqual({
        mode: 'phone-portrait',
        wideColumns: null,
      });
    });

    it('WO-54：599／600 寬度邊界（直拿與中等分界）', () => {
      // 高度充足，寬 599 為手機直拿
      expect(resolveLayoutMode(599, 800)).toEqual({
        mode: 'phone-portrait',
        wideColumns: null,
      });

      // 寬 600 為中等版面
      expect(resolveLayoutMode(600, 800)).toEqual({
        mode: 'medium',
        wideColumns: null,
      });
    });

    it('WO-54：1023／1024 寬度邊界（中等與寬版分界）', () => {
      // 寬 1023 為中等版面
      expect(resolveLayoutMode(1023, 768)).toEqual({
        mode: 'medium',
        wideColumns: null,
      });

      // 寬 1024 為寬版（one-side）
      expect(resolveLayoutMode(1024, 768)).toEqual({
        mode: 'wide',
        wideColumns: 'one-side',
      });
    });

    it('WO-54：1279／1280 寬度邊界（寬版 one-side 與 both 分界）', () => {
      // 寬 1279 為 one-side
      expect(resolveLayoutMode(1279, 800)).toEqual({
        mode: 'wide',
        wideColumns: 'one-side',
      });

      // 寬 1280 為 both
      expect(resolveLayoutMode(1280, 800)).toEqual({
        mode: 'wide',
        wideColumns: 'both',
      });
    });

    it('WO-54：寬高相等之狀況（寬 > 高 不成立，不可誤判為手機橫拿）', () => {
      // 400x400：寬不小於高（相等），非橫拿；寬 400 < 600 → phone-portrait
      expect(resolveLayoutMode(400, 400)).toEqual({
        mode: 'phone-portrait',
        wideColumns: null,
      });

      // 500x500：寬不小於高（相等），非橫拿；寬 500 < 600 → phone-portrait
      expect(resolveLayoutMode(500, 500)).toEqual({
        mode: 'phone-portrait',
        wideColumns: null,
      });

      // 600x600：寬 600 → medium
      expect(resolveLayoutMode(600, 600)).toEqual({
        mode: 'medium',
        wideColumns: null,
      });

      // 1024x1024：寬 1024 → wide (one-side)
      expect(resolveLayoutMode(1024, 1024)).toEqual({
        mode: 'wide',
        wideColumns: 'one-side',
      });

      // 1280x1280：寬 1280 → wide (both)
      expect(resolveLayoutMode(1280, 1280)).toEqual({
        mode: 'wide',
        wideColumns: 'both',
      });
    });
  });

  describe('WO-54：手機打字鍵盤彈出視窗高度縮短情境', () => {
    it('WO-54：直拿手機鍵盤彈出時，高度縮短但寬 < 高，不可誤判為橫拿', () => {
      // 原始手機直拿 390x844
      expect(resolveLayoutMode(390, 844).mode).toBe('phone-portrait');

      // 鍵盤彈出後視窗變矮（例如剩下 500 或 450）
      // 390 < 500，非橫拿，維持直拿
      expect(resolveLayoutMode(390, 500).mode).toBe('phone-portrait');
      expect(resolveLayoutMode(390, 450).mode).toBe('phone-portrait');
      expect(resolveLayoutMode(390, 400).mode).toBe('phone-portrait');
    });

    it('WO-54：橫拿手機鍵盤彈出與候選列變動時（844×390 → 844×180 → 844×200），維持 phone-landscape', () => {
      // 原始手機橫拿 844x390
      const r1 = resolveLayoutMode(844, 390);
      expect(r1.mode).toBe('phone-landscape');

      // 鍵盤彈出後可視高度剩 180
      const r2 = resolveLayoutMode(844, 180, { width: 844, height: 390, mode: r1.mode });
      expect(r2.mode).toBe('phone-landscape');

      // 注音候選列微調高度變 200
      const r3 = resolveLayoutMode(844, 200, { width: 844, height: 180, mode: r2.mode });
      expect(r3.mode).toBe('phone-landscape');
    });

    it('WO-54：先前為 phone-portrait 且寬度沒變時，不論高度變高或變矮一律維持 phone-portrait（375×667 → 375×327 → 375×340 → 375×300 → 375×667 全程直拿）', () => {
      // 1. 直拿初始狀態 375×667
      const s1 = resolveLayoutMode(375, 667);
      expect(s1.mode).toBe('phone-portrait');

      // 2. 鍵盤彈出 375×327（高度大幅變矮）
      const s2 = resolveLayoutMode(375, 327, { width: 375, height: 667, mode: s1.mode });
      expect(s2.mode).toBe('phone-portrait');
      expect(getLayoutMode(375, 327, { width: 375, height: 667, mode: s1.mode })).toBe('phone-portrait');

      // 3. 注音候選列收起變 375×340（高度相較上一步變高，但寬度沒變，維持直拿）
      const s3 = resolveLayoutMode(375, 340, { width: 375, height: 327, mode: s2.mode });
      expect(s3.mode).toBe('phone-portrait');
      expect(getLayoutMode(375, 340, { width: 375, height: 327, mode: s2.mode })).toBe('phone-portrait');

      // 4. 更多候選字或工具列展開變 375×300（高度又變矮，寬度沒變，維持直拿）
      const s4 = resolveLayoutMode(375, 300, { width: 375, height: 340, mode: s3.mode });
      expect(s4.mode).toBe('phone-portrait');

      // 5. 鍵盤完全收起恢復 375×667（全程直拿）
      const s5 = resolveLayoutMode(375, 667, { width: 375, height: 300, mode: s4.mode });
      expect(s5.mode).toBe('phone-portrait');

      // 6. 真正轉向：375×667 → 667×375（寬度改變，重新判斷為橫拿）
      const rotate = resolveLayoutMode(667, 375, { width: 375, height: 667, mode: s1.mode });
      expect(rotate.mode).toBe('phone-landscape');
      expect(getLayoutMode(667, 375, { width: 375, height: 667, mode: s1.mode })).toBe('phone-landscape');
    });
  });

});

// WO-54 原本三條斷言：coarse → touch、空物件 → mouse、any-pointer coarse → touch。
// 九方 11/14 定案改成只猜一次，而且有沒有觸控不再當依據（可觸控筆電要猜成用滑鼠）。
// 那三條與這項定案衝突，改由 inputMode.test.ts 的 C-2 案例覆蓋。
