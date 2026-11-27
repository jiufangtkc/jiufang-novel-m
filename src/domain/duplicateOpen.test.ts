import { describe, expect, it } from 'vitest';
import { DEMO_PROJECTS, type ChapterNode, type DemoProject } from '../data/demo';
import {
  findExistingForOpen,
  hasUnsavedChanges,
  isSameBook,
  manuscriptDigest,
} from './duplicateOpen';

const UUID_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

function proj(id: string, title: string, extra: Partial<DemoProject> = {}): DemoProject {
  return { id, title, updatedLabel: '剛剛', bookGoal: 1000, nodes: [], origin: 'file', ...extra };
}
const none = () => false;

describe('WO-143：isSameBook', () => {
  it('身分證相同且合法 → 同一本（書名檔名不同也算）', () => {
    expect(isSameBook({ title: '甲', filename: 'a.db', bookUuid: UUID_A }, { title: '乙', filename: 'b.db', bookUuid: UUID_A })).toBe(true);
    expect(
      isSameBook(
        { title: '甲', filename: 'a.db', bookUuid: UUID_A, bookMetaPersisted: true },
        { title: '乙', filename: 'b.db', bookUuid: UUID_A, bookMetaPersisted: true },
      ),
    ).toBe(true);
  });
  it('WO-143 審查必修 2：兩邊都是已寫入檔案的身分證且 uuid 不同 → 一定不是同一本，即使書名與檔名都相同（另存分枝）', () => {
    const a = { title: '道劍', filename: '道劍.db', bookUuid: UUID_A, bookMetaPersisted: true };
    const b = { title: '道劍', filename: '道劍.db', bookUuid: UUID_B, bookMetaPersisted: true, originBookUuid: UUID_A };
    expect(isSameBook(a, b)).toBe(false);
    expect(isSameBook(b, a)).toBe(false);
  });
  it('任一邊身分證尚未寫入檔案：uuid 不同時退回書名＋檔名', () => {
    const persisted = { title: '道劍', filename: '道劍.db', bookUuid: UUID_A, bookMetaPersisted: true };
    const legacy = { title: '道劍', filename: '道劍.db', bookUuid: UUID_B, bookMetaPersisted: false };
    expect(isSameBook(persisted, legacy)).toBe(true);
    expect(isSameBook(persisted, { ...legacy, filename: '別的.db' })).toBe(false);
  });
  it('身分證不同，另存分枝（不同 uuid）不算同一本；書名檔名也不同', () => {
    expect(isSameBook({ title: '甲', filename: 'a.db', bookUuid: UUID_A }, { title: '乙', filename: 'b.db', bookUuid: UUID_B })).toBe(false);
  });
  it('不合法的 uuid 不當身分證', () => {
    expect(isSameBook({ title: '甲', filename: 'a.db', bookUuid: 'not-a-uuid' }, { title: '乙', filename: 'b.db', bookUuid: 'not-a-uuid' })).toBe(false);
  });
  it('書名（trim）與檔名都相同且檔名非空 → 同一本；檔名空白不算', () => {
    expect(isSameBook({ title: ' 道劍 ', filename: 'x.db' }, { title: '道劍', filename: 'x.db' })).toBe(true);
    expect(isSameBook({ title: '道劍', filename: '' }, { title: '道劍', filename: '' })).toBe(false);
    expect(isSameBook({ title: '道劍', filename: 'x.db' }, { title: '道劍', filename: 'y.db' })).toBe(false);
  });
});

