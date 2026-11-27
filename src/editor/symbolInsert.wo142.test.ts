import { describe, expect, it, vi } from 'vitest';
// vi 供 execCommand 假函式使用
import { createTrashCaptureTracker } from './trashCapture';
import { createWrapTracker } from './symbolWrap';
import { insertSymbolInto, type SymbolInsertDeps, type SymbolInsertTarget } from './symbolInsert';
import { TRASH_AUTO_MIN_WORDS } from '../domain/trash';

interface FakeTarget extends SymbolInsertTarget {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  readOnly: boolean;
  disabled: boolean;
  focusCalls: unknown[];
  onFocus?: () => void;
}

function fakeTarget(value: string, start: number, end = start): FakeTarget {
  const t: FakeTarget = {
    value,
    selectionStart: start,
    selectionEnd: end,
    readOnly: false,
    disabled: false,
    focusCalls: [],
    focus(options) {
      t.focusCalls.push(options);
      t.onFocus?.();
    },
    setRangeText(text, s, e) {
      t.value = t.value.slice(0, s) + text + t.value.slice(e);
      t.selectionStart = t.selectionEnd = s + text.length;
    },
    setSelectionRange(s, e) {
      t.selectionStart = s;
      t.selectionEnd = e;
    },
  };
  return t;
}

function makeDeps(
  target: FakeTarget,
  over: Partial<SymbolInsertDeps> = {},
): SymbolInsertDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    target,
    isComposing: () => false,
    isFocused: () => true,
    beginWrap: () => calls.push('begin-wrap'),
    endWrap: () => calls.push('end-wrap'),
    onFallbackInput: () => calls.push('fallback-input'),
    onCaretMoved: () => calls.push('caret-moved'),
    ...over,
  };
}

describe('WO-142 insertSymbolInto：後備路徑（沒有 execCommand）', () => {
  it('單符號：插在游標處、游標在符號後，並視為一般輸入', () => {
    const t = fakeTarget('今天天氣', 2);
    const deps = makeDeps(t);
    expect(insertSymbolInto('comma', deps)).toBe('inserted');
    expect(t.value).toBe('今天，天氣');
    expect([t.selectionStart, t.selectionEnd]).toEqual([3, 3]);
    expect(deps.calls).toContain('fallback-input');
  });

  it('有選取：單符號取代選取', () => {
    const t = fakeTarget('今天天氣', 1, 3);
    expect(insertSymbolInto('period', makeDeps(t))).toBe('inserted');
    expect(t.value).toBe('今。氣');
    expect(t.selectionStart).toBe(2);
  });

  it('成對符號無選取：插整對，游標在中間', () => {
    const t = fakeTarget('甲乙', 1);
    const deps = makeDeps(t);
    expect(insertSymbolInto('book-title', deps)).toBe('inserted');
    expect(t.value).toBe('甲《》乙');
    expect([t.selectionStart, t.selectionEnd]).toEqual([2, 2]);
    expect(deps.calls).toContain('caret-moved');
  });

  it('成對符號有選取：包起來，游標在右符號之後，並先登記包選取、最後一定清除', () => {
    const t = fakeTarget('他說你好嗎', 2, 4);
    const deps = makeDeps(t);
    expect(insertSymbolInto('quote', deps)).toBe('inserted');
    expect(t.value).toBe('他說「你好」嗎');
    expect([t.selectionStart, t.selectionEnd]).toEqual([6, 6]);
    expect(deps.calls.indexOf('begin-wrap')).toBeLessThan(deps.calls.indexOf('fallback-input'));
    expect(deps.calls.at(-1)).toBe('end-wrap');
  });

  it('組字中：回傳 composing、內容與游標都不動、不叫處理', () => {
    const t = fakeTarget('甲乙', 1);
    const deps = makeDeps(t, { isComposing: () => true });
    expect(insertSymbolInto('comma', deps)).toBe('composing');
    expect(t.value).toBe('甲乙');
    expect(t.selectionStart).toBe(1);
    expect(deps.calls).toEqual([]);
    expect(t.focusCalls).toEqual([]);
  });

  it('輸入框唯讀、停用、不存在或符號不存在：unavailable，內容不變', () => {
    const ro = fakeTarget('甲', 1);
    ro.readOnly = true;
    expect(insertSymbolInto('comma', makeDeps(ro))).toBe('unavailable');
    expect(ro.value).toBe('甲');
    const dis = fakeTarget('甲', 1);
    dis.disabled = true;
    expect(insertSymbolInto('comma', makeDeps(dis))).toBe('unavailable');
    expect(insertSymbolInto('comma', makeDeps(fakeTarget('甲', 1), { target: null }))).toBe('unavailable');
    expect(insertSymbolInto('nope', makeDeps(fakeTarget('甲', 1)))).toBe('unavailable');
  });

  it('沒有焦點：先 focus（不捲動），並以記住的選取範圍為準', () => {
    const t = fakeTarget('甲乙丙', 1, 2);
    // 模擬 focus 時瀏覽器把游標搬到文末
    t.onFocus = () => {
      t.selectionStart = t.selectionEnd = t.value.length;
    };
    expect(insertSymbolInto('comma', makeDeps(t, { isFocused: () => false }))).toBe('inserted');
    expect(t.focusCalls).toEqual([{ preventScroll: true }]);
    expect(t.value).toBe('甲，丙');
  });
});

