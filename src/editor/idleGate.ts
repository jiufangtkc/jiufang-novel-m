/** 停筆一小段時間才執行。組字期間不計時，也不會中途去改字數或存檔。 */
export function createIdleGate(waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let composing = false;
  let pending: (() => void) | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    setComposing(value: boolean) {
      composing = value;
      if (value) cancelTimer();
    },
    schedule(task: () => void) {
      pending = task;
      cancelTimer();
      if (composing) return;
      timer = setTimeout(() => {
        timer = null;
        const run = pending;
        pending = null;
        if (!composing && run) run();
      }, waitMs);
    },
    flush() {
      cancelTimer();
      const run = pending;
      pending = null;
      if (!composing && run) run();
    },
    cancel: cancelTimer,
  };
}

export const IDLE_MS = 600;
