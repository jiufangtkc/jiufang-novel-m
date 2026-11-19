import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newManuscriptFirstNodeId, writePath } from '../domain/openManuscript';
import { findNode } from '../data/demo';
import { createState, reduce } from '../state/sampleStore';

describe('WO-90／WO-124b：首頁建立新稿導向', () => {
  const source = readFileSync(new URL('./HomeScreen.tsx', import.meta.url), 'utf8');

  it('首頁建立後用共用規則決定要開的節點，不再一律導向第一章', () => {
    expect(source).toContain('navigate(writePath(id, newManuscriptFirstNodeId(id, shape)))');
    expect(source).not.toContain('newChapterId');
    expect(source).not.toMatch(/shape === 'single' \? writePath/);
  });

  it('導向的節點就是 reducer 建立並記為上次開啟的那個節點：長篇第一幕、單篇唯一章', () => {
    for (const [shape, expectedTitle] of [
      ['novel', '第一幕'],
      ['single', '單篇書名'],
    ] as const) {
      const id = `home-${shape}`;
      const state = reduce(createState(new Date('2026-11-14T05:00:00Z')), {
        type: 'add-project',
        id,
        title: '單篇書名',
        shape,
      });
      const project = state.projects.find((p) => p.id === id)!;
      const target = newManuscriptFirstNodeId(id, shape);
      expect(project.lastOpenedNodeId).toBe(target);
      expect(findNode(project.nodes, target)?.title).toBe(expectedTitle);
      expect(writePath(id, target)).toBe(`/p/${id}/write/${target}`);
    }
  });
});
