import { describe, expect, it } from 'vitest';
import type { LayoutResolution } from './layoutMode';
import {
  closeSidePanel,
  createInitialPanelsState,
  enterFocusMode,
  exitFocusMode,
  normalizePanelsForLayout,
  openSidePanel,
  toggleFocusMode,
  toggleSidePanel,
} from './sidePanels';

describe('WO-54：側欄開關規則與專心模式狀態純函式', () => {
  const wideOneSide: LayoutResolution = { mode: 'wide', wideColumns: 'one-side' };
  const wideBoth: LayoutResolution = { mode: 'wide', wideColumns: 'both' };
  const mediumLayout: LayoutResolution = { mode: 'medium', wideColumns: null };
  const phonePortrait: LayoutResolution = { mode: 'phone-portrait', wideColumns: null };
  const phoneLandscape: LayoutResolution = { mode: 'phone-landscape', wideColumns: null };

  describe('WO-54：wide 且 one-side 規則（打開一邊自動收起另一邊，關掉後恢復原本那一邊）', () => {
    it('WO-54：原本開著左邊，打開右邊時左邊自動收起；關掉右邊後，左邊自動恢復', () => {
      // 初始：左側目錄開著
      let state = createInitialPanelsState({ left: true, right: false });
      expect(state.sidePanels).toEqual({ left: true, right: false });

      // 打開右側卡片面板
      state = openSidePanel(state, 'right', wideOneSide);
      // 右側打開，左側自動收起
      expect(state.sidePanels).toEqual({ left: false, right: true });
      expect(state.savedForOneSide).toBe('left');

      // 關閉右側面板
      state = closeSidePanel(state, 'right', wideOneSide);
      // 原本被自動收起的左側自動恢復
      expect(state.sidePanels).toEqual({ left: true, right: false });
      expect(state.savedForOneSide).toBeNull();
    });

    it('WO-54：原本開著右邊，打開左邊時右邊自動收起；關閉左邊後，右邊自動恢復', () => {
      let state = createInitialPanelsState({ left: false, right: true });

      // 打開左側目錄
      state = openSidePanel(state, 'left', wideOneSide);
      expect(state.sidePanels).toEqual({ left: true, right: false });
      expect(state.savedForOneSide).toBe('right');

      // 關閉左側目錄
      state = closeSidePanel(state, 'left', wideOneSide);
      expect(state.sidePanels).toEqual({ left: false, right: true });
      expect(state.savedForOneSide).toBeNull();
    });

    it('WO-54：原本兩邊都沒開，打開右邊再關閉右邊，不會誤打開左邊', () => {
      let state = createInitialPanelsState({ left: false, right: false });

      // 打開右邊
      state = openSidePanel(state, 'right', wideOneSide);
      expect(state.sidePanels).toEqual({ left: false, right: true });
      expect(state.savedForOneSide).toBeNull();

      // 關閉右邊
      state = closeSidePanel(state, 'right', wideOneSide);
      expect(state.sidePanels).toEqual({ left: false, right: false });
      expect(state.savedForOneSide).toBeNull();
    });

    it('WO-54：toggleSidePanel 在 one-side 下正確切換與恢復', () => {
      let state = createInitialPanelsState({ left: true, right: false });

      // 切換右邊（開）
      state = toggleSidePanel(state, 'right', wideOneSide);
      expect(state.sidePanels).toEqual({ left: false, right: true });

      // 切換右邊（關）
      state = toggleSidePanel(state, 'right', wideOneSide);
      expect(state.sidePanels).toEqual({ left: true, right: false });
    });
  });

  describe('WO-54：wide 且 both 規則（左右兩欄可同時開啟）', () => {
    it('WO-54：打開右欄時，左欄不收起，可同時維持開啟', () => {
      let state = createInitialPanelsState({ left: true, right: false });

      state = openSidePanel(state, 'right', wideBoth);
      expect(state.sidePanels).toEqual({ left: true, right: true });

      // 關閉右欄，左欄維持開著
      state = closeSidePanel(state, 'right', wideBoth);
      expect(state.sidePanels).toEqual({ left: true, right: false });

      // 再關閉左欄
      state = closeSidePanel(state, 'left', wideBoth);
      expect(state.sidePanels).toEqual({ left: false, right: false });
    });
  });

  describe('WO-54：phone-* 與 medium 規則（左右同時最多開一個）', () => {
    it('WO-54：medium 中等版面，打開一側自動收起另一側，關閉時不自動復原', () => {
      let state = createInitialPanelsState({ left: true, right: false });

      state = openSidePanel(state, 'right', mediumLayout);
      expect(state.sidePanels).toEqual({ left: false, right: true });

      state = closeSidePanel(state, 'right', mediumLayout);
      expect(state.sidePanels).toEqual({ left: false, right: false });
    });

    it('WO-54：phone-portrait 手機直拿，左右同時最多開一個', () => {
      let state = createInitialPanelsState({ left: true, right: false });

      state = openSidePanel(state, 'right', phonePortrait);
      expect(state.sidePanels).toEqual({ left: false, right: true });

      state = openSidePanel(state, 'left', phonePortrait);
      expect(state.sidePanels).toEqual({ left: true, right: false });
    });

    it('WO-54：phone-landscape 手機橫拿，左右同時最多開一個', () => {
      let state = createInitialPanelsState({ left: false, right: true });

      state = openSidePanel(state, 'left', phoneLandscape);
      expect(state.sidePanels).toEqual({ left: true, right: false });
    });
  });

  describe('WO-54：專心模式規則（進入時記住並全部收起，離開時原樣恢復；不加任何快捷鍵）', () => {
    it('WO-54：進入專心模式前兩欄皆開，進入後全收，離開後兩欄皆恢復', () => {
      let state = createInitialPanelsState({ left: true, right: true });

      // 進入專心模式
      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });
      expect(state.savedBeforeFocus).toEqual({ left: true, right: true });

      // 離開專心模式
      state = exitFocusMode(state, wideBoth);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: true, right: true });
      expect(state.savedBeforeFocus).toBeNull();
    });

    it('WO-54：進入專心模式前僅左欄開啟，離開後僅左欄恢復', () => {
      let state = createInitialPanelsState({ left: true, right: false });

      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });

      state = exitFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: true, right: false });
    });

    it('WO-54：toggleFocusMode 切換專心模式', () => {
      let state = createInitialPanelsState({ left: false, right: true });

      state = toggleFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });

      state = toggleFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: false, right: true });
    });

    it('WO-54：在專心模式中若使用者主動打開側欄，自動解除專心模式', () => {
      let state = createInitialPanelsState({ left: true, right: false });
      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);

      state = openSidePanel(state, 'left', wideOneSide);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: true, right: false });
    });
  });

  describe('WO-54：版面縮放切換校正（normalizePanelsForLayout）', () => {
    it('WO-54：由 wide both 切換至 wide one-side，兩欄皆開時收起右欄並記錄', () => {
      const state = createInitialPanelsState({ left: true, right: true });
      const normalized = normalizePanelsForLayout(state, wideOneSide);

      expect(normalized.sidePanels).toEqual({ left: true, right: false });
      expect(normalized.savedForOneSide).toBe('right');
    });

    it('WO-54：由 wide 切換至 medium 時，兩欄皆開時收起右欄', () => {
      const state = createInitialPanelsState({ left: true, right: true });
      const normalized = normalizePanelsForLayout(state, mediumLayout);

      expect(normalized.sidePanels).toEqual({ left: true, right: false });
      expect(normalized.savedForOneSide).toBeNull();
    });
  });
});
