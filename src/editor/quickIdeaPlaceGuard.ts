/**
 * WO-144：記靈感的「焦點交接」保護。
 *
 * 一、零寫入（返工 A）：不論從頁首燈泡或「⋯」選單進入，正文因為焦點移到選單／記入欄而失焦，
 *    都不能因此寫入游標或閱讀位置；取消、點背景、Esc 關掉後也一樣沒有寫入。
 *    保護從「按下『⋯』要開選單」的那一刻就開始（選單一開就會把焦點移走），而不是等點了「記靈感」才設。
 *    選單階段的失焦寫入先「暫緩」不丟掉：
 *    - 最後沒有進記靈感（例如選了排版、版本，或只開選單又關掉）→ 選單收起時照原樣補寫，行為與沒有這個功能時相同；
 *    - 進了記靈感 → 整段結束時直接丟掉暫緩的寫入（取消零寫入；存起來走另一條寫稿子的路）。
 *
 * 二、橫拿打字鎖定（返工 B）：「⋯」打開當下記住是不是橫拿打字（html.landscape-writing）。
 *    選單搶走焦點會讓即時判斷變成「鍵盤已收」，所以選單開著的期間一律用開啟當下的值。
 */
export interface PlaceWriters {
  remember: () => void;
  save: () => void;
}

export interface QuickIdeaPlaceGuard {
  /** 「⋯」選單要開了（在焦點被移走之前呼叫）；記下當下是不是橫拿打字。 */
  beginMenu: (landscapeTypingNow: boolean) => void;
  /** 進入記靈感（燈泡或選單項）；沒有進行中的階段就自己開一段。 */
  enterQuickIdea: () => void;
  /** 目前是否在保護階段。 */
  isActive: () => boolean;
  /** 選單開啟當下鎖定的「橫拿打字」；沒有鎖定回 null。 */
  lockedLandscape: () => boolean | null;
  /** 暫緩一組位置寫入（只留最新一組）。 */
  defer: (writers: PlaceWriters) => void;
  /** 選單與記入畫面都已關閉：進過記靈感就丟掉暫緩的寫入，否則補寫。 */
  end: () => void;
  /** 目前是否在「面板關閉後的收尾保護」（等鍵盤與版面穩定）。 */
  isTail: () => boolean;
  /** 收尾保護的世代；重新開選單／記入畫面後舊的收尾計時失效。 */
  tailToken: () => number;
  /** 結束收尾保護、恢復一般存位置；token 不符（已重新開啟）時什麼都不做。 */
  finishTail: (token?: number) => void;
  /** 使用者主動輸入（touch／wheel／鍵盤）：收尾保護中就立即結束，否則什麼都不做。 */
  userInput: () => void;
}

export function createQuickIdeaPlaceGuard(): QuickIdeaPlaceGuard {
  let active = false;
  let entered = false;
  let locked: boolean | null = null;
  let pending: PlaceWriters | null = null;
  let tail = false;
  let token = 0;

  const finishTail = (t?: number) => {
    if (!tail || (t !== undefined && t !== token)) return;
    tail = false;
    active = false;
  };

  return {
    beginMenu: (landscapeTypingNow) => {
      tail = false;
      token += 1;
      active = true;
      entered = false;
      locked = landscapeTypingNow;
    },
    enterQuickIdea: () => {
      tail = false;
      token += 1;
      active = true;
      entered = true;
    },
    isActive: () => active,
    lockedLandscape: () => locked,
    defer: (writers) => {
      pending = writers;
    },
    end: () => {
      const toFlush = !entered ? pending : null;
      // 進過記靈感：面板關了之後鍵盤與版面可能還在變動，保護先不解除（active 維持 true），
      // 交給 startTailWatch 等穩定或逾時、或使用者主動輸入才結束。
      tail = entered;
      token += 1;
      active = entered;
      entered = false;
      locked = null;
      pending = null;
      if (toFlush) {
        toFlush.remember();
        toFlush.save();
      }
    },
    isTail: () => tail,
    tailToken: () => token,
    finishTail,
    userInput: () => finishTail(),
  };
}

/** 收尾保護：可視區最後一次變動後安靜這麼久就視為穩定（iPhone 鍵盤收合動畫約 0.25～0.3 秒）。 */
export const TAIL_QUIET_MS = 350;
/** 收尾保護上限：即使可視區一直在變，最多保護這麼久就恢復存位置。 */
export const TAIL_MAX_MS = 1200;

