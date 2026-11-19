import { findNode, type ChapterNode } from '../data/demo';

/** 目錄樹內「＋ 新增」行的種類：根層新增卷、卷內新增章、章內新增幕。 */
export type InlineAddKind = 'volume' | 'chapter' | 'scene';

/** 展開值省略（舊資料）視為展開，和目錄實際畫出子清單的判斷一致。 */
export function isNodeExpanded(node: ChapterNode): boolean {
  return node.expanded !== false;
}

/**
 * 某一層清單尾端該放哪一種新增行；沒有就回 null。
 * parent 為 null 代表根層。整理目錄模式一律不放。
 */
export function inlineAddKindFor(parent: ChapterNode | null, organizing: boolean): InlineAddKind | null {
  if (organizing) return null;
  if (!parent) return 'volume';
  if (parent.type === 'folder') return isNodeExpanded(parent) ? 'chapter' : null;
  if (parent.type === 'file') {
    return isNodeExpanded(parent) && (parent.children?.length ?? 0) > 0 ? 'scene' : null;
  }
  return null;
}

/** 這個節點底下要不要畫子清單：有子節點，或是展開中的空卷（只放新增章行）。 */
export function showsChildList(node: ChapterNode, organizing: boolean): boolean {
  if (!isNodeExpanded(node)) return false;
  if (node.children?.length) return true;
  return inlineAddKindFor(node, organizing) === 'chapter';
}

/** 卷內新增章前確認目標卷還在；不在就不要新增，避免掉到根層備援。 */
export function volumeStillExists(nodes: readonly ChapterNode[], volumeId: string): boolean {
  return findNode(nodes, volumeId)?.type === 'folder';
}
