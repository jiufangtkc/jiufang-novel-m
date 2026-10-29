import { TREE_NEW_CHAPTER } from '../copy/userFacing';
import { findNode, type ChapterNode } from '../data/demo';
import { locateNode, writingOrder } from './chapterOps';

const CHAPTER_NUMBER = /^第([0-9]+|[零〇一二三四五六七八九十百千]+)章/;
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
const DIGIT_VALUE: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseChineseNumber(token: string): number | null {
  if (!token) return null;
  let total = 0;
  let current = 0;
  let seen = false;
  for (const char of token) {
    if (char === '千' || char === '百' || char === '十') {
      const unit = char === '千' ? 1000 : char === '百' ? 100 : 10;
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
      seen = true;
      continue;
    }
    const digit = DIGIT_VALUE[char];
    if (digit == null) return null;
    current = digit;
    seen = true;
  }
  if (!seen) return null;
  return total + current;
}

export function formatChineseNumber(value: number): string {
  if (!Number.isInteger(value) || value <= 0 || value > 9999) return String(value);
  if (value < 10) return DIGITS[value] ?? String(value);
  if (value < 20) return value === 10 ? '十' : `十${DIGITS[value - 10]}`;
  const thousands = Math.floor(value / 1000);
  const hundreds = Math.floor((value % 1000) / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  let result = '';
  if (thousands) result += `${DIGITS[thousands]}千`;
  if (hundreds) result += `${DIGITS[hundreds]}百`;
  else if (thousands && (tens || ones)) result += '零';
  if (tens) result += `${DIGITS[tens]}十`;
  else if (hundreds && ones) result += '零';
  if (ones) result += DIGITS[ones];
  return result;
}

/** 依上一章的章號給下一章。沒有章號，或下一個號已經有章在用，就用「新章」。 */
export function nextChapterTitle(previous: string | null | undefined, taken: readonly string[] = []): string {
  const serial = chapterSerial(previous ?? '');
  if (!serial) return TREE_NEW_CHAPTER;
  const next = serial.value + 1;
  if (taken.some((title) => chapterSerial(title)?.value === next)) return TREE_NEW_CHAPTER;
  if (serial.style === 'arabic') return `第${String(next).padStart(serial.width, '0')}章\u3000`;
  return `第${formatChineseNumber(next)}章\u3000`;
}

function chapterSerial(title: string): { value: number; style: 'arabic' | 'chinese'; width: number } | null {
  const match = CHAPTER_NUMBER.exec(title.trim());
  const token = match?.[1];
  if (!token) return null;
  if (/^[0-9]+$/.test(token)) return { value: Number(token), style: 'arabic', width: token.length };
  const value = parseChineseNumber(token);
  if (value == null || value < 1) return null;
  return { value, style: 'chinese', width: token.length };
}

/** 新章跟在錨點那一章後面。錨點是幕時用它所屬的章；沒有錨點就用目錄最後一章。 */
export function sourceTitleForNewChapter(nodes: readonly ChapterNode[], anchorId: string | null): string | null {
  const files = writingOrder(nodes).filter((node) => node.type === 'file');
  const last = files[files.length - 1]?.title ?? null;
  if (!anchorId) return last;
  const anchor = findNode(nodes, anchorId);
  if (!anchor) return last;
  if (anchor.type === 'file') return anchor.title;
  if (anchor.type === 'scene') {
    const location = locateNode(nodes, anchorId);
    const parent = location?.parentId ? findNode(nodes, location.parentId) : null;
    return parent?.type === 'file' ? parent.title : last;
  }
  const inside = (anchor.children ?? []).filter((node) => node.type === 'file');
  return inside[inside.length - 1]?.title ?? last;
}

/** 給新章的章名：沿用上一章的數字寫法；那個號已經有章就改叫「新章」。 */
export function titleForNewChapter(nodes: readonly ChapterNode[], anchorId: string | null): string {
  const taken = writingOrder(nodes)
    .filter((node) => node.type === 'file')
    .map((node) => node.title);
  return nextChapterTitle(sourceTitleForNewChapter(nodes, anchorId), taken);
}
