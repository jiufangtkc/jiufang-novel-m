import type { ChapterNode } from '../../data/demo';
import { inflateRawSync } from 'node:zlib';

/**
 * WO-103 測試與固定產物共用的假書稿（全部是程式產生的假文字，不是真稿）。
 *
 * 涵蓋：兩卷以上、收合的卷、未分卷的章、同章多幕、同名不同代號（章與幕）、空章、空卷、
 * 前後全形空格、連續半形空格、連續空行、首尾空行、標點、表情符號（含國旗與 ZWJ 組合）、一般換行，
 * 以及不該進檔的幕摘要／視角／地點。
 */
export const FAKE_BOOK_TITLE = '霧港假稿：測試用?<書名>';

export function fakeBookNodes(): ChapterNode[] {
  return [
    {
      id: 'v1',
      type: 'folder',
      title: '第一卷　霧港',
      expanded: false,
      children: [
        {
          id: 'c1',
          type: 'file',
          title: '第一章　燈號',
          progress: 'Draft',
          content: '　　霧從港口漫上來。  兩個半形空格之後。\n\n\n連續兩個空行之後😀🇹🇼👩‍💻，標點！？……「引號」\n',
          expanded: true,
          children: [
            {
              id: 's1',
              type: 'scene',
              title: '夜巡',
              content: '\n幕一的開頭是空行。\n',
              sceneSummary: '【不該出現】幕摘要',
              scenePov: '【不該出現】視角',
              sceneLocation: '【不該出現】地點',
            },
            {
              id: 's2',
              type: 'scene',
              title: '夜巡',
              content: '幕二　結尾有全形空格　',
            },
          ],
        },
        { id: 'c2', type: 'file', title: '第二章　空章', content: '' },
      ],
    },
    { id: 'v2', type: 'folder', title: '第二卷　空卷', children: [] },
    { id: 'c3', type: 'file', title: '外篇　未分卷', content: ' 前面一個半形空格，後面三個半形空格   ' },
    {
      id: 'v3',
      type: 'folder',
      title: '第三卷　潮汐',
      children: [
        {
          id: 'c4',
          type: 'file',
          title: '第一章　燈號',
          content: '第三卷的同名章。<&>"\'',
          children: [
            { id: 's3', type: 'scene', title: '幕名', content: '  兩個半形空格開頭\n最後一行沒有換行' },
          ],
        },
        { id: 'c5', type: 'file', title: '第五章', content: '最後一章\n\n' },
      ],
    },
  ];
}

/** 「自選章節」假操作：先點後面的幕，再點前面的章、幕（點選順序故意與目錄相反）。 */
export const FAKE_CLICK_ORDER = ['s3', 'c2', 's1'] as const;

/* ---------------- .docx 解壓（只用 Node 內建 zlib，不另裝套件） ---------------- */

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是 zip 檔');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('zip 中央目錄損壞');
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    const raw = bytes.subarray(start, start + compSize);
    files.set(name, method === 0 ? raw : new Uint8Array(inflateRawSync(raw)));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

export interface DocxParagraph {
  xml: string;
  text: string;
  pageBreakBefore: boolean;
}

/** 從 word/document.xml 依序取出每個段落（文字已還原跳脫字元）。 */
export function docxParagraphs(documentXml: string): DocxParagraph[] {
  const body = documentXml.slice(documentXml.indexOf('<w:body>'), documentXml.indexOf('<w:sectPr'));
  const out: DocxParagraph[] = [];
  for (const match of body.matchAll(/<w:p>([\s\S]*?)<\/w:p>|<w:p\/>/g)) {
    const xml = match[0];
    const texts = [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => unescapeXml(m[1]!));
    out.push({ xml, text: texts.join(''), pageBreakBefore: /<w:pageBreakBefore(?: w:val="(?:true|1|on)")?\/>/.test(xml) });
  }
  return out;
}
