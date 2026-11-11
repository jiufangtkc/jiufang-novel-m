import { describe, expect, it, vi } from 'vitest';
import {
  captureCaretSnapshot,
  clearStoredWritingCardsView,
  COMPOSITION_TIMEOUT_MS,
  decideOpenCards,
  DEFAULT_WRITING_CARD_CATEGORY,
  getStoredWritingCardsView,
  handleCardsPointerDown,
  restoreCaretSnapshot,
  saveStoredWritingCardsView,
  shouldCancelPendingOpen,
  WRITING_CARDS_STORAGE_PREFIX,
} from './writingCards';

describe('writingCards 領域邏輯（WO-50）', () => {
  it('預設開啟「角色」分類（character）', () => {
    expect(DEFAULT_WRITING_CARD_CATEGORY).toBe('character');
    const view = getStoredWritingCardsView('project-new');
    expect(view.categoryId).toBe('character');
    expect(view.cardId).toBeNull();
  });

  it('組字中按看卡片防護純函式：handleCardsPointerDown 與 shouldCancelPendingOpen', () => {
    // 1. 組字中：必須 preventDefault（不搶焦打斷組字）並記下待開啟
    const composingResult = handleCardsPointerDown(true);
    expect(composingResult.preventDefault).toBe(true);
    expect(composingResult.isPendingOpen).toBe(true);

    // 2. 非組字中：不阻擋預設行為（正常轉移焦點），不待開啟
    const normalResult = handleCardsPointerDown(false);
    expect(normalResult.preventDefault).toBe(false);
    expect(normalResult.isPendingOpen).toBe(false);

    // 3. 待開啟標記在正文 blur、換章節、收起或逾時時皆應取消
    expect(shouldCancelPendingOpen('blur')).toBe(true);
    expect(shouldCancelPendingOpen('chapter-change')).toBe(true);
    expect(shouldCancelPendingOpen('close')).toBe(true);
    expect(shouldCancelPendingOpen('timeout')).toBe(true);
    expect(COMPOSITION_TIMEOUT_MS).toBe(3000);
  });

  it('同一份稿子記住上次看的分類與卡片，鍵名帶 projectId', () => {
    const mockStorage = {
      data: {} as Record<string, string>,
      getItem(k: string) {
        return this.data[k] ?? null;
      },
      setItem(k: string, v: string) {
        this.data[k] = v;
      },
      removeItem(k: string) {
        delete this.data[k];
      },
    };

    saveStoredWritingCardsView(
      'proj-101',
      { categoryId: 'world', cardId: '30000000-0000-4000-8000-000000000001' },
      mockStorage,
    );

    // 檢查鍵名帶 projectId
    expect(mockStorage.data[`${WRITING_CARDS_STORAGE_PREFIX}proj-101`]).toBeDefined();

    // 讀取該稿件
    const view101 = getStoredWritingCardsView('proj-101', mockStorage);
    expect(view101.categoryId).toBe('world');
    expect(view101.cardId).toBe('30000000-0000-4000-8000-000000000001');

    // 換稿子不可沿用別份稿子的位置，另一份稿子仍為預設「角色」
    const view102 = getStoredWritingCardsView('proj-102', mockStorage);
    expect(view102.categoryId).toBe('character');
    expect(view102.cardId).toBeNull();

    // 清理
    clearStoredWritingCardsView('proj-101', mockStorage);
    expect(mockStorage.getItem(`${WRITING_CARDS_STORAGE_PREFIX}proj-101`)).toBeNull();
  });

  it('WO-53：舊版暫用分類代碼（outline、worldview、scene）或舊卡片 id 會安全回退到預設分類', () => {
    const mockStorage = {
      data: {} as Record<string, string>,
      getItem(k: string) {
        return this.data[k] ?? null;
      },
      setItem(k: string, v: string) {
        this.data[k] = v;
      },
      removeItem(k: string) {
        delete this.data[k];
      },
    };

    for (const legacyCategoryId of ['outline', 'worldview', 'scene', 'ai_chat']) {
      saveStoredWritingCardsView(
        'proj-legacy',
        { categoryId: legacyCategoryId, cardId: 'world-1' },
        mockStorage,
      );
      const view = getStoredWritingCardsView('proj-legacy', mockStorage);
      expect(view.categoryId).toBe('character');
      expect(view.cardId).toBeNull();
    }

    // 合法分類但舊版卡片 id：保留分類、卡片回退為 null
    saveStoredWritingCardsView(
      'proj-legacy-card',
      { categoryId: 'character', cardId: 'char-1' },
      mockStorage,
    );
    const viewCard = getStoredWritingCardsView('proj-legacy-card', mockStorage);
    expect(viewCard.categoryId).toBe('character');
    expect(viewCard.cardId).toBeNull();
  });

  it('組字中按看卡片：decideOpenCards 判斷必須暫緩，等 compositionend 後再開', () => {
    // 正在組字（例如正在打注音尚未選字）
    expect(decideOpenCards(true)).toEqual({ action: 'defer-until-composition-end' });

    // 未在組字
    expect(decideOpenCards(false)).toEqual({ action: 'open-immediately' });
  });

  it('captureCaretSnapshot 與 restoreCaretSnapshot：游標與聚焦還原', () => {
    let top = 100;

    const mockTextarea = {
      selectionStart: 12,
      selectionEnd: 15,
      value: '這是測試用的範例稿件正文文字。',
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
      set scrollTop(val: number) {
        top = val;
      },
      get scrollTop() {
        return top;
      },
    } as unknown as HTMLTextAreaElement;

    // 1. 擷取游標快照（原本聚焦）
    const snapshot = captureCaretSnapshot(mockTextarea, true);
    expect(snapshot).not.toBeNull();
    expect(snapshot).toEqual({
      selectionStart: 12,
      selectionEnd: 15,
      scrollTop: 100,
      wasFocused: true,
    });

    if (!snapshot) return;

    // 2. 還原快照
    restoreCaretSnapshot(mockTextarea, snapshot);
    expect(mockTextarea.focus).toHaveBeenCalled();
    expect(mockTextarea.setSelectionRange).toHaveBeenCalledWith(12, 15);
    expect(mockTextarea.scrollTop).toBe(100);

    // 3. 原本未聚焦時，還原不主動 focus
    const unfocusedMock = {
      ...mockTextarea,
      focus: vi.fn(),
    } as unknown as HTMLTextAreaElement;
    restoreCaretSnapshot(unfocusedMock, { ...snapshot, wasFocused: false });
    expect(unfocusedMock.focus).not.toHaveBeenCalled();
  });
});
