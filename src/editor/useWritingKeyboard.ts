import { useEffect, useRef, useState } from 'react';
import { PHONE_LANDSCAPE_MAX_HEIGHT } from '../layout';

/** 寬度達到這個值就當成電腦版，聚焦也不收起底部分頁。 */
export const DESKTOP_LAYOUT_WIDTH = 768;

/**
 * 手機上一聚焦就進入精簡版面，失焦才恢復。
 * 這個函式本身不看高度：iOS Chrome 鍵盤出來時高度差常常是 0，用它判斷會進不去。
 * 只有「曾觀察到可見高度明顯縮小、之後又恢復」時，hook 才額外退出精簡版面（見 nextKeyboardHeightState）；
 * 沒觀察到高度變化就維持這裡的聚焦／失焦行為。
 * 電腦版（精細指標，或寬度達到 768）維持完整版面。
 */
export function shouldUseCompactWritingLayout(input: {
  focused: boolean;
  pointerFine: boolean;
  viewportWidth: number;
}): boolean {
  if (!input.focused) return false;
  if (input.pointerFine || input.viewportWidth >= DESKTOP_LAYOUT_WIDTH) return false;
  return true;
}

/** 手機螢幕短邊上限。iPhone 最大約 440，平板短邊從 768 起。對齊 WO-54 橫拿門檻（500）。 */
export const PHONE_SHORT_EDGE_MAX = PHONE_LANDSCAPE_MAX_HEIGHT;

/**
 * 橫放時可見高度低於這個值，才當成鍵盤開著。
 * 手機橫放沒鍵盤時高度約 320–440，有鍵盤通常只剩兩百上下。
 */
export const PHONE_LANDSCAPE_LOW_HEIGHT = 300;

/**
 * 手機橫放、鍵盤開著打字時，藏起標題、側欄、目錄與底部狀態，只留正文。
 * 可見高度用版面高與 visualViewport 裡較小的那個：鍵盤收起、高度回來就恢復。
 * 轉回直向、失焦、平板（短邊更大）或電腦（精細指標）都不進來。
 * 不讀正文，也不動組字狀態。
 */
export function shouldUsePhoneLandscapeWriting(input: {
  focused: boolean;
  pointerFine: boolean;
  orientationLandscape: boolean;
  viewportHeight: number;
  screenShortEdge: number;
  visualViewportWidth: number;
  visualViewportHeight: number;
}): boolean {
  if (!input.focused || input.pointerFine) return false;
  const phone = input.screenShortEdge > 0 && input.screenShortEdge <= PHONE_SHORT_EDGE_MAX;
  if (!phone) return false;
  const visibleHeight = Math.min(
    input.viewportHeight,
    input.visualViewportHeight > 0 ? input.visualViewportHeight : input.viewportHeight,
  );
  if (visibleHeight <= 0 || visibleHeight > PHONE_LANDSCAPE_LOW_HEIGHT) return false;
  const visualLandscape =
    input.visualViewportWidth > input.screenShortEdge &&
    input.visualViewportWidth > input.visualViewportHeight;
  return input.orientationLandscape || visualLandscape;
}

/** 縮小量至少要有這麼多 CSS px，才算鍵盤出現（排除網址列伸縮）。 */
export const KEYBOARD_SHRINK_MIN_PX = 150;
/** 縮小量也至少要達到基準高度的這個比例。 */
export const KEYBOARD_SHRINK_RATIO = 0.2;
/** 縮小後，可見高度回到「基準 − 這個值」以上才算鍵盤收起。 */
export const KEYBOARD_RECOVER_TOLERANCE_PX = 80;

/** 尚未觀察到縮小／已觀察到縮小（鍵盤出現）／縮小後已恢復（鍵盤收起）。 */
export type KeyboardHeightPhase = 'unseen' | 'shrunk' | 'recovered';

/** baseline 是鍵盤出現前的可信可見高度。沒有可信基準時整個狀態為 null，維持舊邏輯。 */
export type KeyboardHeightState = { baseline: number; phase: KeyboardHeightPhase };

/** 基準 H 下，縮小量達此值才記為明顯變小：max(150, H × 20%)。 */
export function keyboardShrinkThreshold(baseline: number): number {
  return Math.max(KEYBOARD_SHRINK_MIN_PX, baseline * KEYBOARD_SHRINK_RATIO);
}

