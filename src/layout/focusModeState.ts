/**
 * 專注模式狀態與橫拿防誤觸離開狀態機（WO-62）
 *
 * 九方定案：
 * 手機橫拿專注時只留右上角一顆淡淡的離開按鈕（44×44，只有圖示，朗讀「離開專注模式」）。
 * 第一次點先展開「離開專注模式」字樣，再點一次才離開（防誤觸；展開後約 3 秒沒點就收回）。
 * 本模組提供純函式／狀態機 reducer，使行為具備高可測試性與確定性。
 */

export interface LandscapeExitState {
  expanded: boolean;
}

export type LandscapeExitAction =
  | { type: 'click' }
  | { type: 'collapse' }
  | { type: 'reset' };

export interface LandscapeExitResult {
  nextState: LandscapeExitState;
  shouldExit: boolean;
}

/** 展開後未點擊之自動收合時間（毫秒） */
export const LANDSCAPE_EXIT_TIMEOUT_MS = 3000;

export const INITIAL_LANDSCAPE_EXIT_STATE: LandscapeExitState = {
  expanded: false,
};

/**
 * 建立手機橫拿離開狀態
 */
export function createLandscapeExitState(expanded = false): LandscapeExitState {
  return { expanded };
}

/**
 * 手機橫拿離開按鈕純函式 reducer
 */
export function landscapeExitReducer(
  state: LandscapeExitState,
  action: LandscapeExitAction,
): LandscapeExitResult {
  switch (action.type) {
    case 'click':
      if (!state.expanded) {
        return {
          nextState: { expanded: true },
          shouldExit: false,
        };
      }
      return {
        nextState: { expanded: false },
        shouldExit: true,
      };
    case 'collapse':
    case 'reset':
      return {
        nextState: { expanded: false },
        shouldExit: false,
      };
    default:
      return {
        nextState: state,
        shouldExit: false,
      };
  }
}
