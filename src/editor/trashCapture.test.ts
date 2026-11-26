import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRASH_AUTO_MIN_WORDS } from '../domain/trash';
import { classifyTextDelta, LARGE_TEXT_THRESHOLD } from '../domain/writingLog';
import { createTrashCaptureTracker, TRASH_UNDO_WINDOW_MS } from './trashCapture';

describe('WO-138 第 4 段：編輯器自動收集與門檻', () => {
  it('寫作紀錄 LARGE_TEXT_THRESHOLD 維持 50，暫存區自動收錄門檻為 100 字', () => {
    expect(LARGE_TEXT_THRESHOLD).toBe(50);
    expect(TRASH_AUTO_MIN_WORDS).toBe(100);

    const tracker = createTrashCaptureTracker();
    // 刪 50 字：寫作紀錄記 largeDelete，但暫存區不收
    const before50 = '開頭。' + '霧'.repeat(50) + '結尾。';
    const after50 = '開頭。結尾。';
    expect(classifyTextDelta(before50, after50, { source: 'type' }).largeDelete).toBe(true);
    tracker.noteSelection(3, 53, before50.length);
    expect(
      tracker.handleEdit({
        chapterId: 'ch-1',
        before: before50,
        after: after50,
        source: 'type',
        nowMs: 1000,
      }),
    ).toEqual({ kind: 'none' });

    // 刪 99 字仍不收
    const before99 = '前'.repeat(10) + '港'.repeat(99) + '後'.repeat(10);
    const after99 = '前'.repeat(10) + '後'.repeat(10);
    tracker.noteSelection(10, 109, before99.length);
    expect(
      tracker.handleEdit({
        chapterId: 'ch-1',
        before: before99,
        after: after99,
        source: 'type',
        nowMs: 2000,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('按住刪除鍵一字一字連刪 120 次皆不進暫存區', () => {
    const tracker = createTrashCaptureTracker();
    let current = '霧'.repeat(120);
    for (let i = 0; i < 120; i += 1) {
      const next = current.slice(0, -1);
      tracker.noteSelection(next.length, next.length, current.length);
      const res = tracker.handleEdit({
        chapterId: 'ch-1',
        before: current,
        after: next,
        source: 'type',
        nowMs: 1000 + i * 50,
      });
      expect(res).toEqual({ kind: 'none' });
      current = next;
    }
  });

  it('一次刪除、剪下、組字蓋過或同書貼上蓋過 ≥ 100 字時精確收集原文與前後文錨點', () => {
    const tracker = createTrashCaptureTracker();
    const deleted = '【範例】' + '海'.repeat(100);
    // 前後刻意放重複字元，驗證選取快照優先不會對齊偏移
    const before = '燈塔說「好」字。' + deleted + '「好」字留在港口。';
    const delStart = '燈塔說「好」字。'.length;
    const delEnd = delStart + deleted.length;

    // 1. 選取後直接打字蓋過
    const afterType = before.slice(0, delStart) + '新' + before.slice(delEnd);
    tracker.noteSelection(delStart, delEnd, before.length);
    const resType = tracker.handleEdit({
      chapterId: 'ch-1',
      before,
      after: afterType,
      source: 'type',
      nowMs: 5000,
    });
    expect(resType.kind).toBe('capture');
    if (resType.kind === 'capture') {
      expect(resType.payload.deletedText).toBe(deleted);
      expect(resType.payload.wordCount).toBe(104);
      expect(resType.payload.deletionWordDelta).toBe(-104);
      expect(resType.payload.charOffset).toBe(delStart);
      expect(resType.payload.beforeAnchor).toBe('燈塔說「好」字。');
      expect(resType.payload.afterAnchor).toBe('「好」字留在港口。');
    }

    // 2. 組字結束結算蓋過
    const afterComp = before.slice(0, delStart) + '中文詞' + before.slice(delEnd);
    tracker.noteSelection(delStart, delEnd, before.length);
    const resComp = tracker.handleEdit({
      chapterId: 'ch-1',
      before,
      after: afterComp,
      source: 'composition',
      nowMs: 6000,
    });
    expect(resComp.kind).toBe('capture');
    if (resComp.kind === 'capture') {
      expect(resComp.payload.deletedText).toBe(deleted);
    }

    // 3. 同書貼上蓋過
    const afterPaste = before.slice(0, delStart) + '貼入一段短句' + before.slice(delEnd);
    tracker.noteSelection(delStart, delEnd, before.length);
    const resPaste = tracker.handleEdit({
      chapterId: 'ch-1',
      before,
      after: afterPaste,
      source: 'paste',
      nowMs: 7000,
    });
    expect(resPaste.kind).toBe('capture');
    if (resPaste.kind === 'capture') {
      expect(resPaste.payload.deletedText).toBe(deleted);
    }
  });
});

describe('WO-138 第 4 段：雙層系統復原撤回', () => {
  it('第 1 層：historyUndo 在 15 秒內將正文精確復原時撤回該筆刪稿', () => {
    const tracker = createTrashCaptureTracker();
    const before = '開頭。' + '霧'.repeat(105) + '結尾。';
    const after = '開頭。結尾。';
    tracker.noteSelection(3, 108, before.length);
    const captured = tracker.handleEdit({
      chapterId: 'ch-1',
      before,
      after,
      source: 'type',
      nowMs: 10_000,
    });
    expect(captured.kind).toBe('capture');
    if (captured.kind !== 'capture') return;
    tracker.rememberAutoTrash('trash-item-1', 'ch-1', captured.payload);

    tracker.noteHistoryUndo();
    const undone = tracker.handleEdit({
      chapterId: 'ch-1',
      before: after,
      after: before,
      source: 'type',
      nowMs: 12_000,
    });
    expect(undone).toEqual({ kind: 'undo', itemId: 'trash-item-1' });
    expect(tracker.getLastAutoTrash()).toBeNull();
  });

  it('第 2 層：行動鍵盤無 historyUndo 時，15 秒內非 paste 一步還原原文仍撤回', () => {
    const tracker = createTrashCaptureTracker();
    const before = '港'.repeat(110);
    const after = '';
    tracker.noteSelection(0, 110, before.length);
    const captured = tracker.handleEdit({
      chapterId: 'ch-1',
      before,
      after,
      source: 'type',
      nowMs: 20_000,
    });
    if (captured.kind !== 'capture') throw new Error('expected capture');
    tracker.rememberAutoTrash('trash-item-2', 'ch-1', captured.payload);

    // 未呼叫 noteHistoryUndo()，直接由系統輸入變回 beforeText
    const undone = tracker.handleEdit({
      chapterId: 'ch-1',
      before: after,
      after: before,
      source: 'type',
      nowMs: 20_000 + TRASH_UNDO_WINDOW_MS,
    });
    expect(undone).toEqual({ kind: 'undo', itemId: 'trash-item-2' });
  });

  it('超過 15 秒、中途手動改字、來源為 paste、切章或排版 clear 後不誤撤回', () => {
    const tracker = createTrashCaptureTracker();
    const before = '霧'.repeat(105);
    const after = '剩餘';
    const captureOnce = (nowMs: number) => {
      tracker.noteSelection(0, before.length, before.length);
      const res = tracker.handleEdit({ chapterId: 'ch-1', before, after, source: 'type', nowMs });
      if (res.kind !== 'capture') throw new Error('expected capture');
      tracker.rememberAutoTrash('item-x', 'ch-1', res.payload);
    };

    // 1. 超過 15 秒
    captureOnce(1000);
    tracker.noteHistoryUndo();
    expect(
      tracker.handleEdit({
        chapterId: 'ch-1',
        before: after,
        after: before,
        source: 'type',
        nowMs: 1000 + TRASH_UNDO_WINDOW_MS + 1,
      }),
    ).toEqual({ kind: 'none' });

    // 2. 來源為 paste 貼回同字（非復原）
    captureOnce(1000);
    expect(
      tracker.handleEdit({
        chapterId: 'ch-1',
        before: after,
        after: before,
        source: 'paste',
        nowMs: 2000,
      }),
    ).toEqual({ kind: 'none' });

    // 3. 中途手動打字後清掉撤回紀錄
    captureOnce(1000);
    expect(
      tracker.handleEdit({
        chapterId: 'ch-1',
        before: after,
        after: after + '甲',
        source: 'type',
        nowMs: 2000,
      }),
    ).toEqual({ kind: 'none' });
    expect(tracker.getLastAutoTrash()).toBeNull();

    // 4. 切章或 clear
    captureOnce(1000);
    tracker.clear();
    expect(tracker.getLastAutoTrash()).toBeNull();
  });
});

describe('WO-138 第 4 段：useWritingSurface 接線守衛', () => {
  it('排除組字中、排版 replaceText、找與取代，並維持 WO-122 replaceRef 守衛', () => {
    const surface = readFileSync(new URL('./useWritingSurface.ts', import.meta.url), 'utf8');
    expect(surface).toContain('createTrashCaptureTracker');
    expect(surface).toContain('trashCapture.noteSelection');
    expect(surface).toContain('trashCapture.noteHistoryUndo');
    expect(surface).toContain('trashCapture.handleEdit');
    expect(surface).toContain('trashCapture.rememberAutoTrash');
    expect(surface).toContain('trashCapture.clear()');

    // replaceRef.current 區段不得出現 process(／noteLarge／setDirty
    const start = surface.indexOf('replaceRef.current = (next');
    const end = surface.indexOf('const onCompositionStart');
    const replaceBlock = surface.slice(start, end);
    expect(replaceBlock).not.toMatch(/noteLarge|process\(|setDirty/);
  });
});
