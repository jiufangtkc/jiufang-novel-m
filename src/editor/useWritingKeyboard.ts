import { useEffect, useState } from 'react';

/** 鍵盤高度超過這個值，才當成鍵盤開著。桌面點一下文字框不會超過。 */
const KEYBOARD_INSET_PX = 120;

function keyboardInset(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

function simulatedKeyboard(): boolean {
  return document.documentElement.dataset.forceKeyboard === '1';
}

/**
 * 正文聚焦且鍵盤真的佔住畫面時為 true。
 * 截圖可設 data-force-keyboard 並送出 jiufang-keyboard-sim。
 */
export function useWritingKeyboard(focused: boolean): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      setOpen(simulatedKeyboard() || (focused && keyboardInset() > KEYBOARD_INSET_PX));
    };
    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('jiufang-keyboard-sim', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('jiufang-keyboard-sim', update);
    };
  }, [focused]);

  useEffect(() => {
    document.documentElement.classList.toggle('keyboard-open', open);
    return () => document.documentElement.classList.remove('keyboard-open');
  }, [open]);

  return open;
}