/** 可見高度：innerHeight 與有效 visualViewport.height 的較小值；visualViewport 不可用則用 innerHeight。 */
export function visibleViewportHeight(
  innerHeight: number,
  visualViewportHeight: number | null | undefined,
): number {
  if (visualViewportHeight && visualViewportHeight > 0) {
    return innerHeight > 0 ? Math.min(innerHeight, visualViewportHeight) : visualViewportHeight;
  }
  return innerHeight;
}

/**
 * 高度狀態轉移（純函式）。
 * - 未聚焦：量測基準、回到 unseen。已明顯矮於基準的取樣（鍵盤收起動畫中）不覆寫基準。
 * - 聚焦且沒有基準：回傳 null（沒有可信基準，走舊邏輯，不猜測）。
 * - 聚焦：縮小量 ≥ max(150, H×20%) → shrunk；曾 shrunk 且高度 ≥ H−80 → recovered；
 *   recovered 之後再縮小到門檻 → shrunk；其餘（中間區間）維持上一狀態。
 *   縮小期間不會把矮高度寫成基準；只有 unseen／recovered 且高度變高時才上調基準。
 */
export function nextKeyboardHeightState(
  prev: KeyboardHeightState | null,
  input: { focused: boolean; height: number },
): KeyboardHeightState | null {
  const { focused, height } = input;
  if (!(height > 0)) return prev;
  if (!focused) {
    if (!prev || height >= prev.baseline - keyboardShrinkThreshold(prev.baseline)) {
      return { baseline: height, phase: 'unseen' };
    }
    return { baseline: prev.baseline, phase: 'unseen' };
  }
  if (!prev) return null;
  const { baseline, phase } = prev;
  if (baseline - height >= keyboardShrinkThreshold(baseline)) return { baseline, phase: 'shrunk' };
  if (phase === 'shrunk') {
    return height >= baseline - KEYBOARD_RECOVER_TOLERANCE_PX
      ? { baseline: Math.max(baseline, height), phase: 'recovered' }
      : prev;
  }
  if (height > baseline) return { baseline: height, phase };
  return prev;
}

/**
 * 裝置是否橫拿：只看螢幕寬高。真的旋轉手機會對調 screen.width／height；
 * 鍵盤把畫面壓矮不會動螢幕尺寸，所以不會誤判。
 */
export function isDeviceLandscape(screenWidth: number, screenHeight: number): boolean {
  return screenWidth > screenHeight;
}

/**
 * 手機直拿才套用高度判斷：觸控、寬度未達 768、手機短邊、裝置非橫拿。其餘（橫拿、平板、電腦）不適用。
 * 「非橫拿」必須用 deviceLandscape（螢幕寬高），不可用 (orientation: landscape) 媒體查詢：
 * 媒體查詢看的是瀏覽器可用區域，直拿時鍵盤把高度壓到小於寬度，它會變 true，
 * 追蹤就被關掉、基準被清掉，收鍵盤後正文仍聚焦便無法重建基準，選單回不來。
 */
export function usesKeyboardHeightTracking(input: {
  pointerFine: boolean;
  viewportWidth: number;
  screenShortEdge: number;
  deviceLandscape: boolean;
}): boolean {
  return (
    !input.pointerFine &&
    input.viewportWidth < DESKTOP_LAYOUT_WIDTH &&
    input.screenShortEdge > 0 &&
    input.screenShortEdge <= PHONE_SHORT_EDGE_MAX &&
    !input.deviceLandscape
  );
}

export type WritingChrome = { compact: boolean; landscape: boolean };

export type WritingUpdateInput = {
  focused: boolean;
  pointerFine: boolean;
  viewportWidth: number;
  innerHeight: number;
  /** visualViewport.height；沒有 visualViewport 時傳 null。 */
  visualViewportHeight: number | null;
  /** visualViewport.width；沒有時傳 null，退回 viewportWidth。 */
  visualViewportWidth?: number | null;
  screenWidth: number;
  screenHeight: number;
  /** (orientation: landscape) 媒體查詢結果。只給既有橫拿打字規則用，不用於高度追蹤。 */
  orientationMediaLandscape: boolean;
  /** 截圖用的模擬鍵盤（data-force-keyboard）。 */
  forced?: boolean;
  heightState: KeyboardHeightState | null;
  resetKey: string;
};

export type WritingUpdateResult = WritingChrome & {
  heightState: KeyboardHeightState | null;
  resetKey: string;
};

