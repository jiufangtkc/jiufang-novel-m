import { countWords, tokenizeWords } from './wordCount';

/** 逐字比對區段類型。 */
export type DiffSegmentKind = 'equal' | 'remove' | 'add';

/** 單一段落內的逐字比對區段。 */
export interface DiffSegment {
  readonly kind: DiffSegmentKind;
  readonly text: string;
}

/** 段落層級比對狀態。 */
export type CompareParagraphKind = 'unchanged' | 'modified' | 'added' | 'removed';

/** 對齊並逐字標記後的單一段落。 */
export interface CompareParagraph {
  readonly id: string;
  readonly kind: CompareParagraphKind;
  readonly isBlank: boolean;
  readonly segments: readonly DiffSegment[];
}

/** 比較頁顯示項目：單一段落或連續未改段落的收合條。 */
export type CompareDisplayItem =
  | {
      readonly type: 'paragraph';
      readonly paragraph: CompareParagraph;
    }
  | {
      readonly type: 'collapsed';
      readonly id: string;
      readonly hiddenParagraphCount: number;
      readonly paragraphs: readonly CompareParagraph[];
    };

/** 新舊版比較結果。 */
export interface VersionCompareResult {
  readonly hasChanges: boolean;
  readonly addedWords: number;
  readonly removedWords: number;
  readonly changedParagraphs: number;
  readonly paragraphs: readonly CompareParagraph[];
  readonly displayItems: readonly CompareDisplayItem[];
}

type EditOp =
  | { readonly kind: 'equal'; readonly aIdx: number; readonly bIdx: number }
  | { readonly kind: 'remove'; readonly aIdx: number }
  | { readonly kind: 'add'; readonly bIdx: number };

const PARA_MAX_D = 2000;
const CHAR_MAX_D = 1200;
const PAIR_DP_CELL_LIMIT = 16384;
const MIN_PAIR_SIMILARITY = 0.25;

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function splitParagraphs(normalizedText: string): string[] {
  if (normalizedText === '') return [];
  return normalizedText.split('\n');
}

/**
 * Myers O((N+M)D) 序列比對；超過步數上限 maxD 時回退為整段替換以確保大文件不卡頓。
 */
function myersDiff<T>(a: readonly T[], b: readonly T[], maxD: number): EditOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return b.map((_, bIdx) => ({ kind: 'add', bIdx }));
  }
  if (m === 0) {
    return a.map((_, aIdx) => ({ kind: 'remove', aIdx }));
  }

  const limit = Math.min(n + m, maxD);
  const offset = limit;
  const width = limit * 2 + 1;
  const v = new Int32Array(width);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let solvedD = -1;

  for (let d = 0; d <= limit; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x === n && y === m) {
        solvedD = d;
        break;
      }
    }
    if (solvedD >= 0) break;
    trace.push(v.slice());
  }

  if (solvedD < 0) {
    const fallback: EditOp[] = [];
    for (let aIdx = 0; aIdx < n; aIdx += 1) fallback.push({ kind: 'remove', aIdx });
    for (let bIdx = 0; bIdx < m; bIdx += 1) fallback.push({ kind: 'add', bIdx });
    return fallback;
  }

  const ops: EditOp[] = [];
  let x = n;
  let y = m;

  for (let d = solvedD; d >= 1; d -= 1) {
    const prevV = trace[d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && prevV[offset + k - 1]! < prevV[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prevV[offset + prevK]!;
    const prevY = prevX - prevK;
    const midX = down ? prevX : prevX + 1;
    const midY = midX - k;

    while (x > midX && y > midY) {
      x -= 1;
      y -= 1;
      ops.push({ kind: 'equal', aIdx: x, bIdx: y });
    }
    if (down) {
      ops.push({ kind: 'add', bIdx: prevY });
    } else {
      ops.push({ kind: 'remove', aIdx: prevX });
    }
    x = prevX;
    y = prevY;
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    ops.push({ kind: 'equal', aIdx: x, bIdx: y });
  }

  ops.reverse();
  return ops;
}

/** 計算兩個字串的字元多重集重疊相似度（0..1），用於決定多段變更內是否配對為同一段修改。 */
function charBagSimilarity(a: string, b: string): number {
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  if (charsA.length === 0 && charsB.length === 0) return 1;
  if (charsA.length === 0 || charsB.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const ch of charsA) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let shared = 0;
  for (const ch of charsB) {
    const left = counts.get(ch) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(ch, left - 1);
    }
  }
  return (2 * shared) / (charsA.length + charsB.length);
}

