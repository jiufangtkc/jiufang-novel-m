import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { moveNode } from '../domain/chapterOps';
import { reduceDrag, type DragState } from './dragSession';

function file(id: string): ChapterNode {
  return { id, type: 'file', title: id, content: id };
}

function idsAfter(nodes: readonly ChapterNode[], state: DragState, event: Parameters<typeof reduceDrag>[1]) {
  const step = reduceDrag(state, event);
  if (!step.move) return { nodes, state: step.state };
  const parentId = null;
  const index = nodes.findIndex((node) => node.id === step.move?.drop.id) + (step.move.drop.after ? 1 : 0);
  const moved = moveNode(nodes, step.move.dragId, parentId, index) ?? nodes;
  return { nodes: moved, state: step.state };
}

describe('拖曳中斷', () => {
  const tree = [file('ch-12'), file('ch-07'), file('ch-03')];

  it('pointercancel 取消拖曳，之後點別章不會把章移走', () => {
    let state: DragState = { dragId: null, drop: null };
    state = reduceDrag(state, { type: 'start', id: 'ch-12' }).state;
    state = reduceDrag(state, { type: 'hover', drop: { id: 'ch-07', after: true } }).state;
    const cancelled = idsAfter(tree, state, { type: 'pointercancel' });
    expect(cancelled.nodes.map((node) => node.id)).toEqual(['ch-12', 'ch-07', 'ch-03']);
    expect(cancelled.state.dragId).toBeNull();
    const laterClick = idsAfter(cancelled.nodes, cancelled.state, { type: 'pointerup' });
    expect(laterClick.nodes.map((node) => node.id)).toEqual(['ch-12', 'ch-07', 'ch-03']);
  });

  it('lostpointercapture 同樣取消，放開才會搬', () => {
    let state: DragState = { dragId: null, drop: null };
    state = reduceDrag(state, { type: 'start', id: 'ch-12' }).state;
    state = reduceDrag(state, { type: 'hover', drop: { id: 'ch-03', after: true } }).state;
    const lost = idsAfter(tree, state, { type: 'lostpointercapture' });
    expect(lost.nodes.map((node) => node.id)).toEqual(['ch-12', 'ch-07', 'ch-03']);
    expect(lost.state).toEqual({ dragId: null, drop: null });

    state = reduceDrag({ dragId: null, drop: null }, { type: 'start', id: 'ch-12' }).state;
    state = reduceDrag(state, { type: 'hover', drop: { id: 'ch-03', after: true } }).state;
    const dropped = idsAfter(tree, state, { type: 'pointerup' });
    expect(dropped.nodes.map((node) => node.id)).toEqual(['ch-07', 'ch-03', 'ch-12']);
    expect(dropped.state.dragId).toBeNull();
  });
});
