import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { readFileProject, snapshotFingerprints, writeFileProject, type FileProjectInfo } from '../db/projectFile';
import { openMemoryDb } from '../db/wasmDb';
import {
  canMoveBy,
  expandToNode,
  insertBelowAnchor,
  moveBy,
  moveChapterToVolume,
  moveNode,
  parentAllows,
  removalImpact,
  renameNode,
  resolveDrop,
  siblingOrders,
  withoutNode,
} from './chapterOps';

function file(id: string, title: string, children: ChapterNode[] = [], content = '【範例】正文。'): ChapterNode {
  return { id, type: 'file', title, progress: 'Draft', content, expanded: true, children };
}

function scene(id: string): ChapterNode {
  return { id, type: 'scene', title: id, progress: 'Draft', content: '【範例】幕。', children: [] };
}

function volume(id: string, children: ChapterNode[]): ChapterNode {
  return { id, type: 'folder', title: id, expanded: true, children };
}

const sample = (): ChapterNode[] => [
  volume('v1', [file('c1', '第一章', [scene('s1')]), file('c2', '第二章')]),
  volume('v2', [file('c3', '第三章')]),
  file('c4', '最上層章'),
];

const info: FileProjectInfo = {
  title: '【範例】排序測試',
  logline: '',
  currentTheme: '',
  globalFontFamily: '',
  globalFontSize: 12,
  editorFontFamily: '',
  editorFontSize: 16,
  targetWordCount: 1000,
  dailyTargetWordCount: 300,
  categoryOrder: null,
  expandedCategories: null,
  categoriesMeta: '{}',
  lastOpenedNodeId: null,
  lastCursorPosition: 0,
};

describe('章節目錄排序與刪除', () => {
  it('卷只在最上層，幕只在章裡', () => {
    expect(parentAllows(null, 'folder')).toBe(true);
    expect(parentAllows(volume('v', []), 'folder')).toBe(false);
    expect(parentAllows(null, 'scene')).toBe(false);
    expect(parentAllows(file('c', '章'), 'scene')).toBe(true);
    expect(moveNode(sample(), 'v2', 'v1', 0)).toBeNull();
    expect(moveNode(sample(), 's1', null, 0)).toBeNull();
  });

  it('上移下移只在同一層，最上面不能再上移', () => {
    expect(canMoveBy(sample(), 'c1', -1)).toBe(false);
    const moved = moveBy(sample(), 'c2', -1);
    expect(moved?.[0].children?.map((node) => node.id)).toEqual(['c2', 'c1']);
    expect(moveBy(sample(), 'c1', -1)).toBeNull();
  });

  it('章可以移到別卷或最上層', () => {
    const into = moveChapterToVolume(sample(), 'c4', 'v2');
    expect(into?.[1].children?.map((node) => node.id)).toEqual(['c3', 'c4']);
    const up = moveChapterToVolume(sample(), 'c3', null);
    expect(up?.map((node) => node.id)).toEqual(['v1', 'v2', 'c4', 'c3']);
  });

  it('新章加在錨點下面', () => {
    const created = file('new', '新章', [], '');
    const next = insertBelowAnchor(sample(), 'c1', created);
    expect(next?.[0].children?.map((node) => node.id)).toEqual(['c1', 'new', 'c2']);
  });

  it('刪除後復原，章、幕、進度與正文原封不動', () => {
    const before = sample();
    const removed = withoutNode(before, 'c1');
    expect(removed?.[0].children?.map((node) => node.id)).toEqual(['c2']);
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(removed));
    const restored = before;
    expect(restored[0].children?.[0]).toMatchObject({
      id: 'c1',
      progress: 'Draft',
      content: '【範例】正文。',
    });
    expect(restored[0].children?.[0].children?.[0].id).toBe('s1');
  });

  it('有字或有子項目才需要確認', () => {
    const empty = file('e', '空章', [], '');
    expect(removalImpact(empty).needsConfirm).toBe(false);
    expect(removalImpact(file('c', '有字')).needsConfirm).toBe(true);
    const parent = file('c', '有幕', [scene('s')]);
    expect(removalImpact(parent).scenes).toBe(1);
    expect(removalImpact(parent).needsConfirm).toBe(true);
  });

  it('收合的卷會為了回到該章而展開', () => {
    const collapsed = sample();
    if (collapsed[0]) collapsed[0] = { ...collapsed[0], expanded: false };
    const opened = expandToNode(collapsed, 'c2');
    expect(opened[0]?.expanded).toBe(true);
  });

  it('拖曳不能把幕放到卷上', () => {
    expect(resolveDrop(sample(), 's1', 'v2', true)).toBeNull();
    expect(resolveDrop(sample(), 'c2', 'c1', true)).toEqual({ parentId: 'v1', index: 1 });
  });

  it('改名拒絕空白', () => {
    expect(renameNode(sample(), 'c1', '   ')).toBeNull();
    expect(renameNode(sample(), 'c1', '第一章　改')?.[0].children?.[0].title).toBe('第一章　改');
  });

  it('排序寫回 .db 再開，同層順序與結構一致，其他表不丟', async () => {
    const db = await openMemoryDb(new Uint8Array());
    const tree = sample();
    writeFileProject(db.sql, info, tree, [], []);
    db.sql.run(
      `INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES ('keep', '範例快照', '2026-01-01', 1, '{}')`,
    );
    const before = snapshotFingerprints(db.sql);
    const moved = moveBy(tree, 'c2', -1);
    expect(moved).not.toBeNull();
    writeFileProject(db.sql, info, moved ?? [], [], []);
    const loaded = readFileProject(db.sql);
    expect(siblingOrders(loaded.tree)).toEqual(siblingOrders(moved ?? []));
    expect(loaded.tree[0]?.children?.map((node) => node.title)).toEqual(['第二章', '第一章']);
    expect(loaded.tree[0]?.children?.[1].children?.[0].id).toBe('s1');
    expect(snapshotFingerprints(db.sql)).toEqual(before);
    db.close();
  });

  it('四十章以上範例書可計算捲動範圍，排序後再開仍一致', async () => {
    const chapters = Array.from({ length: 41 }, (_, index) =>
      file(`long-${index + 1}`, `第${index + 1}章　【範例】`, [], '【範例】'),
    );
    expect(chapters.length).toBeGreaterThan(40);
    const rowHeight = 44;
    const viewport = 500;
    expect(chapters.length * rowHeight).toBeGreaterThan(viewport);
    const moved = moveNode(chapters, 'long-41', null, 0);
    expect(moved?.[0].id).toBe('long-41');
    const db = await openMemoryDb(new Uint8Array());
    writeFileProject(db.sql, info, moved ?? [], [], []);
    const loaded = readFileProject(db.sql);
    expect(loaded.tree.map((node) => node.id)[0]).toBe('long-41');
    expect(loaded.tree).toHaveLength(41);
    expect(siblingOrders(loaded.tree).map((row) => row.sortOrder)).toEqual(
      siblingOrders(moved ?? []).map((row) => row.sortOrder),
    );
    db.close();
  });
});