/** 將字串轉為升冪排序的 Unicode 碼點陣列，供多段保序 DP 快速計算多重集重疊相似度。 */
function toSortedCodePoints(text: string): Uint32Array {
  const cps: number[] = [];
  for (const ch of text) {
    cps.push(ch.codePointAt(0)!);
  }
  const arr = new Uint32Array(cps);
  arr.sort();
  return arr;
}

/** 由兩個已排序碼點陣列以雙指標線性計算字元多重集重疊相似度（0..1），結果與 charBagSimilarity 完全等價。 */
function sortedCharBagSimilarity(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    const av = a[i]!;
    const bv = b[j]!;
    if (av === bv) {
      shared += 1;
      i += 1;
      j += 1;
    } else if (av < bv) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/** 計算兩字串（排除換行與空白）的字元多重集交集個數，作為合併分段／併段前的快速預檢。 */
function charBagOverlapCount(a: string, b: string): number {
  const counts = new Map<string, number>();
  for (const ch of a) {
    if (ch === '\n' || ch.trim() === '') continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let shared = 0;
  for (const ch of b) {
    if (ch === '\n' || ch.trim() === '') continue;
    const left = counts.get(ch) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(ch, left - 1);
    }
  }
  return shared;
}

function nonNewlineLen(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch !== '\n') count += 1;
  }
  return count;
}

function nonWsNonNewlineLen(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch !== '\n' && ch.trim() !== '') count += 1;
  }
  return count;
}

function stripNewlines(text: string): string {
  return text.indexOf('\n') === -1 ? text : text.replace(/\n/g, '');
}

