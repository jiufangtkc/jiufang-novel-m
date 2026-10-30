import { findNode, type ChapterNode } from '../data/demo';
import { cloneNode, locateNode } from './chapterOps';
import { countManuscriptWords } from './manuscriptWords';

export const VERSION_LIMIT = 10;
export const DELETED_LIMIT = 10;
export const VERSION_INTERVAL_MS = 30 * 60 * 1000;

export interface ChapterVersion {
  id: string;
  nodeId: string;
  title: string;
  content: string;
  wordCount: number;
  savedAt: number;
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
}

export interface BookArchive {
  versions: Record<string, ChapterVersion[]>;
  deleted: DeletedRecord[];
}

export function emptyArchive(): BookArchive {
  return { versions: {}, deleted: [] };
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
    wordCount: countManuscriptWords(content),
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

export function deletedFromNode(
  nodes: readonly ChapterNode[],
  id: string,
  deletedAt: number,
  recordId: string,
): DeletedRecord | null {
  const node = findNode(nodes, id);
  const location = locateNode(nodes, id);
  if (!node || !location) return null;
  const siblings =
    location.parentId == null ? nodes : (findNode(nodes, location.parentId)?.children ?? []);
  return {
    id: recordId,
    node: cloneNode(node),
    parentId: location.parentId,
    index: location.index,
    deletedAt,
    title: node.title,
    beforeIds: siblings.slice(0, location.index).map((item) => item.id).reverse(),
    afterIds: siblings.slice(location.index + 1).map((item) => item.id),
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
