import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_RECOVER_TOLERANCE_PX,
  decideWritingUpdate,
  isDeviceLandscape,
  keyboardShrinkThreshold,
  type WritingUpdateInput,
  nextKeyboardHeightState,
  shouldUseCompactWritingLayout,
  usesKeyboardHeightTracking,
  visibleViewportHeight,
  type KeyboardHeightState,
} from './useWritingKeyboard';

/** 依 hook 的組合方式算 compact：高度狀態為 recovered 就退出，其餘沿用聚焦／失焦判斷。 */
function compactOf(state: KeyboardHeightState | null, focused: boolean): boolean {
  return (
    state?.phase !== 'recovered' &&
    shouldUseCompactWritingLayout({ focused, pointerFine: false, viewportWidth: 390 })
  );
}

/** 先未聚焦量到基準，再聚焦依序送入高度，回傳每一步的 compact 與最後狀態。 */
function run(baseline: number, heights: number[]) {
  let state = nextKeyboardHeightState(null, { focused: false, height: baseline });
  const compacts: boolean[] = [];
  const phases: Array<string | undefined> = [];
  for (const height of heights) {
    state = nextKeyboardHeightState(state, { focused: true, height });
    compacts.push(compactOf(state, true));
    phases.push(state?.phase);
  }
  return { state, compacts, phases };
}

describe('WO-118 高度門檻', () => {
  it('縮小門檻為 max(150, H×20%)', () => {
    expect(keyboardShrinkThreshold(800)).toBe(160);
    expect(keyboardShrinkThreshold(600)).toBe(150);
    expect(keyboardShrinkThreshold(1000)).toBe(200);
  });

  it('Android：800→500→760→500，compact 依序為 true→true→false→true', () => {
    // 第一個 true 為聚焦後尚未縮小的舊邏輯
    const { compacts, phases } = run(800, [800, 500, 760, 500]);
    expect(compacts).toEqual([true, true, false, true]);
    expect(phases).toEqual(['unseen', 'shrunk', 'recovered', 'shrunk']);
  });

  it('臨界值：縮小剛好 160 算縮小、159 不算；恢復 720 算、719 不算', () => {
    expect(run(800, [640]).phases).toEqual(['shrunk']);
    expect(run(800, [641]).phases).toEqual(['unseen']);
    expect(KEYBOARD_RECOVER_TOLERANCE_PX).toBe(80);
    expect(run(800, [500, 720]).phases).toEqual(['shrunk', 'recovered']);
    expect(run(800, [500, 719]).phases).toEqual(['shrunk', 'shrunk']);
  });

  it('小幅變化（網址列伸縮）800→740→800 不觸發，一直維持舊邏輯 compact=true', () => {
    const { compacts, phases } = run(800, [740, 800]);
    expect(phases).toEqual(['unseen', 'unseen']);
    expect(compacts).toEqual([true, true]);
  });

  it('從沒明顯縮小，就算回到或超過基準也不退出精簡版面', () => {
    const { compacts, state } = run(800, [700, 800, 850, 800]);
    expect(compacts).toEqual([true, true, true, true]);
    expect(state?.phase).toBe('unseen');
  });

  it('縮小後的中間區間維持上一狀態，不抖動', () => {
    // shrunk 後在 640～720 之間不恢復；recovered 後在中間區間仍維持 recovered
    expect(run(800, [500, 600, 700]).phases).toEqual(['shrunk', 'shrunk', 'shrunk']);
    expect(run(800, [500, 760, 700, 660]).phases).toEqual([
      'shrunk',
      'recovered',
      'recovered',
      'recovered',
    ]);
  });

  it('縮小期間不把矮高度寫成基準', () => {
    const { state } = run(800, [500, 450]);
    expect(state?.baseline).toBe(800);
  });

  it('重複收起／叫出：每一輪都能退出再進入', () => {
    const { compacts } = run(800, [500, 780, 520, 790, 510]);
    expect(compacts).toEqual([true, false, true, false, true]);
  });
});