export interface TailWatchEnv {
  /** 訂閱可視區 resize；回傳取消函式，沒有可視區時回 null。沒傳就用 window.visualViewport（測試可傳假的）。 */
  onViewportResize?: (cb: () => void) => (() => void) | null;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

function defaultViewportResize(cb: () => void): (() => void) | null {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return null;
  vv.addEventListener('resize', cb);
  return () => vv.removeEventListener('resize', cb);
}

/**
 * 面板關閉後（guard.isTail()）等 visualViewport 的 resize 穩定（安靜 TAIL_QUIET_MS），
 * 或總時限 TAIL_MAX_MS 到，就結束收尾保護。使用者主動輸入會由 guard.userInput() 提早結束。
 * 回傳取消函式（元件卸載或重新開啟時呼叫）。沒有在收尾階段時什麼都不做。
 */
export function startTailWatch(guard: QuickIdeaPlaceGuard, envIn: TailWatchEnv = {}): () => void {
  if (!guard.isTail()) return () => {};
  const env = {
    onViewportResize: envIn.onViewportResize ?? defaultViewportResize,
    setTimeout: envIn.setTimeout ?? ((cb: () => void, ms: number): unknown => window.setTimeout(cb, ms)),
    clearTimeout: envIn.clearTimeout ?? ((id: unknown) => window.clearTimeout(id as number)),
  };
  const token = guard.tailToken();
  let quietTimer: unknown = null;
  let unsub: (() => void) | null = null;
  let maxTimer: unknown = null;
  const cancel = () => {
    if (quietTimer !== null) env.clearTimeout(quietTimer);
    if (maxTimer !== null) env.clearTimeout(maxTimer);
    quietTimer = null;
    maxTimer = null;
    unsub?.();
    unsub = null;
  };
  const done = () => {
    cancel();
    guard.finishTail(token);
  };
  const armQuiet = () => {
    if (quietTimer !== null) env.clearTimeout(quietTimer);
    quietTimer = env.setTimeout(done, TAIL_QUIET_MS);
  };
  maxTimer = env.setTimeout(done, TAIL_MAX_MS);
  unsub = env.onViewportResize(armQuiet);
  armQuiet();
  return cancel;
}

/**
 * 正文失焦時要不要寫入游標／閱讀位置。保護階段中改為暫緩（回 false，沒呼叫任何寫入）。
 */
export function persistPlaceOnBodyBlur(guard: QuickIdeaPlaceGuard, writers: PlaceWriters): boolean {
  if (guard.isActive()) {
    guard.defer(writers);
    return false;
  }
  writers.remember();
  writers.save();
  return true;
}

/**
 * 正文 onScroll 要不要寫入閱讀位置。保護階段中（「⋯」選單、燈泡、記入畫面開著）
 * 因焦點切換、鍵盤收起、可視區變高而發生的捲動不是使用者在閱讀，一律不寫（回 false，沒呼叫寫入）。
 * 沒有保護階段時照常寫入，一般閱讀與打字不受影響。
 * 這類捲動是直接丟掉、不暫緩：取消時寫入次數為零；若階段最後沒進記靈感，
 * 補寫的是失焦那一組（見 end），之後使用者真正捲動會再正常記錄。
 */
export function persistScrollPlace(guard: QuickIdeaPlaceGuard, save: () => void): boolean {
  if (guard.isActive()) return false;
  save();
  return true;
}

/** 目前（選單開著時用開啟當下鎖定的值，否則用即時值）是否提供「記靈感」。 */
export function isQuickIdeaAvailable(guard: QuickIdeaPlaceGuard, landscapeTypingNow: boolean): boolean {
  return !(guard.lockedLandscape() ?? landscapeTypingNow);
}

/** 燈泡與「⋯」選單項共用的開啟判斷。回 'open' 時已進入保護階段，呼叫端再開畫面。 */
export function tryEnterQuickIdea(
  guard: QuickIdeaPlaceGuard,
  state: { landscapeTypingNow: boolean; composing: boolean },
): 'blocked' | 'composing' | 'open' {
  if (!isQuickIdeaAvailable(guard, state.landscapeTypingNow)) return 'blocked';
  if (state.composing) return 'composing';
  guard.enterQuickIdea();
  return 'open';
}

/** 狀態變動後呼叫：選單與記入畫面都關了就結束保護階段。 */
export function settleQuickIdeaSession(
  guard: QuickIdeaPlaceGuard,
  state: { menuOpen: boolean; quickIdeaOpen: boolean },
): void {
  if (!state.menuOpen && !state.quickIdeaOpen) guard.end();
}
