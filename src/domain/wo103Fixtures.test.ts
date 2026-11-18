import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { docxBytes, itemParagraphTexts } from './docxExport';
import { findNode } from '../data/demo';
import { buildTxt, planExport, toggleSelection, txtBytes, type ExportScope } from './fullTextExport';
import { FAKE_BOOK_TITLE, FAKE_CLICK_ORDER, docxParagraphs, fakeBookNodes, unzip } from './testing/wo103FakeBook';

/**
 * WO-103：假資料固定產物（給派工人實檔檢查）。
 *
 * 平常只在記憶體裡產生並核對。要把檔案寫出來時：
 *   WO103_FIXTURE_OUT=/workspace/delivery/novel-editor-mobile/wo103/假資料產物 npx vitest run src/domain/wo103Fixtures.test.ts
 * 會寫出：全文.docx、全文.txt、自選章節.docx、自選章節.txt、對照.json（假原稿、預期節點順序、預期段落、原始正文）。
 * 全部是程式產生的假文字，不是真稿。.docx 內 docProps/core.xml 的建立時間每次不同，其餘內容固定。
 */

function selectedIds(): Set<string> {
  const nodes = fakeBookNodes();
  let selected = new Set<string>();
  for (const id of FAKE_CLICK_ORDER) selected = toggleSelection(findNode(nodes, id)!, selected);
  return selected;
}

function manifestFor(scope: ExportScope) {
  const nodes = fakeBookNodes();
  const selected = scope === 'selected' ? selectedIds() : new Set<string>();
  const plan = planExport(nodes, scope, selected);
  return {
    plan,
    entry: {
      scope,
      clickOrder: scope === 'selected' ? [...FAKE_CLICK_ORDER] : null,
      selectedIds: scope === 'selected' ? [...selected] : null,
      expectedNodeOrder: plan.items.map((item) => item.nodeId),
      items: plan.items.map((item) => ({
        role: item.role,
        nodeId: item.nodeId,
        title: item.title,
        body: item.body,
        pageBreakBefore: item.pageBreakBefore,
      })),
      expectedDocxParagraphs: plan.items.flatMap((item) =>
        itemParagraphTexts(item).map((text, index) => ({
          text,
          pageBreakBefore: index === 0 && item.pageBreakBefore,
          role: index === 0 ? item.role : 'body',
          nodeId: item.nodeId,
        })),
      ),
      expectedTxt: buildTxt(plan),
    },
  };
}

describe('WO-103 假資料固定產物', () => {
  it('全文與自選章節的 .docx／.txt 與對照表可重跑產生，內容與規劃一致', async () => {
    const out = process.env.WO103_FIXTURE_OUT;
    const manifest = {
      note: 'WO-103 假資料固定產物；全部是程式產生的假文字，不是真稿。',
      bookTitle: FAKE_BOOK_TITLE,
      sourceNodes: fakeBookNodes(),
      docx: { font: 'PMingLiU', halfPoints: 24, pageA4Twip: [11906, 16838], marginTwip: 1440 },
      txt: { encoding: 'UTF-8（無 BOM）', newline: 'LF', itemSeparator: '\\n\\n', titleBodySeparator: '\\n' },
      outputs: {} as Record<string, unknown>,
    };
    for (const scope of ['all', 'selected'] as const) {
      const { plan, entry } = manifestFor(scope);
      const docx = await docxBytes(plan);
      const txt = txtBytes(plan);
      const paragraphs = docxParagraphs(new TextDecoder().decode(unzip(docx).get('word/document.xml')!));
      expect(paragraphs.map((p) => ({ text: p.text, pageBreakBefore: p.pageBreakBefore }))).toEqual(
        entry.expectedDocxParagraphs.map(({ text, pageBreakBefore }) => ({ text, pageBreakBefore })),
      );
      expect(new TextDecoder().decode(txt)).toBe(entry.expectedTxt);
      const name = scope === 'all' ? '全文' : '自選章節';
      manifest.outputs[name] = { docxFile: `${name}.docx`, txtFile: `${name}.txt`, ...entry };
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/${name}.docx`, docx);
        writeFileSync(`${out}/${name}.txt`, txt);
      }
    }
    expect(Object.keys(manifest.outputs)).toEqual(['全文', '自選章節']);
    if (out) writeFileSync(`${out}/對照.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  });
});
