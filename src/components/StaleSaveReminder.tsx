import { useEffect, useState } from 'react';
import { staleSaveReminder, staleSaveReminderAria } from '../copy/userFacing';

/** 時鐘更新間隔：頁面一直開著跨過 3 天門檻時，最慢一分鐘內會出現。 */
export const STALE_SAVE_TICK_MS = 60_000;

type Listenable = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** 定時與回到頁面時呼叫 bump；回傳清理函式。 */
export function subscribeStaleSaveTick(
  bump: () => void,
  intervalMs: number,
  target: Listenable | null,
  doc: Listenable | null,
): () => void {
  const timer = setInterval(bump, intervalMs);
  target?.addEventListener('focus', bump);
  target?.addEventListener('pageshow', bump);
  doc?.addEventListener('visibilitychange', bump);
  return () => {
    clearInterval(timer);
    target?.removeEventListener('focus', bump);
    target?.removeEventListener('pageshow', bump);
    doc?.removeEventListener('visibilitychange', bump);
  };
}

/**
 * WO-98：只負責讓畫面定時、回到頁面時重算。每次渲染請自己用 Date.now() 取現在時間，
 * 這樣存檔成功後（紀錄時間 = 現在）當下就消失，不必等下一次更新。
 */
export function useStaleSaveTick(intervalMs: number = STALE_SAVE_TICK_MS): void {
  const [, setTick] = useState(0);
  useEffect(
    () =>
      subscribeStaleSaveTick(
        () => setTick((value) => value + 1),
        intervalMs,
        typeof window === 'undefined' ? null : window,
        typeof document === 'undefined' ? null : document,
      ),
    [intervalMs],
  );
}

/**
 * 點提醒要走的存檔動作：支援選檔寫回時走「儲存專案」；手機等不支援的裝置沿用檔案頁的
 * 主操作「另存專案」（saveProject 本身沒有分享／下載替代路徑）。
 */
export function runReminderSave(
  canPickFiles: boolean,
  actions: { saveProject: () => Promise<unknown>; saveProjectAs: () => Promise<unknown> },
): Promise<unknown> {
  return canPickFiles ? actions.saveProject() : actions.saveProjectAs();
}

/** 頁首內獨立次列的一行小字；點一下走既有存檔流程，不跳視窗、不擋正文。 */
export function StaleSaveReminder({ days, onSave }: { days: number; onSave: () => void }) {
  return (
    <button
      type="button"
      className="stale-save-reminder"
      aria-label={staleSaveReminderAria(days)}
      onClick={onSave}
      data-testid="stale-save-reminder"
    >
      {staleSaveReminder(days)}
    </button>
  );
}
