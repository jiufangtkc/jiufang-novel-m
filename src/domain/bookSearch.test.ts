import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import {
  countInBook,
  findInBook,
  replaceAll,
  replaceOne,
  type SearchHit,
} from './bookSearch';

/**
 * 建立測試用範例章節樹。
 * 遵循專案規範：一律使用範例內容（故事背景：霧港、主角：沈雨晴）。
 */
function createDemoTree(): ChapterNode[] {
  return [
    {
      id: 'vol-1',
      type: 'folder',
      title: '第一卷　霧港之秋',
      children: [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　海潮來信',
          content: '十月的霧港總是下雨。\n沈雨晴在石階上看著渡輪靠岸，信紙浸了水氣。\n她知道信件不會騙人。',
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　燈塔守衛',
          content: '沈雨晴快步走向舊燈塔。\n石壁上有青苔，海浪聲很響。',
          children: [
            {
              id: 'sc-1',
              type: 'scene',
              title: '幕 1　迴旋梯',
              content: '舊燈塔的鐵階梯旋轉而上。\n沈雨晴數著階數，第十三級會發出微響。',
            },
            {
              id: 'sc-2',
              type: 'scene',
              title: '幕 2　頂樓瞭望',
              content: '風從破掉的玻璃窗灌進來。守塔人點了一根菸，望著海面上的燈火。',
            },
          ],
        },
      ],
    },
    {
      id: 'vol-2',
      type: 'folder',
      title: '第二卷　海風微明',
      children: [
        {
          id: 'ch-3',
          type: 'file',
          title: '第三章　晨曦初現',
          content: '破曉時分，霧氣慢慢散開，沈雨晴在碼頭等第一班客船。',
        },
      ],
    },
  ];
}

