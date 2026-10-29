import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import {
  addSceneUnderChapter,
  createScene,
  loadProjects,
  outlineRows,
  saveProjects,
  type KeyValueStore,
} from './outline';

function chapter(children: ChapterNode[] = []): ChapterNode {
  return {
    id: 'ch-3',
    type: 'file',
    title: '第三章　舊照片',
    progress: '1st Edit',
    expanded: false,
    children,
  };
}

describe('在章底下新增幕', () => {
  it('幕掛在該章底下並自動展開，列上的 parent 與種類正確', () => {
    const nodes = [chapter()];
    const scene = createScene(chapter(), 'sc-new');
    const next = addSceneUnderChapter(nodes, 'ch-3', scene);
    expect(next).not.toBeNull();
    expect(next?.[0].expanded).toBe(true);
    expect(next?.[0].children).toEqual([scene]);
    const row = outlineRows(next ?? []).find((item) => item.id === 'sc-new');
    expect(row).toMatchObject({
      parent_id: 'ch-3',
      node_type: 'scene',
      title: '幕 1　新幕',
    });
  });

  it('已有幕時編號往下加，卷或其他層不能當父層', () => {
    const existing: ChapterNode = {
      id: 'sc-1',
      type: 'scene',
      title: '幕 1　上坡',
      progress: 'Draft',
    };
    const scene = createScene(chapter([existing]), 'sc-2');
    expect(scene.title).toBe('幕 2　新幕');
    const folder: ChapterNode = { id: 'vol', type: 'folder', title: '第一卷', children: [] };
    expect(addSceneUnderChapter([folder], 'vol', scene)).toBeNull();
    expect(addSceneUnderChapter([chapter()], 'missing', scene)).toBeNull();
  });

  it('存起來再讀回，重新整理後幕還在', () => {
    const memory = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    };
    const scene = createScene(chapter(), 'sc-keep');
    const nodes = addSceneUnderChapter([chapter()], 'ch-3', scene) ?? [];
    saveProjects(store, [{ id: 'fog', title: '【示範】霧港紀事', updatedLabel: '剛剛', bookGoal: 1000, nodes }]);
    const loaded = loadProjects(store);
    const row = outlineRows(loaded?.[0].nodes ?? []).find((item) => item.id === 'sc-keep');
    expect(row).toMatchObject({ parent_id: 'ch-3', node_type: 'scene' });
  });
});
