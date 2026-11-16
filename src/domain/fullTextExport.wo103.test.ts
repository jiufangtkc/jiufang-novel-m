import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { sanitizeDbBasename } from './bookTitle';
import { exportDbFilename } from './exportFilename';
import {
  allBodyNodeIds,
  buildTxt,
  checkStateOf,
  fullTextExportFilename,
  hasExportableChapter,
  planExport,
  selectAll,
  toggleSelection,
  txtBytes,
  type ExportItem,
} from './fullTextExport';
import { FAKE_BOOK_TITLE, FAKE_CLICK_ORDER, fakeBookNodes } from './testing/wo103FakeBook';
import { findNode } from '../data/demo';

/** WO-103：匯出內容規劃、自選章節、TXT 與檔名。全部是程式產生的假稿。 */

const brief = (items: ExportItem[]) => items.map((item) => [item.role, item.nodeId, item.body === null ? null : 'body', item.pageBreakBefore]);

function clickInOrder(nodes: ChapterNode[], ids: readonly string[]): Set<string> {
  let selected = new Set<string>();
  for (const id of ids) selected = toggleSelection(findNode(nodes, id)!, selected);
  return selected;
}

describe('WO-103 全文：完整目錄順序、卷章幕、每章新頁', () => {
  it('全文依目錄由上到下：收合的卷也輸出、空卷不輸出、未分卷章不加虛構卷名、同名不同代號各自輸出一次', () => {
    const nodes = fakeBookNodes();
    const plan = planExport(nodes, 'all');
    expect(brief(plan.items)).toEqual([
      ['volume', 'v1', null, false], // 第一頁開頭：不多一張空白頁
      ['chapter', 'c1', 'body', false],
      ['scene', 's1', 'body', false],
      ['scene', 's2', 'body', false], // 幕不另分頁
      ['chapter', 'c2', 'body', true], // 空章保留章名、自己一頁
      ['chapter', 'c3', 'body', true], // 未分卷：前面沒有卷名
      ['volume', 'v3', null, true], // 卷名在該卷第一章的頁首，不另做卷名頁
      ['chapter', 'c4', 'body', false],
      ['scene', 's3', 'body', false],
      ['chapter', 'c5', 'body', true],
    ]);
    expect(plan.chapterCount).toBe(5);
    // 每個正文節點只輸出一次
    const ids = plan.items.map((item) => item.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('v2');
    // 只輸出標題與正文，幕摘要／視角／地點不進檔
    expect(JSON.stringify(plan.items)).not.toContain('不該出現');
    // 正文原樣，沒有 trim 或正規化
    expect(plan.items.find((item) => item.nodeId === 'c1')!.body).toBe(findNode(nodes, 'c1')!.content);
    expect(plan.items.find((item) => item.nodeId === 'c3')!.body).toBe(' 前面一個半形空格，後面三個半形空格   ');
    expect(plan.items.find((item) => item.nodeId === 'c2')!.body).toBe('');
  });

  it('畫面上的收合狀態不影響輸出（expanded 改來改去結果都一樣）', () => {
    const a = fakeBookNodes();
    const b = fakeBookNodes();
    const flip = (list: ChapterNode[]) => list.forEach((node) => {
      node.expanded = !node.expanded;
      flip(node.children ?? []);
    });
    flip(b);
    expect(planExport(b, 'all')).toEqual(planExport(a, 'all'));
  });
});

describe('WO-103 自選章節：勾選規則與目錄順序', () => {
  it('先點後面的再點前面的，仍依目錄順序；只選幕時列所屬章名當脈絡但不帶章正文或未選的幕', () => {
    const nodes = fakeBookNodes();
    const selected = clickInOrder(nodes, FAKE_CLICK_ORDER);
    expect([...selected]).toEqual(['s3', 'c2', 's1']); // 點選順序
    const plan = planExport(nodes, 'selected', selected);
    expect(brief(plan.items)).toEqual([
      ['volume', 'v1', null, false],
      ['chapter', 'c1', null, false], // 章名脈絡，不帶 c1 正文
      ['scene', 's1', 'body', false],
      ['chapter', 'c2', 'body', true],
      ['volume', 'v3', null, true],
      ['chapter', 'c4', null, false], // 只選幕：所屬章仍是新頁開頭
      ['scene', 's3', 'body', false],
    ]);
    const text = buildTxt(plan);
    expect(text).not.toContain('霧從港口'); // c1 正文
    expect(text).not.toContain('幕二'); // 未選的 s2
    expect(text).not.toContain('外篇'); // 未選的 c3
    expect(text).not.toContain('第三卷的同名章'); // c4 正文
    expect(plan.chapterCount).toBe(3);
  });

  it('全選選入所有章及其幕（收合的卷也算）；取消全選清空', () => {
    const nodes = fakeBookNodes();
    expect([...selectAll(nodes)]).toEqual(['c1', 's1', 's2', 'c2', 'c3', 'c4', 's3', 'c5']);
    expect(allBodyNodeIds(nodes)).toEqual(['c1', 's1', 's2', 'c2', 'c3', 'c4', 's3', 'c5']);
    expect(planExport(nodes, 'selected', selectAll(nodes))).toEqual(planExport(nodes, 'all'));
    expect(planExport(nodes, 'selected', new Set()).chapterCount).toBe(0);
  });

  it('卷勾選帶入所有子章／幕；章勾選帶入所有幕；單獨取消幕後父層顯示部分選取；再點部分選取的父層會整批選回', () => {
    const nodes = fakeBookNodes();
    const v1 = findNode(nodes, 'v1')!;
    const c1 = findNode(nodes, 'c1')!;
    const s2 = findNode(nodes, 's2')!;
    let selected = toggleSelection(v1, new Set());
    expect([...selected].sort()).toEqual(['c1', 'c2', 's1', 's2']);
    expect(checkStateOf(v1, selected)).toBe('checked');
    selected = toggleSelection(s2, selected);
    expect(checkStateOf(s2, selected)).toBe('unchecked');
    expect(checkStateOf(c1, selected)).toBe('partial');
    expect(checkStateOf(v1, selected)).toBe('partial');
    selected = toggleSelection(c1, selected);
    expect(checkStateOf(c1, selected)).toBe('checked');
    selected = toggleSelection(v1, selected);
    expect(selected.size).toBe(0);
    // 章勾選只帶自己的幕
    const only = toggleSelection(c1, new Set());
    expect([...only].sort()).toEqual(['c1', 's1', 's2']);
    // 空卷不能被當成有內容
    expect(checkStateOf(findNode(nodes, 'v2')!, selectAll(nodes))).toBe('unchecked');
  });

  it('選章但取消其中一幕：章正文與其他幕輸出，被取消的幕不輸出', () => {
    const nodes = fakeBookNodes();
    let selected = toggleSelection(findNode(nodes, 'c1')!, new Set());
    selected = toggleSelection(findNode(nodes, 's1')!, selected);
    const plan = planExport(nodes, 'selected', selected);
    expect(brief(plan.items)).toEqual([
      ['volume', 'v1', null, false],
      ['chapter', 'c1', 'body', false],
      ['scene', 's2', 'body', false],
    ]);
  });

  it('無章（只有空卷或完全空白）判斷為沒有可匯出的章；只有空白正文的章仍算章', () => {
    expect(hasExportableChapter([])).toBe(false);
    expect(hasExportableChapter([{ id: 'v', type: 'folder', title: '空卷', children: [] }])).toBe(false);
    expect(planExport([{ id: 'v', type: 'folder', title: '空卷', children: [] }], 'all').chapterCount).toBe(0);
    const blank: ChapterNode[] = [{ id: 'c', type: 'file', title: '第一章　', content: '' }];
    expect(hasExportableChapter(blank)).toBe(true);
    expect(buildTxt(planExport(blank, 'all'))).toBe('第一章　\n');
  });
});

describe('WO-103 TXT：UTF-8 無 BOM、LF、正文逐字', () => {
  it('標題獨立一行＋一個 LF＋原正文；項與項之間另加兩個 LF；正文區塊逐字比對（不 trim）', () => {
    const nodes = fakeBookNodes();
    const plan = planExport(nodes, 'all');
    const text = buildTxt(plan);
    const body = (id: string) => findNode(nodes, id)!.content!;
    const expected = [
      '第一卷　霧港',
      `第一章　燈號\n${body('c1')}`,
      `夜巡\n${body('s1')}`,
      `夜巡\n${body('s2')}`,
      `第二章　空章\n`,
      `外篇　未分卷\n${body('c3')}`,
      '第三卷　潮汐',
      `第一章　燈號\n${body('c4')}`,
      `幕名\n${body('s3')}`,
      `第五章\n${body('c5')}`,
    ].join('\n\n');
    expect(text).toBe(expected);

    // 依規劃逐段切回：分隔用的 LF 與作者原有的 LF 分開斷言
    let cursor = 0;
    for (const [index, item] of plan.items.entries()) {
      if (index > 0) {
        expect(text.slice(cursor, cursor + 2)).toBe('\n\n'); // 格式分隔
        cursor += 2;
      }
      expect(text.slice(cursor, cursor + item.title.length)).toBe(item.title);
      cursor += item.title.length;
      if (item.body !== null) {
        expect(text[cursor]).toBe('\n'); // 標題後的一個 LF
        cursor += 1;
        expect(text.slice(cursor, cursor + item.body.length)).toBe(item.body); // 原正文逐字
        cursor += item.body.length;
      }
    }
    expect(cursor).toBe(text.length);

    const bytes = txtBytes(plan);
    expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(text);
    expect(text).not.toContain('\r');
    // 全形空格、連續半形空格、表情符號、首尾空行都在
    expect(text).toContain('　　霧從港口漫上來。  兩個半形空格之後。\n\n\n連續兩個空行之後😀🇹🇼👩‍💻');
    expect(text).toContain('夜巡\n\n幕一的開頭是空行。\n');
  });
});

describe('WO-103 檔名：沿用現行安全書名規則', () => {
  const NOW = new Date(2026, 10, 16, 21, 5);

  it('安全書名_全文／自選章節_YYYYMMDD-HHMM.docx／.txt，書名經 sanitizeDbBasename', () => {
    expect(fullTextExportFilename('霧港', 'docx', 'all', NOW)).toBe('霧港_全文_20261116-2105.docx');
    expect(fullTextExportFilename('霧港', 'txt', 'selected', NOW)).toBe('霧港_自選章節_20261116-2105.txt');
    const safe = sanitizeDbBasename(FAKE_BOOK_TITLE);
    expect(fullTextExportFilename(FAKE_BOOK_TITLE, 'docx', 'all', NOW)).toBe(`${safe}_全文_20261116-2105.docx`);
    expect(safe).not.toMatch(/[<>:"/\\|?*]/);
    // 不影響既有 .db 另存檔名
    expect(exportDbFilename('霧港', NOW)).toBe('霧港_20261116-2105.db');
  });

  it('危險字、Windows 保留名稱、全形空格、表情符號、長書名都照現行規則；完整檔名不超過 255 位元組', () => {
    const cases = ['a/b\\c:d*e?f"g<h>i|j', 'CON', 'com1', '霧　港', '😀🇹🇼霧港', '', '...', '霧'.repeat(300), '👩‍💻'.repeat(100)];
    for (const title of cases) {
      for (const format of ['docx', 'txt'] as const) {
        for (const scope of ['all', 'selected'] as const) {
          const name = fullTextExportFilename(title, format, scope, NOW);
          const base = sanitizeDbBasename(title);
          expect(name.startsWith(base)).toBe(true);
          expect(name.endsWith(`.${format}`)).toBe(true);
          expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
          expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
        }
      }
    }
    expect(fullTextExportFilename('CON', 'txt', 'all', NOW)).toBe(`${sanitizeDbBasename('CON')}_全文_20261116-2105.txt`);
    expect(fullTextExportFilename('霧　港', 'docx', 'all', NOW)).toBe('霧　港_全文_20261116-2105.docx');
    expect(fullTextExportFilename('', 'docx', 'all', NOW)).toBe('未命名稿子_全文_20261116-2105.docx');
  });
});
