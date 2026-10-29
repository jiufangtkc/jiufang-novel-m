import { findNode, type ChapterNode } from '../data/demo';
import { countManuscriptWords } from './manuscriptWords';

export interface NodeLocation {
  parentId: string | null;
  index: number;
}

export interface RemovalImpact {
  chapters: number;
  scenes: number;
  words: number;
  needsConfirm: boolean;
}

export function locateNode(nodes: readonly ChapterNode[], id: string): NodeLocation | null {
  const walk = (list: readonly ChapterNode[], parentId: string | null): NodeLocation | null => {
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index];
      if (!node) continue;
      if (node.id === id) return { parentId, index };
      if (node.children?.length) {
        const found = walk(node.children, node.id);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes, null);
}

export function parentAllows(parent: ChapterNode | null, type: ChapterNode['type']): boolean {
  if (type === 'folder') return parent == null;
  if (type === 'file') return parent == null || parent.type === 'folder';
  return parent?.type === 'file';
}

function siblingsOf(nodes: readonly ChapterNode[], parentId: string | null): ChapterNode[] {
  if (parentId == null) return [...nodes];
  return [...(findNode(nodes, parentId)?.children ?? [])];
}

function replaceSiblings(
  nodes: readonly ChapterNode[],
  parentId: string | null,
  next: readonly ChapterNode[],
): ChapterNode[] {
  if (parentId == null) return [...next];
  return nodes.map((node) => {
    if (node.id === parentId) return { ...node, children: [...next] };
    if (!node.children?.length) return node;
    return { ...node, children: replaceSiblings(node.children, parentId, next) };
  });
}

function containsId(node: ChapterNode, id: string): boolean {
  if (node.id === id) return true;
  return (node.children ?? []).some((child) => containsId(child, id));
}

export function insertNode(
  nodes: readonly ChapterNode[],
  parentId: string | null,
  index: number,
  node: ChapterNode,
): ChapterNode[] | null {
  const parent = parentId == null ? null : findNode(nodes, parentId);
  if (parentId != null && !parent) return null;
  if (!parentAllows(parent, node.type)) return null;
  const list = siblingsOf(nodes, parentId);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, node);
  return replaceSiblings(nodes, parentId, list);
}

/** 新章放在上次開的章下面；幕則放在所屬章下面；卷則放進該卷最後。 */
export function insertBelowAnchor(
  nodes: readonly ChapterNode[],
  anchorId: string | null,
  node: ChapterNode,
): ChapterNode[] | null {
  if (!anchorId) return insertNode(nodes, null, nodes.length, node);
  const anchor = findNode(nodes, anchorId);
  const location = locateNode(nodes, anchorId);
  if (!anchor || !location) return insertNode(nodes, null, nodes.length, node);
  if (anchor.type === 'scene' && location.parentId) {
    const chapter = locateNode(nodes, location.parentId);
    if (!chapter) return null;
    return insertNode(nodes, chapter.parentId, chapter.index + 1, node);
  }
  if (anchor.type === 'folder') {
    if (node.type === 'folder') {
      return insertNode(nodes, null, location.index + 1, node);
    }
    return insertNode(nodes, anchor.id, anchor.children?.length ?? 0, node);
  }
  return insertNode(nodes, location.parentId, location.index + 1, node);
}

export function moveBy(nodes: readonly ChapterNode[], id: string, delta: -1 | 1): ChapterNode[] | null {
  const location = locateNode(nodes, id);
  if (!location) return null;
  const list = siblingsOf(nodes, location.parentId);
  const nextIndex = location.index + delta;
  if (nextIndex < 0 || nextIndex >= list.length) return null;
  const [item] = list.splice(location.index, 1);
  if (!item) return null;
  list.splice(nextIndex, 0, item);
  return replaceSiblings(nodes, location.parentId, list);
}

export function canMoveBy(nodes: readonly ChapterNode[], id: string, delta: -1 | 1): boolean {
  const location = locateNode(nodes, id);
  if (!location) return false;
  const list = siblingsOf(nodes, location.parentId);
  const nextIndex = location.index + delta;
  return nextIndex >= 0 && nextIndex < list.length;
}

export function moveNode(
  nodes: readonly ChapterNode[],
  id: string,
  parentId: string | null,
  index: number,
): ChapterNode[] | null {
  const node = findNode(nodes, id);
  const location = locateNode(nodes, id);
  if (!node || !location) return null;
  const parent = parentId == null ? null : findNode(nodes, parentId);
  if (parentId != null && !parent) return null;
  if (!parentAllows(parent, node.type)) return null;
  if (parent && containsId(node, parent.id)) return null;
  const from = siblingsOf(nodes, location.parentId);
  const [removed] = from.splice(location.index, 1);
  if (!removed) return null;
  const without = replaceSiblings(nodes, location.parentId, from);
  const dest = siblingsOf(without, parentId);
  let at = index;
  if (location.parentId === parentId && location.index < index) at -= 1;
  at = Math.max(0, Math.min(at, dest.length));
  if (location.parentId === parentId && at === location.index) return [...nodes];
  dest.splice(at, 0, removed);
  return replaceSiblings(without, parentId, dest);
}

