import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  keepBodyFocusOnPointerDown,
  refocusBodyIfLost,
  snapshotForCardsClose,
} from '../editor/bodyFocusGuard';
import { captureCaretSnapshot, restoreCaretSnapshot } from '../domain/writingCards';
import { focusWritingBody } from '../editor/focusWriting';

/**
 * 沒有 DOM 的測試環境：用「假的頁面焦點」模擬瀏覽器。
 * 對應瀏覽器行為：按鈕 pointerdown 沒被 preventDefault，接著的 mousedown 預設動作
 * 就會把焦點從正文移到按鈕（正文失焦、selection 保留）；被 preventDefault 則焦點不動。
 * 事件處理流程（pointerdown 處理函式、切換後保險、關閉看卡片的還原）都是實際執行的程式。
 */
interface FakePage {
  activeElement: unknown;
}

function makeBody(page: FakePage, value: string, caret: number) {
  const body = {
    value,
    selectionStart: caret as number | null,
    selectionEnd: caret as number | null,
    scrollTop: 0,
    readOnly: false,
    focusCalls: 0,
    focus() {
      body.focusCalls += 1;
      page.activeElement = body;
    },
    setSelectionRange(a: number, b: number) {
      body.selectionStart = a;
      body.selectionEnd = b;
    },
    type(text: string) {
      // 在游標處插入
      const at = body.selectionStart ?? 0;
      body.value = body.value.slice(0, at) + text + body.value.slice(body.selectionEnd ?? at);
      body.selectionStart = body.selectionEnd = at + text.length;
    },
  };
  return body;
}

/** 模擬使用者按下一顆按鈕：pointerdown → （瀏覽器預設搶焦點）→ click */
function pressButton(
  page: FakePage,
  button: object,
  onPointerDown: ((e: { preventDefault(): void }) => void) | null,
  onClick: () => void,
) {
  let prevented = false;
  onPointerDown?.({ preventDefault: () => (prevented = true) });
  if (!prevented) page.activeElement = button;
  onClick();
  return { prevented };
}

const page: FakePage = { activeElement: null };

beforeEach(() => {
  page.activeElement = null;
  vi.stubGlobal('document', page);
});
afterEach(() => vi.unstubAllGlobals());

const TEXT = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';