describe('全書搜尋 findInBook', () => {
  it('依章節樹由上而下、節點內由前到後找出所有匹配，並填入完整 path 階層', () => {
    const tree = createDemoTree();
    const hits = findInBook(tree, '沈雨晴');

    expect(hits).toHaveLength(4);
    // 第 1 筆在第一章
    expect(hits[0].nodeId).toBe('ch-1');
    expect(hits[0].nodeTitle).toBe('第一章　海潮來信');
    expect(hits[0].path).toEqual(['第一卷　霧港之秋', '第一章　海潮來信']);
    expect(hits[0].start).toBe(11);
    expect(hits[0].end).toBe(14);
    expect(hits[0].match).toBe('沈雨晴');

    // 第 2 筆在第二章
    expect(hits[1].nodeId).toBe('ch-2');
    expect(hits[1].nodeTitle).toBe('第二章　燈塔守衛');
    expect(hits[1].path).toEqual(['第一卷　霧港之秋', '第二章　燈塔守衛']);

    // 第 3 筆在第二章幕 1
    expect(hits[2].nodeId).toBe('sc-1');
    expect(hits[2].nodeTitle).toBe('幕 1　迴旋梯');
    expect(hits[2].path).toEqual(['第一卷　霧港之秋', '第二章　燈塔守衛', '幕 1　迴旋梯']);

    // 第 4 筆在第三章
    expect(hits[3].nodeId).toBe('ch-3');
    expect(hits[3].nodeTitle).toBe('第三章　晨曦初現');
    expect(hits[3].path).toEqual(['第二卷　海風微明', '第三章　晨曦初現']);
  });

  it('上下文擷取前後約 20 字，且同行截斷不跨越換行', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '範例章節',
        content: '第一行開頭的前置文字。\n沈雨晴走進霧港的燈塔，夜色正濃。\n第三行結尾文字。',
      },
    ];

    const hits = findInBook(tree, '霧港');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    // before 截斷於換行後，只保留同行文字
    expect(hit.before).toBe('沈雨晴走進');
    expect(hit.match).toBe('霧港');
    // after 截斷於換行前，只保留同行文字
    expect(hit.after).toBe('的燈塔，夜色正濃。');
  });

  it('長段落無換行時，前後文各取至多約 20 字', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '長文字範例',
        content: '一二三四五六七八九十一二三四五六七八九十目標字詞甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸',
      },
    ];

    const hits = findInBook(tree, '目標字詞');
    expect(hits).toHaveLength(1);
    expect(hits[0].before).toBe('一二三四五六七八九十一二三四五六七八九十');
    expect(hits[0].match).toBe('目標字詞');
    expect(hits[0].after).toBe('甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸');
  });

  it('支援表情符號與複合字元（🐱 與 👨‍👩‍👧），UTF-16 索引一致且不切壞代理對', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '表情符號範例',
        content: '沈雨晴養了一隻小黑貓🐱在港口，每天遇見碼頭上的👨‍👩‍👧一家人散步。',
      },
    ];

    // 搜尋單一表情符號 🐱（2 個 code units）
    const catHits = findInBook(tree, '🐱');
    expect(catHits).toHaveLength(1);
    expect(catHits[0].match).toBe('🐱');
    expect(catHits[0].before).toContain('小黑貓');
    expect(catHits[0].after).toContain('在港口');

    // 搜尋複合字元旁的文字，確認 UTF-16 索引完全準確
    const familyHits = findInBook(tree, '一家人');
    expect(familyHits).toHaveLength(1);
    expect(familyHits[0].match).toBe('一家人');
    expect(familyHits[0].before).toContain('👨‍👩‍👧');
  });

  it('全形與半形不互相轉換：搜尋「Ａ」不會找到「A」，搜尋「，」不會找到「,」', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '全形半形範例',
        content: '計劃A與計劃Ａ。半形,與全形，標點。',
      },
    ];

    // 搜尋全形「Ａ」
    const fullAHits = findInBook(tree, 'Ａ');
    expect(fullAHits).toHaveLength(1);
    expect(fullAHits[0].match).toBe('Ａ');
    expect(fullAHits[0].before).toContain('計劃');

    // 搜尋半形「A」
    const halfAHits = findInBook(tree, 'A');
    expect(halfAHits).toHaveLength(1);
    expect(halfAHits[0].match).toBe('A');

    // 搜尋全形逗號「，」
    const fullCommaHits = findInBook(tree, '，');
    expect(fullCommaHits).toHaveLength(1);
    expect(fullCommaHits[0].match).toBe('，');

    // 搜尋半形逗號「,」
    const halfCommaHits = findInBook(tree, ',');
    expect(halfCommaHits).toHaveLength(1);
    expect(halfCommaHits[0].match).toBe(',');
  });

  it('查詢字當作一般文字處理，非正規表示式（.*、(註)、\\n 照字面匹配）', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '符號範例',
        content: '文字包含.*萬用字元，以及(註解1)標記，還有字面上的\\n字樣。',
      },
    ];

    expect(findInBook(tree, '.*')).toHaveLength(1);
    expect(findInBook(tree, '.*')[0].match).toBe('.*');

    expect(findInBook(tree, '(註解1)')).toHaveLength(1);
    expect(findInBook(tree, '(註解1)')[0].match).toBe('(註解1)');

    expect(findInBook(tree, '\\n')).toHaveLength(1);
    expect(findInBook(tree, '\\n')[0].match).toBe('\\n');
  });

  it('空字串或純空白查詢：防呆回傳 0 筆', () => {
    const tree = createDemoTree();
    expect(findInBook(tree, '')).toEqual([]);
    expect(findInBook(tree, '   ')).toEqual([]);
    expect(findInBook(tree, '\t\t')).toEqual([]);
    expect(findInBook(tree, '\n')).toEqual([]);
    expect(findInBook(tree, '\u3000\u3000')).toEqual([]);
  });

  it('支援 nodeIds 指定搜尋範圍（單一幕、單一章、整卷）', () => {
    const tree = createDemoTree();

    // 僅搜尋第二章幕 1
    const sceneHits = findInBook(tree, '沈雨晴', { nodeIds: ['sc-1'] });
    expect(sceneHits).toHaveLength(1);
    expect(sceneHits[0].nodeId).toBe('sc-1');

    // 搜尋第二章（包含其下的所有幕）
    const chapterHits = findInBook(tree, '沈雨晴', { nodeIds: ['ch-2'] });
    expect(chapterHits).toHaveLength(2);
    expect(chapterHits.map((h) => h.nodeId)).toEqual(['ch-2', 'sc-1']);

    // 搜尋第一卷（包含第一章、第二章及其幕）
    const volHits = findInBook(tree, '沈雨晴', { nodeIds: ['vol-1'] });
    expect(volHits).toHaveLength(3);
    expect(volHits.map((h) => h.nodeId)).toEqual(['ch-1', 'ch-2', 'sc-1']);
  });

  it('大小寫敏感度：預設 false 不區分英文字母大小寫，若指定 caseSensitive: true 則精確區分', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '英文範例',
        content: 'Port FOG is quiet. The fog lifts in Foggy morning.',
      },
    ];

    // 預設不區分大小寫
    const defaultHits = findInBook(tree, 'fog');
    expect(defaultHits).toHaveLength(3);
    expect(defaultHits[0].match).toBe('FOG');
    expect(defaultHits[1].match).toBe('fog');
    expect(defaultHits[2].match).toBe('Fog');

    // 明確設定區分大小寫
    const sensitiveHits = findInBook(tree, 'fog', { caseSensitive: true });
    expect(sensitiveHits).toHaveLength(1);
    expect(sensitiveHits[0].match).toBe('fog');
  });

  it('重疊情況：查「哈哈」在「哈哈哈」中計 1 次（非重疊、由左往右）', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '重疊範例',
        content: '碼頭的老闆哈哈哈大笑，哈哈哈哈更開心。',
      },
    ];

    const hits = findInBook(tree, '哈哈');
    // 「哈哈哈」算 1 次，「哈哈哈哈」算 2 次，共 3 次
    expect(hits).toHaveLength(3);
  });
});