export function moveChapterToVolume(
  nodes: readonly ChapterNode[],
  chapterId: string,
  volumeId: string | null,
): ChapterNode[] | null {
  const chapter = findNode(nodes, chapterId);
  if (!chapter || chapter.type !== 'file') return null;
  const parent = volumeId == null ? null : findNode(nodes, volumeId);
  if (volumeId != null && parent?.type !== 'folder') return null;
  const destLength = volumeId == null ? nodes.length : (parent?.children?.length ?? 0);
  return moveNode(nodes, chapterId, volumeId, destLength);
}

export function withoutNode(nodes: readonly ChapterNode[], id: string): ChapterNode[] | null {
  const location = locateNode(nodes, id);
  if (!location) return null;
  const list = siblingsOf(nodes, location.parentId).filter((node) => node.id !== id);
  return replaceSiblings(nodes, location.parentId, list);
}

/** 剛新增、正文還是空的章，取消改名時拿掉。已有字或不是這一章就不刪。 */
export function discardFreshChapter(
  nodes: readonly ChapterNode[],
  input: { id: string; freshId: string | null; content: string; childCount: number },
): ChapterNode[] | null {
  if (!input.freshId || input.freshId !== input.id) return null;
  if (input.content.trim() !== '' || input.childCount > 0) return null;
  return withoutNode(nodes, input.id);
}

export function renameNode(nodes: readonly ChapterNode[], id: string, title: string): ChapterNode[] | null {
  const trimmed = title.trim();
  if (!trimmed || !findNode(nodes, id)) return null;
  const walk = (list: readonly ChapterNode[]): ChapterNode[] =>
    list.map((node) => {
      if (node.id === id) return { ...node, title: trimmed };
      if (!node.children?.length) return node;
      return { ...node, children: walk(node.children) };
    });
  return walk(nodes);
}

export function expandToNode(nodes: readonly ChapterNode[], id: string): ChapterNode[] {
  const walk = (list: readonly ChapterNode[]): { nodes: readonly ChapterNode[]; hit: boolean; changed: boolean } => {
    let hit = false;
    let changed = false;
    const next = list.map((node) => {
      if (node.id === id) {
        hit = true;
        return node;
      }
      if (!node.children?.length) return node;
      const child = walk(node.children);
      if (!child.hit) return node;
      hit = true;
      if (!child.changed && node.expanded !== false) return node;
      changed = true;
      return { ...node, expanded: true, children: [...child.nodes] };
    });
    if (!changed) return { nodes: list, hit, changed: false };
    return { nodes: next, hit, changed: true };
  };
  return [...walk(nodes).nodes];
}

function countKind(node: ChapterNode, type: ChapterNode['type'], includeSelf: boolean): number {
  const self = includeSelf && node.type === type ? 1 : 0;
  return self + (node.children ?? []).reduce((sum, child) => sum + countKind(child, type, true), 0);
}

export function removalImpact(node: ChapterNode): RemovalImpact {
  const chapters = countKind(node, 'file', false);
  const scenes = countKind(node, 'scene', node.type !== 'scene');
  const words = (function wordSum(current: ChapterNode): number {
    const own = current.type === 'folder' ? 0 : countManuscriptWords(current.content ?? '');
    return own + (current.children ?? []).reduce((sum, child) => sum + wordSum(child), 0);
  })(node);
  const needsConfirm = words > 0 || (node.children?.length ?? 0) > 0;
  return { chapters, scenes, words, needsConfirm };
}

export interface FlatRow {
  id: string;
  type: ChapterNode['type'];
  parentId: string | null;
  index: number;
  depth: number;
}

export function flattenVisible(
  nodes: readonly ChapterNode[],
  depth = 0,
  parentId: string | null = null,
): FlatRow[] {
  const rows: FlatRow[] = [];
  nodes.forEach((node, index) => {
    rows.push({ id: node.id, type: node.type, parentId, index, depth });
    if (node.expanded !== false && node.children?.length) {
      rows.push(...flattenVisible(node.children, depth + 1, node.id));
    }
  });
  return rows;
}

export function resolveDrop(
  nodes: readonly ChapterNode[],
  dragId: string,
  hitId: string,
  after: boolean,
): { parentId: string | null; index: number } | null {
  const drag = findNode(nodes, dragId);
  const hit = findNode(nodes, hitId);
  const hitLocation = locateNode(nodes, hitId);
  if (!drag || !hit || !hitLocation || dragId === hitId) return null;
  if (containsId(drag, hitId)) return null;

  if (drag.type === hit.type && parentAllows(hitLocation.parentId ? findNode(nodes, hitLocation.parentId) : null, drag.type)) {
    return { parentId: hitLocation.parentId, index: hitLocation.index + (after ? 1 : 0) };
  }
  if (drag.type === 'scene' && hit.type === 'file') {
    return { parentId: hit.id, index: after ? (hit.children?.length ?? 0) : 0 };
  }
  if (drag.type === 'file' && hit.type === 'folder') {
    return { parentId: hit.id, index: after ? (hit.children?.length ?? 0) : 0 };
  }
  if (drag.type === 'file' && hit.type === 'scene' && hitLocation.parentId) {
    const chapter = locateNode(nodes, hitLocation.parentId);
    if (!chapter) return null;
    return { parentId: chapter.parentId, index: chapter.index + (after ? 1 : 0) };
  }
  if (drag.type === 'folder' && hit.type !== 'folder') {
    let cursor: string | null = hitLocation.parentId;
    while (cursor) {
      const parent = findNode(nodes, cursor);
      const location = locateNode(nodes, cursor);
      if (!parent || !location) return null;
      if (parent.type === 'folder') {
        return { parentId: null, index: location.index + (after ? 1 : 0) };
      }
      cursor = location.parentId;
    }
  }
  return null;
}

