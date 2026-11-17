import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  TextRun,
  type IRunOptions,
} from 'docx';
import type { ExportItem, ExportPlan } from './fullTextExport';

/**
 * WO-103：把匯出規劃寫成 Word（.docx）。
 *
 * 九方已定案：每章從新的一頁開始；正文新細明體（PMingLiU）12 點；章名與正文相同，不用任何標題樣式。
 * 正文逐字照原樣：作者的每一行（含空行）各成一個一般段落，全形空格、連續半形空格、表情符號原樣留在 w:t
 * （xml:space="preserve"），不加首行縮排、不插入空白字元。
 *
 * 暫定，交九方審（工單暫定第 1、2、10、11 條）：
 * - A4 直式，上下左右邊界各 2.54 公分（1440 twip）。
 * - 單倍行距（240／auto），段前段後 0，不設縮排，靠左（不左右強制對齊）。
 * - 只寫 PMingLiU（ascii／hAnsi／eastAsia／cs 都是），不另寫後備字型、不嵌入字型。
 * - 不做書名頁、目錄、頁碼、頁首頁尾或說明。
 */

export const DOCX_FONT = 'PMingLiU';
/** 12 點；Word 的 w:sz 以半點計，所以是 24。 */
export const DOCX_HALF_POINTS = 24;
/** A4（twip）。 */
export const A4_WIDTH_TWIP = 11906;
export const A4_HEIGHT_TWIP = 16838;
/** 2.54 公分＝1 英吋＝1440 twip。 */
export const MARGIN_TWIP = 1440;

const RUN_PROPS = {
  font: { ascii: DOCX_FONT, hAnsi: DOCX_FONT, eastAsia: DOCX_FONT, cs: DOCX_FONT },
  size: DOCX_HALF_POINTS,
} satisfies Partial<IRunOptions>;

const PARAGRAPH_SPACING = { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO };

/**
 * XML 1.0 不允許的控制字元（Tab、LF、CR 以外的 C0 控制字元、U+FFFE／U+FFFF、落單的代理字元）。
 * 這些字元寫進 document.xml 會讓整份檔打不開，所以只在 Word 檔裡略過；TXT 照原樣保留。
 * 一般書寫（含全形空格、表情符號）不會碰到。
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlSafeText(text: string): string {
  return text.replace(XML_ILLEGAL, '');
}

/** 一段文字（標題或正文的一行）變成一個一般段落；空字串就是空段落。 */
function paragraphOf(text: string, pageBreakBefore: boolean): Paragraph {
  const safe = xmlSafeText(text);
  return new Paragraph({
    pageBreakBefore,
    alignment: AlignmentType.LEFT,
    spacing: PARAGRAPH_SPACING,
    // 段落標記也指定字型大小，空段落的高度才會是 12 點新細明體的一行。
    run: RUN_PROPS,
    children: safe === '' ? [] : [new TextRun({ text: safe, ...RUN_PROPS })],
  });
}

/**
 * 正文拆成段落：以 LF 分行，每一行一段，空行就是空段落。
 * 正文是空字串時不產生任何段落（還原時 0 段＝空字串；「一個空段落」則代表正文只有一個換行之前的空行）。
 */
export function bodyLines(body: string): string[] {
  return body === '' ? [] : body.split('\n');
}

export function itemParagraphTexts(item: ExportItem): string[] {
  return [item.title, ...(item.body === null ? [] : bodyLines(item.body))];
}

export function buildDocxDocument(plan: ExportPlan): Document {
  const children: Paragraph[] = [];
  for (const item of plan.items) {
    itemParagraphTexts(item).forEach((text, index) => {
      children.push(paragraphOf(text, index === 0 && item.pageBreakBefore));
    });
  }
  return new Document({
    styles: {
      default: {
        document: {
          run: RUN_PROPS,
          paragraph: { spacing: PARAGRAPH_SPACING },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH_TWIP, height: A4_HEIGHT_TWIP, orientation: PageOrientation.PORTRAIT },
            margin: { top: MARGIN_TWIP, right: MARGIN_TWIP, bottom: MARGIN_TWIP, left: MARGIN_TWIP },
          },
        },
        children,
      },
    ],
  });
}

export async function docxBytes(plan: ExportPlan): Promise<Uint8Array> {
  const buffer = await Packer.toArrayBuffer(buildDocxDocument(plan));
  return new Uint8Array(buffer);
}
