import { findNode, type ChapterNode } from '../data/demo';
import type { FileCard } from '../db/projectFile';
import { CATEGORY_TIMELINE } from './cardCategories';
import { cloneNode, locateNode } from './chapterOps';
import { collectAliveChapterIds } from './timeline';
import { countWords } from './wordCount';

export const VERSION_LIMIT = 10;
export const DELETED_LIMIT = 10;
export const DELETED_CARD_LIMIT = 10;
export const VERSION_INTERVAL_MS = 30 * 60 * 1000;

export interface ChapterVersion {
  id: string;
  nodeId: string;
  title: string;
  content: string;
  wordCount: number;
  savedAt: number;
}

export interface TimelineChapterLink {
  cardId: string;
  chapterId: string;
}

export interface DeletedRecord {
  id: string;
  node: ChapterNode;
  parentId: string | null;
  index: number;
  deletedAt: number;
  title: string;
  /** 刪除當下，由近到遠的前一個鄰居。舊紀錄可能沒有。 */
  beforeIds?: string[];
  /** 刪除當下，由近到遠的後一個鄰居。舊紀錄可能沒有。 */
  afterIds?: string[];
  /** WO-132 嚴-5：刪除當下連到被刪章節子樹的時間線事件，供復原時自動連回。 */
  unlinkedTimelineEvents?: TimelineChapterLink[];
}

export interface DeletedCardRecord {
  id: string;
  rootCardId: string;
  title: string;
  category: string;
  parentId: string | null;
  index: number;
  /** 刪除當下，由近到遠的前一個同層鄰居。 */
  beforeIds?: string[];
  /** 刪除當下，由近到遠的後一個同層鄰居。 */
  afterIds?: string[];
  /** 含該卡與所有子孫卡片的快照。 */
  cards: FileCard[];
  deletedAt: number;
}

export interface BookArchive {
  versions: Record<string, ChapterVersion[]>;
  deleted: DeletedRecord[];
  deletedCards?: DeletedCardRecord[];
}

export function emptyArchive(): BookArchive {
  return { versions: {}, deleted: [], deletedCards: [] };
}

export function shouldKeepVersion(lastKept: string, content: string): boolean {
  return content !== lastKept;
}

/**
 * 這一輪有改字時，先留下進章時的正文，再留下現在的正文。
 * 進章時的正文若已經在最新一版，pushVersion 會略過。
 */
export function sessionVersions(options: {
  baseline: string;
  lastKept: string;
  content: string;
  baselineStored: boolean;
  node: { id: string; title: string };
  savedAt: number;
}): { versions: ChapterVersion[]; baselineStored: boolean; lastKept: string } {
  if (!shouldKeepVersion(options.lastKept, options.content)) {
    return { versions: [], baselineStored: options.baselineStored, lastKept: options.lastKept };
  }
  const versions: ChapterVersion[] = [];
  let baselineStored = options.baselineStored;
  if (!baselineStored && options.baseline !== options.content) {
    versions.push(
      versionFromNode(options.node, options.savedAt, `v-${options.savedAt}-${options.node.id}-base`, options.baseline),
    );
    baselineStored = true;
  }
  versions.push(
    versionFromNode(
      options.node,
      options.savedAt + 1,
      `v-${options.savedAt}-${options.node.id}`,
      options.content,
    ),
  );
  return { versions, baselineStored: true, lastKept: options.content };
}

export function versionFromNode(
  node: { id: string; title: string; content?: string },
  savedAt: number,
  id: string,
  contentOverride?: string,
): ChapterVersion {
  const content = contentOverride ?? node.content ?? '';
  return {
    id,
    nodeId: node.id,
    title: node.title,
    content,
    wordCount: countWords(content),
    savedAt,
  };
}

/** 找回舊版只換正文。章名維持畫面上現在的名字。 */
export function nodeAfterVersionRestore<T extends { content?: string }>(
  node: T,
  version: { content: string },
): T {
  return { ...node, content: version.content };
}

/** 最新的在最前面。內容跟最新一版一樣就略過。超過十版丟掉最舊的。 */
export function pushVersion(existing: readonly ChapterVersion[] | undefined, next: ChapterVersion): ChapterVersion[] {
  if (existing && existing[0]?.content === next.content) return existing as ChapterVersion[];
  return [next, ...(existing ?? [])].slice(0, VERSION_LIMIT);
}

export function withVersion(archive: BookArchive, version: ChapterVersion): BookArchive {
  return {
    ...archive,
    versions: {
      ...archive.versions,
      [version.nodeId]: pushVersion(archive.versions[version.nodeId], version),
    },
  };
}

function textNodes(node: ChapterNode): ChapterNode[] {
  const rows: ChapterNode[] = [];
  const walk = (current: ChapterNode) => {
    if (current.type !== 'folder') rows.push(current);
    current.children?.forEach(walk);
  };
  walk(node);
  return rows;
}

export function versionsForNode(node: ChapterNode, savedAt: number): ChapterVersion[] {
  return textNodes(node).map((item, index) => versionFromNode(item, savedAt, `v-${savedAt}-${item.id}-${index}`));
}

/** 收集被刪節點（單章或整卷子樹）底下所有章節所關聯的時間線事件。 */
export function collectUnlinkedTimelineEvents(
  node: ChapterNode,
  cards: readonly FileCard[],
): TimelineChapterLink[] {
  const deletedChapterIds = collectAliveChapterIds([node]);
  if (deletedChapterIds.size === 0 || cards.length === 0) return [];
  const links: TimelineChapterLink[] = [];
  for (const card of cards) {
    if (
      card.category === CATEGORY_TIMELINE &&
      typeof card.chapterId === 'string' &&
      card.chapterId !== '' &&
      deletedChapterIds.has(card.chapterId)
    ) {
      links.push({ cardId: card.id, chapterId: card.chapterId });
    }
  }
  return links;
}

export function deletedFromNode(
  nodes: readonly ChapterNode[],
  id: string,
  deletedAt: number,
  recordId: string,
  cards?: readonly FileCard[],
): DeletedRecord | null {
  const node = findNode(nodes, id);
  const location = locateNode(nodes, id);
  if (!node || !location) return null;
  const siblings =
    location.parentId == null ? nodes : (findNode(nodes, location.parentId)?.children ?? []);
  const unlinkedTimelineEvents = cards ? collectUnlinkedTimelineEvents(node, cards) : [];
  return {
    id: recordId,
    node: cloneNode(node),
    parentId: location.parentId,
    index: location.index,
    deletedAt,
    title: node.title,
    beforeIds: siblings.slice(0, location.index).map((item) => item.id).reverse(),
    afterIds: siblings.slice(location.index + 1).map((item) => item.id),
    ...(unlinkedTimelineEvents.length > 0 ? { unlinkedTimelineEvents } : {}),
  };
}

export function rememberDeleted(existing: readonly DeletedRecord[], record: DeletedRecord): DeletedRecord[] {
  return [record, ...existing.filter((item) => item.id !== record.id)].slice(0, DELETED_LIMIT);
}

export function forgetDeleted(existing: readonly DeletedRecord[], id: string): DeletedRecord[] {
  return existing.filter((item) => item.id !== id);
}

export function archiveDeletion(
  archive: BookArchive,
  record: DeletedRecord,
  versions: readonly ChapterVersion[],
): BookArchive {
  let next: BookArchive = { ...archive, deleted: rememberDeleted(archive.deleted, record) };
  for (const version of versions) next = withVersion(next, version);
  return next;
}
