import { afterEach, describe, expect, it, vi } from 'vitest';
import { decidePaste, createClipMarker, type InternalClip } from './clipboardPolicy';
import { scrollDeltaToReveal } from './caret';
import { decideEnterKey, IME_ENTER_WINDOW_MS, removeSpuriousLineBreak } from './enterGuard';
import { createIdleGate } from './idleGate';

describe('Safari 選字時的 Enter', () => {
  it('組字還沒結束時不擋換行，但也不當成其他動作', () => {
    expect(
      decideEnterKey({
        key: 'Enter',
        isComposing: true,
        keyCode: 229,
        timeStamp: 1000,
        lastCompositionEndTimeStamp: null,
        composingFlag: true,
      }),
    ).toEqual({ blockNewline: false, suppressActions: true });
  });

  it('Safari 在選字結束後緊接著送來的 Enter 要擋下換行', () => {
    expect(
      decideEnterKey({
        key: 'Enter',
        isComposing: false,
        keyCode: 229,
        timeStamp: 1000,
        lastCompositionEndTimeStamp: null,
        composingFlag: false,
      }).blockNewline,
    ).toBe(true);
    expect(
      decideEnterKey({
        key: 'Enter',
        isComposing: false,
        keyCode: 13,
        timeStamp: 200,
        lastCompositionEndTimeStamp: 200 - IME_ENTER_WINDOW_MS,
        composingFlag: false,
      }),
    ).toEqual({ blockNewline: true, suppressActions: true });
  });

  it('停筆後再按 Enter 就是正常換行', () => {
    expect(
      decideEnterKey({
        key: 'Enter',
        isComposing: false,
        keyCode: 13,
        timeStamp: 1000,
        lastCompositionEndTimeStamp: 1000 - IME_ENTER_WINDOW_MS - 1,
        composingFlag: false,
      }),
    ).toEqual({ blockNewline: false, suppressActions: false });
  });

  it('組字中的其他鍵也不觸發動作', () => {
    expect(
      decideEnterKey({
        key: 'a',
        isComposing: false,
        keyCode: 229,
        timeStamp: 10,
        lastCompositionEndTimeStamp: null,
        composingFlag: false,
      }).suppressActions,
    ).toBe(true);
  });

  it('只在組字結束後拿掉游標旁多出來的換行', () => {
    expect(removeSpuriousLineBreak('霧港\n紀事', 3)).toEqual({ value: '霧港紀事', caret: 2 });
    expect(removeSpuriousLineBreak('霧港\n紀事', 2)).toEqual({ value: '霧港紀事', caret: 2 });
    expect(removeSpuriousLineBreak('霧港紀事', 2)).toBeNull();
  });
});

describe('只能在編輯器內貼上', () => {
  const clip: InternalClip = { text: '燈塔下的信。', marker: createClipMarker() };

  it('標記、正文或空的剪貼簿可以貼回內部文字', () => {
    expect(decidePaste(clip.marker, clip, false)).toEqual({ action: 'insert', text: clip.text });
    expect(decidePaste(clip.text, clip, false)).toEqual({ action: 'insert', text: clip.text });
    expect(decidePaste('', clip, false)).toEqual({ action: 'insert', text: clip.text });
  });

  it('外面的文字、讀不到的內容，以及還沒在裡面複製過，都擋下', () => {
    expect(decidePaste('從備忘錄貼來的', clip, false)).toEqual({ action: 'block' });
    expect(decidePaste(null, clip, false)).toEqual({ action: 'block' });
    expect(decidePaste('從備忘錄貼來的', null, false)).toEqual({ action: 'block' });
  });

  it('組字時不改內容', () => {
    expect(decidePaste(clip.marker, clip, true)).toEqual({ action: 'ignore-composing' });
  });
});

describe('游標不要被鍵盤擋住', () => {
  it('游標在可視範圍下方時往下捲', () => {
    expect(scrollDeltaToReveal(400, 28, 0, 300, 24)).toBe(400 + 28 - (300 - 24));
  });

  it('游標在可視範圍上方時往上捲', () => {
    expect(scrollDeltaToReveal(10, 28, 100, 300, 24)).toBe(10 - (100 + 24));
  });

  it('看得到就不動', () => {
    expect(scrollDeltaToReveal(80, 28, 40, 300, 24)).toBe(0);
  });
});

describe('停筆之後才計算', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('時間未到不執行，組字期間也不執行', () => {
    vi.useFakeTimers();
    const gate = createIdleGate(600);
    const task = vi.fn();
    gate.schedule(task);
    vi.advanceTimersByTime(599);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();

    gate.setComposing(true);
    gate.schedule(task);
    vi.advanceTimersByTime(2000);
    expect(task).toHaveBeenCalledOnce();
    gate.setComposing(false);
    gate.schedule(task);
    vi.advanceTimersByTime(600);
    expect(task).toHaveBeenCalledTimes(2);
  });
});