describe('WO-142 insertSymbolInto：execCommand 主路徑', () => {
  it('execCommand 成功就不走後備路徑；成對符號再把游標移到中間', () => {
    const t = fakeTarget('甲乙', 1);
    const exec = vi.fn((text: string) => {
      t.setRangeText(text, t.selectionStart ?? 0, t.selectionEnd ?? 0, 'end');
      return true;
    });
    const deps = makeDeps(t, { execInsert: exec });
    expect(insertSymbolInto('quote', deps)).toBe('inserted');
    expect(exec).toHaveBeenCalledWith('「」');
    expect(t.value).toBe('甲「」乙');
    expect(t.selectionStart).toBe(2);
    expect(deps.calls).not.toContain('fallback-input');
  });

  it('execCommand 回傳 false 或沒改內容：改走後備路徑', () => {
    const t = fakeTarget('甲乙', 1);
    const deps = makeDeps(t, { execInsert: () => false });
    expect(insertSymbolInto('comma', deps)).toBe('inserted');
    expect(t.value).toBe('甲，乙');
    expect(deps.calls).toContain('fallback-input');

    const t2 = fakeTarget('甲乙', 1);
    const deps2 = makeDeps(t2, { execInsert: () => true });
    expect(insertSymbolInto('comma', deps2)).toBe('inserted');
    expect(t2.value).toBe('甲，乙');
    expect(deps2.calls).toContain('fallback-input');
  });

  it('execCommand 丟錯：同樣走後備路徑', () => {
    const t = fakeTarget('甲', 1);
    const deps = makeDeps(t, {
      execInsert: () => {
        throw new Error('boom');
      },
    });
    expect(insertSymbolInto('dash', deps)).toBe('inserted');
    expect(t.value).toBe('甲──');
  });
});

describe('WO-142 刪稿暫存：包選取的成對符號不會被當成大段刪除', () => {
  const big = '字'.repeat(TRASH_AUTO_MIN_WORDS + 50);
  const before = `前${big}後`;
  const wrapped = `前「${big}」後`;

  it('沒抑制時（對照組）：同樣的包選取會被誤判成刪除而收錄', () => {
    const tracker = createTrashCaptureTracker();
    tracker.noteSelection(1, 1 + big.length, before.length);
    const outcome = tracker.handleEdit({ chapterId: 'c1', before, after: wrapped, source: 'type', nowMs: 1 });
    expect(outcome.kind).toBe('capture');
  });

  it('抑制後：選取一大段點「」不產生刪稿暫存項目；旗標用完即清', () => {
    const tracker = createTrashCaptureTracker();
    tracker.noteSelection(1, 1 + big.length, before.length);
    tracker.suppressNextCapture();
    expect(tracker.handleEdit({ chapterId: 'c1', before, after: wrapped, source: 'type', nowMs: 1 })).toEqual({
      kind: 'none',
    });
    // 之後一般的大段刪除仍照常收錄
    tracker.noteSelection(1, 1 + big.length, before.length);
    const later = tracker.handleEdit({
      chapterId: 'c1',
      before,
      after: '前後',
      source: 'type',
      nowMs: 2,
    });
    expect(later.kind).toBe('capture');
  });

  it('沒有選取的後備路徑（只靠差異比對）一樣不收錄；releaseSuppress 會清旗標', () => {
    const tracker = createTrashCaptureTracker();
    tracker.suppressNextCapture();
    expect(tracker.handleEdit({ chapterId: 'c1', before, after: wrapped, source: 'type', nowMs: 1 }).kind).toBe(
      'none',
    );
    tracker.suppressNextCapture();
    tracker.releaseSuppress();
    expect(tracker.handleEdit({ chapterId: 'c1', before, after: wrapped, source: 'type', nowMs: 2 }).kind).toBe(
      'capture',
    );
  });

  it('整合：insertSymbolInto 後備路徑包大段選取，經追蹤器不會收錄', () => {
    const tracker = createTrashCaptureTracker();
    const t = fakeTarget(before, 1, 1 + big.length);
    const wraps = createWrapTracker();
    let outcomeKind = 'unset';
    const deps = makeDeps(t, {
      beginWrap: (record) => wraps.begin(record),
      endWrap: () => wraps.end(),
      onFallbackInput: ({ start, end }) => {
        tracker.noteSelection(start, end, before.length);
        // 與 useWritingSurface.process 相同的順序
        const wrap = wraps.resolve(before, t.value);
        if (wrap) tracker.suppressNextCapture();
        outcomeKind = tracker.handleEdit({
          chapterId: 'c1',
          before,
          after: t.value,
          source: 'type',
          nowMs: 1,
        }).kind;
        tracker.releaseSuppress();
      },
    });
    expect(insertSymbolInto('quote', deps)).toBe('inserted');
    expect(t.value).toBe(wrapped);
    expect(outcomeKind).toBe('none');
  });

  it('單符號取代一大段選取：等同打字蓋掉，照一般刪除規則收錄', () => {
    const tracker = createTrashCaptureTracker();
    const t = fakeTarget(before, 1, 1 + big.length);
    let outcomeKind = 'unset';
    const deps = makeDeps(t, {
      onFallbackInput: ({ start, end }) => {
        tracker.noteSelection(start, end, before.length);
        outcomeKind = tracker.handleEdit({
          chapterId: 'c1',
          before,
          after: t.value,
          source: 'type',
          nowMs: 1,
        }).kind;
      },
    });
    expect(insertSymbolInto('period', deps)).toBe('inserted');
    expect(outcomeKind).toBe('capture');
  });
});
