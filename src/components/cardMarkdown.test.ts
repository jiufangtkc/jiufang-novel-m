import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EMPTY_CARD_CONTENT_MESSAGE,
  isSafeUrl,
  parseCardMarkdown,
  renderCardMarkdownToNodes,
} from './cardMarkdown';
import { CardMarkdownView } from './CardMarkdownView';

describe('cardMarkdown 網址安全性檢查（isSafeUrl）', () => {
  it('允許 http:、https:、mailto: 等安全通訊協定', () => {
    expect(isSafeUrl('https://fogport.tw/archive/rain')).toBe(true);
    expect(isSafeUrl('http://fogport.tw/shipyard/guide')).toBe(true);
    expect(isSafeUrl('mailto:rain.shen@fogport.tw')).toBe(true);
    expect(isSafeUrl('mailto:rain.shen@fogport.tw?subject=霧港船塢紀錄')).toBe(true);
    expect(isSafeUrl('  https://fogport.tw/lighthouse  ')).toBe(true);
  });

  it('嚴格阻絕 javascript:、data:、vbscript:、file: 等不安全協定', () => {
    expect(isSafeUrl('javascript:alert("攻擊")')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:void(0)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox("警告")')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('blob:https://fogport.tw/uuid')).toBe(false);
  });

  it('阻絕不可見控制字元混淆與非允許協定', () => {
    expect(isSafeUrl('java\u0000script:alert(1)')).toBe(false);
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('about:blank')).toBe(false);
  });

  it('依工單規格阻絕相對路徑與空值，避免未預期跳轉', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl('/chapter/fogport-harbor')).toBe(false);
    expect(isSafeUrl('#section-shen-rain')).toBe(false);
    expect(isSafeUrl('characters/rain.md')).toBe(false);
  });
});

describe('cardMarkdown 獨立解析與轉譯函式（parseCardMarkdown / renderCardMarkdownToNodes）', () => {
  it('parseCardMarkdown 能將小說範例文字正確解析為語法節點清單', () => {
    const sample = '### 霧港暗記\n\n沈雨晴在筆記中記載著**關鍵閥門**的位置。';
    const tokens = parseCardMarkdown(sample);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens[0].type).toBe('heading');
    expect((tokens[0] as any).depth).toBe(3);
    const paragraphToken = tokens.find((t) => t.type === 'paragraph');
    expect(paragraphToken).toBeDefined();

    // 空字串解析應安全返回空陣列
    expect(parseCardMarkdown('')).toEqual([]);
  });

  it('renderCardMarkdownToNodes 能將語法節點轉換為 React 節點清單', () => {
    const sample = '- 舊式壓力表\n- 柴油引擎冷卻液';
    const tokens = parseCardMarkdown(sample);
    const nodes = renderCardMarkdownToNodes(tokens, 'unit-test');
    expect(nodes.length).toBe(1);
    expect(React.isValidElement(nodes[0])).toBe(true);

    // 空語法節點應安全返回空陣列
    expect(renderCardMarkdownToNodes([])).toEqual([]);
  });
});

