import type { ChapterNode } from '../data/demo';

/**
 * 全 App 唯一的字數算法（WO-76，九方 2026-11-13 13:41、14:04 定案，對齊 Word「字數」）。
 *
 * - 中文字一字算 1；全形標點每個算 1，「……」「——」各是兩個符號，所以算 2。
 * - 英文一個單字算 1（iPhone、OK 各算 1），不逐字母算。
 * - 一串阿拉伯數字整串算 1（2026、3.5、1,000、12:30 各算 1）；只有小數點、千分位逗號（後面剛好三位數）、
 *   時間的冒號夾在兩段數字中間時，才算數字內部，不另算。
 * - 半形標點夾在中文裡、或在數字旁但不是數字內部（3,價格、1,2,3）時，每個算 1；
 *   黏在英文單字上的（OK,、let's、e-mail）不另算。
 * - 全形空白、半形空白、換行、空行都不算。
 *
 * 寫作頁本章與今天字數、首頁、統計、暫存、讀檔、另存重開、刪章提示、章節舊版，全部呼叫這一個函式。
 */
export function countWords(text: string): number {
  let total = 0;
  /** 目前這一段連在一起的「英數與半形符號」，遇到空白或中文時交給 countRun 計算。 */
  let run: string[] = [];
  const endRun = () => {
    if (run.length) total += countRun(run);
    run = [];
  };
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (WHITESPACE.test(ch)) {
      endRun();
      continue;
    }
    // 組字用的附加符號、異體字選擇符、零寬字元：不另算，也不切斷英文單字。
    if (INVISIBLE.test(ch)) continue;
    if (LATIN_WORD.test(ch)) {
      run.push(ch);
      continue;
    }
    if (
      ASCII_MARK.test(ch) ||
      (CURLY_APOSTROPHE.test(ch) && run.length > 0 && LATIN_WORD.test(run[run.length - 1]!) && LATIN_WORD.test(chars[i + 1] ?? ''))
    ) {
      // 半形符號，或英文單字中間的彎撇號（let’s）。
      run.push(ch);
      continue;
    }
    // 其餘都是中文字、全形標點、其他全形符號：一個算 1。
    endRun();
    total += 1;
  }
  endRun();
  return total;
}

/** 全書字數：每個卷、章、幕的名稱，加上章與幕的正文（與 Word 整份檔案計算的原則一致）。 */
export function countBookWords(nodes: readonly ChapterNode[]): number {
  return nodes.reduce((sum, node) => {
    const own = countWords(node.title ?? '') + (node.type === 'folder' ? 0 : countWords(node.content ?? ''));
    return sum + own + countBookWords(node.children ?? []);
  }, 0);
}

/** 一個節點與底下所有章、幕的正文字數，不含名稱（刪章提示用）。 */
export function countBodyWords(node: ChapterNode): number {
  const own = node.type === 'folder' ? 0 : countWords(node.content ?? '');
  return own + (node.children ?? []).reduce((sum, child) => sum + countBodyWords(child), 0);
}

/**
 * 計算一段連在一起的英數與半形符號（中間沒有空白、中文）。
 *
 * 1. 先切成「英數串」與「單一半形符號」。
 * 2. 數字內部符號併進數字：兩段純數字中間的「.」「:」，或後面剛好三位數的「,」（千分位）。
 *    所以 3.5、1,000、12:30 各算 1；1,2,3 的逗號不是千分位，數字與逗號各自算。
 * 3. 黏在英文單字上的半形符號不另算：夾在英數串之間且至少一邊是英文單字（e-mail、COVID-19、let's），
 *    併成同一個單字；在英文單字前後（OK,、(OK)）直接略過。
 * 4. 剩下的英數串各算 1，剩下的半形符號每個算 1。
 */
function countRun(chars: readonly string[]): number {
  type Piece = { kind: 'num' | 'word'; text: string } | { kind: 'mark'; text: string };
  const pieces: Piece[] = [];
  for (const ch of chars) {
    const last = pieces[pieces.length - 1];
    if (LATIN_WORD.test(ch)) {
      if (last && last.kind !== 'mark') {
        last.text += ch;
        if (!DIGIT.test(ch)) last.kind = 'word';
      } else {
        pieces.push({ kind: DIGIT.test(ch) ? 'num' : 'word', text: ch });
      }
    } else {
      pieces.push({ kind: 'mark', text: ch });
    }
  }

  // 2. 數字內部符號：num 符號 num → 一個 num。
  for (let i = 1; i + 1 < pieces.length; ) {
    const prev = pieces[i - 1]!;
    const mark = pieces[i]!;
    const next = pieces[i + 1]!;
    const internal =
      prev.kind === 'num' &&
      mark.kind === 'mark' &&
      next.kind === 'num' &&
      (mark.text === '.' || mark.text === ':' || (mark.text === ',' && next.text.length === 3));
    if (internal) {
      prev.text += mark.text + next.text;
      pieces.splice(i, 2);
    } else {
      i += 1;
    }
  }

  // 3. 黏在英文單字上的符號。
  let total = 0;
  for (let i = 0; i < pieces.length; ) {
    const piece = pieces[i]!;
    if (piece.kind !== 'mark') {
      total += 1;
      i += 1;
      continue;
    }
    let j = i;
    while (j < pieces.length && pieces[j]!.kind === 'mark') j += 1;
    const before = pieces[i - 1];
    const after = pieces[j];
    const touchesWord = before?.kind === 'word' || after?.kind === 'word';
    if (touchesWord) {
      // 夾在英數之間（e-mail、COVID-19）：併成一個單字，後面那段不再另算。
      if (before && after) j += 1;
    } else {
      total += j - i;
    }
    i = j;
  }
  return total;
}

const WHITESPACE = /^[\s　]$/u;
const INVISIBLE = /^[\p{M}​-‍⁠﻿]$/u;
/** 半形的英文字母與數字，以及其他拼音文字的字母（café、Ελλάδα）。全形英數與中日韓文字不在內。 */
const LATIN_WORD = /^(?![ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿＀-￯\u{20000}-\u{3ffff}])[\p{L}\p{N}]$/u;
const ASCII_MARK = /^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/u;
const CURLY_APOSTROPHE = /^[‘’]$/u;
const DIGIT = /^[0-9]$/u;
