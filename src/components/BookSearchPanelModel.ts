/**
 * WO-63 全書搜尋畫面用的純函式。
 *
 * 搜尋與取代一律沿用 WO-46 的 findInBook／replaceOne／replaceAll，這裡只做：
 * 範圍換算、依章分組、取代計畫（要寫回哪幾章正文）、復原紀錄與復原計算。
 * 只碰章節樹正文；沒有任何卡片欄位，卡片不會被改。
 */
import { findNode, type ChapterNode } from '../data/demo';
import {
  findInBook,
  replaceAll,
  replaceOne,
  type SearchHit,
  type SearchOptions,
} from '../domain/bookSearch';

export type SearchScope = 'book' | 'chapter';

/** 指到某一章的第幾處（從 0 起算）。正文改動後用它重新找位置，不靠舊字元位置。 */
export interface HitRef {
  nodeId: string;
  ordinal: number;
}

export interface IndexedHit {
  hit: SearchHit;
  /** 全部結果中的序號（從 0 起算） */
  index: number;
  /** 同一章中的序號（從 0 起算） */
  ordinal: number;
}

export interface HitGroup {
  nodeId: string;
  title: string;
  hits: IndexedHit[];
}

/** 一處已取代的位置（以取代後的正文計） */
export interface ReplaceSpot {
  start: number;
  /** 取代後文字的長度 */
  length: number;
  /** 原本的字 */
  original: string;
}

export interface ReplaceEntry {
  nodeId: string;
  title: string;
  before: string;
  after: string;
  spots: ReplaceSpot[];
}

/** 上次取代的復原紀錄：只記受影響章節的正文，不記卡片、不記整本專案。 */
export interface ReplaceRecord {
  id: number;
  query: string;
  replacement: string;
  total: number;
  chapters: number;
  entries: ReplaceEntry[];
}

/** 要寫回的正文：一章一筆，走既有 commit-text。 */
export interface BodyCommit {
  nodeId: string;
  text: string;
}

export interface ReplacePlan {
  commits: BodyCommit[];
  record: ReplaceRecord;
}

/** 範圍換成 findInBook 的選項。「這一章」但沒有打開的章時回傳 null（沒有結果）。 */
export function scopeOptions(scope: SearchScope, chapterId: string | null | undefined): SearchOptions | null {
  if (scope === 'book') return {};
  if (!chapterId) return null;
  return { nodeIds: [chapterId] };
}

export function searchBody(
  nodes: readonly ChapterNode[],
  query: string,
  scope: SearchScope,
  chapterId: string | null | undefined,
): SearchHit[] {
  const options = scopeOptions(scope, chapterId);
  if (!options) return [];
  return findInBook(nodes, query, options);
}

/** 依章分組，保留章節樹順序與每章處數。 */
export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
  const groups: HitGroup[] = [];
  const byId = new Map<string, HitGroup>();
  hits.forEach((hit, index) => {
    let group = byId.get(hit.nodeId);
    if (!group) {
      group = { nodeId: hit.nodeId, title: hit.nodeTitle, hits: [] };
      byId.set(hit.nodeId, group);
      groups.push(group);
    }
    group.hits.push({ hit, index, ordinal: group.hits.length });
  });
  return groups;
}

export function chapterCount(hits: readonly SearchHit[]): number {
  return new Set(hits.map((hit) => hit.nodeId)).size;
}

export function refOf(hits: readonly SearchHit[], index: number): HitRef | null {
  const hit = hits[index];
  if (!hit) return null;
  let ordinal = 0;
  for (let i = 0; i < index; i += 1) if (hits[i]!.nodeId === hit.nodeId) ordinal += 1;
  return { nodeId: hit.nodeId, ordinal };
}

/** 依章與章內序號找回全部結果中的序號；找不到回傳 -1。 */
export function indexOfRef(hits: readonly SearchHit[], ref: HitRef | null): number {
  if (!ref) return -1;
  let ordinal = 0;
  for (let i = 0; i < hits.length; i += 1) {
    if (hits[i]!.nodeId !== ref.nodeId) continue;
    if (ordinal === ref.ordinal) return i;
    ordinal += 1;
  }
  return -1;
}

