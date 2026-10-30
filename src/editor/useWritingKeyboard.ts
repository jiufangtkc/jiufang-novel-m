import { useEffect, useState } from 'react';

/** 寬度達到這個值就當成電腦版，聚焦也不收起底部分頁。 */
export const DESKTOP_LAYOUT_WIDTH = 768;

/**
 * 手機上一聚焦就進入精簡版面，失焦才恢復。
 * 不看 visualViewport：iOS Chrome 鍵盤出來時高度差常常是 0，用它判斷會進不去。
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

/** 手機螢幕短邊上限。iPhone 最大約 440，平板短邊從 768 起。 */
export const PHONE_SHORT_EDGE_MAX = 500;

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

function simulatedKeyboard(): boolean {
  return document.documentElement.dataset.forceKeyboard === '1';
}

export type WritingChrome = { compact: boolean; landscape: boolean };

/**
 * 正文聚焦時為 compact。截圖可設 data-force-keyboard 並送出 jiufang-keyboard-sim。
 * 手機橫放另加 landscape，只藏寫作周圍的欄，不改精簡版面的寬度規則。
 */
export function useWritingKeyboard(focused: boolean): WritingChrome {
  const [chrome, setChrome] = useState<WritingChrome>({ compact: false, landscape: false });

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)');
    const landscapeMedia = window.matchMedia('(orientation: landscape)');
    const update = () => {
      const pointerFine = fine.matches;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const visual = window.visualViewport;
      const screenShortEdge = Math.min(window.screen.width, window.screen.height);
      const forced = simulatedKeyboard();
      const orientationLandscape =
        landscapeMedia.matches || window.screen.width > window.screen.height;
      const visualViewportHeight = visual?.height ?? viewportHeight;
      const reportedViewportHeight =
        forced && orientationLandscape && screenShortEdge <= PHONE_SHORT_EDGE_MAX
          ? Math.min(viewportHeight, PHONE_LANDSCAPE_LOW_HEIGHT)
          : viewportHeight;
      const reportedVisualHeight =
        forced && orientationLandscape && screenShortEdge <= PHONE_SHORT_EDGE_MAX
          ? Math.min(visualViewportHeight, PHONE_LANDSCAPE_LOW_HEIGHT)
          : visualViewportHeight;
      const landscape = shouldUsePhoneLandscapeWriting({
        focused,
        pointerFine,
        orientationLandscape,
        viewportHeight: reportedViewportHeight,
        screenShortEdge,
        visualViewportWidth: visual?.width ?? viewportWidth,
        visualViewportHeight: reportedVisualHeight,
      });
      setChrome({
        compact:
          forced ||
          shouldUseCompactWritingLayout({
            focused,
            pointerFine,
            viewportWidth,
          }),
        landscape,
      });
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