describe('WO-82：進出專注鈕不讓正文失焦', () => {
  it('正文有焦點、游標在第 20 字：按進入專注後焦點仍在正文，續打落在原處', () => {
    const body = makeBody(page, TEXT, 20);
    body.focus();
    const button = {};
    let hadFocus = false;
    pressButton(
      page,
      button,
      (e) => {
        hadFocus = keepBodyFocusOnPointerDown(body, e);
      },
      () => undefined,
    );
    expect(page.activeElement).toBe(body);
    expect(hadFocus).toBe(true);
    // 切換完成後的保險：已在正文就不再動
    expect(refocusBodyIfLost(body, hadFocus)).toBe(false);
    body.type('新');
    expect(body.value.indexOf('新')).toBe(20);
  });

  it('沒有擋預設動作時（對照組）焦點會被按鈕搶走，保險會立即叫回且不動游標', () => {
    const body = makeBody(page, TEXT, 20);
    body.focus();
    // 假設 pointerdown 沒處理：焦點被按鈕搶走
    pressButton(page, {}, null, () => undefined);
    expect(page.activeElement).not.toBe(body);
    expect(body.selectionStart).toBe(20);
    expect(refocusBodyIfLost(body, true)).toBe(true);
    expect(page.activeElement).toBe(body);
    expect(body.selectionStart).toBe(20);
    expect(body.selectionEnd).toBe(20);
    body.type('新');
    expect(body.value.indexOf('新')).toBe(20);
  });

  it('保留選取範圍，不放到文末', () => {
    const body = makeBody(page, TEXT, 5);
    body.setSelectionRange(5, 9);
    body.focus();
    pressButton(page, {}, (e) => keepBodyFocusOnPointerDown(body, e), () => undefined);
    expect([body.selectionStart, body.selectionEnd]).toEqual([5, 9]);
    pressButton(page, {}, null, () => undefined);
    refocusBodyIfLost(body, true);
    expect([body.selectionStart, body.selectionEnd]).toEqual([5, 9]);
  });

  it('正文本來沒有焦點：不擋按鈕、不主動把焦點交給正文', () => {
    const body = makeBody(page, TEXT, 3);
    const button = {};
    page.activeElement = button;
    let prevented = false;
    const had = keepBodyFocusOnPointerDown(body, { preventDefault: () => (prevented = true) });
    expect(had).toBe(false);
    expect(prevented).toBe(false);
    expect(refocusBodyIfLost(body, had)).toBe(false);
    expect(page.activeElement).toBe(button);
    expect(body.focusCalls).toBe(0);
  });

  it('離開專注（含橫拿第一次、第二次點擊）：焦點一直留在正文，游標不動', () => {
    const body = makeBody(page, TEXT, 12);
    body.focus();
    const exitButton = {};
    // 橫拿第一次：只展開文字，仍在專注中
    pressButton(page, exitButton, (e) => keepBodyFocusOnPointerDown(body, e), () => undefined);
    expect(page.activeElement).toBe(body);
    expect(body.selectionStart).toBe(12);
    // 橫拿第二次：離開
    pressButton(page, exitButton, (e) => keepBodyFocusOnPointerDown(body, e), () => undefined);
    expect(page.activeElement).toBe(body);
    body.type('新');
    expect(body.value.indexOf('新')).toBe(12);
  });

  it('四種版面、全部入口都用同一套事件流程（直拿頁首與拇指區、橫拿浮動、中等與寬版頁首）', () => {
    for (const entry of [
      'enter-focus-mode', // 直拿打字中頁首（WO-81）、中等、寬版
      'thumb-focus-button', // 直拿拇指區
      'toggle-focus-landscape', // 橫拿浮動
      'exit-focus-mode', // 離開鈕
    ]) {
      page.activeElement = null;
      const body = makeBody(page, TEXT, 20);
      body.focus();
      pressButton(page, { entry }, (e) => keepBodyFocusOnPointerDown(body, e), () => undefined);
      expect(page.activeElement, entry).toBe(body);
      expect(body.selectionStart, entry).toBe(20);
    }
  });

  it('注音組字中：只擋按鈕搶焦點，不改文字、不改游標', () => {
    const body = makeBody(page, TEXT, 20);
    body.focus();
    const before = body.value;
    pressButton(page, {}, (e) => keepBodyFocusOnPointerDown(body, e), () => undefined);
    expect(body.value).toBe(before);
    expect(body.selectionStart).toBe(20);
    expect(page.activeElement).toBe(body);
  });

  it('既有的新章進入正文仍放到文末（不是原位置還原）', () => {
    const body = makeBody(page, TEXT, 3);
    focusWritingBody(body);
    expect(body.selectionStart).toBe(TEXT.length);
  });
});

