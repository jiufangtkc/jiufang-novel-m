import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import {
  VERSION_INTERVAL_MS,
  VERSION_LIMIT,
  archiveDeletion,
  deletedFromNode,
  emptyArchive,
  forgetDeleted,
  pushVersion,
  rememberDeleted,
  sessionVersions,
  shouldKeepVersion,
  versionFromNode,
  versionsForNode,
  withVersion,
  nodeAfterVersionRestore,
} from './chapterVersions';
import { placeRecovered } from './chapterOps';

function file(id: string, title: string, content = '甲', children: ChapterNode[] = []): ChapterNode {
  return { id, type: 'file', title, content, children };
}

function version(content: string, savedAt: number): ReturnType<typeof versionFromNode> {
  return versionFromNode({ id: 'c1', title: '第一章', content }, savedAt, `v-${savedAt}`);
}

describe('章的舊版', () => {
  it('內容有變才留，最多十版，最舊的先丟掉', () => {
    expect(VERSION_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(shouldKeepVersion('甲', '甲')).toBe(false);
    expect(shouldKeepVersion('甲', '乙')).toBe(true);
    let list = pushVersion(undefined, version('0', 0));
    expect(pushVersion(list, version('0', 1))).toBe(list);
    for (let index = 1; index <= VERSION_LIMIT; index += 1) {
      list = pushVersion(list, version(String(index), index));
    }
    expect(list).toHaveLength(VERSION_LIMIT);
    expect(list[0]?.content).toBe(String(VERSION_LIMIT));
    expect(list.some((item) => item.content === '0')).toBe(false);
  });

  it('離開本章時先留下進章的正文，內容沒變則不留', () => {
    const same = sessionVersions({
      baseline: '舊',
      lastKept: '舊',
      content: '舊',
      baselineStored: false,
      node: { id: 'c1', title: '第一章' },
      savedAt: 10,
    });
    expect(same.versions).toEqual([]);
    const changed = sessionVersions({
      baseline: '舊',
      lastKept: '舊',
      content: '新',
      baselineStored: false,
      node: { id: 'c1', title: '第一章' },
      savedAt: 10,
    });
    expect(changed.versions.map((item) => item.content)).toEqual(['舊', '新']);
    let archive = emptyArchive();
    for (const version of changed.versions) archive = withVersion(archive, version);
    expect(archive.versions.c1?.map((item) => item.content)).toEqual(['新', '舊']);
    const again = sessionVersions({
      baseline: '舊',
      lastKept: changed.lastKept,
      content: '再改',
      baselineStored: changed.baselineStored,
      node: { id: 'c1', title: '第一章' },
      savedAt: 40,
    });
    expect(again.versions.map((item) => item.content)).toEqual(['再改']);
  });

  it('換回舊版之前先把現在的內容留下', () => {
    const kept = pushVersion(undefined, version('舊', 1));
    const beforeRestore = pushVersion(kept, version('現在', 2));
    expect(beforeRestore.map((item) => item.content)).toEqual(['現在', '舊']);
    const archive = withVersion(emptyArchive(), beforeRestore[1]!);
    const restored = withVersion(archive, beforeRestore[0]!);
    expect(restored.versions.c1?.map((item) => item.content)).toEqual(['現在', '舊']);
  });

  it('找回舊版只換正文，章名留著現在的', () => {
    const node = file('c1', '現在的章名', '現在的正文');
    const version = versionFromNode({ id: 'c1', title: '舊章名', content: '舊正文' }, 1, 'v1');
    const next = nodeAfterVersionRestore(node, version);
    expect(next.title).toBe('現在的章名');
    expect(next.content).toBe('舊正文');
    expect(next.progress).toBeUndefined();
  });

  it('刪掉的章留得回來，復原後就從清單拿掉', () => {
    const nodes = [file('c1', '第一章', '甲'), file('c2', '第二章', '乙', [{ id: 's1', type: 'scene', title: '幕', content: '丙' }])];
    const record = deletedFromNode(nodes, 'c2', 50, 'del-c2');
    expect(record?.parentId).toBeNull();
    expect(record?.index).toBe(1);
    expect(record?.node.children?.[0]?.content).toBe('丙');
    const versions = versionsForNode(record!.node, 50);
    expect(versions.map((item) => item.nodeId)).toEqual(['c2', 's1']);
    let archive = archiveDeletion(emptyArchive(), record!, versions);
    expect(archive.deleted).toHaveLength(1);
    expect(archive.versions.c2?.[0]?.content).toBe('乙');
    const gone = [file('c1', '第一章', '甲'), file('c3', '第三章', '丁')];
    expect(placeRecovered(gone, record!, false).map((node) => node.id)).toEqual(['c1', 'c2', 'c3']);
    expect(placeRecovered(gone, record!, true).map((node) => node.id)).toEqual(['c1', 'c3', 'c2']);
    archive = { ...archive, deleted: forgetDeleted(archive.deleted, 'del-c2') };
    expect(archive.deleted).toHaveLength(0);
  });

  it('刪掉的章最多留十筆，原卷不見了就放到最後', () => {
    let deleted = rememberDeleted([], deletedFromNode([file('a', '甲')], 'a', 1, 'd0')!);
    for (let index = 1; index <= 12; index += 1) {
      const id = `c${index}`;
      const record = deletedFromNode([file(id, id)], id, index, `d${index}`)!;
      deleted = rememberDeleted(deleted, record);
    }
    expect(deleted).toHaveLength(10);
    expect(deleted[0]?.id).toBe('d12');
    expect(deleted.some((item) => item.id === 'd0')).toBe(false);
    const orphan = deletedFromNode(
      [{ id: 'v', type: 'folder', title: '卷', children: [file('c', '章')] }],
      'c',
      3,
      'gone',
    )!;
    const placed = placeRecovered([file('tail', '尾')], orphan, false);
    expect(placed.map((node) => node.id)).toEqual(['tail', 'c']);
  });
});
