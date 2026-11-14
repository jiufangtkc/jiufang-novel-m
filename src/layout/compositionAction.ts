/**
 * 組字中延後 DOM 操作純函式與管理員（WO-54）
 *
 * 規則：
 * 組字中（compositionstart～compositionend）若需要做任何會影響正文的 DOM 動作（例如捲動校正），
 * 必須延後到 compositionend 之後執行；
 * 若未在組字中，則可立即執行。
 * 切換版面過程中絕不呼叫 blur() 或 focus()，保留正文游標與鍵盤焦點。
 */

import { revealCaret } from '../editor/caret';

export interface CompositionActionState {
  isComposing: boolean;
  hasPendingAction: boolean;
}

export function createCompositionActionState(): CompositionActionState {
  return {
    isComposing: false,
    hasPendingAction: false,
  };
}

/**
 * 判斷當前是否應延後執行影響正文之 DOM 動作
 */
export function shouldDeferActionDuringComposition(isComposing: boolean): boolean {
  return isComposing;
}

/**
 * 開始組字
 */
export function handleCompositionStart(state: CompositionActionState): CompositionActionState {
  return {
    ...state,
    isComposing: true,
  };
}

/**
 * 版面切換或觸發 DOM 動作請求
 */
export function handleLayoutChange(
  state: CompositionActionState,
): { state: CompositionActionState; shouldExecuteNow: boolean } {
  if (state.isComposing) {
    return {
      state: {
        ...state,
        hasPendingAction: true,
      },
      shouldExecuteNow: false,
    };
  }
  return {
    state,
    shouldExecuteNow: true,
  };
}

/**
 * 組字結束：檢查是否有排隊待執行的動作
 */
export function handleCompositionEnd(
  state: CompositionActionState,
): { state: CompositionActionState; shouldExecutePending: boolean } {
  const shouldExecutePending = state.hasPendingAction;
  return {
    state: {
      isComposing: false,
      hasPendingAction: false,
    },
    shouldExecutePending,
  };
}

/**
 * 組字中動作佇列管理員（供元件與 Hook 操作）
 */
export class CompositionActionQueue {
  private isComposing = false;
  private pendingCallback: (() => void) | null = null;

  startComposition(): void {
    this.isComposing = true;
  }

  endComposition(): void {
    this.isComposing = false;
    if (this.pendingCallback) {
      const callback = this.pendingCallback;
      this.pendingCallback = null;
      callback();
    }
  }

  scheduleDeferred(action: () => void): void {
    this.pendingCallback = action;
  }

  enqueueOrRun(action: () => void): boolean {
    if (this.isComposing) {
      this.pendingCallback = action;
      return false;
    }
    action();
    return true;
  }

  hasPending(): boolean {
    return this.pendingCallback !== null;
  }

  getComposing(): boolean {
    return this.isComposing;
  }

  clear(): void {
    this.pendingCallback = null;
  }
}

/**
 * 換版面時正文輸入框動作處理函式（供 EditorPane 與測試呼叫）
 *
 * 保證：
 * 1. 絕不呼叫 blur() 或 focus()，保護軟體鍵盤與游標焦點不被重置。
 * 2. selectionStart 與 selectionEnd 完全不被變動。
 * 3. 若正在組字中（isComposing 為 true），將 reveal 動作延後至 compositionend 後執行；
 * 4. 若未在組字中，則立即執行 reveal 捲動校正。
 */
export function handleEditorLayoutChange(options: {
  textarea: HTMLTextAreaElement | null;
  isComposing: boolean;
  queue: CompositionActionQueue;
  revealFn?: (el: HTMLTextAreaElement) => void;
}): { deferred: boolean; executed: boolean } {
  if (!options.textarea) {
    return { deferred: false, executed: false };
  }
  const el = options.textarea;
  const reveal = options.revealFn ?? revealCaret;

  if (options.isComposing) {
    options.queue.scheduleDeferred(() => {
      reveal(el);
    });
    return { deferred: true, executed: false };
  }

  reveal(el);
  return { deferred: false, executed: true };
}
