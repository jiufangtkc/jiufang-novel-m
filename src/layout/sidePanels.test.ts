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

describe('WO-54：側欄開關規則與專注模式狀態純函式', () => {
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

  describe('WO-54：專注模式規則（進入時記住並全部收起，離開時原樣恢復；不加任何快捷鍵）', () => {
    it('WO-54：進入專注模式前兩欄皆開，進入後全收，離開後兩欄皆恢復', () => {
      let state = createInitialPanelsState({ left: true, right: true });

      // 進入專注模式
      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });
      expect(state.savedBeforeFocus).toEqual({ left: true, right: true });

      // 離開專注模式
      state = exitFocusMode(state, wideBoth);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: true, right: true });
      expect(state.savedBeforeFocus).toBeNull();
    });

    it('WO-54：進入專注模式前僅左欄開啟，離開後僅左欄恢復', () => {
      let state = createInitialPanelsState({ left: true, right: false });

      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });

      state = exitFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: true, right: false });
    });

    it('WO-54：toggleFocusMode 切換專注模式', () => {
      let state = createInitialPanelsState({ left: false, right: true });

      state = toggleFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });

      state = toggleFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: false, right: true });
    });

    it('WO-54：在專注模式中若使用者主動打開側欄，自動解除專注模式', () => {
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

  describe('WO-62：四種版面專注模式進出與離開後側欄恢復驗證', () => {
    it('WO-62：① 手機直拿（phone-portrait）進入專注模式側欄全收，離開後側欄原樣恢復', () => {
      // 情況 1：進入前目錄開啟
      let portraitTree = createInitialPanelsState({ left: true, right: false }, phonePortrait);
      portraitTree = enterFocusMode(portraitTree);
      expect(portraitTree.focusMode).toBe(true);
      expect(portraitTree.sidePanels).toEqual({ left: false, right: false });

      portraitTree = exitFocusMode(portraitTree, phonePortrait);
      expect(portraitTree.focusMode).toBe(false);
      expect(portraitTree.sidePanels).toEqual({ left: true, right: false });

      // 情況 2：進入前看卡片開啟
      let portraitCards = createInitialPanelsState({ left: false, right: true }, phonePortrait);
      portraitCards = enterFocusMode(portraitCards);
      expect(portraitCards.focusMode).toBe(true);
      expect(portraitCards.sidePanels).toEqual({ left: false, right: false });

      portraitCards = exitFocusMode(portraitCards, phonePortrait);
      expect(portraitCards.focusMode).toBe(false);
      expect(portraitCards.sidePanels).toEqual({ left: false, right: true });

      // 情況 3：進入前兩者皆關閉
      let portraitNone = createInitialPanelsState({ left: false, right: false }, phonePortrait);
      portraitNone = enterFocusMode(portraitNone);
      expect(portraitNone.focusMode).toBe(true);
      expect(portraitNone.sidePanels).toEqual({ left: false, right: false });

      portraitNone = exitFocusMode(portraitNone, phonePortrait);
      expect(portraitNone.focusMode).toBe(false);
      expect(portraitNone.sidePanels).toEqual({ left: false, right: false });
    });

    it('WO-62：② 手機橫拿（phone-landscape）進入專注模式側欄全收，離開後側欄原樣恢復', () => {
      // 情況 1：進入前目錄開啟
      let landscapeTree = createInitialPanelsState({ left: true, right: false }, phoneLandscape);
      landscapeTree = enterFocusMode(landscapeTree);
      expect(landscapeTree.focusMode).toBe(true);
      expect(landscapeTree.sidePanels).toEqual({ left: false, right: false });

      landscapeTree = exitFocusMode(landscapeTree, phoneLandscape);
      expect(landscapeTree.focusMode).toBe(false);
      expect(landscapeTree.sidePanels).toEqual({ left: true, right: false });

      // 情況 2：進入前看卡片開啟
      let landscapeCards = createInitialPanelsState({ left: false, right: true }, phoneLandscape);
      landscapeCards = enterFocusMode(landscapeCards);
      expect(landscapeCards.focusMode).toBe(true);
      expect(landscapeCards.sidePanels).toEqual({ left: false, right: false });

      landscapeCards = exitFocusMode(landscapeCards, phoneLandscape);
      expect(landscapeCards.focusMode).toBe(false);
      expect(landscapeCards.sidePanels).toEqual({ left: false, right: true });

      // 情況 3：進入前兩者皆關閉
      let landscapeNone = createInitialPanelsState({ left: false, right: false }, phoneLandscape);
      landscapeNone = enterFocusMode(landscapeNone);
      expect(landscapeNone.focusMode).toBe(true);
      expect(landscapeNone.sidePanels).toEqual({ left: false, right: false });

      landscapeNone = exitFocusMode(landscapeNone, phoneLandscape);
      expect(landscapeNone.focusMode).toBe(false);
      expect(landscapeNone.sidePanels).toEqual({ left: false, right: false });
    });

    it('WO-62：③ 中等版面（medium）進入專注模式側欄全收，離開後側欄原樣恢復', () => {
      // 情況 1：進入前目錄開啟
      let mediumTree = createInitialPanelsState({ left: true, right: false }, mediumLayout);
      mediumTree = enterFocusMode(mediumTree);
      expect(mediumTree.focusMode).toBe(true);
      expect(mediumTree.sidePanels).toEqual({ left: false, right: false });

      mediumTree = exitFocusMode(mediumTree, mediumLayout);
      expect(mediumTree.focusMode).toBe(false);
      expect(mediumTree.sidePanels).toEqual({ left: true, right: false });

      // 情況 2：進入前看卡片開啟
      let mediumCards = createInitialPanelsState({ left: false, right: true }, mediumLayout);
      mediumCards = enterFocusMode(mediumCards);
      expect(mediumCards.focusMode).toBe(true);
      expect(mediumCards.sidePanels).toEqual({ left: false, right: false });

      mediumCards = exitFocusMode(mediumCards, mediumLayout);
      expect(mediumCards.focusMode).toBe(false);
      expect(mediumCards.sidePanels).toEqual({ left: false, right: true });

      // 情況 3：進入前兩者皆關閉
      let mediumNone = createInitialPanelsState({ left: false, right: false }, mediumLayout);
      mediumNone = enterFocusMode(mediumNone);
      expect(mediumNone.focusMode).toBe(true);
      expect(mediumNone.sidePanels).toEqual({ left: false, right: false });

      mediumNone = exitFocusMode(mediumNone, mediumLayout);
      expect(mediumNone.focusMode).toBe(false);
      expect(mediumNone.sidePanels).toEqual({ left: false, right: false });
    });

    it('WO-62：④ 寬版（wide both）進入專注模式側欄全收，離開後側欄原樣恢復（支援雙欄皆開）', () => {
      // 情況 1：進入前左右兩欄皆開啟
      let bothOpen = createInitialPanelsState({ left: true, right: true }, wideBoth);
      bothOpen = enterFocusMode(bothOpen);
      expect(bothOpen.focusMode).toBe(true);
      expect(bothOpen.sidePanels).toEqual({ left: false, right: false });

      bothOpen = exitFocusMode(bothOpen, wideBoth);
      expect(bothOpen.focusMode).toBe(false);
      expect(bothOpen.sidePanels).toEqual({ left: true, right: true });

      // 情況 2：進入前僅左欄開啟
      let leftOnly = createInitialPanelsState({ left: true, right: false }, wideBoth);
      leftOnly = enterFocusMode(leftOnly);
      expect(leftOnly.focusMode).toBe(true);
      expect(leftOnly.sidePanels).toEqual({ left: false, right: false });

      leftOnly = exitFocusMode(leftOnly, wideBoth);
      expect(leftOnly.focusMode).toBe(false);
      expect(leftOnly.sidePanels).toEqual({ left: true, right: false });

      // 情況 3：進入前兩欄皆關閉
      let noneOpen = createInitialPanelsState({ left: false, right: false }, wideBoth);
      noneOpen = enterFocusMode(noneOpen);
      expect(noneOpen.focusMode).toBe(true);
      expect(noneOpen.sidePanels).toEqual({ left: false, right: false });

      noneOpen = exitFocusMode(noneOpen, wideBoth);
      expect(noneOpen.focusMode).toBe(false);
      expect(noneOpen.sidePanels).toEqual({ left: false, right: false });
    });

    it('WO-62：④ 寬版（wide one-side）進入專注模式側欄全收，離開後側欄恢復且保留 savedForOneSide 記憶', () => {
      // 寬版預設左欄開啟
      let state = createInitialPanelsState(undefined, wideOneSide);
      expect(state.sidePanels).toEqual({ left: true, right: false });

      // 打開右欄：左欄自動收起，並記錄 savedForOneSide: 'left'
      state = openSidePanel(state, 'right', wideOneSide);
      expect(state.sidePanels).toEqual({ left: false, right: true });
      expect(state.savedForOneSide).toBe('left');

      // 進入專注模式：全收
      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);
      expect(state.sidePanels).toEqual({ left: false, right: false });
      expect(state.savedForOneSide).toBe('left');

      // 離開專注模式：恢復右欄開啟，且 savedForOneSide: 'left' 依然保留
      state = exitFocusMode(state, wideOneSide);
      expect(state.focusMode).toBe(false);
      expect(state.sidePanels).toEqual({ left: false, right: true });
      expect(state.savedForOneSide).toBe('left');

      // 關閉右欄：左欄依然能正確自動恢復
      state = closeSidePanel(state, 'right', wideOneSide);
      expect(state.sidePanels).toEqual({ left: true, right: false });
      expect(state.savedForOneSide).toBeNull();
    });

    it('WO-62：重複呼叫 enterFocusMode 或在非專注模式呼叫 exitFocusMode 維持等冪性不損壞狀態', () => {
      let state = createInitialPanelsState({ left: true, right: false }, mediumLayout);

      // 非專注模式呼叫 exitFocusMode 不改變狀態
      const untouched = exitFocusMode(state, mediumLayout);
      expect(untouched).toBe(state);

      // 進入專注模式
      state = enterFocusMode(state);
      expect(state.focusMode).toBe(true);

      // 重複呼叫 enterFocusMode 不改變狀態
      const reEnter = enterFocusMode(state);
      expect(reEnter).toBe(state);
    });
  });
});
