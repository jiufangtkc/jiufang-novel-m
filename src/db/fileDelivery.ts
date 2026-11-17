/**
 * WO-103：匯出全文（Word／TXT）的交付輔助。
 *
 * 沿用既有 .db 另存的「能分享就分享，否則下載」模式（db/library.ts 的 shareDatabase 不動，.db 行為不變），
 * 差別（暫定，交九方審）：
 * - 檔名與 MIME 由呼叫端決定（.docx／.txt），不強制 .db 與 application/octet-stream。
 * - 下載路徑把連結「掛進頁面且隱藏」再點，點完移除；物件網址延後釋放，讓瀏覽器有時間接手下載
 *   （既有 .db 路徑是未掛進頁面的連結、點完立刻釋放）。
 * - WO-103 返工1：電腦（精細指標或無觸控）直接下載；只有具觸控的粗指標裝置先分享。
 * - 分享被使用者取消（AbortError）回 'cancelled'，不再自動改成下載。
 * - 首次分享遇 NotAllowedError 回 'needs-gesture'：檔案已備妥，使用者再按「儲存檔案」時
 *   以 download 模式直接下載同一個檔案（不再分享、不重新產生）。
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
  /** 當下主指標是否為精細指標（`(pointer: fine)`）；無法確認時不提供。 */
  pointerFine?: (() => boolean) | undefined;
  /** 當下主指標是否為粗指標（`(pointer: coarse)`）；無法確認時不提供。 */
  pointerCoarse?: (() => boolean) | undefined;
  /** 當下 `navigator.maxTouchPoints`；無法確認時不提供。 */
  maxTouchPoints?: (() => number) | undefined;
}

/** auto：依當下能力先分享或直接下載；download：一律下載（已備妥的檔案再按「儲存檔案」）。 */
export type DeliveryMode = 'auto' | 'download';

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
    pointerFine: typeof matchMedia === 'function' ? () => matchMedia('(pointer: fine)').matches : undefined,
    pointerCoarse: typeof matchMedia === 'function' ? () => matchMedia('(pointer: coarse)').matches : undefined,
    maxTouchPoints: typeof nav?.maxTouchPoints === 'number' ? () => nav.maxTouchPoints : undefined,
  };
}

/**
 * 每次交付都讀當下能力（不看 App「操作方式」設定、不看瀏覽器名稱）：
 * 精細指標、無觸控或無法確認 → 下載；只有「具觸控且主指標為粗指標」才優先分享。
 */
export function shouldPreferDownload(env: DeliveryEnv): boolean {
  try {
    if (env.pointerFine?.() === true) return true;
    const touch = env.maxTouchPoints?.();
    if (typeof touch !== 'number' || !(touch > 0)) return true;
    return env.pointerCoarse?.() !== true;
  } catch {
    return true;
  }
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

/** 把檔案交給掛進頁面的隱藏連結下載；失敗時清理連結與物件網址並丟出錯誤。 */
export function downloadFile(file: File, env: DeliveryEnv = browserDeliveryEnv()): 'downloaded' {
  const url = env.createObjectURL(file);
  let remove: (() => void) | null = null;
  try {
    const link = env.createLink();
    remove = link.remove;
    link.anchor.href = url;
    link.anchor.download = file.name;
    link.anchor.click();
  } catch (error) {
    try {
      remove?.();
    } finally {
      env.revokeObjectURL(url);
    }
    throw error;
  }
  remove();
  env.schedule(() => env.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
  return 'downloaded';
}

/**
 * 交付檔案。mode 'download'（已備妥重試）一律下載。
 * auto：精細指標／無觸控／無法確認 → 直接下載；具觸控的粗指標裝置先分享。
 * 分享取消（AbortError）回 cancelled；NotAllowedError 回 needs-gesture；其他分享錯誤與能力檢查拋錯改走下載。
 * 下載本身失敗才丟出錯誤。
 */
export async function deliverFile(
  file: File,
  env: DeliveryEnv = browserDeliveryEnv(),
  mode: DeliveryMode = 'auto',
): Promise<DeliveryResult> {
  if (mode === 'download') return downloadFile(file, env);
  const payload = fileSharePayload(file);
  let canShare = false;
  try {
    canShare = Boolean(env.share && env.canShare?.(payload)) && !shouldPreferDownload(env);
  } catch {
    canShare = false;
  }
  if (canShare && env.share) {
    try {
      await env.share(payload);
      return 'shared';
    } catch (error) {
      const name = errorName(error);
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-gesture';
      // 其他分享錯誤（含宣稱可分享但實際不支援）：改走下載
    }
  }
  return downloadFile(file, env);
}