describe('WO-118 iOS 與沒有基準', () => {
  it('iOS 高度不變（差為 0）：聚焦 compact=true、失焦 false', () => {
    const { compacts, state } = run(800, [800, 800, 800]);
    expect(compacts).toEqual([true, true, true]);
    expect(compactOf(state, true)).toBe(true);
    const blurred = nextKeyboardHeightState(state, { focused: false, height: 800 });
    expect(compactOf(blurred, false)).toBe(false);
  });

  it('沒有可信基準（一開始就聚焦）：回傳 null，沿用舊邏輯', () => {
    const state = nextKeyboardHeightState(null, { focused: true, height: 500 });
    expect(state).toBeNull();
    expect(compactOf(state, true)).toBe(true);
    // 之後即使高度回到 800，也不猜測已收鍵盤
    const later = nextKeyboardHeightState(state, { focused: true, height: 800 });
    expect(later).toBeNull();
    expect(compactOf(later, true)).toBe(true);
  });

  it('無效高度（0）不改變狀態', () => {
    const base = nextKeyboardHeightState(null, { focused: false, height: 800 });
    expect(nextKeyboardHeightState(base, { focused: true, height: 0 })).toEqual(base);
  });
});

describe('WO-118 失焦與重設', () => {
  it('失焦再聚焦：不沿用上一輪的 recovered，要重新縮小才會再退出', () => {
    let state = run(800, [500, 780]).state;
    expect(compactOf(state, true)).toBe(false);
    state = nextKeyboardHeightState(state, { focused: false, height: 800 });
    expect(state).toEqual({ baseline: 800, phase: 'unseen' });
    state = nextKeyboardHeightState(state, { focused: true, height: 800 });
    expect(compactOf(state, true)).toBe(true);
  });

  it('失焦時鍵盤還沒收完（高度仍矮）：不把矮高度當基準', () => {
    let state = run(800, [500]).state;
    state = nextKeyboardHeightState(state, { focused: false, height: 520 });
    expect(state).toEqual({ baseline: 800, phase: 'unseen' });
    state = nextKeyboardHeightState(state, { focused: false, height: 800 });
    expect(state?.baseline).toBe(800);
  });

  it('失焦時小幅變化會更新基準（網址列伸縮）', () => {
    const state = nextKeyboardHeightState(
      { baseline: 800, phase: 'unseen' },
      { focused: false, height: 740 },
    );
    expect(state).toEqual({ baseline: 740, phase: 'unseen' });
  });
});

describe('WO-118 可見高度來源', () => {
  it('取 innerHeight 與有效 visualViewport 的較小值', () => {
    expect(visibleViewportHeight(800, 500)).toBe(500);
    expect(visibleViewportHeight(500, 800)).toBe(500);
  });

  it('visualViewport 不可用或無效，退回 innerHeight', () => {
    expect(visibleViewportHeight(800, undefined)).toBe(800);
    expect(visibleViewportHeight(800, null)).toBe(800);
    expect(visibleViewportHeight(800, 0)).toBe(800);
  });

  it('只有 visualViewport 縮小（innerHeight 不變）也能走完縮小→恢復', () => {
    const heights = [500, 790].map((vv) => visibleViewportHeight(800, vv));
    expect(run(800, heights).compacts).toEqual([true, false]);
  });

  it('只有 innerHeight 縮小（visualViewport 同步或不可用）也能走完縮小→恢復', () => {
    const heights = [500, 790].map((inner) => visibleViewportHeight(inner, undefined));
    expect(run(800, heights).compacts).toEqual([true, false]);
  });
});

