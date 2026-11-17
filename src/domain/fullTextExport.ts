import type { ChapterNode } from '../data/demo';
import { sanitizeDbBasename } from './bookTitle';

/**
 * WO-103：匯出全文（Word／TXT）的內容規劃。
 *
 * 一律走完整目錄樹（收合的卷也走），順序＝目錄由上到下；與點選順序、名稱、畫面展開狀態無關。
 * 只輸出卷名、章名、幕名與正文；幕摘要、視角、地點、卡片與 AI 資料不進檔。
 * 正文逐字照原樣（不 trim、不正規化、不加縮排）。
 *
 * 版面規則（暫定，交九方審，工單暫定第 6、7、11 條）：
 * - 每一章從新的一頁開始（九方已定案）；第一章不另起空白頁。
 * - 卷名在該卷第一個輸出章的頁首、章名之前；未選的卷不輸出；不另做卷名頁。
 * - 幕名在所屬章正文之後、該幕正文之前，不另分頁。只選幕時，所屬章名仍當作新頁開頭，但不帶章正文。
 */

export type ExportFormat = 'docx' | 'txt';
export type ExportScope = 'all' | 'selected';

export type ExportItemRole = 'volume' | 'chapter' | 'scene';

export interface ExportItem {
  role: ExportItemRole;
  /** 來源節點代號。 */
  nodeId: string;
  title: string;
  /** 正文；null 代表只輸出標題（卷名，或只選了幕時的章名脈絡）。 */
  body: string | null;
  /** 這一項是不是新的一頁的開頭（每章第一項；整份文件第一項不算）。 */
  pageBreakBefore: boolean;
}

export interface ExportPlan {
  items: ExportItem[];
  /** 輸出的章（含只為了脈絡而列出章名的章）數。0 代表沒有可輸出的內容。 */
  chapterCount: number;
}

/** 可勾選的正文節點：章與幕。卷沒有正文，勾選狀態由底下的章／幕決定。 */
export function isBodyNode(node: ChapterNode): boolean {
  return node.type === 'file' || node.type === 'scene';
}

