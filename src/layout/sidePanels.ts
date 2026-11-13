/**
 * 側欄開關狀態骨架與純函式（WO-54）
 *
 * 規則：
 * 1. wide 且 one-side（1024–1279）：打開一邊會自動收起另一邊，關閉該邊後自動恢復原本那一邊。
 * 2. wide 且 both（≥ 1280）：左右側欄可同時打開。
 * 3. phone-* 與 medium：左右側欄同時最多開一個（抽屜／讓位）。
 * 4. 專注模式：進入時記住哪幾欄開著並全部收起；離開時原樣恢復。（不加任何快捷鍵）
 */

import type { LayoutResolution } from './layoutMode';

export interface SidePanelsState {
  left: boolean;
  right: boolean;
}

export type SidePanelName = 'left' | 'right';

export interface PanelsState {
  sidePanels: SidePanelsState;
  focusMode: boolean;
  savedBeforeFocus: SidePanelsState | null;
  savedForOneSide: SidePanelName | null;
}

export function createInitialPanelsState(
  initial?: Partial<SidePanelsState> & { focusMode?: boolean },
  layout?: LayoutResolution,
): PanelsState {
  const defaultLeft = layout?.mode === 'wide' ? true : false;
  const initialFocus = Boolean(initial?.focusMode);
  return {
    sidePanels: {
      left: initialFocus ? false : (initial?.left ?? defaultLeft),
      right: initialFocus ? false : (initial?.right ?? false),
    },
    focusMode: initialFocus,
    savedBeforeFocus: initialFocus
      ? { left: initial?.left ?? defaultLeft, right: initial?.right ?? false }
      : null,
    savedForOneSide: null,
  };
}

/**
 * 打開側欄
 */
export function openSidePanel(
  state: PanelsState,
  side: SidePanelName,
  layout: LayoutResolution,
): PanelsState {
  const otherSide: SidePanelName = side === 'left' ? 'right' : 'left';
  const otherWasOpen = state.sidePanels[otherSide];

  // 若目前在專注模式中，打開側欄自動解除專注模式
  const baseFocus = false;
  const baseSavedBeforeFocus = null;

  // 1. 寬版且 one-side：打開一邊自動收起另一邊，並記住被收起的那一邊
  if (layout.mode === 'wide' && layout.wideColumns === 'one-side') {
    return {
      sidePanels: {
        left: side === 'left',
        right: side === 'right',
      },
      focusMode: baseFocus,
      savedBeforeFocus: baseSavedBeforeFocus,
      savedForOneSide: otherWasOpen ? otherSide : null,
    };
  }

  // 2. 寬版且 both：左右側欄可同時開啟
  if (layout.mode === 'wide' && layout.wideColumns === 'both') {
    return {
      sidePanels: {
        ...state.sidePanels,
        [side]: true,
      },
      focusMode: baseFocus,
      savedBeforeFocus: baseSavedBeforeFocus,
      savedForOneSide: null,
    };
  }

  // 3. 手機版與中等版面：左右同時最多開一個（抽屜／讓位）
  return {
    sidePanels: {
      left: side === 'left',
      right: side === 'right',
    },
    focusMode: baseFocus,
    savedBeforeFocus: baseSavedBeforeFocus,
    savedForOneSide: null,
  };
}

/**
 * 關閉側欄
 */
export function closeSidePanel(
  state: PanelsState,
  side: SidePanelName,
  layout: LayoutResolution,
): PanelsState {
  const otherSide: SidePanelName = side === 'left' ? 'right' : 'left';

  // 1. 寬版且 one-side：關閉時，若之前有被自動收起的另一邊，自動恢復該邊
  if (
    layout.mode === 'wide' &&
    layout.wideColumns === 'one-side' &&
    state.savedForOneSide === otherSide
  ) {
    return {
      ...state,
      sidePanels: {
        left: otherSide === 'left',
        right: otherSide === 'right',
      },
      savedForOneSide: null,
    };
  }

  return {
    ...state,
    sidePanels: {
      ...state.sidePanels,
      [side]: false,
    },
    savedForOneSide: null,
  };
}

/**
 * 切換側欄開關
 */
export function toggleSidePanel(
  state: PanelsState,
  side: SidePanelName,
  layout: LayoutResolution,
): PanelsState {
  if (state.sidePanels[side]) {
    return closeSidePanel(state, side, layout);
  }
  return openSidePanel(state, side, layout);
}

/**
 * 進入專注模式：記住開著的側欄並全部收起
 */
export function enterFocusMode(state: PanelsState): PanelsState {
  if (state.focusMode) return state;

  return {
    sidePanels: { left: false, right: false },
    focusMode: true,
    savedBeforeFocus: { ...state.sidePanels },
    savedForOneSide: state.savedForOneSide,
  };
}

/**
 * 離開專注模式：原樣恢復進入前側欄狀態
 */
export function exitFocusMode(
  state: PanelsState,
  layout?: LayoutResolution,
): PanelsState {
  if (!state.focusMode) return state;

  const restored = state.savedBeforeFocus ?? { left: false, right: false };

  // 若有提供版面資訊，做一次版面規則校正
  let finalPanels = restored;
  if (layout) {
    if (layout.mode === 'wide' && layout.wideColumns === 'one-side') {
      if (restored.left && restored.right) {
        // one-side 不可兩側同時開啟，優先保留左側
        finalPanels = { left: true, right: false };
      }
    } else if (layout.mode !== 'wide') {
      if (restored.left && restored.right) {
        // 手機與中等最多開一個
        finalPanels = { left: true, right: false };
      }
    }
  }

  return {
    sidePanels: finalPanels,
    focusMode: false,
    savedBeforeFocus: null,
    savedForOneSide: state.savedForOneSide,
  };
}

/**
 * 切換專注模式
 */
export function toggleFocusMode(
  state: PanelsState,
  layout?: LayoutResolution,
): PanelsState {
  return state.focusMode ? exitFocusMode(state, layout) : enterFocusMode(state);
}

/**
 * 版面變更時校正側欄狀態
 */
export function normalizePanelsForLayout(
  state: PanelsState,
  layout: LayoutResolution,
): PanelsState {
  if (state.focusMode) return state;

  if (layout.mode === 'wide' && layout.wideColumns === 'both') {
    return state;
  }

  // 若兩邊同時開著，但目前版面只允許最多開一邊
  if (state.sidePanels.left && state.sidePanels.right) {
    if (layout.mode === 'wide' && layout.wideColumns === 'one-side') {
      return {
        ...state,
        sidePanels: { left: true, right: false },
        savedForOneSide: 'right',
      };
    }
    return {
      ...state,
      sidePanels: { left: true, right: false },
      savedForOneSide: null,
    };
  }

  return state;
}