describe('WO-118 適用範圍', () => {
  const portrait = {
    pointerFine: false,
    viewportWidth: 390,
    screenShortEdge: 390,
    deviceLandscape: false,
  };

  it('isDeviceLandscape 只看螢幕寬高', () => {
    expect(isDeviceLandscape(390, 844)).toBe(false);
    expect(isDeviceLandscape(844, 390)).toBe(true);
    expect(isDeviceLandscape(390, 390)).toBe(false);
  });

  it('手機直拿適用', () => {
    expect(usesKeyboardHeightTracking(portrait)).toBe(true);
  });

  it('橫拿、平板、電腦、精細指標都不適用', () => {
    expect(usesKeyboardHeightTracking({ ...portrait, deviceLandscape: true })).toBe(false);
    expect(
      usesKeyboardHeightTracking({ ...portrait, viewportWidth: 767, screenShortEdge: 768 }),
    ).toBe(false);
    expect(usesKeyboardHeightTracking({ ...portrait, viewportWidth: 1280 })).toBe(false);
    expect(usesKeyboardHeightTracking({ ...portrait, pointerFine: true })).toBe(false);
    expect(usesKeyboardHeightTracking({ ...portrait, screenShortEdge: 0 })).toBe(false);
  });
});

describe('WO-118 hook 實際決策（decideWritingUpdate）：媒體查詢被鍵盤壓矮誤判', () => {
  const base = {
    pointerFine: false,
    viewportWidth: 390,
    screenWidth: 390,
    screenHeight: 844,
    visualViewportHeight: null,
    orientationMediaLandscape: false,
  };

  /** 依序送入每一步並串接 heightState／resetKey，如同 hook 的 ref。 */
  function play(steps: Array<Partial<WritingUpdateInput> & { focused: boolean; innerHeight: number }>) {
    let heightState: KeyboardHeightState | null = null;
    let resetKey = '';
    return steps.map((step) => {
      const r = decideWritingUpdate({ ...base, ...step, heightState, resetKey });
      heightState = r.heightState;
      resetKey = r.resetKey;
      return r;
    });
  }

  it('直拿、持續聚焦：800→350→800→350，350 時媒體查詢誤判為橫向，選單仍會 隱藏→可見→隱藏', () => {
    const results = play([
      { focused: false, innerHeight: 800 }, // 量到基準
      { focused: true, innerHeight: 800 },
      { focused: true, innerHeight: 350, orientationMediaLandscape: true }, // 寬 390 > 高 350
      { focused: true, innerHeight: 800, orientationMediaLandscape: false },
      { focused: true, innerHeight: 350, orientationMediaLandscape: true },
    ]);
    expect(results.slice(1).map((r) => r.compact)).toEqual([true, true, false, true]);
    // 350 那一步追蹤仍開、基準沒被清
    expect(results[2].heightState).toEqual({ baseline: 800, phase: 'shrunk' });
    expect(results[3].heightState?.phase).toBe('recovered');
    expect(results[4].heightState).toEqual({ baseline: 800, phase: 'shrunk' });
    // 重設 key 不因媒體查詢而變
    expect(new Set(results.map((r) => r.resetKey)).size).toBe(1);
  });

  it('對照：裝置真的橫拿（螢幕 844×390）追蹤關閉並重設，不把直拿基準帶過去', () => {
    const results = play([
      { focused: false, innerHeight: 800 },
      { focused: true, innerHeight: 350 },
      {
        focused: true,
        innerHeight: 350,
        screenWidth: 844,
        screenHeight: 390,
        viewportWidth: 844,
        orientationMediaLandscape: true,
      },
      { focused: true, innerHeight: 800 }, // 轉回直拿：沒有可信基準，不猜
    ]);
    expect(results[1].heightState?.phase).toBe('shrunk');
    expect(results[2].heightState).toBeNull();
    expect(results[2].resetKey).not.toBe(results[1].resetKey);
    expect(results[3].heightState).toBeNull();
    expect(results[3].compact).toBe(true);
  });

  it('電腦（精細指標）不追蹤、不進精簡版面', () => {
    const [desktop] = play([{ focused: true, innerHeight: 500, pointerFine: true }]);
    expect(desktop.heightState).toBeNull();
    expect(desktop.compact).toBe(false);
  });
});