describe('WO-143：findExistingForOpen', () => {
  const opened = (extra: Partial<{ title: string; filename: string; bookUuid: string; bookMetaPersisted: boolean }> = {}) => ({
    title: '道劍',
    filename: '道劍.db',
    bookUuid: UUID_A,
    bookMetaPersisted: true,
    ...extra,
  });

  it('身分證對得上 → same-book', () => {
    const p = proj('p1', '道劍', { bookUuid: UUID_A, filename: '改名後.db' });
    const found = findExistingForOpen({ opened: opened(), projects: [p], recentIds: ['p1'], isRemoved: none });
    expect(found).toEqual({ kind: 'same-book', project: p });
  });

  it('舊檔（沒有身分證）書名＋檔名相同 → same-book', () => {
    const p = proj('p1', '道劍', { bookUuid: UUID_B, filename: '道劍.db' });
    const found = findExistingForOpen({
      opened: opened({ bookMetaPersisted: false, bookUuid: UUID_A }),
      projects: [p],
      recentIds: ['p1'],
      isRemoved: none,
    });
    expect(found.kind).toBe('same-book');
  });

  it('舊檔只有書名相同、檔名不同 → same-title', () => {
    const p = proj('p1', '道劍', { filename: '別的檔名.db' });
    const found = findExistingForOpen({ opened: opened({ bookMetaPersisted: false }), projects: [p], recentIds: ['p1'], isRemoved: none });
    expect(found).toEqual({ kind: 'same-title', projects: [p] });
  });

  it('有身分證但與已有的不同（另存分枝或別本同名）→ same-title，即使檔名也相同', () => {
    const p = proj('p1', '道劍', { bookUuid: UUID_B, filename: '道劍.db', originBookUuid: UUID_A, bookMetaPersisted: true });
    const found = findExistingForOpen({ opened: opened(), projects: [p], recentIds: ['p1'], isRemoved: none });
    expect(found.kind).toBe('same-title');
  });

  it('書名頭尾空白不影響', () => {
    const p = proj('p1', '  道劍 ', { filename: 'z.db' });
    const found = findExistingForOpen({ opened: opened({ title: '道劍 ', bookMetaPersisted: false }), projects: [p], recentIds: ['p1'], isRemoved: none });
    expect(found.kind).toBe('same-title');
  });

  it('書名不同 → none', () => {
    const found = findExistingForOpen({ opened: opened(), projects: [proj('p1', '別本')], recentIds: ['p1'], isRemoved: none });
    expect(found).toEqual({ kind: 'none' });
  });

  it('範例書與已刪除稿子被排除', () => {
    // 內建範例書要用真的內建代號（isBuiltinSampleBook 只認 DEMO_PROJECTS 的 id）。
    const sampleId = DEMO_PROJECTS[0]!.id;
    const sample = proj(sampleId, '道劍', { origin: 'demo', bookUuid: UUID_A });
    const removed = proj('p-gone', '道劍', { bookUuid: UUID_A });
    const found = findExistingForOpen({
      opened: opened(),
      projects: [sample, removed],
      recentIds: [sampleId, 'p-gone'],
      isRemoved: (id) => id === 'p-gone',
    });
    // 兩份都被排除，沒有任何可比對的稿子。
    expect(found).toEqual({ kind: 'none' });
  });

  it('多份 same-book 取 recentIds 排最前面的那份；不在清單的排最後', () => {
    const a = proj('a', '道劍', { bookUuid: UUID_A });
    const b = proj('b', '道劍', { bookUuid: UUID_A });
    const c = proj('c', '道劍', { bookUuid: UUID_A });
    const found = findExistingForOpen({ opened: opened(), projects: [a, b, c], recentIds: ['b', 'a'], isRemoved: none });
    expect(found.kind === 'same-book' && found.project.id).toBe('b');
    const found2 = findExistingForOpen({ opened: opened(), projects: [a, b, c], recentIds: ['c'], isRemoved: none });
    expect(found2.kind === 'same-book' && found2.project.id).toBe('c');
  });

  it('複審必修 1：uuid 完全相符但較舊開啟的副本，優先於較近期開啟、書名檔名相同的舊格式別稿；沒有相符副本時才落到別稿', () => {
    const exact = proj('exact', '道劍', { bookUuid: UUID_A, bookMetaPersisted: true, filename: '道劍.db' });
    const legacy = proj('legacy', '道劍', { bookUuid: UUID_B, bookMetaPersisted: false, filename: '道劍.db' });
    const found = findExistingForOpen({
      opened: opened(),
      projects: [legacy, exact],
      recentIds: ['legacy', 'exact'],
      isRemoved: none,
    });
    expect(found.kind === 'same-book' && found.project.id).toBe('exact');
    const without = findExistingForOpen({
      opened: opened(),
      projects: [legacy],
      recentIds: ['legacy'],
      isRemoved: none,
    });
    expect(without.kind === 'same-book' && without.project.id).toBe('legacy');
  });

  it('same-book 優先於 same-title', () => {
    const same = proj('same', '道劍', { bookUuid: UUID_A });
    const other = proj('other', '道劍', { bookUuid: UUID_B });
    const found = findExistingForOpen({ opened: opened(), projects: [other, same], recentIds: ['other', 'same'], isRemoved: none });
    expect(found.kind === 'same-book' && found.project.id).toBe('same');
  });
});

describe('WO-143：hasUnsavedChanges／manuscriptDigest', () => {
  it('沒有對應檔案一律算有（無法判斷時寧可多問）', () => {
    expect(hasUnsavedChanges({ id: 'p', hasExternalFile: false }, {})).toBe(true);
    expect(hasUnsavedChanges({ id: 'p' }, {})).toBe(true);
  });
  it('有檔案：看 dirtySinceFileSave', () => {
    expect(hasUnsavedChanges({ id: 'p', hasExternalFile: true }, {})).toBe(false);
    expect(hasUnsavedChanges({ id: 'p', hasExternalFile: true }, { p: { dirtySinceFileSave: false } })).toBe(false);
    expect(hasUnsavedChanges({ id: 'p', hasExternalFile: true }, { p: { dirtySinceFileSave: true } })).toBe(true);
  });
  it('摘要：相同內容相同、改一個字就不同、標題也算', () => {
    const nodes = (text: string, title = '第一章'): ChapterNode[] => [
      { id: 'x', type: 'file', title, content: text },
    ];
    expect(manuscriptDigest(nodes('甲乙丙'))).toBe(manuscriptDigest(nodes('甲乙丙')));
    expect(manuscriptDigest(nodes('甲乙丙'))).not.toBe(manuscriptDigest(nodes('甲乙丁')));
    expect(manuscriptDigest(nodes('甲乙丙'))).not.toBe(manuscriptDigest(nodes('甲乙丙', '第二章')));
  });
});
