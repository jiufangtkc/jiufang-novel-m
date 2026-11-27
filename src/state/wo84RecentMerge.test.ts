/**
 * WO-143 取代 WO-84：首頁最近清單不再把同名稿子收成一筆。
 * 這個檔案原本測 WO-84 的「同名只留一筆」，現在改測新行為：照 recentIds 順序全列，重名時標示差別。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DemoProject } from '../data/demo';
import { recentListEntries } from './recentProjects';

const UUID_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

function proj(id: string, title: string, extra: Partial<DemoProject> = {}): DemoProject {
  return { id, title, updatedLabel: '已在手機', bookGoal: 1000, nodes: [], origin: 'file', ...extra };
}

describe('WO-143 取代 WO-84：首頁清單不合併同名', () => {
  it('同名兩份都列出來，順序照 recentIds', () => {
    const a = proj('a', '【範例】同名稿');
    const b = proj('b', '【範例】同名稿');
    expect(recentListEntries([a, b], ['b', 'a']).map((e) => e.project.id)).toEqual(['b', 'a']);
  });

  it('不存在於 projects 的代號被排除；不刪底層專案', () => {
    const a = proj('a', '甲');
    const all = [a];
    expect(recentListEntries(all, ['ghost', 'a']).map((e) => e.project.id)).toEqual(['a']);
    expect(all).toHaveLength(1);
  });

  it('沒有重名：沒有標示、沒有檔名行、沒有「留下這一份」', () => {
    const entries = recentListEntries([proj('x', '甲', { filename: 'x.db' }), proj('y', '乙', { filename: 'y.db' })], ['y', 'x']);
    for (const entry of entries) {
      expect(entry.badge).toBeNull();
      expect(entry.filename).toBeNull();
      expect(entry.sameTitleOthers).toBe(0);
      expect(entry.otherSameBookIds).toEqual([]);
    }
  });

  it('同一本（身分證相同）→ same-book，並列出同一本的其他份', () => {
    const a = proj('a', '道劍', { bookUuid: UUID_A, filename: 'a.db' });
    const b = proj('b', '道劍', { bookUuid: UUID_A, filename: 'b.db' });
    const [ea, eb] = recentListEntries([a, b], ['a', 'b']);
    expect(ea!.badge).toBe('same-book');
    expect(ea!.filename).toBe('a.db');
    expect(ea!.otherSameBookIds).toEqual(['b']);
    expect(eb!.otherSameBookIds).toEqual(['a']);
  });

  it('只是同名（不同身分證、不同檔名）→ same-title，且不會被列為同一本的其他份', () => {
    const a = proj('a', '道劍', { bookUuid: UUID_A, filename: 'a.db' });
    const b = proj('b', ' 道劍 ', { bookUuid: UUID_B, filename: 'b.db' });
    const [ea, eb] = recentListEntries([a, b], ['a', 'b']);
    expect(ea!.badge).toBe('same-title');
    expect(eb!.badge).toBe('same-title');
    expect(ea!.otherSameBookIds).toEqual([]);
    expect(ea!.sameTitleOthers).toBe(1);
  });

  it('審查必修 2：另存分枝（不同的已寫入身分證、相同檔名）不是同一本，標示 same-title，也不會被列為可刪', () => {
    const a = proj('a', '道劍', { bookUuid: UUID_A, filename: '道劍.db', bookMetaPersisted: true });
    const b = proj('b', '道劍', { bookUuid: UUID_B, filename: '道劍.db', bookMetaPersisted: true, originBookUuid: UUID_A });
    const [ea, eb] = recentListEntries([a, b], ['a', 'b']);
    expect(ea!.badge).toBe('same-title');
    expect(eb!.badge).toBe('same-title');
    expect(ea!.otherSameBookIds).toEqual([]);
    expect(eb!.otherSameBookIds).toEqual([]);
  });

  it('三份：兩份同一本、一份只是同名 → 同一本那兩份互相列出，另一份只是同名', () => {
    const a = proj('a', '道劍', { bookUuid: UUID_A, filename: 'a.db' });
    const b = proj('b', '道劍', { bookUuid: UUID_A, filename: 'b.db' });
    const c = proj('c', '道劍', { bookUuid: UUID_B, filename: 'c.db' });
    const entries = recentListEntries([a, b, c], ['a', 'b', 'c']);
    expect(entries.map((e) => e.badge)).toEqual(['same-book', 'same-book', 'same-title']);
    expect(entries[0]!.otherSameBookIds).toEqual(['b']);
    expect(entries[2]!.otherSameBookIds).toEqual([]);
  });

  it('沒有檔名的重名稿子：有標示、沒有檔名行', () => {
    const [ea] = recentListEntries([proj('a', '道劍'), proj('b', '道劍')], ['a', 'b']);
    expect(ea!.badge).toBe('same-title');
    expect(ea!.filename).toBeNull();
  });

  it('首頁實際使用新的清單函式，不再用 WO-84 的合併函式', () => {
    const source = readFileSync(new URL('../screens/HomeScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('recentListEntries(state.projects, state.recentIds)');
    expect(source).not.toContain('recentDisplayProjects');
  });
});
