import { findNode, updateNode, type ChapterNode } from '../data/demo';
import { moveNode, renameNode, withoutNode } from './chapterOps';

/** 復原只記載這一動，不把整本目錄蓋回去。 */
export type StructureChange =
  | { kind: 'move'; id: string; parentId: string | null; index: number }
  | { kind: 'add'; id: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'progress'; id: string; progress: ChapterNode['progress'] };

export function nodesAfterStructureUndo(
  current: readonly ChapterNode[],
  change: StructureChange,
): ChapterNode[] {
  if (change.kind === 'move') {
    return moveNode(current, change.id, change.parentId, change.index) ?? [...current];
  }
  if (change.kind === 'add') return withoutNode(current, change.id) ?? [...current];
  if (change.kind === 'rename') return renameNode(current, change.id, change.title) ?? [...current];
  if (!findNode(current, change.id)) return [...current];
  return updateNode(current, change.id, (item) => ({ ...item, progress: change.progress }));
}
