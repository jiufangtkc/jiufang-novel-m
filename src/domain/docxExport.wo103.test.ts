import { describe, expect, it } from 'vitest';
import { findNode } from '../data/demo';
import { bodyLines, docxBytes, itemParagraphTexts, xmlSafeText } from './docxExport';
import { planExport, toggleSelection, type ExportPlan } from './fullTextExport';
import { FAKE_CLICK_ORDER, docxParagraphs, fakeBookNodes, unzip } from './testing/wo103FakeBook';

/**
 * WO-103：實際產生 .docx、解壓讀 XML 核對（不是只看畫面 CSS，也不是 mock Blob）。
 * 九方已定案：每章新頁、PMingLiU 12 點（w:sz 24）、章名與正文同為一般段落、無標題樣式、正文不加縮排、逐字照原樣。
 */

async function open(plan: ExportPlan) {
  const files = unzip(await docxBytes(plan));
  const text = (name: string) => new TextDecoder().decode(files.get(name)!);
  return { files, documentXml: text('word/document.xml'), stylesXml: text('word/styles.xml') };
}

function expectedParagraphs(plan: ExportPlan): Array<{ text: string; pageBreakBefore: boolean }> {
  return plan.items.flatMap((item) =>
    itemParagraphTexts(item).map((text, index) => ({ text, pageBreakBefore: index === 0 && item.pageBreakBefore })),
  );
}

