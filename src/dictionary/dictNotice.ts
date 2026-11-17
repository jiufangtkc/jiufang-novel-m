/**
 * 沒網路提示的顯示控制（WO-105，規格 B-3 第 5 點）
 * 約 3 秒自己消失；消失前再按一次重新計時；選取改變可立刻消失。
 * 框架無關，計時器可注入，方便測試。
 */

export const DICT_NOTICE_MS = 3000;

export interface DictNoticeTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

const realTimers: DictNoticeTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id as number),
};

export function createDictNotice(timers: DictNoticeTimers = realTimers, ms = DICT_NOTICE_MS) {
  let visible = false;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const stop = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };
  return {
    isVisible: () => visible,
    /** 顯示並（重新）計時 */
    show() {
      stop();
      const changed = !visible;
      visible = true;
      timer = timers.set(() => {
        timer = null;
        visible = false;
        emit();
      }, ms);
      if (changed) emit();
    },
    hide() {
      stop();
      if (!visible) return;
      visible = false;
      emit();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type DictNotice = ReturnType<typeof createDictNotice>;
