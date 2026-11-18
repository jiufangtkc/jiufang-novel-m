/**
 * WO-123：開檔該走「系統選檔 picker」還是「隱藏的 file input」。
 *
 * 背景：Windows 桌面瀏覽器的系統選檔視窗若完全蓋住瀏覽器，瀏覽器可能自行取消 showOpenFilePicker，
 * 即使作家已選好檔也會回 AbortError。Windows 桌面因此改走 input（不會被取消）。
 * 這裡只決定開檔的路；canPickLocalFiles() 不動，存檔能力與手機分流不受影響。
 *
 * 判定全部是純函式，可注入平台與 UA；瀏覽器資訊只在 readBrowserRouteEnv() 這個邊界讀取。
 */

export interface OpenRouteEnv {
  /** navigator.userAgentData.platform（沒有或空字串視為缺漏）。 */
  platform?: string | null;
  /** navigator.userAgentData.mobile。 */
  mobile?: boolean | null;
  /** navigator.userAgent。 */
  userAgent?: string | null;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Mobile|Tablet/i;
const WINDOWS_UA = /Windows NT|Win32|Win64|Windows/i;

/**
 * 是否為 Windows 桌面。規則（衝突時由上而下優先）：
 * 1. userAgentData.mobile === true，或 UA 有手機／平板標記 → 否（含 Windows Phone）。
 * 2. userAgentData.platform 有值 → 只有 "Windows" 才是。
 * 3. 否則看 UA 有沒有 Windows 標記。
 * 4. 資訊缺漏或無法辨識 → 否（沿用既有能力判斷）。
 * 不看螢幕寬度、觸控能力或瀏覽器版本；一般觸控 Windows 筆電仍算桌面。
 */
export function isWindowsDesktop(env: OpenRouteEnv): boolean {
  const ua = typeof env.userAgent === 'string' ? env.userAgent : '';
  if (env.mobile === true) return false;
  if (MOBILE_UA.test(ua)) return false;
  const platform = typeof env.platform === 'string' ? env.platform.trim() : '';
  if (platform) return platform.toLowerCase() === 'windows';
  return WINDOWS_UA.test(ua);
}

/** 邊界：讀瀏覽器資訊。沒有 navigator（node）或讀取拋錯都回空資訊。 */
export function readBrowserRouteEnv(): OpenRouteEnv {
  try {
    if (typeof navigator === 'undefined') return {};
    const data = (navigator as unknown as { userAgentData?: { platform?: unknown; mobile?: unknown } }).userAgentData;
    return {
      platform: typeof data?.platform === 'string' ? data.platform : null,
      mobile: typeof data?.mobile === 'boolean' ? data.mobile : null,
      userAgent: typeof navigator.userAgent === 'string' ? navigator.userAgent : null,
    };
  } catch {
    return {};
  }
}

export type OpenRoute = 'picker' | 'input';

/** 支援 picker 且不是 Windows 桌面才走 picker；其他一律走既有 input。 */
export function decideOpenRoute(input: { canPick: boolean; env: OpenRouteEnv }): OpenRoute {
  if (input.canPick && !isWindowsDesktop(input.env)) return 'picker';
  return 'input';
}

/**
 * 開檔分派：hook 的 open 直接呼叫這裡（同步，維持在點擊的有效操作時機內）。
 * runPicker／clickInput 由呼叫端提供；一次呼叫只會執行其中一個、且只一次。
 */
export function dispatchOpen(input: {
  canPick: boolean;
  env: OpenRouteEnv;
  runPicker: () => void;
  clickInput: () => void;
}): OpenRoute {
  const route = decideOpenRoute({ canPick: input.canPick, env: input.env });
  if (route === 'picker') input.runPicker();
  else input.clickInput();
  return route;
}
