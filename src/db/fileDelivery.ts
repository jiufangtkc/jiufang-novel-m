/**
 * WO-103：匯出全文（Word／TXT）的交付輔助。
 *
 * 沿用既有 .db 另存的「能分享就分享，否則下載」模式（db/library.ts 的 shareDatabase 不動，.db 行為不變），
 * 差別（暫定，交九方審）：
 * - 檔名與 MIME 由呼叫端決定（.docx／.txt），不強制 .db 與 application/octet-stream。
 * - 下載路徑把連結「掛進頁面且隱藏」再點，點完移除；物件網址延後釋放，讓瀏覽器有時間接手下載
 *   （既有 .db 路徑是未掛進頁面的連結、點完立刻釋放）。
 * - 分享被使用者取消（AbortError）回 'cancelled'，不再自動改成下載。
 * - 瀏覽器因「使用者手勢已失效」拒絕分享（NotAllowedError）時回 'needs-gesture'：
 *   檔案已備妥，由畫面請使用者再明確點一次「儲存檔案」（同一個檔案，不重新產生）。
 *
 * 成功界線：分享 Promise 成功（'shared'）或下載連結已交給瀏覽器（'downloaded'）。
 * 瀏覽器無法讓網頁得知使用者最後是否真的寫進磁碟，所以這裡不宣稱已存到指定位置。
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const TXT_MIME = 'text/plain;charset=utf-8';

/** 下載連結點擊後多久才釋放物件網址（毫秒）。 */
export const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;

export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled' | 'needs-gesture';

export interface DeliveryEnv {
  share?: ((data: ShareData) => Promise<void>) | undefined;
  canShare?: ((data: ShareData) => boolean) | undefined;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** 建立並掛進頁面的隱藏下載連結；回傳點擊與移除方法。 */
  createLink: () => { anchor: HTMLAnchorElement; remove: () => void };
  schedule: (run: () => void, delayMs: number) => void;
}

export function browserDeliveryEnv(): DeliveryEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    share: typeof nav?.share === 'function' ? (data) => nav.share(data) : undefined,
    canShare: typeof nav?.canShare === 'function' ? (data) => nav.canShare(data) : undefined,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createLink: () => {
      const anchor = document.createElement('a');
      anchor.hidden = true;
      anchor.style.display = 'none';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      return { anchor, remove: () => anchor.remove() };
    },
    schedule: (run, delayMs) => {
      setTimeout(run, delayMs);
    },
  };
}

/** 分享只傳檔案本身（不帶標題、文字或網址），讓 iPhone Safari 分享面板可選「儲存到檔案」。 */
export function fileSharePayload(file: File): ShareData {
  return { files: [file] };
}

export function makeExportFile(bytes: Uint8Array, filename: string, mime: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], filename, { type: mime });
}

function errorName(error: unknown): string | null {
  if (error && typeof error === 'object' && 'name' in error && typeof (error as { name: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }
  return null;
}

/**
 * 交付檔案。分享失敗（非取消、非手勢失效）照樣丟出錯誤，由呼叫端當成「無法匯出」，不計次。
 */
export async function deliverFile(file: File, env: DeliveryEnv = browserDeliveryEnv()): Promise<DeliveryResult> {
  const payload = fileSharePayload(file);
  if (env.share && env.canShare?.(payload)) {
    try {
      await env.share(payload);
      return 'shared';
    } catch (error) {
      const name = errorName(error);
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-gesture';
      throw error;
    }
  }
  const url = env.createObjectURL(file);
  const { anchor, remove } = env.createLink();
  try {
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
  } catch (error) {
    remove();
    env.revokeObjectURL(url);
    throw error;
  }
  remove();
  env.schedule(() => env.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
  return 'downloaded';
}