/** 某一章正文裡的第 ordinal 處（用最新正文重算）。 */
export function hitInText(text: string, query: string, ordinal: number): SearchHit | null {
  const hits = findInBook([{ id: '_', type: 'file', title: '', content: text }], query);
  return hits[ordinal] ?? null;
}

export function hitsInText(text: string, query: string): SearchHit[] {
  return findInBook([{ id: '_', type: 'file', title: '', content: text }], query);
}

function contentOf(nodes: readonly ChapterNode[], nodeId: string): string {
  return findNode(nodes, nodeId)?.content ?? '';
}

function spotsFor(before: string, query: string, replacement: string, onlyStarts?: ReadonlySet<number>): ReplaceSpot[] {
  const spots: ReplaceSpot[] = [];
  let shift = 0;
  for (const hit of hitsInText(before, query)) {
    if (onlyStarts && !onlyStarts.has(hit.start)) continue;
    spots.push({ start: hit.start + shift, length: replacement.length, original: hit.match });
    shift += replacement.length - hit.match.length;
  }
  return spots;
}

/** 取代全部：沿用 replaceAll，回傳要寫回的章與復原紀錄。沒有可取代的回傳 null。 */
export function planReplaceAll(
  nodes: readonly ChapterNode[],
  query: string,
  replacement: string,
  scope: SearchScope,
  chapterId: string | null | undefined,
  id: number,
): ReplacePlan | null {
  const options = scopeOptions(scope, chapterId);
  if (!options) return null;
  const result = replaceAll(nodes, query, replacement, options);
  if (result.count === 0) return null;
  const entries: ReplaceEntry[] = result.changedNodeIds.map((nodeId) => {
    const before = contentOf(nodes, nodeId);
    return {
      nodeId,
      title: findNode(nodes, nodeId)?.title ?? '',
      before,
      after: contentOf(result.nodes, nodeId),
      spots: spotsFor(before, query, replacement),
    };
  });
  return {
    commits: entries.map((entry) => ({ nodeId: entry.nodeId, text: entry.after })),
    record: { id, query, replacement, total: result.count, chapters: entries.length, entries },
  };
}

/** 取代這處：沿用 replaceOne。目標以「哪一章第幾處」指定，用最新正文找位置。 */
export function planReplaceOne(
  nodes: readonly ChapterNode[],
  ref: HitRef,
  query: string,
  replacement: string,
  id: number,
): ReplacePlan | null {
  const before = contentOf(nodes, ref.nodeId);
  const hit = hitInText(before, query, ref.ordinal);
  if (!hit) return null;
  const result = replaceOne(nodes, { nodeId: ref.nodeId, start: hit.start, end: hit.end, match: hit.match }, replacement);
  if (!result.ok) return null;
  const after = contentOf(result.nodes, ref.nodeId);
  const entry: ReplaceEntry = {
    nodeId: ref.nodeId,
    title: findNode(nodes, ref.nodeId)?.title ?? '',
    before,
    after,
    spots: [{ start: hit.start, length: replacement.length, original: hit.match }],
  };
  return {
    commits: [{ nodeId: ref.nodeId, text: after }],
    record: { id, query, replacement, total: 1, chapters: 1, entries: [entry] },
  };
}

/**
 * 復原一章：正文沒再動過就整章換回取代前；
 * 取代後又打了字，就只把沒被新字碰到的那幾處換回去，新打的字保留。
 */
