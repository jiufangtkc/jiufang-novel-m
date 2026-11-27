import { describe, expect, it } from 'vitest';
import { classifyTextDelta } from '../domain/writingLog';
import { TRASH_AUTO_MIN_WORDS } from '../domain/trash';
import { countWords } from '../domain/wordCount';
import { insertSymbolInto, type SymbolInsertTarget } from './symbolInsert';
import { createWrapTracker, matchWrapEdit, type WrapRecord } from './symbolWrap';
import { createTrashCaptureTracker } from './trashCapture';

const big = '字'.repeat(TRASH_AUTO_MIN_WORDS + 20);
const original = `前${big}後`;
const wrapped = `前「${big}」後`;
const record: WrapRecord = { beforeText: original, afterText: wrapped, left: '「', right: '」' };

/** 與 useWritingSurface.process() 相同的順序。 */
function makeSurface() {
  const wraps = createWrapTracker();
  const trash = createTrashCaptureTracker();
  const edit = (before: string, after: string, selection?: { start: number; end: number }, nowMs = 1) => {
    if (selection) trash.noteSelection(selection.start, selection.end, before.length);
    const wrap = wraps.resolve(before, after);
    const delta = wrap ? wrap.delta : classifyTextDelta(before, after);
    if (wrap) trash.suppressNextCapture();
    const outcome = trash.handleEdit({ chapterId: 'c1', before, after, source: 'type', nowMs });
    if (wrap) trash.releaseSuppress();
    return { wrap, delta, outcome };
  };
  return { wraps, trash, edit };
}