describe('WO-82：看卡片開關不讓正文失焦', () => {
  it('僅查看：按看卡片後焦點留在正文（不交給卡片），關閉後仍在正文、游標在原處', () => {
    const body = makeBody(page, TEXT, 20);
    body.focus();
    // 按下看卡片鈕：拍快照、擋搶焦點
    let snapshot = null as ReturnType<typeof captureCaretSnapshot>;
    pressButton(
      page,
      {},
      (e) => {
        snapshot = captureCaretSnapshot(body as unknown as HTMLTextAreaElement, true);
        keepBodyFocusOnPointerDown(body, e);
      },
      () => undefined,
    );
    expect(page.activeElement).toBe(body);
    // 面板開著：卡片面板的按鈕不得拿走焦點——此處只檢查正文仍有焦點
    // 關閉：按關閉鈕（焦點被搶走），還原後回到正文
    page.activeElement = {};
    restoreCaretSnapshot(
      body as unknown as HTMLTextAreaElement,
      snapshotForCardsClose(body, snapshot),
    );
    expect(page.activeElement).toBe(body);
    expect([body.selectionStart, body.selectionEnd]).toEqual([20, 20]);
    body.type('新');
    expect(body.value.indexOf('新')).toBe(20);
    expect(body.value).not.toContain('卡片');
  });

  it('查看卡片時使用者在正文移動游標：關閉不會被舊快照蓋回', () => {
    const body = makeBody(page, TEXT, 20);
    body.focus();
    const snapshot = captureCaretSnapshot(body as unknown as HTMLTextAreaElement, true);
    body.setSelectionRange(4, 4);
    page.activeElement = {};
    restoreCaretSnapshot(
      body as unknown as HTMLTextAreaElement,
      snapshotForCardsClose(body, snapshot),
    );
    expect(page.activeElement).toBe(body);
    expect(body.selectionStart).toBe(4);
  });

  it('編輯卡片才交出焦點：正文失焦且唯讀，關閉後回到正文原游標，卡片內容不進正文', () => {
    const body = makeBody(page, TEXT, 20);
    body.focus();
    const snapshot = captureCaretSnapshot(body as unknown as HTMLTextAreaElement, true);
    // WO-64：開始編輯卡片 → 正文失焦、唯讀，焦點交給卡片輸入框
    const cardInput = { value: '卡片內容' };
    body.readOnly = true;
    page.activeElement = cardInput;
    expect(page.activeElement).not.toBe(body);
    // 此時按鈕 pointerdown：正文沒有焦點，不會被強行叫回
    const had = keepBodyFocusOnPointerDown(body, { preventDefault: () => undefined });
    expect(had).toBe(false);
    // 關閉
    body.readOnly = false;
    restoreCaretSnapshot(
      body as unknown as HTMLTextAreaElement,
      snapshotForCardsClose(body, snapshot),
    );
    expect(page.activeElement).toBe(body);
    expect(body.selectionStart).toBe(20);
    expect(body.value).toBe(TEXT);
    expect(body.value).not.toContain(cardInput.value);
  });

  it('開啟時正文沒有焦點：關閉也不主動把焦點拉進正文', () => {
    const body = makeBody(page, TEXT, 7);
    const snapshot = captureCaretSnapshot(body as unknown as HTMLTextAreaElement, false);
    restoreCaretSnapshot(
      body as unknown as HTMLTextAreaElement,
      snapshotForCardsClose(body, snapshot),
    );
    expect(page.activeElement).not.toBe(body);
    expect(body.selectionStart).toBe(7);
  });
});

describe('WO-82：EditorPane 接線（輔助檢查，焦點行為由上方流程測試驗證）', () => {
  const src = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');

  function buttonBlock(testId: string): string {
    const at = src.indexOf(`data-testid="${testId}"`);
    expect(at, testId).toBeGreaterThan(0);
    const start = src.lastIndexOf('<button', at);
    return src.slice(start, at);
  }

  it.each(['enter-focus-mode', 'thumb-focus-button', 'toggle-focus-landscape', 'exit-focus-mode'])(
    '%s 在 pointerdown 保護正文焦點',
    (id) => {
      expect(buttonBlock(id)).toContain('onPointerDown={handleFocusSwitchPointerDown}');
    },
  );

  it.each(['toggle-cards-topbar', 'toggle-cards-landscape', 'thumb-cards-button'])(
    '%s 的 pointerdown 會保護正文焦點',
    (id) => {
      expect(buttonBlock(id)).toContain('onPointerDown={handleButtonPointerDown}');
      expect(src).toMatch(/handleButtonPointerDown[\s\S]{0,700}keepBodyFocusOnPointerDown\(ref\.current, e\)/);
    },
  );

  it('進入專注仍走原本的 enterFocusMode，離開仍走 handleExitClick（路徑不變）', () => {
    expect(buttonBlock('enter-focus-mode')).toContain('onClick={enterFocusMode}');
    expect(buttonBlock('exit-focus-mode')).toContain('onClick={handleExitClick}');
  });
});
