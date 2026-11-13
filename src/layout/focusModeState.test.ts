import { describe, expect, it } from 'vitest';
import {
  createLandscapeExitState,
  INITIAL_LANDSCAPE_EXIT_STATE,
  LANDSCAPE_EXIT_TIMEOUT_MS,
  landscapeExitReducer,
  type LandscapeExitState,
} from './focusModeState';

describe('WO-62：手機橫拿離開鈕純函式 reducer 驗證', () => {
  it('WO-62：第一次點只展開文字、狀態仍在專注模式；第二次點才離開', () => {
    // 初始狀態為未展開
    const initial = INITIAL_LANDSCAPE_EXIT_STATE;
    expect(initial.expanded).toBe(false);

    // 第一次點擊：僅展開文字，shouldExit 為 false，狀態仍在專注模式中
    const firstClick = landscapeExitReducer(initial, { type: 'click' });
    expect(firstClick.nextState.expanded).toBe(true);
    expect(firstClick.shouldExit).toBe(false);

    // 第二次點擊：展開狀態下點擊，shouldExit 為 true，離開專注模式
    const secondClick = landscapeExitReducer(firstClick.nextState, { type: 'click' });
    expect(secondClick.nextState.expanded).toBe(false);
    expect(secondClick.shouldExit).toBe(true);
  });

  it('WO-62：展開後若未點擊，約 3 秒收合（collapse 動作收回字樣）', () => {
    // 逾時時間常數為 3000ms（約 3 秒）
    expect(LANDSCAPE_EXIT_TIMEOUT_MS).toBe(3000);

    const expandedState = createLandscapeExitState(true);
    const collapsed = landscapeExitReducer(expandedState, { type: 'collapse' });

    expect(collapsed.nextState.expanded).toBe(false);
    expect(collapsed.shouldExit).toBe(false);
  });

  it('WO-62：展開後逾時收合，再次點擊時重新當作第一次點擊（只展開文字、不離開）', () => {
    let state: LandscapeExitState = INITIAL_LANDSCAPE_EXIT_STATE;

    // 第一次點擊：展開文字
    const click1 = landscapeExitReducer(state, { type: 'click' });
    expect(click1.nextState.expanded).toBe(true);
    expect(click1.shouldExit).toBe(false);
    state = click1.nextState;

    // 約 3 秒沒點擊：自動收合
    const timeout = landscapeExitReducer(state, { type: 'collapse' });
    expect(timeout.nextState.expanded).toBe(false);
    expect(timeout.shouldExit).toBe(false);
    state = timeout.nextState;

    // 再次點擊：重新計算，只展開文字，不觸發離開
    const click2 = landscapeExitReducer(state, { type: 'click' });
    expect(click2.nextState.expanded).toBe(true);
    expect(click2.shouldExit).toBe(false);
  });

  it('WO-62：reset 動作可隨時重設回未展開狀態且不觸發離開', () => {
    const expandedState = createLandscapeExitState(true);
    const resetResult = landscapeExitReducer(expandedState, { type: 'reset' });

    expect(resetResult.nextState.expanded).toBe(false);
    expect(resetResult.shouldExit).toBe(false);
  });

  it('WO-62：純函式 reducer 保持狀態不可變性（immutability），不修改傳入的 state 物件', () => {
    const originalState = Object.freeze({ expanded: false });
    const result1 = landscapeExitReducer(originalState, { type: 'click' });

    expect(originalState.expanded).toBe(false);
    expect(result1.nextState).not.toBe(originalState);
    expect(result1.nextState.expanded).toBe(true);

    const frozenExpanded = Object.freeze({ expanded: true });
    const result2 = landscapeExitReducer(frozenExpanded, { type: 'click' });

    expect(frozenExpanded.expanded).toBe(true);
    expect(result2.nextState).not.toBe(frozenExpanded);
    expect(result2.nextState.expanded).toBe(false);
    expect(result2.shouldExit).toBe(true);
  });
});