export function cloneNode(node: ChapterNode): ChapterNode {
  return { ...node, children: node.children?.map((child) => cloneNode(child)) };
}

export function countNodes(nodes: readonly ChapterNode[], type: ChapterNode['type']): number {
  return nodes.reduce(
    (sum, node) => sum + (node.type === type ? 1 : 0) + countNodes(node.children ?? [], type),
    0,
  );
}

/** 目錄由上到下的章與幕，收合的卷裡面也算。 */
export function writingOrder(nodes: readonly ChapterNode[]): ChapterNode[] {
  const rows: ChapterNode[] = [];
  const walk = (list: readonly ChapterNode[]) => {
    for (const node of list) {
      if (node.type === 'file' || node.type === 'scene') rows.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return rows;
}

/** 上一章／下一章只在章之間移動，順序跟目錄一樣。 */
export function neighborChapterId(nodes: readonly ChapterNode[], id: string, delta: -1 | 1): string | null {
  const files = writingOrder(nodes).filter((node) => node.type === 'file');
  const current = findNode(nodes, id);
  const chapterId = current?.type === 'scene' ? (locateNode(nodes, id)?.parentId ?? id) : id;
  const index = files.findIndex((node) => node.id === chapterId);
  if (index < 0) return null;
  return files[index + delta]?.id ?? null;
}

function appendRecovered(nodes: readonly ChapterNode[], node: ChapterNode): ChapterNode[] {
  if (node.type === 'scene') {
    const files = writingOrder(nodes).filter((item) => item.type === 'file');
    const last = files[files.length - 1];
    if (last) {
      const placed = insertNode(nodes, last.id, last.children?.length ?? 0, node);
      if (placed) return placed;
    }
    const asChapter: ChapterNode = { ...node, type: 'file' };
    return insertNode(nodes, null, nodes.length, asChapter) ?? [...nodes, asChapter];
  }
  return insertNode(nodes, null, nodes.length, node) ?? [...nodes, node];
}

/** 刪掉的章放回原位置。用前後鄰居記位置；鄰居也被刪了就往外找。 */
export function placeRecovered(
  nodes: readonly ChapterNode[],
  record: {
    node: ChapterNode;
    parentId: string | null;
    index: number;
    beforeIds?: readonly string[];
    afterIds?: readonly string[];
  },
  atEnd: boolean,
): ChapterNode[] {
  if (findNode(nodes, record.node.id)) return [...nodes];
  const node = cloneNode(record.node);
  if (!atEnd) {
    const parent = record.parentId == null ? null : findNode(nodes, record.parentId);
    const parentExists = record.parentId == null || parent != null;
    if (parentExists && parentAllows(parent, node.type)) {
      const siblings = record.parentId == null ? nodes : (parent?.children ?? []);
      const placed = insertNode(nodes, record.parentId, neighborIndex(siblings, record), node);
      if (placed) return placed;
    }
  }
  return appendRecovered(nodes, node);
}

function neighborIndex(
  siblings: readonly { id: string }[],
  record: { index: number; beforeIds?: readonly string[]; afterIds?: readonly string[] },
): number {
  if (!record.beforeIds?.length && !record.afterIds?.length) return record.index;
  let beforeHit = -1;
  for (const id of record.beforeIds ?? []) {
    const found = siblings.findIndex((item) => item.id === id);
    if (found >= 0) {
      beforeHit = found;
      break;
    }
  }
  let afterHit = -1;
  for (const id of record.afterIds ?? []) {
    const found = siblings.findIndex((item) => item.id === id);
    if (found >= 0) {
      afterHit = found;
      break;
    }
  }
  if (beforeHit >= 0 && afterHit >= 0) return Math.min(beforeHit + 1, afterHit);
  if (afterHit >= 0) return afterHit;
  if (beforeHit >= 0) return beforeHit + 1;
  return siblings.length;
}

/** 同層 sort_order，與 writeFileProject 寫回 chapters 的順序相同。 */
export function siblingOrders(nodes: readonly ChapterNode[], parentId: string | null = null): { id: string; parentId: string | null; sortOrder: number }[] {
  const rows: { id: string; parentId: string | null; sortOrder: number }[] = [];
  nodes.forEach((node, index) => {
    rows.push({ id: node.id, parentId, sortOrder: index });
    if (node.children?.length) rows.push(...siblingOrders(node.children, node.id));
  });
  return rows;
}
