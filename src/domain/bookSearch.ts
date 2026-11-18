import { findNode, type ChapterNode } from '../data/demo';

/**
 * 全書搜尋與取代的設定選項。
 */
export interface SearchOptions {
  /**
   * 是否區分英文字母大小寫。
   * 預設為 false（不區分大小寫，只影響英文字母大小寫）。
   */
  caseSensitive?: boolean;

  /**
   * 限定搜尋的節點 ID 清單（選用）。
   * 若指定，僅在此清單內的節點及其子節點中搜尋。
   */
  nodeIds?: readonly string[];
}

/**
 * 單筆搜尋結果。
 */
export interface SearchHit {
  /** 節點 ID */
  nodeId: string;
  /** 節點標題 */
  nodeTitle: string;
  /** 從卷到章到幕的階層標題陣列（例如：['第一卷 霧港之秋', '第一章 來信']） */
  path: string[];
  /** 在該節點正文（content）中的起始字元索引（UTF-16） */
  start: number;
  /** 在該節點正文（content）中的結束字元索引（UTF-16） */
  end: number;
  /** 匹配文字前約 20 字的上下文（遇換行截斷，不切斷代理對） */
  before: string;
  /** 該處實際匹配的文字（保留原文大小寫） */
  match: string;
  /** 匹配文字後約 20 字的上下文（遇換行截斷，不切斷代理對） */
  after: string;
}

/**
 * 節點搜尋次數項目。
 */
export interface NodeSearchCount {
  nodeId: string;
  nodeTitle: string;
  count: number;
}

/**
 * 全書搜尋次數統計結果。
 */
export interface BookSearchCountResult {
  /** 全書總出現次數 */
  total: number;
  /** 有出現匹配字詞的各節點統計清單（依章節順序） */
  byNode: NodeSearchCount[];
  /** 節點 ID 對應出現次數的快速對照表 */
  countsByNodeId: Record<string, number>;
}

/**
 * 取代單筆的目標介面。可直接傳入 SearchHit 或包含必要欄位的物件。
 */
export interface ReplaceHitTarget {
  nodeId: string;
  start: number;
  end?: number;
  match?: string;
  query?: string;
}

/**
 * 單筆取代的執行結果。
 */
export interface ReplaceOneResult {
  /** 更新後的新章節樹（若未成功則為原樹參考） */
  nodes: ChapterNode[];
  /** 是否成功取代。若目標位置文字已被修改或節點不存在，則為 false */
  ok: boolean;
}

/**
 * 全部取代的執行結果。
 */
export interface ReplaceAllResult {
  /** 更新後的新章節樹 */
  nodes: ChapterNode[];
  /** 總共取代的筆數 */
  count: number;
  /** 內容有被修改的節點 ID 清單（依章節走訪順序） */
  changedNodeIds: string[];
}

/** 上下文擷取半徑（前後各約 20 字） */
const CONTEXT_RADIUS = 20;

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * 將字串轉為搜尋比對用的鍵值。
 * 遵循工單規格：不區分大小寫時只影響英文字母大小寫，全形／半形與標點符號不互相轉換。
 * 若原生 toLowerCase 造成字串長度改變，退回僅轉換 ASCII A-Z，以確保字串長度與索引 1:1 絕對一致。
 */
function toSearchString(str: string, caseSensitive: boolean): string {
  if (caseSensitive) return str;
  const lower = str.toLowerCase();
  if (lower.length !== str.length) {
    return str.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  }
  return lower;
}

/**
 * 擷取匹配處的前文上下文（約 20 字，遇換行符號截斷，不切壞 UTF-16 代理對）。
 */