describe('全書計算出現次數 countInBook', () => {
  it('正確計算全書總次數、各節點次數與快速對照表', () => {
    const tree = createDemoTree();
    const result = countInBook(tree, '沈雨晴');

    expect(result.total).toBe(4);
    expect(result.byNode).toEqual([
      { nodeId: 'ch-1', nodeTitle: '第一章　海潮來信', count: 1 },
      { nodeId: 'ch-2', nodeTitle: '第二章　燈塔守衛', count: 1 },
      { nodeId: 'sc-1', nodeTitle: '幕 1　迴旋梯', count: 1 },
      { nodeId: 'ch-3', nodeTitle: '第三章　晨曦初現', count: 1 },
    ]);
    expect(result.countsByNodeId).toEqual({
      'ch-1': 1,
      'ch-2': 1,
      'sc-1': 1,
      'ch-3': 1,
    });
  });

  it('搭配 nodeIds 範圍篩選', () => {
    const tree = createDemoTree();
    const result = countInBook(tree, '沈雨晴', { nodeIds: ['ch-2'] });

    expect(result.total).toBe(2);
    expect(result.byNode).toHaveLength(2);
    expect(result.countsByNodeId).toEqual({
      'ch-2': 1,
      'sc-1': 1,
    });
  });

  it('空字串或純空白查詢：回傳 0 筆', () => {
    const tree = createDemoTree();
    expect(countInBook(tree, '')).toEqual({ total: 0, byNode: [], countsByNodeId: {} });
    expect(countInBook(tree, '   ')).toEqual({ total: 0, byNode: [], countsByNodeId: {} });
  });

  it('無匹配字詞時回傳 0 筆', () => {
    const tree = createDemoTree();
    const result = countInBook(tree, '不存在的詞');
    expect(result.total).toBe(0);
    expect(result.byNode).toEqual([]);
    expect(result.countsByNodeId).toEqual({});
  });
});

