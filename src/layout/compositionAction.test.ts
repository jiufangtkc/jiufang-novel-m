import { describe, expect, it, vi } from 'vitest';
import {
  CompositionActionQueue,
  createCompositionActionState,
  handleCompositionEnd,
  handleCompositionStart,
  handleLayoutChange,
  shouldDeferActionDuringComposition,
} from './compositionAction';

describe('WO-54：組字中延後 DOM 操作純函式與佇列', () => {
  it('WO-54：shouldDeferActionDuringComposition 正確判斷', () => {
    expect(shouldDeferActionDuringComposition(true)).toBe(true);
    expect(shouldDeferActionDuringComposition(false)).toBe(false);
  });

  describe('WO-54：狀態轉換純函式', () => {
    it('WO-54：未在組字中時，換版面應立即執行動作', () => {
      const state = createCompositionActionState();
      const result = handleLayoutChange(state);

      expect(result.shouldExecuteNow).toBe(true);
      expect(result.state.hasPendingAction).toBe(false);
    });

    it('WO-54：正在組字中時，換版面應延後執行動作並記錄待辦', () => {
      let state = createCompositionActionState();
      state = handleCompositionStart(state);
      expect(state.isComposing).toBe(true);

      const result = handleLayoutChange(state);
      expect(result.shouldExecuteNow).toBe(false);
      expect(result.state.hasPendingAction).toBe(true);

      // 組字結束，應觸發待辦執行
      const endResult = handleCompositionEnd(result.state);
      expect(endResult.shouldExecutePending).toBe(true);
      expect(endResult.state.isComposing).toBe(false);
      expect(endResult.state.hasPendingAction).toBe(false);
    });

    it('WO-54：組字過程中若沒有版面變化，組字結束時不觸發多餘動作', () => {
      let state = createCompositionActionState();
      state = handleCompositionStart(state);
      const endResult = handleCompositionEnd(state);

      expect(endResult.shouldExecutePending).toBe(false);
      expect(endResult.state.isComposing).toBe(false);
    });
  });

  describe('WO-54：CompositionActionQueue 管理員', () => {
    it('WO-54：未組字時排入動作立即執行', () => {
      const queue = new CompositionActionQueue();
      const fn = vi.fn();

      const executed = queue.enqueueOrRun(fn);
      expect(executed).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('WO-54：組字中排入動作延到 endComposition 執行', () => {
      const queue = new CompositionActionQueue();
      const fn = vi.fn();

      queue.startComposition();
      expect(queue.getComposing()).toBe(true);

      const executed = queue.enqueueOrRun(fn);
      expect(executed).toBe(false);
      expect(fn).not.toHaveBeenCalled();
      expect(queue.hasPending()).toBe(true);

      queue.endComposition();
      expect(queue.getComposing()).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(queue.hasPending()).toBe(false);
    });
  });
});