function extractBefore(content: string, start: number): string {
  if (start <= 0) return '';
  let rawStart = Math.max(0, start - CONTEXT_RADIUS);
  // 避免切斷 UTF-16 代理對（若切在低位代理，向後退 1 個字元以保留完整字元邊界）
  if (rawStart > 0 && isLowSurrogate(content.charCodeAt(rawStart))) {
    rawStart += 1;
  }
  const slice = content.slice(rawStart, start);
  const lastNewlineN = slice.lastIndexOf('\n');
  const lastNewlineR = slice.lastIndexOf('\r');
  const cutIndex = Math.max(lastNewlineN, lastNewlineR);
  return cutIndex !== -1 ? slice.slice(cutIndex + 1) : slice;
}

/**
 * 擷取匹配處的後文上下文（約 20 字，遇換行符號截斷，不切壞 UTF-16 代理對）。
 */
function extractAfter(content: string, end: number): string {
  if (end >= content.length) return '';
  let rawEnd = Math.min(content.length, end + CONTEXT_RADIUS);
  // 避免切斷 UTF-16 代理對（若結尾落在高位代理，向前延伸 1 個字元納入低位代理）
  if (rawEnd < content.length && isHighSurrogate(content.charCodeAt(rawEnd - 1))) {
    rawEnd = Math.min(content.length, rawEnd + 1);
  }
  const slice = content.slice(end, rawEnd);
  const newlineN = slice.indexOf('\n');
  const newlineR = slice.indexOf('\r');
  let cutIndex = -1;
  if (newlineN !== -1 && newlineR !== -1) {
    cutIndex = Math.min(newlineN, newlineR);
  } else if (newlineN !== -1) {
    cutIndex = newlineN;
  } else if (newlineR !== -1) {
    cutIndex = newlineR;
  }
  return cutIndex !== -1 ? slice.slice(0, cutIndex) : slice;
}

/**
 * 檢查目前節點是否在指定的 nodeIds 範圍內。
 * 若無限定則回傳 true；若節點本身或其任何祖先在清單中，則視為在範圍內。
 */
function isNodeInScope(
  nodeId: string,
  ancestorIds: readonly string[],
  scopeSet: ReadonlySet<string> | null,
): boolean {
  if (!scopeSet) return true;
  if (scopeSet.has(nodeId)) return true;
  for (const ancestorId of ancestorIds) {
    if (scopeSet.has(ancestorId)) return true;
  }
  return false;
}

/**
 * 全書搜尋：在整本書所有章、幕的正文裡找字，列出每一筆出現位置與上下文。
 * 順序依章節樹由上而下、同節點內由前到後。
 * 查詢字當作一般文字處理，非正規表示式。空字串或純空白查詢回傳空陣列。
 */
export function findInBook(
  nodes: readonly ChapterNode[],
  query: string,
  options?: SearchOptions,
): SearchHit[] {
  if (!query || query.trim() === '') {
    return [];
  }

  const caseSensitive = options?.caseSensitive ?? false;
  const scopeSet = options?.nodeIds ? new Set(options.nodeIds) : null;
  const needle = toSearchString(query, caseSensitive);
  const queryLen = query.length;
  const hits: SearchHit[] = [];

  function walk(
    list: readonly ChapterNode[],
    ancestorTitles: readonly string[],
    ancestorIds: readonly string[],
  ): void {
    for (const node of list) {
      const currentPath = [...ancestorTitles, node.title];
      const inScope = isNodeInScope(node.id, ancestorIds, scopeSet);

      if (inScope && typeof node.content === 'string' && node.content.length > 0) {
        const content = node.content;
        const haystack = toSearchString(content, caseSensitive);
        let matchIndex = haystack.indexOf(needle, 0);

        while (matchIndex !== -1) {
          const end = matchIndex + queryLen;
          hits.push({
            nodeId: node.id,
            nodeTitle: node.title,
            path: currentPath,
            start: matchIndex,
            end,
            before: extractBefore(content, matchIndex),
            match: content.slice(matchIndex, end),
            after: extractAfter(content, end),
          });
          // 非重疊比對：從 matchIndex + queryLen 繼續往下尋找
          matchIndex = haystack.indexOf(needle, end);
        }
      }

      if (node.children && node.children.length > 0) {
        walk(node.children, currentPath, [...ancestorIds, node.id]);
      }
    }
  }

  walk(nodes, [], []);
  return hits;
}