export function revertEntry(current: string, entry: ReplaceEntry, replacement: string): string {
  if (current === entry.after) return entry.before;
  const after = entry.after;
  let prefix = 0;
  const maxPrefix = Math.min(after.length, current.length);
  while (prefix < maxPrefix && after[prefix] === current[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(after.length, current.length) - prefix;
  while (suffix < maxSuffix && after[after.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix += 1;
  const changedEnd = after.length - suffix;
  let text = current;
  const spots = [...entry.spots].sort((a, b) => b.start - a.start);
  for (const spot of spots) {
    let pos: number;
    if (spot.start + spot.length <= prefix) pos = spot.start;
    else if (spot.start >= changedEnd) pos = spot.start - after.length + current.length;
    else continue;
    if (text.slice(pos, pos + spot.length) !== replacement) continue;
    text = text.slice(0, pos) + spot.original + text.slice(pos + spot.length);
  }
  return text;
}

/** 復原上次取代：只回傳該次受影響、而且真的要改的章。 */
export function planUndo(nodes: readonly ChapterNode[], record: ReplaceRecord): BodyCommit[] {
  const commits: BodyCommit[] = [];
  for (const entry of record.entries) {
    const node = findNode(nodes, entry.nodeId);
    if (!node) continue;
    const current = node.content ?? '';
    const text = revertEntry(current, entry, record.replacement);
    if (text !== current) commits.push({ nodeId: entry.nodeId, text });
  }
  return commits;
}

/** 已取代標記：在清單裡留著那一處，標「已取代」。 */
export interface ReplacedMark {
  recordId: number;
  nodeId: string;
  start: number;
  length: number;
  original: string;
  replacement: string;
  before: string;
  after: string;
}

export function marksFromRecord(record: ReplaceRecord): ReplacedMark[] {
  const marks: ReplacedMark[] = [];
  for (const entry of record.entries) {
    for (const spot of entry.spots) {
      const hit = {
        start: spot.start,
        end: spot.start + spot.length,
      };
      const text = entry.after;
      const lineStart = Math.max(text.lastIndexOf('\n', hit.start - 1) + 1, hit.start - 20);
      let lineEnd = text.indexOf('\n', hit.end);
      if (lineEnd === -1) lineEnd = text.length;
      marks.push({
        recordId: record.id,
        nodeId: entry.nodeId,
        start: spot.start,
        length: spot.length,
        original: spot.original,
        replacement: record.replacement,
        before: text.slice(lineStart, hit.start),
        after: text.slice(hit.end, Math.min(lineEnd, hit.end + 20)),
      });
    }
  }
  return marks;
}

/** 單處取代後，同一章後面的標記跟著位移。 */
export function shiftMarks(marks: readonly ReplacedMark[], nodeId: string, at: number, delta: number): ReplacedMark[] {
  if (delta === 0) return [...marks];
  return marks.map((mark) => (mark.nodeId === nodeId && mark.start > at ? { ...mark, start: mark.start + delta } : mark));
}

/**
 * 取代這處之後，目前焦點移到下一筆：同一章在取代處之後的下一處；
 * 這章沒有了就到下一章第一處；再沒有就回到第一筆。都沒有回傳 null。
 */
export function nextAfterReplace(
  hitsAfter: readonly SearchHit[],
  nodeOrder: readonly string[],
  nodeId: string,
  replacedEnd: number,
): HitRef | null {
  if (hitsAfter.length === 0) return null;
  const same = hitsAfter.findIndex((hit) => hit.nodeId === nodeId && hit.start >= replacedEnd);
  if (same !== -1) return refOf(hitsAfter, same);
  const position = nodeOrder.indexOf(nodeId);
  const later = hitsAfter.findIndex((hit) => nodeOrder.indexOf(hit.nodeId) > position);
  if (later !== -1) return refOf(hitsAfter, later);
  return refOf(hitsAfter, 0);
}

/** 章節樹由上而下的節點順序。 */
export function nodeOrder(nodes: readonly ChapterNode[]): string[] {
  const order: string[] = [];
  const walk = (list: readonly ChapterNode[]) => {
    for (const node of list) {
      order.push(node.id);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return order;
}

/** 正文覆上目前正文框裡的字（還沒寫回的打字），讓搜尋與取代用最新正文。 */
export function withLiveText(
  nodes: ChapterNode[],
  live: { chapterId: string; text: string } | null,
): ChapterNode[] {
  if (!live) return nodes;
  const node = findNode(nodes, live.chapterId);
  if (!node || (node.content ?? '') === live.text) return nodes;
  const walk = (list: ChapterNode[]): ChapterNode[] =>
    list.map((item) => {
      if (item.id === live.chapterId) return { ...item, content: live.text };
      return item.children ? { ...item, children: walk(item.children) } : item;
    });
  return walk(nodes);
}

/** 確認視窗舉例用：標題或內容含這個字的第一張卡片標題。只讀，不改卡片。 */
export function exampleCardTitle(
  cards: readonly { title?: string | null; content?: string | null }[],
  query: string,
): string | null {
  if (!query.trim()) return null;
  const needle = query.toLowerCase();
  const found =
    cards.find((card) => (card.title ?? '').toLowerCase().includes(needle)) ??
    cards.find((card) => (card.content ?? '').toLowerCase().includes(needle));
  return found?.title ? found.title : null;
}