/** 依目錄順序列出所有章與幕的代號（收合的卷也算）。 */
export function allBodyNodeIds(nodes: readonly ChapterNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly ChapterNode[]) => {
    for (const node of list) {
      if (isBodyNode(node)) ids.push(node.id);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

/** 某個節點自己（若是章／幕）加上所有子孫中的章與幕。 */
export function bodyIdsUnder(node: ChapterNode): string[] {
  const ids: string[] = isBodyNode(node) ? [node.id] : [];
  for (const child of node.children ?? []) ids.push(...bodyIdsUnder(child));
  return ids;
}

/** 稿子有沒有任何章（或沒有章的散幕）。空卷不算。 */
export function hasExportableChapter(nodes: readonly ChapterNode[]): boolean {
  return allBodyNodeIds(nodes).length > 0;
}

export type CheckState = 'checked' | 'partial' | 'unchecked';

/** 勾選清單上某一列的狀態。卷與有幕的章會有「部分選取」。 */
export function checkStateOf(node: ChapterNode, selected: ReadonlySet<string>): CheckState {
  const ids = bodyIdsUnder(node);
  if (ids.length === 0) return 'unchecked';
  let count = 0;
  for (const id of ids) if (selected.has(id)) count += 1;
  if (count === 0) return 'unchecked';
  return count === ids.length ? 'checked' : 'partial';
}

/**
 * 點一下某一列：全選狀態就整批取消，否則整批選入（卷帶入所有子章／幕，章帶入所有幕，幕只動自己）。
 * 回傳新的集合，不改原集合。
 */
export function toggleSelection(node: ChapterNode, selected: ReadonlySet<string>): Set<string> {
  const ids = bodyIdsUnder(node);
  const next = new Set(selected);
  if (checkStateOf(node, selected) === 'checked') {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
  return next;
}

/** 全選：所有章及其幕。 */
export function selectAll(nodes: readonly ChapterNode[]): Set<string> {
  return new Set(allBodyNodeIds(nodes));
}

/** 只留下目前目錄裡還存在的代號（稿子在清單打開期間被改過時用）。 */
export function pruneSelection(nodes: readonly ChapterNode[], selected: ReadonlySet<string>): Set<string> {
  const exists = new Set(allBodyNodeIds(nodes));
  return new Set([...selected].filter((id) => exists.has(id)));
}

/**
 * 排出要輸出的內容。scope = 'all' 等於全選；'selected' 只輸出集合裡的章／幕。
 * 每個已選正文節點只輸出一次；輸出順序只看目錄。
 */
export function planExport(
  nodes: readonly ChapterNode[],
  scope: ExportScope,
  selected: ReadonlySet<string> = new Set(),
): ExportPlan {
  const chosen = scope === 'all' ? selectAll(nodes) : selected;
  const items: ExportItem[] = [];
  const emittedVolumes = new Set<string>();
  let chapterCount = 0;
  /** 目前這一頁屬於哪一章（散幕用自己的代號）。 */
  let currentPageOwner: string | null = null;

  const startPage = (volumes: readonly ChapterNode[], owner: ChapterNode, withBody: boolean) => {
    let first = true;
    const pushFirst = (item: Omit<ExportItem, 'pageBreakBefore'>) => {
      items.push({ ...item, pageBreakBefore: first && items.length > 0 });
      first = false;
    };
    for (const volume of volumes) {
      if (emittedVolumes.has(volume.id)) continue;
      emittedVolumes.add(volume.id);
      pushFirst({ role: 'volume', nodeId: volume.id, title: volume.title, body: null });
    }
    pushFirst({
      role: owner.type === 'scene' ? 'scene' : 'chapter',
      nodeId: owner.id,
      title: owner.title,
      body: withBody ? (owner.content ?? '') : null,
    });
    chapterCount += 1;
    currentPageOwner = owner.id;
  };

  const walk = (list: readonly ChapterNode[], volumes: readonly ChapterNode[], chapter: ChapterNode | null) => {
    for (const node of list) {
      if (node.type === 'folder') {
        walk(node.children ?? [], [...volumes, node], chapter);
        continue;
      }
      if (node.type === 'file') {
        // 章本身被選才帶章正文；只選了幕時，遇到第一個被選的幕才列章名當脈絡（見下方幕的處理）。
        if (chosen.has(node.id)) startPage(volumes, node, true);
        walk(node.children ?? [], volumes, node);
        continue;
      }
      // 幕
      if (chosen.has(node.id)) {
        if (!chapter) {
          // 不在任何章底下的散幕（電腦版資料可能有）：自己當一頁的開頭。
          startPage(volumes, node, true);
        } else {
          if (currentPageOwner !== chapter.id) startPage(volumes, chapter, false);
          items.push({ role: 'scene', nodeId: node.id, title: node.title, body: node.content ?? '', pageBreakBefore: false });
        }
      }
      if (node.children?.length) walk(node.children, volumes, chapter);
    }
  };

  walk(nodes, [], null);
  return { items, chapterCount };
}

/**
 * TXT（暫定第 11 條）：UTF-8、不加 BOM、換行一律 LF。
 * 每一項＝標題一行；有正文時標題後接一個 LF 再接原正文。項與項之間另外以兩個 LF 分隔。
 * 正文不 trim、不吞首尾空行、不加裝飾線。
 */
export const TXT_ITEM_SEPARATOR = '\n\n';

export function itemText(item: ExportItem): string {
  return item.body === null ? item.title : `${item.title}\n${item.body}`;
}

export function buildTxt(plan: ExportPlan): string {
  return plan.items.map(itemText).join(TXT_ITEM_SEPARATOR);
}

export function txtBytes(plan: ExportPlan): Uint8Array {
  return new TextEncoder().encode(buildTxt(plan));
}

/** 檔名時間戳：裝置本地時間 YYYYMMDD-HHMM（與既有 .db 另存檔名同一習慣）。 */
export function localStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export const EXPORT_SCOPE_FILENAME_LABEL: Record<ExportScope, string> = {
  all: '全文',
  selected: '自選章節',
};

const FILENAME_MAX_TOTAL_BYTES = 255;

/**
 * 檔名（暫定第 3 條）：安全書名_全文_YYYYMMDD-HHMM.docx／安全書名_自選章節_YYYYMMDD-HHMM.txt。
 * 書名一律經 sanitizeDbBasename（現行規則）；再核對含後綴的完整檔名不超過 255 位元組。
 */
export function fullTextExportFilename(title: string, format: ExportFormat, scope: ExportScope, now = new Date()): string {
  const suffix = `_${EXPORT_SCOPE_FILENAME_LABEL[scope]}_${localStamp(now)}.${format}`;
  let base = sanitizeDbBasename(title);
  const encoder = new TextEncoder();
  // sanitizeDbBasename 已把書名限制在 200 位元組，後綴最多約 32 位元組，正常不會超過；萬一超過就逐字縮短再清一次。
  while (encoder.encode(base + suffix).length > FILENAME_MAX_TOTAL_BYTES && Array.from(base).length > 1) {
    const units = Array.from(base);
    units.pop();
    base = sanitizeDbBasename(units.join(''));
  }
  return `${base}${suffix}`;
}
