import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { deletedFromNode } from './chapterVersions';
import { placeRecovered, withoutNode } from './chapterOps';

function chapter(n: number): ChapterNode {
  return { id: `c${n}`, type: 'file', title: `第${n}章`, content: `字${n}`, progress: 'Draft' };
}

describe('刪掉的章靠鄰居找回位置', () => {
  it('連刪第 20、19 章後，第 20 章放回原位置會在第 21 章前面', () => {
    let nodes = [18, 19, 20, 21].map(chapter);
    const removed20 = deletedFromNode(nodes, 'c20', 1, 'd20');
    nodes = withoutNode(nodes, 'c20') ?? nodes;
    const removed19 = deletedFromNode(nodes, 'c19', 2, 'd19');
    nodes = withoutNode(nodes, 'c19') ?? nodes;
    const with20 = placeRecovered(nodes, removed20!, false);
    expect(with20.map((node) => node.id)).toEqual(['c18', 'c20', 'c21']);
    expect(with20.find((node) => node.id === 'c20')?.content).toBe('字20');
    const with19 = placeRecovered(with20, removed19!, false);
    expect(with19.map((node) => node.id)).toEqual(['c18', 'c19', 'c20', 'c21']);
  });
});