describe('WO-103 Word（.docx）實檔內容', () => {
  it('全文：段落逐字對照、每章新頁、第一頁不多空白頁、卷名不多造分頁、幕不分頁', async () => {
    const nodes = fakeBookNodes();
    const plan = planExport(nodes, 'all');
    const { files, documentXml } = await open(plan);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']));
    const paragraphs = docxParagraphs(documentXml);
    expect(paragraphs.map((p) => ({ text: p.text, pageBreakBefore: p.pageBreakBefore }))).toEqual(expectedParagraphs(plan));

    // 分頁只出現在每章（或該章所屬卷第一次出現時的卷名）開頭；整份第一段沒有分頁、也沒有前導空段
    const breaks = paragraphs.filter((p) => p.pageBreakBefore).map((p) => p.text);
    expect(breaks).toEqual(['第二章　空章', '外篇　未分卷', '第三卷　潮汐', '第五章']);
    expect(paragraphs[0]!.text).toBe('第一卷　霧港');
    expect(paragraphs[0]!.pageBreakBefore).toBe(false);
    expect(documentXml).not.toMatch(/<w:br w:type="page"\/>/);
    // 第三卷的卷名與它的第一章在同一頁（卷名不另起一頁）
    const v3 = paragraphs.findIndex((p) => p.text === '第三卷　潮汐');
    expect(paragraphs[v3 + 1]).toMatchObject({ text: '第一章　燈號', pageBreakBefore: false });
    // 幕名不分頁
    for (const p of paragraphs.filter((x) => x.text === '夜巡' || x.text === '幕名')) expect(p.pageBreakBefore).toBe(false);

    // 每個正文區塊逐字還原（以 LF 接回）＝來源原字串；空行成空段、首尾空行保留
    let index = 0;
    for (const item of plan.items) {
      expect(paragraphs[index]!.text).toBe(item.title);
      index += 1;
      if (item.body === null) continue;
      const lines = bodyLines(item.body);
      const restored = paragraphs.slice(index, index + lines.length).map((p) => p.text).join('\n');
      expect(restored).toBe(item.body);
      expect(restored).toBe(findNode(nodes, item.nodeId)!.content ?? '');
      index += lines.length;
    }
    expect(index).toBe(paragraphs.length);
  });

  it('每段都是一般段落：沒有 pStyle（無 Heading 1／標題 1 等）、沒有縮排、靠左、單倍行距段前段後 0；字型與大小在每段與每個文字都明確指定', async () => {
    const { documentXml, stylesXml } = await open(planExport(fakeBookNodes(), 'all'));
    const paragraphs = docxParagraphs(documentXml);
    expect(paragraphs.length).toBeGreaterThan(10);
    for (const p of paragraphs) {
      expect(p.xml).not.toContain('<w:pStyle');
      expect(p.xml).not.toContain('<w:ind');
      expect(p.xml).not.toContain('<w:numPr');
      expect(p.xml).toContain('<w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/>');
      expect(p.xml).toContain('<w:jc w:val="left"/>');
      // 段落標記的字型大小（空段落的行高也是 12 點新細明體）
      expect(p.xml).toMatch(/<w:pPr>[\s\S]*<w:rPr><w:rFonts w:ascii="PMingLiU" w:cs="PMingLiU" w:eastAsia="PMingLiU" w:hAnsi="PMingLiU"\/><w:sz w:val="24"\/><w:szCs w:val="24"\/><\/w:rPr><\/w:pPr>/);
      for (const run of p.xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)) {
        expect(run[1]).toContain('<w:rFonts w:ascii="PMingLiU" w:cs="PMingLiU" w:eastAsia="PMingLiU" w:hAnsi="PMingLiU"/>');
        expect(run[1]).toContain('<w:sz w:val="24"/>');
        expect(run[1]).not.toMatch(/<w:(b|i|u|caps|smallCaps)\b/);
        expect(run[1]).toMatch(/<w:t xml:space="preserve">/);
      }
    }
    // 檔內沒有其他字型名稱、沒有嵌入字型、沒有換行／定位字元元素替代作者的換行
    const fontNames = new Set([...documentXml.matchAll(/w:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)"/g)].map((m) => m[1]));
    expect([...fontNames]).toEqual(['PMingLiU']);
    expect(documentXml).not.toMatch(/標楷|DFKai|KaiTi|MingLiU_HKSCS/);
    expect(documentXml).not.toContain('<w:br');
    expect(documentXml).not.toContain('<w:tab/>');
    // 文件預設（styles.xml docDefaults）也是 PMingLiU 12 點、段前段後 0；Normal 不另設縮排
    expect(stylesXml).toMatch(/<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="PMingLiU" w:cs="PMingLiU" w:eastAsia="PMingLiU" w:hAnsi="PMingLiU"\/><w:sz w:val="24"\/><w:szCs w:val="24"\/><\/w:rPr><\/w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"\/><\/w:pPr><\/w:pPrDefault><\/w:docDefaults>/);
    expect(stylesXml).toContain('<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:qFormat/></w:style>');
  });

  it('A4 直式、上下左右 2.54 公分；沒有頁首頁尾、頁碼、書名頁或目錄', async () => {
    const { files, documentXml } = await open(planExport(fakeBookNodes(), 'all'));
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>');
    expect(documentXml).toMatch(/<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/);
    expect(documentXml).not.toContain('headerReference');
    expect(documentXml).not.toContain('footerReference');
    expect(documentXml).not.toMatch(/PAGE|TOC \\/);
    expect([...files.keys()].some((name) => /header|footer/.test(name))).toBe(false);
    expect(docxParagraphs(documentXml)[0]!.text).toBe('第一卷　霧港'); // 開頭沒有書名或說明
  });

  it('自選章節：依目錄順序、只含選取內容；只選幕時章名開新頁但不帶章正文', async () => {
    const nodes = fakeBookNodes();
    let selected = new Set<string>();
    for (const id of FAKE_CLICK_ORDER) selected = toggleSelection(findNode(nodes, id)!, selected);
    const plan = planExport(nodes, 'selected', selected);
    const { documentXml } = await open(plan);
    const paragraphs = docxParagraphs(documentXml);
    expect(paragraphs.map((p) => ({ text: p.text, pageBreakBefore: p.pageBreakBefore }))).toEqual(expectedParagraphs(plan));
    expect(paragraphs.map((p) => p.text)).toEqual([
      '第一卷　霧港',
      '第一章　燈號',
      '夜巡',
      '',
      '幕一的開頭是空行。',
      '',
      '第二章　空章',
      '第三卷　潮汐',
      '第一章　燈號',
      '幕名',
      '  兩個半形空格開頭',
      '最後一行沒有換行',
    ]);
    expect(paragraphs.filter((p) => p.pageBreakBefore).map((p) => p.text)).toEqual(['第二章　空章', '第三卷　潮汐']);
    expect(documentXml).not.toContain('霧從港口');
    expect(documentXml).not.toContain('幕二');
  });

  it('缺字型的環境也能產生檔案，檔內仍指定 PMingLiU（產生時不讀系統字型）；XML 不合法的控制字元只在 Word 檔裡略過', async () => {
    const plan = planExport([{ id: 'c', type: 'file', title: '第一章', content: 'a\u0001b\u0000c\td' }], 'all');
    const { documentXml } = await open(plan);
    expect(docxParagraphs(documentXml).map((p) => p.text)).toEqual(['第一章', 'abc\td']);
    expect(xmlSafeText('😀　  \t')).toBe('😀　  \t');
    expect(xmlSafeText('a￾b￿c\uD800d')).toBe('abcd');
    expect(documentXml).toContain('w:eastAsia="PMingLiU"');
  });
});
