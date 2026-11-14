import { describe, expect, it } from 'vitest';
import { newChapterId } from '../domain/openManuscript';
import { createState, reduce } from './sampleStore';

describe('WO-90：建立新稿子後直接打開第一章', () => {
  it('WO-90：長篇新稿建立後 lastOpenedNodeId 為第一章，標題為「第一章　」', () => {
    const state = reduce(createState(new Date('2026-11-14T05:00:00Z')), {
      type: 'add-project',
      id: 'novel-wo90',
      title: '【範例】長篇測試',
      shape: 'novel',
    });
    const project = state.projects.find((p) => p.id === 'novel-wo90')!;
    const chapterId = newChapterId('novel-wo90');
    expect(project.lastOpenedNodeId).toBe(chapterId);
    expect(project.nodes).toHaveLength(1);
    expect(project.nodes[0]?.title).toBe('第一章　');
    expect(project.nodes[0]?.id).toBe(chapterId);
  });

  it('WO-90：單篇新稿仍直接打開該章，行為不變', () => {
    const state = reduce(createState(new Date('2026-11-14T05:00:00Z')), {
      type: 'add-project',
      id: 'single-wo90',
      title: '【範例】單篇測試',
      shape: 'single',
    });
    const project = state.projects.find((p) => p.id === 'single-wo90')!;
    const chapterId = newChapterId('single-wo90');
    expect(project.lastOpenedNodeId).toBe(chapterId);
    expect(project.nodes[0]?.title).toBe('【範例】單篇測試');
  });
});