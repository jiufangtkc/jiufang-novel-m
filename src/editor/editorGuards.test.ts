import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBookClip, clipForBook, rememberBookClip } from './bookClip';
import { decidePaste, type InternalClip } from './clipboardPolicy';
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

describe('正文只貼這份稿子裡的字（WO-113）', () => {
  const clip: InternalClip = { text: '燈塔下的信。' };

  it('剪貼簿文字與本稿最近一次正文複製完全相同，才貼回', () => {
    expect(decidePaste(clip.text, clip, false)).toEqual({ action: 'insert', text: clip.text });
    const spaced: InternalClip = { text: ' 前有空格\n後有換行\n' };
    expect(decidePaste(spaced.text, spaced, false)).toEqual({ action: 'insert', text: spaced.text });
  });

  it('外面的文字、讀不到、剪貼簿清空、還沒複製過，都擋下，不會貼回上次的字', () => {
    expect(decidePaste('從備忘錄貼來的', clip, false)).toEqual({ action: 'block' });
    expect(decidePaste(null, clip, false)).toEqual({ action: 'block' });
    expect(decidePaste('', clip, false)).toEqual({ action: 'block' });
    expect(decidePaste('從備忘錄貼來的', null, false)).toEqual({ action: 'block' });
    expect(decidePaste(clip.text, null, false)).toEqual({ action: 'block' });
  });

  it('組字時不改內容', () => {
    expect(decidePaste(clip.text, clip, true)).toEqual({ action: 'ignore-composing' });
  });

  it('同一本書跨章可以貼，換書就不行', () => {
    clearBookClip();
    rememberBookClip('book-a', { text: '【範例】跨章的句子' });
    expect(decidePaste('【範例】跨章的句子', clipForBook('book-a'), false)).toEqual({
      action: 'insert',
      text: '【範例】跨章的句子',
    });
    expect(decidePaste('從備忘錄貼來的', clipForBook('book-a'), false).action).toBe('block');
    // 在另一本書的正文複製後，這本書就沒有可貼的紀錄
    expect(clipForBook('book-b')).toBeNull();
    rememberBookClip('book-b', { text: '【範例】別本書的句子' });
    expect(clipForBook('book-a')).toBeNull();
    expect(decidePaste('【範例】別本書的句子', clipForBook('book-a'), false).action).toBe('block');
    clearBookClip();
  });

  it('正文複製、剪下把真正選取文字放進系統剪貼簿，不再放標記，提示走集中常數', () => {
    const surface = readFileSync(new URL('./useWritingSurface.ts', import.meta.url), 'utf8');
    expect(surface).not.toContain('createClipMarker');
    expect(surface).not.toContain('marker');
    expect(surface.split("clipboardData?.setData('text/plain', text)").length - 1).toBe(2);
    expect(surface).toContain('rememberBookClip(bookId, { text })');
    expect(surface).toContain('toast(EDITOR_PASTE_BLOCKED_TOAST)');
    expect(surface).toContain('toast(EDITOR_COPIED_TOAST)');
    expect(surface).toContain('toast(EDITOR_CUT_TOAST)');
    expect(surface).not.toContain('只能貼回');
  });

  it('卡片不建立正文許可、不攔截貼上；複製、剪下只清掉正文紀錄', () => {
    const cardEditor = readFileSync(new URL('../components/CardEditor.tsx', import.meta.url), 'utf8');
    expect(cardEditor).not.toContain('rememberBookClip');
    expect(cardEditor).toContain('onCopy={clearBookClip}');
    expect(cardEditor).toContain('onCut={clearBookClip}');
    expect(cardEditor).not.toContain('onPaste');
  });

  it('卡片編輯的兩個標題輸入框（橫向與其他版面）複製、剪下也清掉正文許可', () => {
    const cardEditor = readFileSync(new URL('../components/CardEditor.tsx', import.meta.url), 'utf8');
    // 以「<input」切段、每段取到第一個「/>」為止（屬性內有箭頭函式的「>」，不能用 [^>] 判斷結尾）
    const inputs = cardEditor
      .split('<input')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf('/>')))
      .filter((part) => part.includes('data-testid="card-editor-title-input"'));
    expect(inputs.length).toBe(2);
    for (const input of inputs) {
      expect(input).toContain('onCopy={clearBookClip}');
      expect(input).toContain('onCut={clearBookClip}');
      expect(input).not.toContain('onPaste');
    }
    const sentence = '【範例】霧港的鐘聲。';
    rememberBookClip('book-a', { text: sentence });
    expect(decidePaste(sentence, clipForBook('book-a'), false).action).toBe('insert');
    clearBookClip();
    expect(decidePaste(sentence, clipForBook('book-a'), false)).toEqual({ action: 'block' });
  });

  it('卡片預覽（標題與內容）可選取複製，也會清掉正文許可，之後同一句貼進正文被擋', () => {
    const cardEditor = readFileSync(new URL('../components/CardEditor.tsx', import.meta.url), 'utf8');
    const heading = cardEditor.match(/<h2 className="card-detail-heading"[^>]*>/)?.[0] ?? '';
    expect(heading).toContain('onCopy={clearBookClip}');
    expect(heading).toContain('onCut={clearBookClip}');
    const preview = cardEditor.match(/<div[^>]*data-testid="card-editor-preview-content"[^>]*>/)?.[0] ?? '';
    expect(preview).toContain('onCopy={clearBookClip}');
    expect(preview).toContain('onCut={clearBookClip}');

    const sentence = '【範例】燈塔下的信。';
    rememberBookClip('book-a', { text: sentence });
    expect(decidePaste(sentence, clipForBook('book-a'), false).action).toBe('insert');
    // 在預覽複製同一句：處理函式清掉正文紀錄
    clearBookClip();
    expect(decidePaste(sentence, clipForBook('book-a'), false)).toEqual({ action: 'block' });
  });

  it('從卡片複製的文字不能貼進正文（WO-50 定案）', () => {
    clearBookClip();
    const cardText = '【範例】沈雨晴，二十四歲，鐘錶修復師的養女。';

    // 情境一：沒有任何正文複製、只從卡片複製 → 貼到正文
    // 此時 internal clip 為 null，剪貼簿 incoming 為卡片內容
    const decisionNoInternal = decidePaste(cardText, clipForBook('book-a'), false);
    expect(decisionNoInternal).toEqual({ action: 'block' });

    // 情境二：先在正文複製一段（產生 internal clip）→ 再從卡片內容複製另一段 → 貼到正文
    rememberBookClip('book-a', { text: '正文原本複製的一段內容。' });
    // 卡片複製不會呼叫 rememberBookClip，但系統剪貼簿 incoming 被換成卡片文字
    const decisionAfterCardCopy = decidePaste(cardText, clipForBook('book-a'), false);
    expect(decisionAfterCardCopy).toEqual({ action: 'block' });

    // 卡片複製、剪下會清掉正文紀錄：之後連正文原文也不再放行
    clearBookClip();
    expect(decidePaste('正文原本複製的一段內容。', clipForBook('book-a'), false)).toEqual({ action: 'block' });

    clearBookClip();
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
