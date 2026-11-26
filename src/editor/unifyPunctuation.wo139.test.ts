import { describe, expect, it } from 'vitest';
import { FORMAT_KINDS, formatText } from './formatText';
import { unifyPunctuation } from './unifyPunctuation';

describe('WO-139 統一標點轉換引擎：五項規則各自驗證', () => {
  it('破折號：—、–、――、——、單個 ─、三個以上 ─ 與中文句中 -- 一律改為 ──，不動單個 -', () => {
    expect(unifyPunctuation('甲—乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('甲–乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('甲――乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('甲——乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('甲─乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('甲───乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('甲--乙')).toEqual({ text: '甲──乙', replacementCount: 1 });
    expect(unifyPunctuation('氣溫 -5 度，請用 --force 與 foo--bar')).toEqual({
      text: '氣溫 -5 度，請用 --force 與 foo--bar',
      replacementCount: 0,
    });
  });

  it('刪節號：...、。。。、單個 …、⋯⋯、三個以上 … 一律改為 ……', () => {
    expect(unifyPunctuation('他說...算了')).toEqual({ text: '他說……算了', replacementCount: 1 });
    expect(unifyPunctuation('他說。。。算了')).toEqual({ text: '他說……算了', replacementCount: 1 });
    expect(unifyPunctuation('他說…算了')).toEqual({ text: '他說……算了', replacementCount: 1 });
    expect(unifyPunctuation('他說⋯⋯算了')).toEqual({ text: '他說……算了', replacementCount: 1 });
    expect(unifyPunctuation('他說………算了')).toEqual({ text: '他說……算了', replacementCount: 1 });
    // 一兩個全形句號不當刪節號
    expect(unifyPunctuation('這樣。')).toEqual({ text: '這樣。', replacementCount: 0 });
    expect(unifyPunctuation('這樣。。')).toEqual({ text: '這樣。。', replacementCount: 0 });
  });

  it('中文句中半形標點：, . ? ! : ; 改為全形並保留原有空白與換行', () => {
    expect(unifyPunctuation('他說, 走吧. 真的嗎? 太好了! 注意: 這裡; 結束.')).toEqual({
      text: '他說， 走吧。 真的嗎？ 太好了！ 注意： 這裡； 結束。',
      replacementCount: 7,
    });
    expect(unifyPunctuation(',再說!')).toEqual({ text: '，再說！', replacementCount: 2 });
    expect(unifyPunctuation('「你好」,')).toEqual({ text: '「你好」，', replacementCount: 1 });
    expect(unifyPunctuation('嗯……?')).toEqual({ text: '嗯……？', replacementCount: 1 });
    expect(unifyPunctuation('第一行,\r\n第二行.')).toEqual({
      text: '第一行，\r\n第二行。',
      replacementCount: 2,
    });
  });

  it('引號：彎雙引號改「」、彎單引號改『』，支援跨段', () => {
    expect(unifyPunctuation('“你好”')).toEqual({ text: '「你好」', replacementCount: 1 });
    expect(unifyPunctuation('“她說‘不’”')).toEqual({ text: '「她說『不』」', replacementCount: 2 });
    expect(unifyPunctuation('“第一段\n第二段”')).toEqual({
      text: '「第一段\n第二段」',
      replacementCount: 2,
    });
    expect(unifyPunctuation('“單獨開引號')).toEqual({ text: '「單獨開引號', replacementCount: 1 });
    // 直單引號不動
    expect(unifyPunctuation("他說'你好'")).toEqual({ text: "他說'你好'", replacementCount: 0 });
  });

  it('波浪號：中文句中 ~ 改為全形 ～', () => {
    expect(unifyPunctuation('好累喔~')).toEqual({ text: '好累喔～', replacementCount: 1 });
    expect(unifyPunctuation('好喔~~')).toEqual({ text: '好喔～～', replacementCount: 2 });
    expect(unifyPunctuation('嗯~好吧')).toEqual({ text: '嗯～好吧', replacementCount: 1 });
    expect(unifyPunctuation('大約 3~5 分鐘')).toEqual({ text: '大約 3～5 分鐘', replacementCount: 1 });
  });
});

describe('WO-139 混合句轉換順序與 formatText 接入', () => {
  it('混合句一次轉到位，步驟之間不互咬', () => {
    expect(unifyPunctuation('他說:"你真的要走...太快了吧--等等!"')).toEqual({
      text: '他說：「你真的要走……太快了吧──等等！」',
      replacementCount: 5,
    });
    expect(unifyPunctuation('他說:"你好",然後走了.')).toEqual({
      text: '他說：「你好」，然後走了。',
      replacementCount: 4,
    });
    expect(unifyPunctuation('她問:"這樣好嗎~等等...真的?"')).toEqual({
      text: '她問：「這樣好嗎～等等……真的？」',
      replacementCount: 5,
    });
  });

  it('formatText 支援 unify-punctuation 且 FORMAT_KINDS 已納入', () => {
    expect(FORMAT_KINDS).toContain('unify-punctuation');
    expect(formatText('unify-punctuation', '【範例】她說:"再見..."')).toBe('【範例】她說：「再見……」');
  });
});

describe('WO-139 保護區完全不動', () => {
  it('純英文句子、多詞片語與英文撇號完全不動', () => {
    const samples = [
      'Hello, world! How are you? Wait... really — don’t go!',
      "她說OK, let's go.",
      '她說「It’s OK」',
      'She said, “Wait... really?”',
      'This is fine — trust me.',
      'The students’ books from the ’90s.',
      "O’Brien didn't hesitate — really.",
    ];
    for (const s of samples) {
      expect(unifyPunctuation(s)).toEqual({ text: s, replacementCount: 0 });
    }
  });

  it('英文縮寫與詞內符號不動，但英文人名後接中文句逗號正常改全形', () => {
    expect(unifyPunctuation('Dr.王和 Mr.陳使用 Node.js寫程式，a.m.開會，用 e-mail 聯絡。')).toEqual({
      text: 'Dr.王和 Mr.陳使用 Node.js寫程式，a.m.開會，用 e-mail 聯絡。',
      replacementCount: 0,
    });
    expect(unifyPunctuation('他叫 Mr. Wang, 住在台北')).toEqual({
      text: '他叫 Mr. Wang， 住在台北',
      replacementCount: 1,
    });
  });

  it('網址與電子郵件內部標點不動，尾端緊接中文句標點正常轉換', () => {
    expect(unifyPunctuation('https://example.com/a.b?x=1&y=2#top')).toEqual({
      text: 'https://example.com/a.b?x=1&y=2#top',
      replacementCount: 0,
    });
    expect(unifyPunctuation('www.example.com.tw/~user')).toEqual({
      text: 'www.example.com.tw/~user',
      replacementCount: 0,
    });
    expect(unifyPunctuation('見 https://a.tw/b.c, 再說!')).toEqual({
      text: '見 https://a.tw/b.c， 再說！',
      replacementCount: 2,
    });
    expect(unifyPunctuation('網址是 https://a.tw/b.c.')).toEqual({
      text: '網址是 https://a.tw/b.c。',
      replacementCount: 1,
    });
    expect(unifyPunctuation('writer.test@example.com')).toEqual({
      text: 'writer.test@example.com',
      replacementCount: 0,
    });
    expect(unifyPunctuation('寄到 a@b.com, 謝謝!')).toEqual({
      text: '寄到 a@b.com， 謝謝！',
      replacementCount: 2,
    });
    expect(unifyPunctuation('請寄到 a@b.com.')).toEqual({
      text: '請寄到 a@b.com。',
      replacementCount: 1,
    });
  });

  it('數字、千分位、時間、區間、條列編號、英吋單位不動，數字後中文句尾標點正常轉換', () => {
    const untouched = [
      '3.14',
      '0.7.0',
      '2026.11.26',
      '10:30',
      '12:30:45',
      '16:9',
      '1,000',
      '1,000,000',
      '1,000.50',
      '10–20',
      '2020-2026',
      '1. 第一點',
      '  2. 第二點',
      '24"',
      '15.6"',
    ];
    for (const s of untouched) {
      expect(unifyPunctuation(s)).toEqual({ text: s, replacementCount: 0 });
    }
    expect(unifyPunctuation('圓周率是 3.14.')).toEqual({ text: '圓周率是 3.14。', replacementCount: 1 });
    expect(unifyPunctuation('已經 10:30!')).toEqual({ text: '已經 10:30！', replacementCount: 1 });
    expect(unifyPunctuation('螢幕是 24", 很清楚!')).toEqual({
      text: '螢幕是 24"， 很清楚！',
      replacementCount: 2,
    });
  });

  it('WO-139 返工回歸：中文句中純整數後緊接半形標點應轉全形，純英文行與數字內部不動', () => {
    const cases: Array<{ input: string; text: string; replacementCount: number }> = [
      { input: '他今年 18.', text: '他今年 18。', replacementCount: 1 },
      { input: '總共花了 500!', text: '總共花了 500！', replacementCount: 1 },
      { input: '答案是 42?', text: '答案是 42？', replacementCount: 1 },
      { input: '他買了蘋果 3, 香蕉 5.', text: '他買了蘋果 3， 香蕉 5。', replacementCount: 2 },
      { input: 'Chapter 1.', text: 'Chapter 1.', replacementCount: 0 },
    ];
    for (const c of cases) {
      const first = unifyPunctuation(c.input);
      expect(first).toEqual({ text: c.text, replacementCount: c.replacementCount });
      const second = unifyPunctuation(first.text);
      expect(second).toEqual({ text: first.text, replacementCount: 0 });
    }
  });

  it('獨立分隔線完全不動', () => {
    for (const line of ['------', '──────', '———', '  ---  ', '　———　']) {
      expect(unifyPunctuation(line)).toEqual({ text: line, replacementCount: 0 });
    }
  });
});

describe('WO-139 直引號保守判定（不確定不動）', () => {
  it('成對且含中文或中文冒號引導的短語才改', () => {
    expect(unifyPunctuation('"快走！"')).toEqual({ text: '「快走！」', replacementCount: 1 });
    expect(unifyPunctuation('"他叫 Tom"')).toEqual({ text: '「他叫 Tom」', replacementCount: 1 });
    expect(unifyPunctuation('他只回了一句："OK"')).toEqual({
      text: '他只回了一句：「OK」',
      replacementCount: 1,
    });
    expect(unifyPunctuation('她說："Hello, world!" 跟 "快走！"')).toEqual({
      text: '她說："Hello, world!" 跟 「快走！」',
      replacementCount: 1,
    });
  });

  it('WO-139 返工回歸：數字結尾直引號對話與英吋單位不互咬，並驗證處數與冪等性', () => {
    const cases: Array<{ input: string; text: string; replacementCount: number }> = [
      { input: '他說:"我今年18"', text: '他說：「我今年18」', replacementCount: 2 },
      {
        input: '他說:"我今年18"，她說:"我20"',
        text: '他說：「我今年18」，她說：「我20」',
        replacementCount: 4,
      },
      {
        input: '螢幕是 15.6", 他說:"太大了!"',
        text: '螢幕是 15.6"， 他說：「太大了！」',
        replacementCount: 4,
      },
      {
        input: '他說:"這台 24" 螢幕不錯"',
        text: '他說：「這台 24" 螢幕不錯」',
        replacementCount: 2,
      },
      {
        input: '這台 24" 螢幕不錯',
        text: '這台 24" 螢幕不錯',
        replacementCount: 0,
      },
      {
        input: '甲喊:"給我50" 乙喊:"最多30"',
        text: '甲喊：「給我50」 乙喊：「最多30」',
        replacementCount: 4,
      },
      {
        input: '他說:"這台 24" 螢幕不錯"，她說:"那台 27" 也不錯"',
        text: '他說：「這台 24" 螢幕不錯」，她說：「那台 27" 也不錯」',
        replacementCount: 4,
      },
      {
        input: '他說:"圓周率約3.14"',
        text: '他說：「圓周率約3.14」',
        replacementCount: 2,
      },
    ];
    for (const c of cases) {
      const first = unifyPunctuation(c.input);
      expect(first).toEqual({ text: c.text, replacementCount: c.replacementCount });
      const second = unifyPunctuation(first.text);
      expect(second).toEqual({ text: first.text, replacementCount: 0 });
    }
  });

  it('奇數不成對、跨行不成對、屬性、程式碼、空引號與純英文直引號不動', () => {
    expect(unifyPunctuation('他說："快走！')).toEqual({ text: '他說："快走！', replacementCount: 0 });
    expect(unifyPunctuation('第一行 "未閉合\n第二行 "正常對話"')).toEqual({
      text: '第一行 "未閉合\n第二行 「正常對話」',
      replacementCount: 1,
    });
    const unchanged = [
      'code="值"',
      '<a href="https://a.tw/b">連結</a>',
      '""',
      '"   "',
      'He said "hello".',
      '她問："Hello, world!"',
      '他說："https://example.com"',
    ];
    for (const s of unchanged) {
      expect(unifyPunctuation(s)).toEqual({ text: s, replacementCount: 0 });
    }
  });
});

describe('WO-139 已正確標點不動、冪等性與處數等價性', () => {
  const sampleDrafts = [
    '',
    '【範例】已經統一的文字，有「引號」、有『巢狀』、有……還有──以及～全形！',
    '【範例】他說:"你真的要走...太快了吧--等等!"\n她回:“等一下‘馬上’好~”\n------\n網址 https://a.tw/b.c, 寄到 a@b.com!',
    '【範例】1. 第一點：3.14、10:30、1,000、24" 螢幕。\r\nHello, world! — don’t worry.',
    '【範例】他說："快走！\n她問："OK" 與 code="測試" 與 ""。',
    '【範例】單個─與單個…和。。。加上⋯⋯與………，還有好喔~~。',
  ];

  it('已經正確的標點回傳 0 處且為同一字串', () => {
    const clean = sampleDrafts[1]!;
    const res = unifyPunctuation(clean);
    expect(res.replacementCount).toBe(0);
    expect(res.text).toBe(clean);
  });

  it('所有範例稿執行兩次皆冪等，且嚴格滿足 replacementCount === 0 ⇔ text === input', () => {
    for (const draft of sampleDrafts) {
      const first = unifyPunctuation(draft);
      if (first.replacementCount === 0) {
        expect(first.text).toBe(draft);
      } else {
        expect(first.text).not.toBe(draft);
      }
      const second = unifyPunctuation(first.text);
      expect(second.replacementCount).toBe(0);
      expect(second.text).toBe(first.text);
    }
  });
});