describe('CardMarkdownView 預覽元件與語法節點渲染', () => {
  it('支援空內容或純空白字元，顯示規範提示且不可出現 Markdown 字樣', () => {
    const emptyMarkup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: '' }),
    );
    expect(emptyMarkup).toContain(EMPTY_CARD_CONTENT_MESSAGE);
    expect(emptyMarkup).toContain('card-md-empty');
    expect(emptyMarkup).not.toMatch(/markdown/i);

    const whitespaceMarkup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: '   \n\t  ' }),
    );
    expect(whitespaceMarkup).toContain(EMPTY_CARD_CONTENT_MESSAGE);
    expect(whitespaceMarkup).not.toMatch(/markdown/i);
  });

  it('支援 1 至 3 級標題與更深層級收斂', () => {
    const sampleContent = [
      '# 霧港人物誌：沈雨晴',
      '## 船塢巡檢隨筆',
      '### 舊蒸汽閥門檢修原則',
      '#### 附錄：冷霧測量儀細部',
    ].join('\n\n');

    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<h1 class="card-md-h1">霧港人物誌：沈雨晴</h1>');
    expect(markup).toContain('<h2 class="card-md-h2">船塢巡檢隨筆</h2>');
    expect(markup).toContain('<h3 class="card-md-h3">舊蒸汽閥門檢修原則</h3>');
    // 第 4 級標題應收斂為 3 級標題樣式
    expect(markup).toContain('<h3 class="card-md-h3">附錄：冷霧測量儀細部</h3>');
  });

  it('支援段落與換行', () => {
    const sampleContent = '沈雨晴站在第七號碼頭的高台上。\n夜風夾帶著海港特有的鹹味與機油氣息。';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<p class="card-md-p">');
    expect(markup).toContain('沈雨晴站在第七號碼頭的高台上。');
    expect(markup).toContain('<br class="card-md-br"/>');
    expect(markup).toContain('夜風夾帶著海港特有的鹹味與機油氣息。');
  });

  it('支援粗體、斜體與刪除線', () => {
    const sampleContent =
      '這枚**黃銅懷錶**刻有*霧港鐘樓*的舊徽記，而~~上週作廢的通行證~~已無法使用。';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<strong class="card-md-strong">黃銅懷錶</strong>');
    expect(markup).toContain('<em class="card-md-em">霧港鐘樓</em>');
    expect(markup).toContain('<del class="card-md-del">上週作廢的通行證</del>');
  });

  it('支援無序條列、有序條列與巢狀條列', () => {
    const sampleContent = [
      '巡檢必備裝備清單：',
      '- 雙向手動氣閥扳手',
      '- 霧港夜間專用抗壓風鏡',
      '- 船塢分區筆記：',
      '  - 舊碼頭第一修船渠',
      '  - 鐘樓南側蓄水庫',
      '',
      '標準維護步驟：',
      '1. 關閉第一隔離閥',
      '2. 檢查鍋爐外壁冷卻循環',
      '3. 記錄壓力計讀數',
    ].join('\n');

    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<ul class="card-md-ul">');
    expect(markup).toContain('<li class="card-md-li">雙向手動氣閥扳手</li>');
    expect(markup).toContain('<li class="card-md-li">霧港夜間專用抗壓風鏡</li>');
    // 巢狀清單
    expect(markup).toContain('<li class="card-md-li">舊碼頭第一修船渠</li>');
    expect(markup).toContain('<li class="card-md-li">鐘樓南側蓄水庫</li>');
    // 有序清單
    expect(markup).toContain('<ol class="card-md-ol">');
    expect(markup).toContain('<li class="card-md-li">關閉第一隔離閥</li>');
    expect(markup).toContain('<li class="card-md-li">檢查鍋爐外壁冷卻循環</li>');
    expect(markup).toContain('<li class="card-md-li">記錄壓力計讀數</li>');
  });

  it('支援引用區塊', () => {
    const sampleContent = '> 霧氣總在子夜最濃，此時切莫輕信水面上浮沉的燈火。\n> ——沈雨晴的調查隨筆';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<blockquote class="card-md-blockquote">');
    expect(markup).toContain('霧氣總在子夜最濃');
    expect(markup).toContain('沈雨晴的調查隨筆');
  });

  it('支援行內程式碼與程式碼區塊', () => {
    const sampleContent = [
      '在操作介面上輸入 `PORT_FOG_VALVE_RESET` 即可復位。',
      '',
      '```yaml',
      'station: fogport_dock_07',
      'inspector: shen_yu_qing',
      'status: active',
      '```',
    ].join('\n');

    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<code class="card-md-codespan">PORT_FOG_VALVE_RESET</code>');
    expect(markup).toContain('<pre class="card-md-code-block">');
    expect(markup).toContain('<code class="language-yaml">');
    expect(markup).toContain('inspector: shen_yu_qing');
  });

  it('支援分隔線', () => {
    const sampleContent = '霧港上半城記錄\n\n---\n\n霧港下半城記錄';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<hr class="card-md-hr"/>');
  });

  it('支援表格與欄位對齊', () => {
    const sampleContent = [
      '| 船隻名稱 | 歸屬港區 | 檢修狀態 | 備註 |',
      '| :--- | :---: | ---: | :--- |',
      '| 晨霧號 | 霧港北岬 | 待驗收 | 預計明日清晨起錨 |',
      '| 藍鰭號 | 舊船塢七號 | 檢修中 | 蒸汽閥更換完成 |',
    ].join('\n');

    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain('<div class="card-md-table-wrap">');
    expect(markup).toContain('<table class="card-md-table">');
    expect(markup).toContain('<th style="text-align:left" class="card-md-th">船隻名稱</th>');
    expect(markup).toContain('<th style="text-align:center" class="card-md-th">歸屬港區</th>');
    expect(markup).toContain('<th style="text-align:right" class="card-md-th">檢修狀態</th>');
    expect(markup).toContain('<td style="text-align:left" class="card-md-td">晨霧號</td>');
    expect(markup).toContain('<td style="text-align:center" class="card-md-td">霧港北岬</td>');
    expect(markup).toContain('<td style="text-align:right" class="card-md-td">待驗收</td>');
  });

  it('支援安全外部連結並加上 target="_blank" 與 rel="noopener noreferrer"', () => {
    const sampleContent =
      '參閱[霧港總檔案庫](https://fogport.tw/archives)或聯絡[負責工程師](mailto:rain@fogport.tw)。';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    expect(markup).toContain(
      '<a href="https://fogport.tw/archives" target="_blank" rel="noopener noreferrer" class="card-md-link">霧港總檔案庫</a>',
    );
    expect(markup).toContain(
      '<a href="mailto:rain@fogport.tw" target="_blank" rel="noopener noreferrer" class="card-md-link">負責工程師</a>',
    );
  });

  it('安全防護：script 與 img onerror 等原始 HTML 不會執行，安全轉為純文字', () => {
    const sampleContent = [
      '安全測試範例：',
      '<script>alert("惡意腳本執行")</script>',
      '<img src="x" onerror="alert(1)">',
      '<iframe src="https://evil.example.com"></iframe>',
    ].join('\n\n');

    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    // 原始 HTML 不應以真實標籤插入 DOM，防止腳本或屬性事件觸發
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<iframe');

    // 應轉義為安全純文字呈現
    expect(markup).toContain('&lt;script&gt;alert(&quot;惡意腳本執行&quot;)&lt;/script&gt;');
    expect(markup).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
    expect(markup).toContain('&lt;iframe src=&quot;https://evil.example.com&quot;&gt;&lt;/iframe&gt;');
  });

  it('安全防護：javascript: 連結不可點，以無連結功能之 span 呈現', () => {
    const sampleContent = '點擊[執行診斷指令](javascript:alert("跨站腳本"))查看結果。';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    // 不可產生 a 標籤
    expect(markup).not.toContain('<a href="javascript:');
    expect(markup).not.toContain('<a');
    // 應以帶有 unsafe-link 標記的 span 呈現文字
    expect(markup).toContain(
      '<span class="card-md-unsafe-link" data-unsafe-link="true">執行診斷指令</span>',
    );
  });

  it('視覺安全：不顯示圖片，圖片語法改為顯示替代文字', () => {
    const sampleContent =
      '這是女主角的檔案相片：![沈雨晴在舊船塢碼頭邊的側影](https://fogport.tw/photos/rain.jpg)。';
    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: sampleContent }),
    );

    // 絕對不可產生 img 標籤或對外圖片請求
    expect(markup).not.toContain('<img');
    // 應顯示替代文字
    expect(markup).toContain(
      '<span class="card-md-image-alt" data-image-alt="true">沈雨晴在舊船塢碼頭邊的側影</span>',
    );
  });

  it('支援超長中文小說段落並保持良好排版', () => {
    const longParagraph =
      '霧港的夜總是來得特別早。沈雨晴緊了緊防風大衣的領口，踏著濕滑的玄武岩階梯走向第七檢修台。海面上翻湧著深灰色的霧氣，那是從遠洋暖流撞擊寒冷礁岩時蒸騰而起的厚重水氣，經年累月地滲入整座城市的每條街道、每扇百葉窗與每座生鏽的齒輪箱。她抬頭望向遠方隱約閃爍的防波堤導航燈，橘紅色的光暈在霧中被拉散成一圈圈虛浮的光環。這座港口已經運轉了超過一百二十年，自最初的捕鯨補給站，發展成如今縱橫交錯的蒸汽管線之都。她手中握著父親留下來的檢修冊，泛黃的羊皮紙上記錄著每一條主要管線的受壓極限，以及那些被歲月掩埋的暗號與標記。當第一聲沉悶的汽笛穿越重重濃霧響起時，她知道，今天晚上的檢修工作才剛剛開始。';

    const markup = renderToStaticMarkup(
      React.createElement(CardMarkdownView, { content: longParagraph }),
    );

    expect(markup).toContain('<p class="card-md-p">');
    expect(markup).toContain(longParagraph);
    expect(markup).not.toMatch(/markdown/i);
  });
});
