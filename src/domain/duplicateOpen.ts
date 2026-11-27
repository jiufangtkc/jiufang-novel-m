import type { ChapterNode, DemoProject } from '../data/demo';
import { isBookRemoved } from '../db/removedBooks';
import { isValidUuidV4 } from '../db/extensionMeta';
import { isBuiltinSampleBook } from './builtinSampleBook';

/**
 * WO-143：開檔時認「同一本」。純函式，不讀不寫任何儲存。
 * - 有效的檔內身分證優先：兩邊都是已寫入檔案的合法身分證（bookMetaPersisted 為真、UUID v4）時，
 *   uuid 相同才是同一本；uuid 不同一定不是同一本，即使書名與檔名都相同（例如另存分枝沿用相同檔名）。
 * - 只要任一邊的身分證還沒寫進檔案（舊檔、尚未存過）：uuid 相同且合法仍算同一本，
 *   否則退回「書名（trim 後逐字）相同且檔名相同且非空」。
 * - 另存分枝（originBookUuid 相連但各有自己的 uuid）不算同一本。
 * 開檔詢問（findExistingForOpen）、首頁標示（recentProjects）、「留下這一份」（keepOnlyThis）都用這一個函式。
 */
export interface BookIdentityLike {
  title: string;
  filename?: string | null;
  bookUuid?: string | null;
  /** 身分證是否已寫進 .db；沒帶視為尚未寫入。 */
  bookMetaPersisted?: boolean;
}

function hasFileIdentity(book: BookIdentityLike): boolean {
  return book.bookMetaPersisted === true && isValidUuidV4(book.bookUuid);
}

export function isSameBook(a: BookIdentityLike, b: BookIdentityLike): boolean {
  if (hasFileIdentity(a) && hasFileIdentity(b)) return a.bookUuid === b.bookUuid;
  if (isValidUuidV4(a.bookUuid) && a.bookUuid === b.bookUuid) return true;
  const filename = a.filename ?? '';
  return filename !== '' && filename === (b.filename ?? '') && a.title.trim() === b.title.trim();
}

export interface OpenedBookInfo {
  title: string;
  filename: string;
  bookUuid?: string | null;
  bookMetaPersisted?: boolean;
}

export type ExistingForOpen =
  | { kind: 'none' }
  | { kind: 'same-book'; project: DemoProject }
  | { kind: 'same-title'; projects: DemoProject[] };

function recentRank(recentIds: readonly string[], id: string): number {
  const index = recentIds.indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function byRecent(recentIds: readonly string[]) {
  return (a: DemoProject, b: DemoProject) => recentRank(recentIds, a.id) - recentRank(recentIds, b.id);
}

export function findExistingForOpen(input: {
  opened: OpenedBookInfo;
  projects: readonly DemoProject[];
  recentIds: readonly string[];
  isRemoved?: (id: string) => boolean;
}): ExistingForOpen {
  const isRemoved = input.isRemoved ?? isBookRemoved;
  const candidates = input.projects.filter(
    (project) => !isBuiltinSampleBook(project) && !isRemoved(project.id) && !(project.dbKey && isRemoved(project.dbKey)),
  );
  const opened = input.opened;
  // 兩階段挑選（複審必修）：
  // 1) 先找身分證（合法 UUID v4）完全相符的；只要找得到，只從這些裡挑，
  //    不讓「較近期開啟、書名檔名相同的舊格式別稿」搶在真正相符的副本前面。
  // 2) 找不到時才退回 isSameBook（與首頁標示、「留下這一份」共用）：身分資料不足時用書名＋檔名辨認舊檔。
  const byUuid = candidates.filter(
    (project) => isValidUuidV4(opened.bookUuid) && opened.bookUuid === project.bookUuid,
  );
  const sameBook = byUuid.length > 0 ? byUuid : candidates.filter((project) => isSameBook(opened, project));
  if (sameBook.length > 0) return { kind: 'same-book', project: [...sameBook].sort(byRecent(input.recentIds))[0]! };
  const sameTitle = candidates.filter((project) => project.title.trim() === opened.title.trim());
  if (sameTitle.length > 0) return { kind: 'same-title', projects: [...sameTitle].sort(byRecent(input.recentIds)) };
  return { kind: 'none' };
}

/**
 * 還有沒存回檔案的改動嗎？沒有對應檔案，或本機記著上次存檔後又改過，就算有。
 * 旗標 dirtySinceFileSave 隨裝置紀錄（saveMeta）一起存在這個裝置，重新整理後還在；
 * 對不上檔案（hasExternalFile 不是 true）時一律當作「可能有」，寧可多問一次。
 */
export function hasUnsavedChanges(
  project: Pick<DemoProject, 'id' | 'dbKey' | 'hasExternalFile'>,
  saveMeta: Readonly<Record<string, { dirtySinceFileSave?: boolean } | undefined>>,
  /** 審查必修 3：探測只存在這個裝置的內容（卡片草稿、尚未併入正文的即時草稿）；沒傳就只看上面兩項。 */
  deviceOnly?: DeviceOnlyProbe,
): boolean {
  if (project.hasExternalFile !== true || saveMeta[project.id]?.dirtySinceFileSave === true) return true;
  if (!deviceOnly) return false;
  try {
    return deviceOnly(project);
  } catch {
    return true; // 判斷不出來：寧可當作有
  }
}

/** 這份稿子在這個裝置上有沒有「還沒存回檔案」的獨有內容（由 state/deviceOnlyContent 提供實作）。 */
export type DeviceOnlyProbe = (project: Pick<DemoProject, 'id' | 'dbKey'>) => boolean;

function collect(nodes: readonly ChapterNode[], out: string[]): void {
  for (const node of nodes) {
    out.push(`${node.type}\u0001${node.title}\u0001${node.content ?? ''}`);
    if (node.children) collect(node.children, out);
  }
}

/** 章節標題＋正文的穩定摘要（只用來比兩份稿子是否不同）。 */
export function manuscriptDigest(nodes: readonly ChapterNode[]): string {
  const parts: string[] = [];
  collect(nodes, parts);
  const text = parts.join('\u0002');
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 33) ^ code) >>> 0;
  }
  return `${parts.length}:${text.length}:${h1.toString(16)}:${h2.toString(16)}`;
}

export type DuplicateChoice = 'open-existing' | 'replace' | 'keep-separate' | 'cancel';

export interface DuplicateOpenInfo {
  kind: 'same-book' | 'same-title';
  existingId: string;
  title: string;
  existingFilename: string;
  openedFilename: string;
  hasUnsavedChanges: boolean;
  contentDiffers: boolean;
}