describe('WO-142 包選取：統計只算兩個符號', () => {
  it('matchWrapEdit 分辨包起來、復原、其他', () => {
    expect(matchWrapEdit(record, original, wrapped)).toBe('apply');
    expect(matchWrapEdit(record, wrapped, original)).toBe('revert');
    expect(matchWrapEdit(record, original, '前後')).toBeNull();
    expect(matchWrapEdit(null, original, wrapped)).toBeNull();
  });

  it('(a) 包選取：不算大量貼上或刪除，只算 2 個符號，不收進刪稿暫存', () => {
    // 對照：不經追蹤器時，整段被算成新增一次＋刪除一次
    const raw = classifyTextDelta(original, wrapped);
    expect(raw.largeInsert).toBe(true);
    expect(raw.largeDelete).toBe(true);

    const s = makeSurface();
    s.wraps.begin(record);
    const r = s.edit(original, wrapped, { start: 1, end: 1 + big.length });
    expect(r.wrap?.kind).toBe('apply');
    expect(r.delta.largeInsert).toBe(false);
    expect(r.delta.largeDelete).toBe(false);
    expect(r.delta.insertedChars).toBe(2);
    expect(r.delta.deletedChars).toBe(0);
    expect(r.delta.wordDelta).toBe(countWords(wrapped) - countWords(original));
    expect(r.delta.wordDelta).toBe(2);
    expect(r.outcome).toEqual({ kind: 'none' });
  });

  it('(b) 復原：不誤收進刪稿暫存，統計只算 2 個符號的減少', () => {
    const s = makeSurface();
    s.wraps.begin(record);
    s.edit(original, wrapped, { start: 1, end: 1 + big.length });
    s.wraps.end();
    const undo = s.edit(wrapped, original);
    expect(undo.wrap?.kind).toBe('revert');
    expect(undo.outcome).toEqual({ kind: 'none' });
    expect(undo.delta.largeInsert).toBe(false);
    expect(undo.delta.largeDelete).toBe(false);
    expect(undo.delta.insertedChars).toBe(0);
    expect(undo.delta.deletedChars).toBe(2);
    expect(undo.delta.wordDelta).toBe(-2);
  });

  it('(c) 重做：同樣只算 2 個符號、不收錄；可再復原', () => {
    const s = makeSurface();
    s.wraps.begin(record);
    s.edit(original, wrapped, { start: 1, end: 1 + big.length });
    s.wraps.end();
    s.edit(wrapped, original);
    const redo = s.edit(original, wrapped);
    expect(redo.wrap?.kind).toBe('apply');
    expect(redo.outcome).toEqual({ kind: 'none' });
    expect(redo.delta.insertedChars).toBe(2);
    expect(redo.delta.largeInsert).toBe(false);
    const undoAgain = s.edit(wrapped, original);
    expect(undoAgain.outcome).toEqual({ kind: 'none' });
    expect(undoAgain.wrap?.kind).toBe('revert');
  });

  it('(d) 復原後再做真正的大段刪除，仍照常收進刪稿暫存', () => {
    const s = makeSurface();
    s.wraps.begin(record);
    s.edit(original, wrapped, { start: 1, end: 1 + big.length });
    s.wraps.end();
    s.edit(wrapped, original);
    const del = s.edit(original, '前後', { start: 1, end: 1 + big.length }, 2);
    expect(del.wrap).toBeNull();
    expect(del.outcome.kind).toBe('capture');
    expect(del.delta.largeDelete).toBe(true);
    // 旗標已清：之後再來一次大段刪除也照收（記憶已被其他編輯清掉）
    expect(s.wraps.peek()).toEqual({ pending: null, last: null });
  });

  it('其他編輯會清掉記憶：中間打了別的字，之後即使文字剛好吻合也不當成復原', () => {
    const s = makeSurface();
    s.wraps.begin(record);
    s.edit(original, wrapped, { start: 1, end: 1 + big.length });
    s.wraps.end();
    s.edit(wrapped, wrapped + '嗨');
    expect(s.wraps.peek().last).toBeNull();
    const later = s.edit(wrapped, original, { start: 1, end: 1 + big.length + 2 });
    expect(later.wrap).toBeNull();
  });

  it('(e) 標記在 finally 一定清除：插入流程丟例外、或沒有觸發 input 都不殘留', () => {
    const wraps = createWrapTracker();
    const target: SymbolInsertTarget = {
      value: '甲乙丙',
      selectionStart: 0,
      selectionEnd: 2,
      setRangeText() {
        throw new Error('boom');
      },
      setSelectionRange() {},
      focus() {},
    };
    const baseDeps = {
      target,
      isComposing: () => false,
      isFocused: () => true,
      beginWrap: (r: WrapRecord) => wraps.begin(r),
      endWrap: () => wraps.end(),
      onFallbackInput: () => undefined,
    };
    expect(() => insertSymbolInto('quote', baseDeps)).toThrow('boom');
    expect(wraps.peek().pending).toBeNull();

    // execCommand 回報成功但內容沒變也沒有 input：待套用標記不會留到下一次編輯
    const target2: SymbolInsertTarget = { ...target, setRangeText: () => undefined };
    expect(insertSymbolInto('quote', { ...baseDeps, target: target2, execInsert: () => true })).toBe('inserted');
    expect(wraps.peek().pending).toBeNull();
  });

  it('待套用標記只對緊接著的那一次 input 有效', () => {
    const s = makeSurface();
    s.wraps.begin(record);
    // 緊接著發生的是別的編輯：標記作廢
    const other = s.edit(original, original + '。');
    expect(other.wrap).toBeNull();
    expect(s.wraps.peek()).toEqual({ pending: null, last: null });
    const late = s.edit(original, wrapped, { start: 1, end: 1 + big.length });
    expect(late.wrap).toBeNull();
  });

  it('insertSymbolInto 會把完整記錄交給 beginWrap', () => {
    const records: WrapRecord[] = [];
    const t: SymbolInsertTarget = {
      value: '他說你好嗎',
      selectionStart: 2,
      selectionEnd: 4,
      setRangeText(text, s, e) {
        t.value = t.value.slice(0, s) + text + t.value.slice(e);
      },
      setSelectionRange() {},
      focus() {},
    };
    insertSymbolInto('book-title', {
      target: t,
      isComposing: () => false,
      isFocused: () => true,
      beginWrap: (r) => records.push(r),
      endWrap: () => undefined,
      onFallbackInput: () => undefined,
    });
    expect(records).toEqual([
      { beforeText: '他說你好嗎', afterText: '他說《你好》嗎', left: '《', right: '》' },
    ]);
  });
});
