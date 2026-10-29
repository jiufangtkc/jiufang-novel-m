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

function simulatedKeyboard(): boolean {
  return document.documentElement.dataset.forceKeyboard === '1';
}

/**
 * 正文聚焦時為 true。截圖可設 data-force-keyboard 並送出 jiufang-keyboard-sim。
 * visualViewport 只負責正文高度與捲動，不決定要不要精簡。
 */
export function useWritingKeyboard(focused: boolean): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)');
    const update = () => {
      if (simulatedKeyboard()) {
        setOpen(true);
        return;
      }
      setOpen(
        shouldUseCompactWritingLayout({
          focused,
          pointerFine: fine.matches,
          viewportWidth: window.innerWidth,
        }),
      );
    };
    update();
    fine.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('jiufang-keyboard-sim', update);
    return () => {
      fine.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('jiufang-keyboard-sim', update);
    };
  }, [focused]);

  useEffect(() => {
    document.documentElement.classList.toggle('keyboard-open', open);
    return () => document.documentElement.classList.remove('keyboard-open');
  }, [open]);

  return open;
}
