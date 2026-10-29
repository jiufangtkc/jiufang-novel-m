import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { columnNames, tableNames } from '../db/sql';
import { readFileProject, snapshotFingerprints, writeFileProject, type FileProjectInfo } from '../db/projectFile';
import { openMemoryDb } from '../db/wasmDb';
import { moveBy, neighborChapterId, placeRecovered } from './chapterOps';
import { manuscriptWritePath, shapeAfterEdit } from './openManuscript';

function file(id: string, title: string, children: ChapterNode[] = []): ChapterNode {
  return { id, type: 'file', title, content: '【假資料】', expanded: false, children };
}

const info: FileProjectInfo = {
  title: '【假資料】單篇',
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
  lastOpenedNodeId: 'piece',
  lastCursorPosition: 12,
};

describe('上一章下一章與單篇', () => {
  it('上一章下一章照目錄走，收合的卷也算，兩端沒有章', () => {
    const nodes: ChapterNode[] = [
      {
        id: 'v',
        type: 'folder',
        title: '卷',
        expanded: false,
        children: [file('c1', '第一章', [{ id: 's1', type: 'scene', title: '幕', content: '幕' }]), file('c2', '第二章')],
      },
      file('c3', '第三章'),
    ];
    expect(neighborChapterId(nodes, 'c1', -1)).toBeNull();
    expect(neighborChapterId(nodes, 'c1', 1)).toBe('c2');
    expect(neighborChapterId(nodes, 's1', 1)).toBe('c2');
    expect(neighborChapterId(nodes, 's1', -1)).toBeNull();
    expect(neighborChapterId(nodes, 'c2', 1)).toBe('c3');
    expect(neighborChapterId(nodes, 'c3', 1)).toBeNull();
  });

  it('移動章節不改章名', () => {
    const nodes = [file('a', '第一章　甲'), file('b', '第二章　乙')];
    expect(moveBy(nodes, 'b', -1)?.map((node) => node.title)).toEqual(['第二章　乙', '第一章　甲']);
  });

  it('單篇寫成一章普通結構，上次位置跟著 .db，不新增表', async () => {
    const tree = [file('piece', '短篇一則')];
    const db = await openMemoryDb(new Uint8Array());
    writeFileProject(db.sql, info, tree, [], []);
    db.sql.run(
      `INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES ('keep', '假快照', '2026-01-01', 1, '{}')`,
    );
    const before = snapshotFingerprints(db.sql);
    writeFileProject(db.sql, info, tree, [], []);
    const loaded = readFileProject(db.sql);
    expect(loaded.tree).toHaveLength(1);
    expect(loaded.tree[0]?.type).toBe('file');
    expect(loaded.tree[0]?.id).toBe('piece');
    expect(loaded.info.lastOpenedNodeId).toBe('piece');
    expect(loaded.info.lastCursorPosition).toBe(12);
    expect(snapshotFingerprints(db.sql)).toEqual(before);
    expect(tableNames(db.sql).has('chapter_versions')).toBe(false);
    expect(columnNames(db.sql, 'project_info').has('shape')).toBe(false);
    expect(columnNames(db.sql, 'snapshots').has('project_data')).toBe(true);
    db.close();
  });

  it('單篇再開直接進正文，多了一章就變回長篇', () => {
    const single = {
      id: 'p1',
      shape: 'single' as const,
      lastOpenedNodeId: null,
      nodes: [file('p1-ch', '短篇')],
    };
    expect(manuscriptWritePath(single)).toBe('/p/p1/write/p1-ch');
    expect(shapeAfterEdit('single', [file('a', '甲'), file('b', '乙')])).toBe('novel');
    expect(shapeAfterEdit('single', single.nodes)).toBe('single');
    const novel = {
      id: 'fog',
      lastOpenedNodeId: 'ch-2',
      nodes: [file('ch-1', '一'), file('ch-2', '二')],
    };
    expect(manuscriptWritePath(novel)).toBe('/p/fog/write/ch-2');
    expect(manuscriptWritePath({ id: 'fog', nodes: novel.nodes })).toBe('/p/fog/write');
  });

  it('幕沒有章可掛時，放回會變成最上層的章', () => {
    const scene: ChapterNode = { id: 's', type: 'scene', title: '幕', content: '丙' };
    const placed = placeRecovered([], { node: scene, parentId: 'missing', index: 0 }, false);
    expect(placed.map((node) => ({ id: node.id, type: node.type }))).toEqual([{ id: 's', type: 'file' }]);
  });
});
