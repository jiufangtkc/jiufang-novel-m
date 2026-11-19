import { describe, expect, it } from 'vitest';
import {
  NEW_NOVEL_CHAPTER_TITLE,
  NEW_NOVEL_SCENE_TITLE,
  NEW_NOVEL_VOLUME_TITLE,
  TREE_NEW_VOLUME,
} from '../copy/userFacing';
import { findNode } from '../data/demo';
import { newChapterId, newSceneId, newVolumeId } from '../domain/openManuscript';
import { createState, reduce } from './sampleStore';
import { buildImportedProject } from './sampleStore';

const NOW = new Date('2026-11-14T05:00:00Z');

function add(id: string, shape: 'novel' | 'single', title = '【範例】測試') {
  const before = createState(NOW);
  const state = reduce(before, { type: 'add-project', id, title, shape });
  return { before, state, project: state.projects.find((p) => p.id === id)! };
}

describe('WO-90／WO-124b：建立新稿子後直接打開可寫的節點', () => {
  it('三個範例名稱：第一章結尾恰一個全形空白，卷與幕無結尾空白', () => {
    expect(NEW_NOVEL_VOLUME_TITLE).toBe('第一卷');
    expect(NEW_NOVEL_CHAPTER_TITLE).toBe('第一章　');
    expect(NEW_NOVEL_SCENE_TITLE).toBe('第一幕');
    expect(TREE_NEW_VOLUME).toBe('新卷');
  });

  it('長篇新稿只有一卷、一章、一幕，型別、父子與名稱正確，卷章展開', () => {
    const { project } = add('novel-wo90', 'novel');
    expect(project.nodes).toHaveLength(1);
    const volume = project.nodes[0]!;
    expect(volume).toMatchObject({ id: newVolumeId('novel-wo90'), type: 'folder', title: '第一卷', expanded: true });
    expect(volume.children).toHaveLength(1);
    const chapter = volume.children![0]!;
    expect(chapter).toMatchObject({ id: newChapterId('novel-wo90'), type: 'file', title: '第一章　', expanded: true, content: '' });
    expect(chapter.title.endsWith('　')).toBe(true);
    expect(chapter.title.endsWith('　　')).toBe(false);
    expect(chapter.children).toHaveLength(1);
    const scene = chapter.children![0]!;
    expect(scene).toMatchObject({ id: newSceneId('novel-wo90'), type: 'scene', title: '第一幕', content: '' });
    expect(scene.children).toBeUndefined();
    expect(new Set([volume.id, chapter.id, scene.id]).size).toBe(3);
  });

  it('長篇新稿 lastOpenedNodeId 指向實際存在、可寫的第一幕，游標 0', () => {
    const { project } = add('novel-wo90', 'novel');
    expect(project.lastOpenedNodeId).toBe(newSceneId('novel-wo90'));
    const node = findNode(project.nodes, project.lastOpenedNodeId!);
    expect(node?.type).toBe('scene');
    expect(node?.title).toBe('第一幕');
    expect(project.lastCursor).toBe(0);
    expect(project.shape).toBe('novel');
  });

  it('單篇新稿仍是以書名為名的唯一根層章，直接開該章', () => {
    const { project } = add('single-wo90', 'single', '【範例】單篇測試');
    expect(project.nodes).toHaveLength(1);
    expect(project.nodes[0]).toMatchObject({
      id: newChapterId('single-wo90'),
      type: 'file',
      title: '【範例】單篇測試',
      content: '',
    });
    expect(project.nodes[0]!.children).toBeUndefined();
    expect(project.lastOpenedNodeId).toBe(newChapterId('single-wo90'));
    expect(project.lastCursor).toBe(0);
  });

  it('其他初始狀態沿用：書目標、分類、卡片、寫作紀錄', () => {
    const { project, state } = add('novel-wo90', 'novel');
    expect(project.cards).toEqual([]);
    expect(project.bookGoal).toBe(100000);
    expect(state.logsById['novel-wo90']).toEqual([]);
    expect(state.toast).toBe('已開新稿子');
  });

  it('從既有非三層稿夾具再開新稿，原稿樹形與開啟位置維持', () => {
    const base = createState(NOW);
    const old = buildImportedProject('old-1', '舊稿', [
      { title: '甲', content: '甲文' },
      { title: '乙', content: '乙文' },
    ]);
    const seeded = { ...base, projects: [old, ...base.projects] };
    const after = reduce(seeded, { type: 'add-project', id: 'new-1', title: '新', shape: 'novel' });
    expect(after.projects.find((p) => p.id === 'old-1')).toEqual(old);
    expect(after.projects.find((p) => p.id === 'new-1')!.nodes[0]!.type).toBe('folder');
  });

  it('匯入稿不變：多章仍是根層章，第一章為初始位置，沒有卷或幕', () => {
    const imported = buildImportedProject('imp-1', '匯入', [
      { title: '第一章　夜雨', content: '雨' },
      { title: '第二章　天晴', content: '晴' },
    ]);
    expect(imported.nodes.map((n) => n.type)).toEqual(['file', 'file']);
    expect(imported.nodes.every((n) => !n.children)).toBe(true);
    expect(imported.lastOpenedNodeId).toBe(newChapterId('imp-1'));
  });
});