/** hook 每次更新的決策（純函式，hook 直接呼叫它）。 */
export function decideWritingUpdate(input: WritingUpdateInput): WritingUpdateResult {
  const { focused, pointerFine, viewportWidth, innerHeight, screenWidth, screenHeight } = input;
  const forced = input.forced === true;
  const screenShortEdge = Math.min(screenWidth, screenHeight);
  const deviceLandscape = isDeviceLandscape(screenWidth, screenHeight);
  // 既有橫拿打字規則維持原樣：媒體查詢或螢幕寬高任一成立。
  const orientationLandscape = input.orientationMediaLandscape || deviceLandscape;
  const visualViewportHeight = input.visualViewportHeight ?? innerHeight;
  const forcedLandscape =
    forced && orientationLandscape && screenShortEdge <= PHONE_SHORT_EDGE_MAX;
  const landscape = shouldUsePhoneLandscapeWriting({
    focused,
    pointerFine,
    orientationLandscape,
    viewportHeight: forcedLandscape ? Math.min(innerHeight, PHONE_LANDSCAPE_LOW_HEIGHT) : innerHeight,
    screenShortEdge,
    visualViewportWidth: input.visualViewportWidth ?? viewportWidth,
    visualViewportHeight: forcedLandscape
      ? Math.min(visualViewportHeight, PHONE_LANDSCAPE_LOW_HEIGHT)
      : visualViewportHeight,
  });
  // 高度追蹤只看裝置方向；方向、寬度或適用條件真的改變才丟掉舊基準。
  const tracking = usesKeyboardHeightTracking({
    pointerFine,
    viewportWidth,
    screenShortEdge,
    deviceLandscape,
  });
  const resetKey = `${tracking}|${viewportWidth}|${screenShortEdge}|${deviceLandscape}`;
  const prev = resetKey === input.resetKey ? input.heightState : null;
  const heightState = tracking
    ? nextKeyboardHeightState(prev, {
        focused,
        height: visibleViewportHeight(innerHeight, input.visualViewportHeight),
      })
    : null;
  // 曾明顯縮小又恢復＝鍵盤已收：就算正文仍聚焦也退出精簡版面。沒觀察到高度變化就維持舊行為。
  const keyboardClosed = heightState?.phase === 'recovered';
  const compact =
    forced ||
    (!keyboardClosed && shouldUseCompactWritingLayout({ focused, pointerFine, viewportWidth }));
  return { compact, landscape, heightState, resetKey };
}

function simulatedKeyboard(): boolean {
  return document.documentElement.dataset.forceKeyboard === '1';
}

/**
 * 正文聚焦時為 compact。截圖可設 data-force-keyboard 並送出 jiufang-keyboard-sim。
 * 手機橫放另加 landscape，只藏寫作周圍的欄，不改精簡版面的寬度規則。
 */
export function useWritingKeyboard(focused: boolean): WritingChrome {
  const [chrome, setChrome] = useState<WritingChrome>({ compact: false, landscape: false });
  // 高度狀態放 ref：事件或 effect 因 focused 重建時不會被誤重設；離開章節（unmount）時自然消失。
  const heightRef = useRef<KeyboardHeightState | null>(null);
  const heightKeyRef = useRef('');

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)');
    const landscapeMedia = window.matchMedia('(orientation: landscape)');
    const update = () => {
      const visual = window.visualViewport;
      const result = decideWritingUpdate({
        focused,
        pointerFine: fine.matches,
        viewportWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        visualViewportHeight: visual ? visual.height : null,
        visualViewportWidth: visual ? visual.width : null,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        orientationMediaLandscape: landscapeMedia.matches,
        forced: simulatedKeyboard(),
        heightState: heightRef.current,
        resetKey: heightKeyRef.current,
      });
      heightRef.current = result.heightState;
      heightKeyRef.current = result.resetKey;
      setChrome({ compact: result.compact, landscape: result.landscape });
    };
    update();
    fine.addEventListener('change', update);
    landscapeMedia.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('jiufang-keyboard-sim', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      fine.removeEventListener('change', update);
      landscapeMedia.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('jiufang-keyboard-sim', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [focused]);

  useEffect(() => {
    document.documentElement.classList.toggle('keyboard-open', chrome.compact);
    document.documentElement.classList.toggle('landscape-writing', chrome.landscape);
    return () => {
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.classList.remove('landscape-writing');
    };
  }, [chrome]);

  return chrome;
}