/**
 * 全書計算出現次數：回傳總次數與各節點次數。
 * 輕量快速，不建構上下文欄位。
 */
export function countInBook(
  nodes: readonly ChapterNode[],
  query: string,
  options?: SearchOptions,
): BookSearchCountResult {
  if (!query || query.trim() === '') {
    return {
      total: 0,
      byNode: [],
      countsByNodeId: {},
    };
  }

  const caseSensitive = options?.caseSensitive ?? false;
  const scopeSet = options?.nodeIds ? new Set(options.nodeIds) : null;
  const needle = toSearchString(query, caseSensitive);
  const queryLen = query.length;

  const byNode: NodeSearchCount[] = [];
  const countsByNodeId: Record<string, number> = {};
  let total = 0;

  function walk(list: readonly ChapterNode[], ancestorIds: readonly string[]): void {
    for (const node of list) {
      const inScope = isNodeInScope(node.id, ancestorIds, scopeSet);

      if (inScope && typeof node.content === 'string' && node.content.length > 0) {
        const haystack = toSearchString(node.content, caseSensitive);
        let nodeCount = 0;
        let matchIndex = haystack.indexOf(needle, 0);

        while (matchIndex !== -1) {
          nodeCount += 1;
          matchIndex = haystack.indexOf(needle, matchIndex + queryLen);
        }

        if (nodeCount > 0) {
          total += nodeCount;
          byNode.push({
            nodeId: node.id,
            nodeTitle: node.title,
            count: nodeCount,
          });
          countsByNodeId[node.id] = nodeCount;
        }
      }

      if (node.children && node.children.length > 0) {
        walk(node.children, [...ancestorIds, node.id]);
      }
    }
  }

  walk(nodes, []);

  return {
    total,
    byNode,
    countsByNodeId,
  };
}

/**
 * 單筆正文不可變更新輔助函式。
 * 僅複製目標節點與其祖先節點，其餘未修改之兄弟與子節點皆保留原物件參考。
 */
function updateContentImmutably(
  nodes: readonly ChapterNode[],
  targetId: string,
  nextContent: string,
): ChapterNode[] {
  let anyChildChanged = false;

  const nextList = nodes.map((node) => {
    if (node.id === targetId) {
      anyChildChanged = true;
      return { ...node, content: nextContent };
    }
    if (node.children && node.children.length > 0) {
      const updatedChildren = updateContentImmutably(node.children, targetId, nextContent);
      if (updatedChildren !== node.children) {
        anyChildChanged = true;
        return { ...node, children: updatedChildren };
      }
    }
    return node;
  });

  return anyChildChanged ? nextList : (nodes as ChapterNode[]);
}

/**
 * 單筆取代：根據給定的搜尋命中位置進行取代。
 * 若該筆位置的文字已非原先匹配字詞（使用者在中間改動過），則 ok=false 且不改動任何節點。
 * 成功時回傳新樹，不修改傳入的原樹物件。
 */
export function replaceOne(
  nodes: readonly ChapterNode[],
  hit: ReplaceHitTarget,
  replacement: string,
  options?: SearchOptions,
): ReplaceOneResult {
  if (!hit || typeof hit.nodeId !== 'string' || typeof hit.start !== 'number') {
    return { nodes: nodes as ChapterNode[], ok: false };
  }

  const target = findNode(nodes, hit.nodeId);
  if (!target || typeof target.content !== 'string') {
    return { nodes: nodes as ChapterNode[], ok: false };
  }

  const content = target.content;
  const expectedMatch = hit.match ?? hit.query;
  const end = typeof hit.end === 'number'
    ? hit.end
    : expectedMatch !== undefined
      ? hit.start + expectedMatch.length
      : -1;

  if (hit.start < 0 || end < hit.start || end > content.length) {
    return { nodes: nodes as ChapterNode[], ok: false };
  }

  if (expectedMatch !== undefined) {
    const actual = content.slice(hit.start, end);
    const caseSensitive = options?.caseSensitive ?? false;
    const matches = caseSensitive
      ? actual === expectedMatch
      : toSearchString(actual, false) === toSearchString(expectedMatch, false);

    if (!matches) {
      return { nodes: nodes as ChapterNode[], ok: false };
    }
  }

  const nextContent = content.slice(0, hit.start) + replacement + content.slice(end);
  const updatedNodes = updateContentImmutably(nodes, hit.nodeId, nextContent);

  return { nodes: updatedNodes, ok: true };
}