describe('單筆取代 replaceOne', () => {
  it('成功取代單一命中項目，並回傳新樹（不可變更新）', () => {
    const tree = createDemoTree();
    const hits = findInBook(tree, '沈雨晴');
    const firstHit = hits[0]; // ch-1

    const res = replaceOne(tree, firstHit, '陳沐光');
    expect(res.ok).toBe(true);

    // 檢查目標節點正文已被取代
    const updatedCh1 = res.nodes[0].children?.[0];
    expect(updatedCh1?.content).toContain('陳沐光在石階上看著渡輪靠岸');
    expect(updatedCh1?.content).not.toContain('沈雨晴');

    // 驗證原樹未受任何修改（不可變性）
    expect(tree[0].children?.[0].content).toContain('沈雨晴在石階上看著渡輪靠岸');

    // 驗證未修改的節點維持 === 物件參照相等
    expect(res.nodes[0].children?.[1]).toBe(tree[0].children?.[1]); // ch-2 未改動
    expect(res.nodes[1]).toBe(tree[1]); // vol-2 未改動
  });

  it('若該筆位置文字已被改動（不再符合查詢字），ok=false 且不改任何東西', () => {
    const tree = createDemoTree();
    const hit: SearchHit = {
      nodeId: 'ch-1',
      nodeTitle: '第一章　海潮來信',
      path: ['第一卷　霧港之秋', '第一章　海潮來信'],
      start: 11,
      end: 14,
      before: '十月的霧港總是下雨。\n',
      match: '沈雨晴',
      after: '在石階上看著渡輪靠岸',
    };

    // 模擬已改動正文的樹
    const modifiedTree: ChapterNode[] = [
      {
        ...tree[0],
        children: [
          {
            ...tree[0].children![0],
            content: '十月的霧港總是下雨。\n林晚秋在石階上看著渡輪靠岸，信紙浸了水氣。',
          },
          tree[0].children![1],
        ],
      },
      tree[1],
    ];

    const res = replaceOne(modifiedTree, hit, '陳沐光');
    expect(res.ok).toBe(false);
    expect(res.nodes).toBe(modifiedTree); // 原樹參照原樣回傳
  });

  it('目標節點不存在或索引越界時防呆：ok=false 且原樹原樣回傳', () => {
    const tree = createDemoTree();
    const hitNonExist = { nodeId: 'ghost-node', start: 0, end: 3, match: 'abc' };
    const resNonExist = replaceOne(tree, hitNonExist, 'xyz');
    expect(resNonExist.ok).toBe(false);
    expect(resNonExist.nodes).toBe(tree);

    const hitOutOfBound = { nodeId: 'ch-1', start: 9999, end: 10005, match: 'abc' };
    const resOutOfBound = replaceOne(tree, hitOutOfBound, 'xyz');
    expect(resOutOfBound.ok).toBe(false);
    expect(resOutOfBound.nodes).toBe(tree);
  });

  it('取代成空字串（刪除字詞）要可以正常運作', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '範例章節',
        content: '霧港的舊燈塔矗立在海岬。',
      },
    ];

    const hit = findInBook(tree, '舊')[0];
    const res = replaceOne(tree, hit, '');
    expect(res.ok).toBe(true);
    expect(res.nodes[0].content).toBe('霧港的燈塔矗立在海岬。');
  });

  it('表情符號與多字元取代：不可切壞表情符號', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '範例章節',
        content: '港口有一隻🐱在曬太陽。',
      },
    ];

    const hit = findInBook(tree, '🐱')[0];
    const res = replaceOne(tree, hit, '🐶');
    expect(res.ok).toBe(true);
    expect(res.nodes[0].content).toBe('港口有一隻🐶在曬太陽。');
  });

  it('換行格式 \\r\\n 與 \\n 原樣保留不被破壞', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '換行測試',
        content: '第一行\r\n沈雨晴走過。\n第三行結尾。',
      },
    ];

    const hit = findInBook(tree, '沈雨晴')[0];
    const res = replaceOne(tree, hit, '陳沐光');
    expect(res.ok).toBe(true);
    expect(res.nodes[0].content).toBe('第一行\r\n陳沐光走過。\n第三行結尾。');
  });
});