/** 依既有 countWords 規則之計字詞元序列比對，確保小結「多了／少了 N 字」與全文 countWords 完全一致。 */
function diffWordCounts(oldText: string, newText: string): { added: number; removed: number } {
  const oldTokens = tokenizeWords(oldText);
  const newTokens = tokenizeWords(newText);

  let prefix = 0;
  const minLen = Math.min(oldTokens.length, newTokens.length);
  while (prefix < minLen && oldTokens[prefix] === newTokens[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldTokens.length - prefix &&
    suffix < newTokens.length - prefix &&
    oldTokens[oldTokens.length - 1 - suffix] === newTokens[newTokens.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMid = oldTokens.slice(prefix, oldTokens.length - suffix);
  const newMid = newTokens.slice(prefix, newTokens.length - suffix);
  if (oldMid.length === 0 && newMid.length === 0) {
    return { added: 0, removed: 0 };
  }
  if (oldMid.length === 0) {
    return { added: newMid.length, removed: 0 };
  }
  if (newMid.length === 0) {
    return { added: 0, removed: oldMid.length };
  }

  const ops = myersDiff(oldMid, newMid, CHAR_MAX_D);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'add') added += 1;
    else if (op.kind === 'remove') removed += 1;
  }
  return { added, removed };
}

/** 將連續同類區段合併，並把同一組非 equal 變更內的 remove 排在 add 前面以維持閱讀順序與字數計算完整。 */
function normalizeSegments(raw: readonly DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  const push = (kind: DiffSegmentKind, text: string) => {
    if (text === '') return;
    const last = merged[merged.length - 1];
    if (last && last.kind === kind) {
      merged[merged.length - 1] = { kind, text: last.text + text };
    } else {
      merged.push({ kind, text });
    }
  };

  let removedRun = '';
  let addedRun = '';
  const flushChangeRun = () => {
    if (removedRun !== '') {
      push('remove', removedRun);
      removedRun = '';
    }
    if (addedRun !== '') {
      push('add', addedRun);
      addedRun = '';
    }
  };

  for (const seg of raw) {
    if (seg.text === '') continue;
    if (seg.kind === 'equal') {
      flushChangeRun();
      push('equal', seg.text);
    } else if (seg.kind === 'remove') {
      removedRun += seg.text;
    } else {
      addedRun += seg.text;
    }
  }
  flushChangeRun();
  return merged;
}

/** 對單一對齊後的差異段落執行 Unicode 字元級逐字比對。 */
function diffParagraphChars(oldLine: string, newLine: string): DiffSegment[] {
  if (oldLine === newLine) {
    return oldLine === '' ? [] : [{ kind: 'equal', text: oldLine }];
  }
  const oldChars = Array.from(oldLine);
  const newChars = Array.from(newLine);

  let prefixLen = 0;
  const minLen = Math.min(oldChars.length, newChars.length);
  while (prefixLen < minLen && oldChars[prefixLen] === newChars[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldChars.length - prefixLen &&
    suffixLen < newChars.length - prefixLen &&
    oldChars[oldChars.length - 1 - suffixLen] === newChars[newChars.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const oldMid = oldChars.slice(prefixLen, oldChars.length - suffixLen);
  const newMid = newChars.slice(prefixLen, newChars.length - suffixLen);

  const raw: DiffSegment[] = [];
  if (prefixLen > 0) {
    raw.push({ kind: 'equal', text: oldChars.slice(0, prefixLen).join('') });
  }

  if (oldMid.length === 0 && newMid.length > 0) {
    raw.push({ kind: 'add', text: newMid.join('') });
  } else if (newMid.length === 0 && oldMid.length > 0) {
    raw.push({ kind: 'remove', text: oldMid.join('') });
  } else if (oldMid.length > 0 || newMid.length > 0) {
    const ops = myersDiff(oldMid, newMid, CHAR_MAX_D);
    for (const op of ops) {
      if (op.kind === 'equal') {
        raw.push({ kind: 'equal', text: oldMid[op.aIdx]! });
      } else if (op.kind === 'remove') {
        raw.push({ kind: 'remove', text: oldMid[op.aIdx]! });
      } else {
        raw.push({ kind: 'add', text: newMid[op.bIdx]! });
      }
    }
  }

  if (suffixLen > 0) {
    raw.push({ kind: 'equal', text: oldChars.slice(oldChars.length - suffixLen).join('') });
  }

  return normalizeSegments(raw);
}

type AlignedEntry =
  | { readonly kind: 'unchanged'; readonly line: string }
  | { readonly kind: 'removed'; readonly line: string }
  | { readonly kind: 'added'; readonly line: string }
  | {
      readonly kind: 'modified';
      readonly oldLine: string;
      readonly newLine: string;
      readonly changedParagraphCount?: number;
    };

interface CharDiffMeasure {
  readonly removedText: string;
  readonly addedText: string;
  readonly removedLen: number;
  readonly addedLen: number;
  readonly cost: number;
}

function measureCharDiff(oldLine: string, newLine: string): CharDiffMeasure {
  const segments = diffParagraphChars(oldLine, newLine);
  let removedText = '';
  let addedText = '';
  for (const seg of segments) {
    if (seg.kind === 'remove') {
      removedText += stripNewlines(seg.text);
    } else if (seg.kind === 'add') {
      addedText += stripNewlines(seg.text);
    }
  }
  const removedLen = nonNewlineLen(removedText);
  const addedLen = nonNewlineLen(addedText);
  return {
    removedText,
    addedText,
    removedLen,
    addedLen,
    cost: removedLen + addedLen,
  };
}

function isSplitMergeGainAcceptable(savedPairs: number, targetLen: number): boolean {
  if (targetLen <= 0) return false;
  return targetLen === 1 ? savedPairs >= 1 : savedPairs / targetLen >= 0.6;
}

function isBlankSingleLineEntry(entry: AlignedEntry, kind: 'added' | 'removed'): boolean {
  return entry.kind === kind && entry.line.trim() === '';
}

function tryAbsorbNeighbor(
  entries: AlignedEntry[],
  idx: number,
  step: 1 | -1,
  targetKind: 'added' | 'removed',
  base: CharDiffMeasure,
): boolean {
  const entry = entries[idx];
  if (!entry || entry.kind !== 'modified') return false;
  const sourceOverlapPool = targetKind === 'added' ? base.removedText : base.addedText;
  if (sourceOverlapPool.length === 0) return false;

  let k = idx + step;
  while (k >= 0 && k < entries.length && isBlankSingleLineEntry(entries[k]!, targetKind)) {
    k += step;
  }
  if (k < 0 || k >= entries.length) return false;

  const targetEntry = entries[k]!;
  if (targetEntry.kind !== targetKind) return false;

  const candLine = targetEntry.line;
  const minOverlap = Math.max(1, Math.ceil(nonWsNonNewlineLen(candLine) * 0.4));
  if (charBagOverlapCount(sourceOverlapPool, candLine) < minOverlap) return false;

  const start = step === 1 ? idx + 1 : k;
  const end = step === 1 ? k + 1 : idx;
  const extraLines = entries
    .slice(start, end)
    .map((e) => (e.kind === targetKind ? e.line : ''));

  const combinedOld =
    targetKind === 'removed'
      ? (step === 1 ? [entry.oldLine, ...extraLines] : [...extraLines, entry.oldLine]).join('\n')
      : entry.oldLine;
  const combinedNew =
    targetKind === 'added'
      ? (step === 1 ? [entry.newLine, ...extraLines] : [...extraLines, entry.newLine]).join('\n')
      : entry.newLine;

  const candDiff = measureCharDiff(combinedOld, combinedNew);
  const targetLen = nonNewlineLen(candLine);
  const savedPairs = (base.cost + targetLen - candDiff.cost) / 2;
  if (!isSplitMergeGainAcceptable(savedPairs, targetLen)) return false;

  const replaceStart = step === 1 ? idx : k;
  const replaceCount = Math.abs(k - idx) + 1;
  entries.splice(replaceStart, replaceCount, {
    kind: 'modified',
    oldLine: combinedOld,
    newLine: combinedNew,
    ...(entry.changedParagraphCount !== undefined
      ? { changedParagraphCount: entry.changedParagraphCount }
      : {}),
  });
  return true;
}

/**
 * 合併同一變更區塊內的「一段分多段」、「多段併一段」與跨段重排，
 * 讓未改文字保留為 equal、只標出新增或刪除的換行。
 */
function consolidateSplitsAndMerges(initial: readonly AlignedEntry[]): AlignedEntry[] {
  const entries: AlignedEntry[] = [...initial];

  // 階段 A：處理「單段被細切成 2 段以上短段」或「2 段以上短段併成 1 段」，導致單對單相似度未達門檻而未被 DP 配對的情況
  for (let i = 0; i < entries.length; i += 1) {
    const cur = entries[i]!;
    if (cur.kind !== 'removed' && cur.kind !== 'added') continue;
    if (cur.line.trim() === '') continue;

    const targetKind = cur.kind === 'removed' ? 'added' : 'removed';

    // 嘗試往後收集相鄰目標段
    let lastMatchEnd = -1;
    let nonBlankMatched = 0;
    for (let k = i + 1; k < entries.length; k += 1) {
      const cand = entries[k]!;
      if (cand.kind !== targetKind) break;
      if (cand.line.trim() === '') continue;
      const candLen = nonWsNonNewlineLen(cand.line);
      if (charBagOverlapCount(cur.line, cand.line) < Math.max(1, Math.ceil(candLen * 0.4))) {
        break;
      }
      nonBlankMatched += 1;
      lastMatchEnd = k;
    }

    if (nonBlankMatched >= 2 && lastMatchEnd > i) {
      const joined = entries
        .slice(i + 1, lastMatchEnd + 1)
        .map((e) => (e.kind === targetKind ? e.line : ''))
        .join('\n');
      const oldText = cur.kind === 'removed' ? cur.line : joined;
      const newText = cur.kind === 'removed' ? joined : cur.line;
      if (charBagSimilarity(oldText, newText) >= MIN_PAIR_SIMILARITY) {
        const diffInfo = measureCharDiff(oldText, newText);
        const oldLen = nonNewlineLen(oldText);
        const newLen = nonNewlineLen(newText);
        const savedPairs = (oldLen + newLen - diffInfo.cost) / 2;
        const minLen = Math.min(oldLen, newLen);
        if (minLen > 0 && savedPairs / minLen >= 0.6) {
          entries.splice(i, lastMatchEnd - i + 1, { kind: 'modified', oldLine: oldText, newLine: newText });
          continue;
        }
      }
    }

    // 嘗試往前收集相鄰目標段
    let firstMatchStart = -1;
    let backNonBlankMatched = 0;
    for (let k = i - 1; k >= 0; k -= 1) {
      const cand = entries[k]!;
      if (cand.kind !== targetKind) break;
      if (cand.line.trim() === '') continue;
      const candLen = nonWsNonNewlineLen(cand.line);
      if (charBagOverlapCount(cur.line, cand.line) < Math.max(1, Math.ceil(candLen * 0.4))) {
        break;
      }
      backNonBlankMatched += 1;
      firstMatchStart = k;
    }

    if (backNonBlankMatched >= 2 && firstMatchStart >= 0 && firstMatchStart < i) {
      const joined = entries
        .slice(firstMatchStart, i)
        .map((e) => (e.kind === targetKind ? e.line : ''))
        .join('\n');
      const oldText = cur.kind === 'removed' ? cur.line : joined;
      const newText = cur.kind === 'removed' ? joined : cur.line;
      if (charBagSimilarity(oldText, newText) >= MIN_PAIR_SIMILARITY) {
        const diffInfo = measureCharDiff(oldText, newText);
        const oldLen = nonNewlineLen(oldText);
        const newLen = nonNewlineLen(newText);
        const savedPairs = (oldLen + newLen - diffInfo.cost) / 2;
        const minLen = Math.min(oldLen, newLen);
        if (minLen > 0 && savedPairs / minLen >= 0.6) {
          entries.splice(firstMatchStart, i - firstMatchStart + 1, {
            kind: 'modified',
            oldLine: oldText,
            newLine: newText,
          });
          i = firstMatchStart;
        }
      }
    }
  }

  // 階段 B & C：以既有的 modified 為中心，向後／向前吸收相鄰分段（added）或併段（removed），再處理相鄰 modified 跨段重排
  let changed = true;
  while (changed) {
    changed = false;

    for (let idx = 0; idx < entries.length; idx += 1) {
      const entry = entries[idx]!;
      if (entry.kind !== 'modified') continue;

      const base = measureCharDiff(entry.oldLine, entry.newLine);
      if (
        (base.removedLen > 0 &&
          (tryAbsorbNeighbor(entries, idx, 1, 'added', base) ||
            tryAbsorbNeighbor(entries, idx, -1, 'added', base))) ||
        (base.addedLen > 0 &&
          (tryAbsorbNeighbor(entries, idx, 1, 'removed', base) ||
            tryAbsorbNeighbor(entries, idx, -1, 'removed', base)))
      ) {
        changed = true;
        break;
      }
    }

    if (changed) continue;

    // 階段 C：相鄰兩個 modified 跨段重排（例如兩段之間換行位置移動）
    for (let idx = 0; idx + 1 < entries.length; idx += 1) {
      const first = entries[idx]!;
      const second = entries[idx + 1]!;
      if (first.kind !== 'modified' || second.kind !== 'modified') continue;

      const m1 = measureCharDiff(first.oldLine, first.newLine);
      const m2 = measureCharDiff(second.oldLine, second.newLine);
      const crossOverlap =
        charBagOverlapCount(m1.removedText, m2.addedText) >= 2 ||
        charBagOverlapCount(m1.addedText, m2.removedText) >= 2;
      if (!crossOverlap) continue;

      const mergedOld = `${first.oldLine}\n${second.oldLine}`;
      const mergedNew = `${first.newLine}\n${second.newLine}`;
      const candDiff = measureCharDiff(mergedOld, mergedNew);
      const sepCost = m1.cost + m2.cost;
      const savedPairs = (sepCost - candDiff.cost) / 2;
      if (savedPairs >= 2 && sepCost - candDiff.cost >= sepCost * 0.35) {
        const mergedChangedCount =
          (first.changedParagraphCount ?? 1) + (second.changedParagraphCount ?? 1);
        entries.splice(idx, 2, {
          kind: 'modified',
          oldLine: mergedOld,
          newLine: mergedNew,
          changedParagraphCount: mergedChangedCount,
        });
        changed = true;
        break;
      }
    }
  }

  return entries;
}

/** 在多對多段落變更區塊中配對最相近且保序的段落為 modified，並整合分段／併段後回傳。 */
function pairChangeHunk(oldLines: readonly string[], newLines: readonly string[]): AlignedEntry[] {
  if (oldLines.length === 0) {
    return newLines.map((line) => ({ kind: 'added', line }));
  }
  if (newLines.length === 0) {
    return oldLines.map((line) => ({ kind: 'removed', line }));
  }
  if (oldLines.length === 1 && newLines.length === 1) {
    const oldLine = oldLines[0]!;
    const newLine = newLines[0]!;
    if (oldLine === '' && newLine === '') {
      return [{ kind: 'unchanged', line: '' }];
    }
    if (oldLine === '') {
      return [
        { kind: 'removed', line: '' },
        { kind: 'added', line: newLine },
      ];
    }
    if (newLine === '') {
      return [
        { kind: 'removed', line: oldLine },
        { kind: 'added', line: '' },
      ];
    }
    return [{ kind: 'modified', oldLine, newLine }];
  }

  const rows = oldLines.length;
  const cols = newLines.length;
  const oldSorted = oldLines.map((line) => (line.trim() === '' ? null : toSortedCodePoints(line)));
  const newSorted = newLines.map((line) => (line.trim() === '' ? null : toSortedCodePoints(line)));

  // 一般規模（<= 16384 格）走完整精確保序 DP；極端長變更區塊自動收斂為帶狀（banded）保序 DP，不中斷配對
  let halfBand = cols;
  if (rows * cols > PAIR_DP_CELL_LIMIT) {
    const maxHalfBand = Math.max(16, Math.floor(100_000 / Math.max(1, rows) / 2));
    halfBand = Math.min(cols, Math.max(32, Math.abs(rows - cols) + 16), maxHalfBand);
  }

  const cMin = new Int32Array(rows + 1);
  const cMax = new Int32Array(rows + 1);
  for (let r = 0; r <= rows; r += 1) {
    const center = Math.round((r * cols) / rows);
    cMin[r] = Math.max(0, center - halfBand);
    cMax[r] = Math.min(cols, center + halfBand);
  }

  const dpRows: Float64Array[] = new Array<Float64Array>(rows + 1);
  for (let r = 0; r <= rows; r += 1) {
    dpRows[r] = new Float64Array(cMax[r]! - cMin[r]! + 1);
  }

  const simRows: Float64Array[] = new Array<Float64Array>(rows);
  for (let r = 0; r < rows; r += 1) {
    const cEnd = Math.min(cols - 1, cMax[r]!);
    const len = Math.max(0, cEnd - cMin[r]! + 1);
    simRows[r] = new Float64Array(len);
  }

  const getDp = (r: number, c: number): number => {
    if (r === rows || c === cols) return 0;
    const minC = cMin[r]!;
    const maxC = cMax[r]!;
    if (c < minC || c > maxC) return -1;
    return dpRows[r]![c - minC]!;
  };

  for (let r = rows - 1; r >= 0; r -= 1) {
    const minC = cMin[r]!;
    const maxC = Math.min(cols - 1, cMax[r]!);
    const aSorted = oldSorted[r];
    const dpRow = dpRows[r]!;
    const simRow = simRows[r]!;
    for (let c = maxC; c >= minC; c -= 1) {
      const bSorted = newSorted[c];
      let s = 0;
      if (aSorted && bSorted) {
        const raw = sortedCharBagSimilarity(aSorted, bSorted);
        if (raw >= MIN_PAIR_SIMILARITY) s = raw;
      }
      simRow[c - minC] = s;
      const diag = getDp(r + 1, c + 1);
      const matchScore = s > 0 && diag >= 0 ? s + diag : -1;
      const skipOld = getDp(r + 1, c);
      const skipNew = getDp(r, c + 1);
      dpRow[c - minC] = Math.max(0, matchScore, skipOld, skipNew);
    }
  }

  const out: AlignedEntry[] = [];
  let r = 0;
  let c = 0;
  while (r < rows && c < cols) {
    if (c < cMin[r]!) {
      out.push({ kind: 'added', line: newLines[c]! });
      c += 1;
      continue;
    }
    if (c > cMax[r]!) {
      out.push({ kind: 'removed', line: oldLines[r]! });
      r += 1;
      continue;
    }

    const cur = getDp(r, c);
    const s = simRows[r]![c - cMin[r]!]!;
    const diag = getDp(r + 1, c + 1);
    if (s > 0 && diag >= 0 && Math.abs(cur - (s + diag)) < 1e-9) {
      out.push({ kind: 'modified', oldLine: oldLines[r]!, newLine: newLines[c]! });
      r += 1;
      c += 1;
    } else if (getDp(r + 1, c) >= getDp(r, c + 1)) {
      out.push({ kind: 'removed', line: oldLines[r]! });
      r += 1;
    } else {
      out.push({ kind: 'added', line: newLines[c]! });
      c += 1;
    }
  }
  while (r < rows) {
    out.push({ kind: 'removed', line: oldLines[r]! });
    r += 1;
  }
  while (c < cols) {
    out.push({ kind: 'added', line: newLines[c]! });
    c += 1;
  }
  return consolidateSplitsAndMerges(out);
}

/** 先剝除首尾完全相同的段落，中間段落轉為整數 ID 後用 Myers 對齊。 */
function alignParagraphs(oldLines: readonly string[], newLines: readonly string[]): AlignedEntry[] {
  let prefix = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const entries: AlignedEntry[] = [];
  for (let i = 0; i < prefix; i += 1) {
    entries.push({ kind: 'unchanged', line: oldLines[i]! });
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);

  if (oldMid.length > 0 || newMid.length > 0) {
    const idMap = new Map<string, number>();
    const intern = (line: string): number => {
      const existing = idMap.get(line);
      if (existing !== undefined) return existing;
      const next = idMap.size;
      idMap.set(line, next);
      return next;
    };
    const oldIds = oldMid.map(intern);
    const newIds = newMid.map(intern);
    const ops = myersDiff(oldIds, newIds, PARA_MAX_D);

    let pendingOld: string[] = [];
    let pendingNew: string[] = [];
    const flushHunk = () => {
      if (pendingOld.length === 0 && pendingNew.length === 0) return;
      entries.push(...pairChangeHunk(pendingOld, pendingNew));
      pendingOld = [];
      pendingNew = [];
    };

    for (const op of ops) {
      if (op.kind === 'equal') {
        flushHunk();
        entries.push({ kind: 'unchanged', line: oldMid[op.aIdx]! });
      } else if (op.kind === 'remove') {
        pendingOld.push(oldMid[op.aIdx]!);
      } else {
        pendingNew.push(newMid[op.bIdx]!);
      }
    }
    flushHunk();
  }

  for (let i = oldLines.length - suffix; i < oldLines.length; i += 1) {
    entries.push({ kind: 'unchanged', line: oldLines[i]! });
  }

  return entries;
}

/** 依規則收合連續未改段落，在有改動處前後各保留一段非空未改段落作為上下文。 */
function buildDisplayItems(paragraphs: readonly CompareParagraph[], hasChanges: boolean): CompareDisplayItem[] {
  if (!hasChanges) {
    return paragraphs.map((paragraph) => ({ type: 'paragraph', paragraph }));
  }

  const keep = new Array<boolean>(paragraphs.length).fill(false);

  for (let i = 0; i < paragraphs.length; i += 1) {
    const para = paragraphs[i]!;
    if (para.kind === 'unchanged') continue;
    keep[i] = true;

    // 往前找最近 1 段非空未改段落作為前上下文（跳過空行，不論空行是未改、新增或刪除）
    for (let prev = i - 1; prev >= 0; prev -= 1) {
      const candidate = paragraphs[prev]!;
      if (candidate.isBlank) continue;
      if (candidate.kind === 'unchanged') {
        keep[prev] = true;
      }
      break;
    }

    // 往後找最近 1 段非空未改段落作為後上下文（跳過空行，不論空行是未改、新增或刪除）
    for (let next = i + 1; next < paragraphs.length; next += 1) {
      const candidate = paragraphs[next]!;
      if (candidate.isBlank) continue;
      if (candidate.kind === 'unchanged') {
        keep[next] = true;
      }
      break;
    }
  }

  // 保留緊鄰可見段落的未改動空行，維持視覺間距
  for (let i = 0; i < paragraphs.length; i += 1) {
    const para = paragraphs[i]!;
    if (para.kind !== 'unchanged' || !para.isBlank) continue;
    const prevKept = i > 0 && keep[i - 1];
    const nextKept = i + 1 < paragraphs.length && keep[i + 1];
    if (prevKept || nextKept) {
      keep[i] = true;
    }
  }

  // 沒有任何非空變更段（例如僅空行差異）時，全部展開顯示
  if (!keep.some(Boolean)) {
    return paragraphs.map((paragraph) => ({ type: 'paragraph', paragraph }));
  }

  const items: CompareDisplayItem[] = [];
  let hiddenBuffer: CompareParagraph[] = [];
  let collapsedSeq = 0;

  const flushHidden = () => {
    if (hiddenBuffer.length === 0) return;
    const nonBlankCount = hiddenBuffer.filter((p) => !p.isBlank).length;
    if (nonBlankCount === 0) {
      for (const blankPara of hiddenBuffer) {
        items.push({ type: 'paragraph', paragraph: blankPara });
      }
    } else {
      collapsedSeq += 1;
      items.push({
        type: 'collapsed',
        id: `collapsed-${collapsedSeq}`,
        hiddenParagraphCount: nonBlankCount,
        paragraphs: hiddenBuffer,
      });
    }
    hiddenBuffer = [];
  };

  for (let i = 0; i < paragraphs.length; i += 1) {
    const para = paragraphs[i]!;
    if (para.kind !== 'unchanged' || keep[i]) {
      flushHidden();
      items.push({ type: 'paragraph', paragraph: para });
    } else {
      hiddenBuffer.push(para);
    }
  }
  flushHidden();

  return items;
}

/**
 * 比較「舊版正文」與「現在這一章」：
 * 1. 先按換行做段落對齊（Myers），避免全文大矩陣 DP。
 * 2. 只對有差異的段落進行 Unicode 逐字比對。
 * 3. 插入／刪除字數一律交由既有 countWords 計算。
 * 4. 連續未改段落收成一列可展開項目，並在改動處前後各留一段上下文。
 */
export function compareChapterVersions(oldText: string, currentText: string): VersionCompareResult {
  const normOld = normalizeLineEndings(oldText);
  const normCurrent = normalizeLineEndings(currentText);
  const hasChanges = normOld !== normCurrent;

  const oldLines = splitParagraphs(normOld);
  const newLines = splitParagraphs(normCurrent);
  const aligned = alignParagraphs(oldLines, newLines);

  let addedWords = 0;
  let removedWords = 0;
  let changedParagraphs = 0;

  const paragraphs: CompareParagraph[] = aligned.map((entry, idx) => {
    const id = `para-${idx + 1}`;
    if (entry.kind === 'unchanged') {
      const isBlank = entry.line.trim() === '';
      return {
        id,
        kind: 'unchanged',
        isBlank,
        segments: entry.line === '' ? [] : [{ kind: 'equal', text: entry.line }],
      };
    }

    if (entry.kind === 'removed') {
      const isBlank = entry.line.trim() === '';
      if (!isBlank) {
        changedParagraphs += 1;
        removedWords += countWords(entry.line);
      }
      return {
        id,
        kind: 'removed',
        isBlank,
        segments: entry.line === '' ? [] : [{ kind: 'remove', text: entry.line }],
      };
    }

    if (entry.kind === 'added') {
      const isBlank = entry.line.trim() === '';
      if (!isBlank) {
        changedParagraphs += 1;
        addedWords += countWords(entry.line);
      }
      return {
        id,
        kind: 'added',
        isBlank,
        segments: entry.line === '' ? [] : [{ kind: 'add', text: entry.line }],
      };
    }

    const segments = diffParagraphChars(entry.oldLine, entry.newLine);
    const isBlank = entry.oldLine.trim() === '' && entry.newLine.trim() === '';
    if (!isBlank) {
      changedParagraphs += entry.changedParagraphCount ?? 1;
    }
    const { added, removed } = diffWordCounts(entry.oldLine, entry.newLine);
    addedWords += added;
    removedWords += removed;
    return {
      id,
      kind: 'modified',
      isBlank,
      segments,
    };
  });

  const displayItems = buildDisplayItems(paragraphs, hasChanges);

  return {
    hasChanges,
    addedWords,
    removedWords,
    changedParagraphs,
    paragraphs,
    displayItems,
  };
}
