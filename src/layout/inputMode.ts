import { MEDIUM_MIN_WIDTH, type PointerMode } from './layoutMode';

/**
 * 操作方式：第一次打開只猜一次，存進這個瀏覽器，之後不再跟著指標自動換（WO-94）。
 * 有沒有觸控螢幕不再當依據。電腦、筆電（含可觸控的 YOGA 7）猜「用滑鼠」。
 */

export const INPUT_MODE_STORAGE_KEY = 'jiufang-novel-m.input-mode.v1';
export const DEVICE_KIND_STORAGE_KEY = 'jiufang-novel-m.device-kind.v1';

export type DeviceKind = 'phone' | 'tablet' | 'computer' | 'unknown';

export interface DeviceSignals {
  /** 瀏覽器有沒有 matchMedia。沒有時猜成「這個裝置」、用手指點。 */
  hasMatchMedia: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** (any-pointer: fine)，有滑鼠或觸控板。 */
  anyPointerFine: boolean;
  /** (hover: hover)，指標能在上面停。 */
  hover: boolean;
  /**
   * Math.min(screen.width, screen.height)。
   * 用螢幕短邊，不用視窗寬度。量不到就省略。
   */
  screenShortEdge?: number;
}

export interface InputModeGuess {
  deviceKind: DeviceKind;
  inputMode: PointerMode;
}

export interface InputModeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredInputMode extends InputModeGuess {
  /** true 代表這次是剛猜完寫進本機的，不是讀到舊設定。 */
  guessed: boolean;
}

function isPointerMode(value: string | null): value is PointerMode {
  return value === 'touch' || value === 'mouse';
}

function isDeviceKind(value: string | null): value is DeviceKind {
  return value === 'phone' || value === 'tablet' || value === 'computer' || value === 'unknown';
}

function screenShortEdge(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * 依序判斷，先符合的先用。只在這個裝置還沒存過操作方式時呼叫。
 */
export function guessInputMode(signals: DeviceSignals): InputModeGuess {
  if (!signals.hasMatchMedia) {
    return { deviceKind: 'unknown', inputMode: 'touch' };
  }

  const ua = signals.userAgent ?? '';
  const touchPoints = signals.maxTouchPoints ?? 0;
  const anyFine = Boolean(signals.anyPointerFine);
  const hover = Boolean(signals.hover);
  const shortEdge = screenShortEdge(signals.screenShortEdge);
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

  if (isIpad) {
    return { deviceKind: 'tablet', inputMode: anyFine ? 'mouse' : 'touch' };
  }

  const noPointingDevice = !anyFine && !hover;
  const phoneBySize = noPointingDevice && shortEdge !== null && shortEdge < MEDIUM_MIN_WIDTH;
  const phoneByAgent = /iPhone/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua));
  if (phoneBySize || phoneByAgent) {
    return { deviceKind: 'phone', inputMode: 'touch' };
  }

  if (noPointingDevice && shortEdge !== null && shortEdge >= MEDIUM_MIN_WIDTH) {
    return { deviceKind: 'tablet', inputMode: 'touch' };
  }

  if (anyFine || hover) {
    return { deviceKind: 'computer', inputMode: 'mouse' };
  }

  return { deviceKind: 'unknown', inputMode: 'touch' };
}

/** 兩個鍵都認得才算存過。任一格不認得就當作沒存過。 */
export function readStoredInputMode(store: InputModeStore): InputModeGuess | null {
  const inputMode = store.getItem(INPUT_MODE_STORAGE_KEY);
  const deviceKind = store.getItem(DEVICE_KIND_STORAGE_KEY);
  if (!isPointerMode(inputMode) || !isDeviceKind(deviceKind)) return null;
  return { inputMode, deviceKind };
}

function writeStoredInputMode(store: InputModeStore, value: InputModeGuess): void {
  store.setItem(INPUT_MODE_STORAGE_KEY, value.inputMode);
  store.setItem(DEVICE_KIND_STORAGE_KEY, value.deviceKind);
}

/**
 * 有存過就原樣用，不理會現在的指標、方向或視窗大小。
 * 沒存過，或操作方式的值不認得，就猜一次並立刻寫入。
 * 操作方式認得、裝置種類不認得時，只補上稱呼，不改使用者選過的操作方式。
 */
export function ensureInputMode(store: InputModeStore, signals: DeviceSignals): StoredInputMode {
  const storedMode = store.getItem(INPUT_MODE_STORAGE_KEY);
  const storedKind = store.getItem(DEVICE_KIND_STORAGE_KEY);
  const modeOk = isPointerMode(storedMode);
  const kindOk = isDeviceKind(storedKind);

  if (modeOk && kindOk) {
    return { inputMode: storedMode, deviceKind: storedKind, guessed: false };
  }

  const guess = guessInputMode(signals);
  if (modeOk && !kindOk) {
    const kept: InputModeGuess = { inputMode: storedMode, deviceKind: guess.deviceKind };
    writeStoredInputMode(store, kept);
    return { ...kept, guessed: false };
  }

  writeStoredInputMode(store, guess);
  return { ...guess, guessed: true };
}

/** 使用者改了操作方式。只寫操作方式，裝置稱呼留著。 */
export function commitInputMode(store: InputModeStore, inputMode: PointerMode): void {
  store.setItem(INPUT_MODE_STORAGE_KEY, inputMode);
}

const ARROW_ORDER: readonly PointerMode[] = ['touch', 'mouse'];

/** 方向鍵在兩格之間移動。左右上下都會切換；其他鍵不動。 */
export function inputModeAfterArrow(current: PointerMode, key: string): PointerMode | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
    return null;
  }
  const index = ARROW_ORDER.indexOf(current);
  const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  const next = (index + delta + ARROW_ORDER.length) % ARROW_ORDER.length;
  return ARROW_ORDER[next] ?? current;
}

/** 從這個瀏覽器讀判斷用的訊號。沒有 matchMedia 時後面的猜測會走「這個裝置」。 */
export function readDeviceSignals(): DeviceSignals {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return {
      hasMatchMedia: false,
      userAgent,
      maxTouchPoints,
      anyPointerFine: false,
      hover: false,
    };
  }

  let anyPointerFine = false;
  let hover = false;
  try {
    anyPointerFine = window.matchMedia('(any-pointer: fine)').matches;
    hover = window.matchMedia('(hover: hover)').matches;
  } catch {
    return {
      hasMatchMedia: false,
      userAgent,
      maxTouchPoints,
      anyPointerFine: false,
      hover: false,
    };
  }

  const width = window.screen?.width;
  const height = window.screen?.height;
  const screenShortEdge =
    typeof width === 'number' && typeof height === 'number' ? Math.min(width, height) : undefined;

  return {
    hasMatchMedia: true,
    userAgent,
    maxTouchPoints,
    anyPointerFine,
    hover,
    screenShortEdge,
  };
}
