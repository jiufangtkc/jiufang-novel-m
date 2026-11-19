import type { ChapterNode } from '../../data/demo';

/**
 * 測試用：依目錄順序找第一個「章」（file）節點。
 * WO-124b 起長篇新稿的根層第一個節點是卷，不能再用 nodes[0] 當章。
 */
export function firstFileNode(nodes: readonly ChapterNode[]): ChapterNode | undefined {
  for (const node of nodes) {
    if (node.type === 'file') return node;
    const inner = node.children ? firstFileNode(node.children) : undefined;
    if (inner) return inner;
  }
  return undefined;
}