/**
 * 單一字串全部取代輔助函式。
 * 採非重疊、由左至右替換，取代後的內容不重複掃描（避免無窮迴圈）。
 */
function replaceAllInText(
  content: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { text: string; count: number } {
  const needle = toSearchString(query, caseSensitive);
  const haystack = toSearchString(content, caseSensitive);
  const queryLen = query.length;

  let firstIndex = haystack.indexOf(needle, 0);
  if (firstIndex === -1) {
    return { text: content, count: 0 };
  }

  const pieces: string[] = [];
  let lastIndex = 0;
  let count = 0;
  let matchIndex = firstIndex;

  while (matchIndex !== -1) {
    pieces.push(content.slice(lastIndex, matchIndex));
    pieces.push(replacement);
    lastIndex = matchIndex + queryLen;
    count += 1;
    matchIndex = haystack.indexOf(needle, lastIndex);
  }

  pieces.push(content.slice(lastIndex));
  return { text: pieces.join(''), count };
}

/**
 * 全部取代：在整本書（或指定 nodeIds 範圍內）搜尋 query 並全部替換為 replacement。
 * 回傳新樹、總取代次數與受影響的節點 ID 清單。
 * 不可變更新：未改到的節點保留原物件參考。
 */
export function replaceAll(
  nodes: readonly ChapterNode[],
  query: string,
  replacement: string,
  options?: SearchOptions,
): ReplaceAllResult {
  if (!query || query.trim() === '') {
    return {
      nodes: nodes as ChapterNode[],
      count: 0,
      changedNodeIds: [],
    };
  }

  const caseSensitive = options?.caseSensitive ?? false;
  const scopeSet = options?.nodeIds ? new Set(options.nodeIds) : null;
  const changedNodeIds: string[] = [];
  let totalCount = 0;

  function walk(
    list: readonly ChapterNode[],
    ancestorIds: readonly string[],
  ): { nextList: ChapterNode[]; changed: boolean } {
    let listChanged = false;

    const nextList = list.map((node) => {
      const inScope = isNodeInScope(node.id, ancestorIds, scopeSet);
      let contentChanged = false;
      let newContent = node.content;

      if (inScope && typeof node.content === 'string' && node.content.length > 0) {
        const replaceRes = replaceAllInText(node.content, query, replacement, caseSensitive);
        if (replaceRes.count > 0) {
          contentChanged = true;
          newContent = replaceRes.text;
          totalCount += replaceRes.count;
          changedNodeIds.push(node.id);
        }
      }

      let childrenChanged = false;
      let newChildren = node.children;
      if (node.children && node.children.length > 0) {
        const nextAncestors = [...ancestorIds, node.id];
        const childRes = walk(node.children, nextAncestors);
        if (childRes.changed) {
          childrenChanged = true;
          newChildren = childRes.nextList;
        }
      }

      if (contentChanged || childrenChanged) {
        listChanged = true;
        return {
          ...node,
          ...(contentChanged ? { content: newContent } : {}),
          ...(childrenChanged ? { children: newChildren } : {}),
        };
      }

      return node;
    });

    return {
      nextList: listChanged ? nextList : (list as ChapterNode[]),
      changed: listChanged,
    };
  }

  const result = walk(nodes, []);

  return {
    nodes: result.nextList,
    count: totalCount,
    changedNodeIds,
  };
}
