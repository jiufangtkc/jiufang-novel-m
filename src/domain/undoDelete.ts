import type { ChapterNode } from '../data/demo';
import { placeRecovered } from './chapterOps';

export interface DeletedPlacement {
  node: ChapterNode;
  parentId: string | null;
  index: number;
}

/**
 * 刪除後按復原。
 * 錯誤做法是把刪除當下的整份目錄蓋回去，別章在這幾秒打的字會消失。
 */
export function nodesAfterDeleteUndo(
  current: readonly ChapterNode[],
  undo: { snapshot: readonly ChapterNode[]; deleted: DeletedPlacement },
): ChapterNode[] {
  void undo.snapshot;
  return placeRecovered(current, undo.deleted, false);
}