describe('全部取代 replaceAll', () => {
  it('全部取代多個節點中的字詞，回傳新樹、總次數與 changedNodeIds', () => {
    const tree = createDemoTree();
    const res = replaceAll(tree, '沈雨晴', '陳沐光');

    expect(res.count).toBe(4);
    expect(res.changedNodeIds).toEqual(['ch-1', 'ch-2', 'sc-1', 'ch-3']);

    // 檢查各節點是否皆已換掉
    const updatedCh1 = res.nodes[0].children?.[0];
    expect(updatedCh1?.content).toContain('陳沐光');
    expect(updatedCh1?.content).not.toContain('沈雨晴');

    const updatedCh2 = res.nodes[0].children?.[1];
    expect(updatedCh2?.content).toContain('陳沐光快步走向舊燈塔');

    const updatedSc1 = updatedCh2?.children?.[0];
    expect(updatedSc1?.content).toContain('陳沐光數著階數');

    const updatedCh3 = res.nodes[1].children?.[0];
    expect(updatedCh3?.content).toContain('陳沐光在碼頭等第一班客船');

    // 驗證原樹未受影響
    expect(tree[0].children?.[0].content).toContain('沈雨晴');
  });

  it('不可變更新：未改到的節點保留原物件參考，無改動時回傳原樹參考', () => {
    const tree = createDemoTree();

    // 針對單一幕進行全部取代
    const res = replaceAll(tree, '沈雨晴', '陳沐光', { nodeIds: ['sc-1'] });
    expect(res.count).toBe(1);
    expect(res.changedNodeIds).toEqual(['sc-1']);

    // sc-2、ch-1、vol-2 都沒有被改動，應完全保留原參照
    const ch2 = res.nodes[0].children?.[1];
    expect(ch2?.children?.[1]).toBe(tree[0].children?.[1].children?.[1]); // sc-2 原參照
    expect(res.nodes[0].children?.[0]).toBe(tree[0].children?.[0]); // ch-1 原參照
    expect(res.nodes[1]).toBe(tree[1]); // vol-2 原參照

    // 查無文字時，回傳完全相同的原樹參照
    const noChangeRes = replaceAll(tree, '不存在的名字', '任何名字');
    expect(noChangeRes.count).toBe(0);
    expect(noChangeRes.changedNodeIds).toEqual([]);
    expect(noChangeRes.nodes).toBe(tree);
  });

  it('取代後的文字又含查詢字時，不可無限迴圈，亦不可重複取代（把「貓」換成「瘦貓」）', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '重複取代範例',
        content: '港口有一隻貓，長階梯上還有一隻貓。',
      },
    ];

    const res = replaceAll(tree, '貓', '瘦貓');
    expect(res.count).toBe(2);
    expect(res.nodes[0].content).toBe('港口有一隻瘦貓，長階梯上還有一隻瘦貓。');
  });

  it('重疊情況：查「哈哈」在「哈哈哈」中計 1 次（不重疊、由左往右）', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '重疊範例',
        content: '船夫哈哈哈大笑。',
      },
    ];

    const res = replaceAll(tree, '哈哈', '嘻嘻');
    expect(res.count).toBe(1);
    expect(res.nodes[0].content).toBe('船夫嘻嘻哈大笑。');
  });

  it('不分大小寫時，replaceAll 只換到符合處，其餘文字大小寫保留原樣', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '大小寫範例',
        content: 'FOG in the city. The fog is thick and FOGGY.',
      },
    ];

    const res = replaceAll(tree, 'fog', 'MIST');
    expect(res.count).toBe(3);
    // 原始的 in the city, is thick and GY 保留其原本的大寫小寫
    expect(res.nodes[0].content).toBe('MIST in the city. The MIST is thick and MISTGY.');
  });

  it('取代成空字串（刪除所有匹配字詞）', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '刪除範例',
        content: '【草稿】沈雨晴在霧港。【草稿】信紙已濕。',
      },
    ];

    const res = replaceAll(tree, '【草稿】', '');
    expect(res.count).toBe(2);
    expect(res.nodes[0].content).toBe('沈雨晴在霧港。信紙已濕。');
  });

  it('空字串或只有空白的查詢：防呆不做任何事', () => {
    const tree = createDemoTree();
    const emptyRes = replaceAll(tree, '', '測試');
    expect(emptyRes.count).toBe(0);
    expect(emptyRes.changedNodeIds).toEqual([]);
    expect(emptyRes.nodes).toBe(tree);

    const spaceRes = replaceAll(tree, '   ', '測試');
    expect(spaceRes.count).toBe(0);
    expect(spaceRes.nodes).toBe(tree);
  });

  it('換行 \\r\\n 與 \\n 原樣保留不被破壞', () => {
    const tree: ChapterNode[] = [
      {
        id: 'c1',
        type: 'file',
        title: '換行測試',
        content: '第一行\r\n沈雨晴走過。\n沈雨晴回頭。\r\n第三行。',
      },
    ];

    const res = replaceAll(tree, '沈雨晴', '陳沐光');
    expect(res.count).toBe(2);
    expect(res.nodes[0].content).toBe('第一行\r\n陳沐光走過。\n陳沐光回頭。\r\n第三行。');
  });
});

describe('效能測試（工單規定：30 萬字、300 個節點於 1 秒內完成）', () => {
  it('一本 30 萬字、300 個節點的範例樹，findInBook 在 1 秒（1000ms）內完成', () => {
    // 產生 300 個節點，每個節點約 1,100 字，總計超過 30 萬字（約 33 萬字）
    const paragraphBase =
      '霧氣自霧港的港口緩緩爬上石階，路燈一盞接一盞亮起。沈雨晴把信紙摺成四折，塞進大衣口袋，想著明天要不要再去一趟燈塔。海浪拍打著防波堤，遠方傳來汽笛的長鳴。守塔人在塔頂擦拭透鏡，光束劃破濃霧照向海面。';
    // paragraphBase 約 100 字，重複 11 次約 1,100 字
    const nodeContent = Array.from({ length: 11 }, () => paragraphBase).join('\n');

    const bigTree: ChapterNode[] = [];
    const nodeCount = 300;

    for (let i = 1; i <= nodeCount; i += 1) {
      bigTree.push({
        id: `perf-node-${i}`,
        type: 'file',
        title: `第 ${i} 章　範例章節`,
        content: nodeContent,
      });
    }

    const totalChars = bigTree.reduce((sum, n) => sum + (n.content?.length ?? 0), 0);
    expect(totalChars).toBeGreaterThanOrEqual(300000);

    const startTime = performance.now();
    const hits = findInBook(bigTree, '沈雨晴');
    const duration = performance.now() - startTime;

    // 每個節點出現 11 次，300 個節點共 3,300 次
    expect(hits.length).toBe(3300);
    expect(duration).toBeLessThan(1000);
  });
});
