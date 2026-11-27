import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManuscriptVersionSheet } from '../components/ManuscriptVersionSheet';
import { VersionCompareView, resolveOpenCompareAttempt } from '../components/VersionCompareView';
import {
  VERSION_COMPARE_BUTTON,
  VERSION_COMPARE_COMPOSING_TOAST,
  VERSION_COMPARE_NO_DIFF_HINT,
  VERSION_COMPARE_TITLE,
  versionCompareCollapsedLabel,
  versionCompareSummary,
} from '../copy/manuscriptVersionCopy';
import { createManuscriptVersion } from '../domain/manuscriptVersions';
import { compareChapterVersions } from '../domain/versionCompare';
import { countWords, tokenizeWords } from '../domain/wordCount';

const SIMPLIFIED_CHARS = /[删暂记说这为没现还进时请标样选会备储复预关条满丢仅写显隐确认实体处个变对无损坏较资来]/u;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('WO-141：新舊版比較核心邏輯與介面驗證', () => {
  it('中文逐字比對：只改一個字也看得出來，並支援代理對與全形標點', () => {
    const oldText = '【範例】霧港的鐘聲敲了三下，他望向海面。';
    const currentText = '【範例】霧港的鐘聲敲了五下，他望向遠方海面。';
    const diff = compareChapterVersions(oldText, currentText);

    expect(diff.hasChanges).toBe(true);
    expect(diff.changedParagraphs).toBe(1);
    expect(diff.removedWords).toBe(countWords('三'));
    expect(diff.addedWords).toBe(countWords('五') + countWords('遠方'));
    expect(diff.paragraphs).toHaveLength(1);

    const segs = diff.paragraphs[0]!.segments;
    expect(segs).toEqual([
      { kind: 'equal', text: '【範例】霧港的鐘聲敲了' },
      { kind: 'remove', text: '三' },
      { kind: 'add', text: '五' },
      { kind: 'equal', text: '下，他望向' },
      { kind: 'add', text: '遠方' },
      { kind: 'equal', text: '海面。' },
    ]);

    // Unicode 代理對（例如𠀀）不拆半字元
    const emojiDiff = compareChapterVersions('【範例】古字𠀀保留', '【範例】古字𠀁保留');
    expect(emojiDiff.paragraphs[0]!.segments).toEqual([
      { kind: 'equal', text: '【範例】古字' },
      { kind: 'remove', text: '𠀀' },
      { kind: 'add', text: '𠀁' },
      { kind: 'equal', text: '保留' },
    ]);
  });

  it('【範例】稿驗證：改幾個字、刪一段、加一段，標記與小結數字（含英文與數字以 countWords 計算）完全正確', () => {
    const oldDraft = [
      '【範例】第一段開頭沒有改動，海風吹過石階。',
      '【範例】第二段寫他拎著 1988 年的舊皮箱走進霧港。',
      '【範例】這一段在改稿後會整段被刪掉。',
      '【範例】第四段留在最後收尾。',
    ].join('\n');

    const currentDraft = [
      '【範例】第一段開頭沒有改動，海風吹過石階。',
      '【範例】第二段寫他拎著 1995 年的舊皮箱慢慢走進霧港。',
      '【範例】第四段留在最後收尾。',
      '【範例】這是改稿後新加上的結尾段落。',
    ].join('\n');

    const diff = compareChapterVersions(oldDraft, currentDraft);
    expect(diff.hasChanges).toBe(true);
    // 改 1 段（第二段）+ 刪 1 段（第三段）+ 加 1 段（新結尾）= 3 段
    expect(diff.changedParagraphs).toBe(3);

    const expectedRemoved =
      countWords('1988') + countWords('【範例】這一段在改稿後會整段被刪掉。');
    const expectedAdded =
      countWords('1995') + countWords('慢慢') + countWords('【範例】這是改稿後新加上的結尾段落。');

    expect(diff.removedWords).toBe(expectedRemoved);
    expect(diff.addedWords).toBe(expectedAdded);
    expect(versionCompareSummary(diff.addedWords, diff.removedWords, diff.changedParagraphs)).toBe(
      `比這一版多了 ${expectedAdded} 字、少了 ${expectedRemoved} 字，改了 3 段`,
    );

    // 含空行分段（\n\n）時，空行不應灌水段數
    const spacedOld = '【範例】甲段\n\n【範例】乙段\n\n【範例】丙段';
    const spacedNew = '【範例】甲段\n\n【範例】乙段改寫\n\n【範例】丙段';
    const spacedDiff = compareChapterVersions(spacedOld, spacedNew);
    expect(spacedDiff.changedParagraphs).toBe(1);
  });

  it('連續沒改的段落收成「中間 N 段沒改，點一下展開」，前後各留一段上下文不收進折疊，點一下展開原文', () => {
    const oldParagraphs = Array.from({ length: 12 }, (_, idx) => `【範例】第 ${idx + 1} 段內容。`);
    const currentParagraphs = [...oldParagraphs];
    // 只改第 5 段（index 4）與第 11 段（index 10）
    currentParagraphs[4] = '【範例】第 5 段改寫後的內容。';
    currentParagraphs[10] = '【範例】第 11 段補上新描寫。';

    const diff = compareChapterVersions(oldParagraphs.join('\n'), currentParagraphs.join('\n'));
    expect(diff.changedParagraphs).toBe(2);

    // 應呈現：
    // - 0..2（3 段未改）→ collapsed-1 (3 段)
    // - 3（前上下文）、4（修改）、5（後上下文）
    // - 6..8（3 段未改）→ collapsed-2 (3 段)
    // - 9（前上下文）、10（修改）、11（後上下文）
    expect(diff.displayItems).toHaveLength(8);
    const firstCollapsed = diff.displayItems[0]!;
    expect(firstCollapsed.type).toBe('collapsed');
    if (firstCollapsed.type === 'collapsed') {
      expect(firstCollapsed.hiddenParagraphCount).toBe(3);
      expect(versionCompareCollapsedLabel(firstCollapsed.hiddenParagraphCount)).toBe(
        '中間 3 段沒改，點一下展開',
      );
      expect(firstCollapsed.paragraphs.map((p) => p.segments[0]?.text)).toEqual([
        '【範例】第 1 段內容。',
        '【範例】第 2 段內容。',
        '【範例】第 3 段內容。',
      ]);
    }
    // 確認上下文第 4 段（index 3）未被收進折疊
    expect(diff.displayItems[1]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'unchanged', segments: [{ kind: 'equal', text: '【範例】第 4 段內容。' }] },
    });

    const version = createManuscriptVersion({
      version_id: 'ver-collapse-1',
      chapter_id: 'ch-1',
      chapter_title_snapshot: '【範例】第一章',
      content: oldParagraphs.join('\n'),
      note: '改稿前',
      saved_at_ms: new Date(2026, 10, 27, 9, 0).getTime(),
    });

    // 展開前：看得到「中間 3 段沒改，點一下展開」，看不到第 1 段原文
    const beforeExpandHtml = renderToStaticMarkup(
      createElement(VersionCompareView, {
        version,
        versionTimeLabel: '2026-11-27 09:00',
        diff,
        expandedBlockIds: new Set<string>(),
        onExpandBlock: () => undefined,
      }),
    );
    expect(beforeExpandHtml).toContain('data-testid="version-compare-collapsed-collapsed-1"');
    expect(beforeExpandHtml).toContain('中間 3 段沒改，點一下展開');
    expect(beforeExpandHtml).not.toContain('【範例】第 1 段內容。');
    expect(beforeExpandHtml).toContain('【範例】第 4 段內容。');

    // 展開第一組後：看得到第 1~3 段原文，且不影響第二組收合
    const afterExpandHtml = renderToStaticMarkup(
      createElement(VersionCompareView, {
        version,
        versionTimeLabel: '2026-11-27 09:00',
        diff,
        expandedBlockIds: new Set(['collapsed-1']),
        onExpandBlock: () => undefined,
      }),
    );
    expect(afterExpandHtml).toContain('data-testid="version-compare-expanded-collapsed-1"');
    expect(afterExpandHtml).toContain('【範例】第 1 段內容。');
    expect(afterExpandHtml).toContain('【範例】第 3 段內容。');
    expect(afterExpandHtml).toContain('data-testid="version-compare-collapsed-collapsed-2"');

    // 開頭／結尾不足一段上下文時直接留現有；兩段變更中間只隔 1~2 段未改時不產生折疊
    const tightDiff = compareChapterVersions(
      ['【範例】首段修改前', '【範例】中段未改', '【範例】尾段修改前'].join('\n'),
      ['【範例】首段修改後', '【範例】中段未改', '【範例】尾段修改後'].join('\n'),
    );
    expect(tightDiff.displayItems.every((item) => item.type === 'paragraph')).toBe(true);
  });

  it('內容完全相同時不收合並顯示無差異提示，且比較畫面完全唯讀（無輸入框）', () => {
    const text = '【範例】第一段\n【範例】第二段\n【範例】第三段';
    const diff = compareChapterVersions(text, text);
    expect(diff.hasChanges).toBe(false);
    expect(diff.addedWords).toBe(0);
    expect(diff.removedWords).toBe(0);
    expect(diff.changedParagraphs).toBe(0);
    expect(diff.displayItems).toHaveLength(3);

    const version = createManuscriptVersion({
      version_id: 'ver-same',
      chapter_id: 'ch-1',
      chapter_title_snapshot: '【範例】第一章',
      content: text,
      note: '',
      saved_at_ms: new Date(2026, 10, 27, 9, 5).getTime(),
    });
    const html = renderToStaticMarkup(
      createElement(VersionCompareView, {
        version,
        versionTimeLabel: '2026-11-27 09:05',
        diff,
        expandedBlockIds: new Set<string>(),
        onExpandBlock: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="version-compare-no-diff"');
    expect(html).toContain(VERSION_COMPARE_NO_DIFF_HINT);
    expect(html).not.toMatch(/<textarea|<input|contenteditable/i);
  });

  it('版本清單每份旁邊有「比較」按鈕；正在輸入注音（isComposing）時按「比較」會提示且不打開比較頁', () => {
    expect(resolveOpenCompareAttempt(() => true)).toEqual({
      allowed: false,
      message: VERSION_COMPARE_COMPOSING_TOAST,
    });
    expect(resolveOpenCompareAttempt(() => false)).toEqual({ allowed: true });

    const v1 = createManuscriptVersion({
      version_id: 'ver-list-1',
      chapter_id: 'ch-1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】舊版文字',
      note: '備註一',
      saved_at_ms: new Date(2026, 10, 27, 9, 10).getTime(),
    });
    const v2 = createManuscriptVersion({
      version_id: 'ver-list-2',
      chapter_id: 'ch-1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】更早舊版',
      note: '',
      saved_at_ms: new Date(2026, 10, 27, 9, 0).getTime(),
    });

    const listHtml = renderToStaticMarkup(
      createElement(ManuscriptVersionSheet, {
        open: true,
        projectId: 'p-1',
        chapterId: 'ch-1',
        chapterTitle: '【範例】第一章',
        versions: [v1, v2],
        versionRead: { kind: 'ok', revision: 1, versions: [v1, v2] },
        layoutMode: 'phone-portrait',
        isComposing: () => false,
        getCurrentContent: () => '【範例】現在文字',
        onClose: () => undefined,
        onSaveVersion: async () => ({ kind: 'saved', noticeCode: 'saved' }) as const,
        onUpdateNote: async () => ({ kind: 'updated' }) as const,
        onDiscard: async () => ({ kind: 'discarded' }) as const,
        onUndoDiscard: async () => ({ kind: 'restored' }) as const,
        onRestoreVersion: async () => ({ status: 'no-target' }) as const,
      }),
    );

    expect(listHtml).toContain('data-testid="version-compare-btn-ver-list-1"');
    expect(listHtml).toContain('data-testid="version-compare-btn-ver-list-2"');
    expect(listHtml).toContain(`>${VERSION_COMPARE_BUTTON}<`);

    // 確認 VersionCompareView.tsx 註解外不硬寫中文或全形標點，且新文案無簡體字
    const compareViewSrc = stripComments(
      readFileSync(new URL('../components/VersionCompareView.tsx', import.meta.url), 'utf8'),
    );
    expect(compareViewSrc).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    expect(compareViewSrc).toContain("from '../copy/manuscriptVersionCopy'");
    expect(VERSION_COMPARE_TITLE).not.toMatch(SIMPLIFIED_CHARS);
    expect(VERSION_COMPARE_COMPOSING_TOAST).not.toMatch(SIMPLIFIED_CHARS);
  });

  it('約 2 萬字長章比較效能：多段長章與無換行長段皆在可接受時間（< 500ms）內完成', () => {
    const basePara = '【範例】霧港的夜風從防波堤吹過來，路燈在水面上拉出長長的光影，船塢的鐵鍊輕輕晃動著，遠方傳來模糊的汽笛聲與潮水拍岸的節奏。';
    const oldLines = Array.from({ length: 340 }, (_, i) => `第${i + 1}段：${basePara}`);
    const newLines = [...oldLines];
    // 改 6 段、刪 1 段、加 1 段（總字數超過 2 萬字）
    newLines[10] = `第11段：${basePara.replace('霧港', '晴港').replace('汽笛聲', '鐘聲')}`;
    newLines[55] = `第56段：${basePara.replace('防波堤', '木棧道')}`;
    newLines[120] = `第121段：${basePara}這一段多補寫了一句人物心境。`;
    newLines[190] = `第191段：${basePara.replace('路燈', '漁火')}`;
    newLines.splice(220, 1); // 刪一段
    newLines.splice(250, 0, `【範例】新增段落：${basePara}`); // 加一段

    const oldChapter = oldLines.join('\n');
    const newChapter = newLines.join('\n');
    expect(countWords(oldChapter)).toBeGreaterThan(20_000);

    const t0 = performance.now();
    const result = compareChapterVersions(oldChapter, newChapter);
    const elapsedMs = performance.now() - t0;

    expect(result.changedParagraphs).toBe(6);
    expect(result.addedWords).toBeGreaterThan(0);
    expect(result.removedWords).toBeGreaterThan(0);
    expect(result.displayItems.some((item) => item.type === 'collapsed')).toBe(true);
    expect(elapsedMs).toBeLessThan(500);

    // 單段無換行約 2 萬字散布修改（含字元級 Myers 與上限保護）
    const singleLongOld = '【範例】' + '霧港夜色深沉船隻緩緩進港燈火微弱'.repeat(1250);
    const singleLongNew =
      singleLongOld.slice(0, 4000) +
      '這裡改寫了幾個字' +
      singleLongOld.slice(4008, 15000) +
      '又加上一段描寫' +
      singleLongOld.slice(15000);
    expect(countWords(singleLongOld)).toBeGreaterThan(20_000);

    const t1 = performance.now();
    const singleResult = compareChapterVersions(singleLongOld, singleLongNew);
    const singleElapsedMs = performance.now() - t1;

    expect(singleResult.hasChanges).toBe(true);
    expect(singleResult.changedParagraphs).toBe(1);
    expect(singleElapsedMs).toBeLessThan(500);
  });

  it('返工必修 1：【範例】一般分段（按 Enter）、兩段併一段，以及連續多段刪舊改小，未改字皆保留為相同', () => {
    // 1. 一段中間按一次 Enter 分兩段，正文一字未改
    const singlePara = '【範例】霧港的夜風從防波堤吹過來，路燈在水面上拉出長長的光影。';
    const splitOnce = '【範例】霧港的夜風從防波堤吹過來，\n路燈在水面上拉出長長的光影。';
    const splitOnceDiff = compareChapterVersions(singlePara, splitOnce);

    expect(splitOnceDiff.hasChanges).toBe(true);
    expect(splitOnceDiff.changedParagraphs).toBe(1);
    expect(splitOnceDiff.addedWords).toBe(0);
    expect(splitOnceDiff.removedWords).toBe(0);
    expect(splitOnceDiff.paragraphs).toHaveLength(1);
    expect(splitOnceDiff.paragraphs[0]!.kind).toBe('modified');
    expect(splitOnceDiff.paragraphs[0]!.segments).toEqual([
      { kind: 'equal', text: '【範例】霧港的夜風從防波堤吹過來，' },
      { kind: 'add', text: '\n' },
      { kind: 'equal', text: '路燈在水面上拉出長長的光影。' },
    ]);

    // 2. 一段中間按兩次 Enter（含空行）分兩段，並且分段同時微調一字
    const splitDoubleAndEdit = '【範例】霧港的夜風從防波堤吹過來，\n\n路燈在海面上拉出長長的光影。';
    const splitDoubleDiff = compareChapterVersions(singlePara, splitDoubleAndEdit);

    expect(splitDoubleDiff.hasChanges).toBe(true);
    expect(splitDoubleDiff.changedParagraphs).toBe(1);
    expect(splitDoubleDiff.removedWords).toBe(countWords('水'));
    expect(splitDoubleDiff.addedWords).toBe(countWords('海'));
    expect(splitDoubleDiff.paragraphs[0]!.segments).toEqual([
      { kind: 'equal', text: '【範例】霧港的夜風從防波堤吹過來，' },
      { kind: 'add', text: '\n\n' },
      { kind: 'equal', text: '路燈在' },
      { kind: 'remove', text: '水' },
      { kind: 'add', text: '海' },
      { kind: 'equal', text: '面上拉出長長的光影。' },
    ]);

    // 3. 兩段併成一段（含刪單換行與刪空行合併）
    const mergeSingleDiff = compareChapterVersions(splitOnce, singlePara);
    expect(mergeSingleDiff.hasChanges).toBe(true);
    expect(mergeSingleDiff.changedParagraphs).toBe(1);
    expect(mergeSingleDiff.addedWords).toBe(0);
    expect(mergeSingleDiff.removedWords).toBe(0);
    expect(mergeSingleDiff.paragraphs[0]!.segments).toEqual([
      { kind: 'equal', text: '【範例】霧港的夜風從防波堤吹過來，' },
      { kind: 'remove', text: '\n' },
      { kind: 'equal', text: '路燈在水面上拉出長長的光影。' },
    ]);

    const mergeBlankOld = '【範例】霧港的鐘聲響了，\n\n他轉身走進巷口。';
    const mergeBlankNew = '【範例】霧港的鐘聲響了，他轉身走進巷口。';
    const mergeBlankDiff = compareChapterVersions(mergeBlankOld, mergeBlankNew);
    expect(mergeBlankDiff.addedWords).toBe(0);
    expect(mergeBlankDiff.removedWords).toBe(0);
    expect(mergeBlankDiff.paragraphs[0]!.segments).toEqual([
      { kind: 'equal', text: '【範例】霧港的鐘聲響了，' },
      { kind: 'remove', text: '\n\n' },
      { kind: 'equal', text: '他轉身走進巷口。' },
    ]);

    // 4. 連續九段（9×8 > 64）：刪掉開頭一段題材不同的舊段，其餘八段各改一字，前後留相同段落作邊界
    const oldNine = [
      '【範例】序幕未改的海岸線。',
      '【範例】舊題材實驗室的儀表板閃著冷光，完全與港口無關。',
      '【範例】第一段漁船靠岸時甲板還在滴水。',
      '【範例】第二段麵包師傅拉起店門的鐵捲門。',
      '【範例】第三段燈塔守沿著石階慢慢往下走。',
      '【範例】第四段貨車司機在清單劃掉木箱數。',
      '【範例】第五段港務局牆面貼滿了潮汐預報。',
      '【範例】第六段郵局後門傳來腳踏車的鈴聲。',
      '【範例】第七段紅屋頂在晨霧裡慢慢浮現輪廓。',
      '【範例】第八段風鈴在木門被推開時輕輕作響。',
      '【範例】尾聲未改的防波堤。',
    ];
    const newEight = [
      '【範例】序幕未改的海岸線。',
      '【範例】第一段漁船靠岸時甲板還在滲水。',
      '【範例】第二段麵包師傅拉起店門的鋁捲門。',
      '【範例】第三段燈塔守沿著木階慢慢往下走。',
      '【範例】第四段貨車司機在清單劃掉紙箱數。',
      '【範例】第五段港務局牆面貼滿了波汐預報。',
      '【範例】第六段郵局後門傳來腳踏車的響聲。',
      '【範例】第七段紅屋頂在晨光裡慢慢浮現輪廓。',
      '【範例】第八段風鈴在鐵門被推開時輕輕作響。',
      '【範例】尾聲未改的防波堤。',
    ];
    const nineByEightDiff = compareChapterVersions(oldNine.join('\n'), newEight.join('\n'));
    const removedParas = nineByEightDiff.paragraphs.filter((p) => p.kind === 'removed');
    const modifiedParas = nineByEightDiff.paragraphs.filter((p) => p.kind === 'modified');
    const addedParas = nineByEightDiff.paragraphs.filter((p) => p.kind === 'added');

    expect(removedParas).toHaveLength(1);
    expect(modifiedParas).toHaveLength(8);
    expect(addedParas).toHaveLength(0);
    expect(nineByEightDiff.changedParagraphs).toBe(9);
    expect(nineByEightDiff.removedWords).toBe(countWords(oldNine[1]!) + 8);
    expect(nineByEightDiff.addedWords).toBe(8);

    // 5. 連續二十段刪 1 改 19（20×19）同樣正確保序配對
    const oldTwenty = [
      '【範例】開場邊界未改。',
      '【範例】舊段待刪：火箭引擎點火測試資料與太空軌道計算。',
      ...Array.from({ length: 19 }, (_, idx) => `【範例】第 ${idx + 1} 段霧港的碼頭清晨停著一艘木船。`),
      '【範例】結尾邊界未改。',
    ];
    const newNineteen = [
      '【範例】開場邊界未改。',
      ...Array.from({ length: 19 }, (_, idx) => `【範例】第 ${idx + 1} 段霧港的碼頭清晨停著兩艘木船。`),
      '【範例】結尾邊界未改。',
    ];
    const twentyDiff = compareChapterVersions(oldTwenty.join('\n'), newNineteen.join('\n'));
    expect(twentyDiff.paragraphs.filter((p) => p.kind === 'removed')).toHaveLength(1);
    expect(twentyDiff.paragraphs.filter((p) => p.kind === 'modified')).toHaveLength(19);
    expect(twentyDiff.paragraphs.filter((p) => p.kind === 'added')).toHaveLength(0);
    expect(twentyDiff.changedParagraphs).toBe(20);
  });

  it('返工必修 2：【範例】小結字數嚴格符合既有 countWords 規則，不把排除的半形標點多算一字', () => {
    const cases = [
      {
        oldText: '【範例】他說 OK',
        newText: '【範例】他說 OK,',
        expectedAdded: 0,
        expectedRemoved: 0,
      },
      {
        oldText: '【範例】他說 OK',
        newText: '【範例】他說 (OK)!',
        expectedAdded: 0,
        expectedRemoved: 0,
      },
      {
        oldText: '【範例】他說 OK',
        newText: '【範例】他說 OK，',
        expectedAdded: 1,
        expectedRemoved: 0,
      },
      {
        oldText: '【範例】他說 OK',
        newText: '【範例】他說 OK, 沒問題',
        expectedAdded: 3,
        expectedRemoved: 0,
      },
      {
        oldText: '【範例】價格 3',
        newText: '【範例】價格 3,',
        expectedAdded: 1,
        expectedRemoved: 0,
      },
    ];

    for (const tc of cases) {
      const diff = compareChapterVersions(tc.oldText, tc.newText);
      expect(diff.hasChanges).toBe(true);
      expect(diff.changedParagraphs).toBe(1);
      expect(diff.addedWords).toBe(tc.expectedAdded);
      expect(diff.removedWords).toBe(tc.expectedRemoved);
      expect(countWords(tc.oldText) - diff.removedWords + diff.addedWords).toBe(countWords(tc.newText));
    }

    // 確認「他說 OK」→「他說 OK,」在畫面上仍標出新增的逗號，只是小結不計字數
    const commaDiff = compareChapterVersions('【範例】他說 OK', '【範例】他說 OK,');
    expect(commaDiff.paragraphs[0]!.segments).toEqual([
      { kind: 'equal', text: '【範例】他說 OK' },
      { kind: 'add', text: ',' },
    ]);

    // 確認 tokenizeWords 與 countWords 在各種中英數標點混排下詞元數完全一致
    const samples = [
      '【範例】他說 OK, (let’s go) 2026 年 1,000 元與 3.5 倍、12:30 到站！',
      '【範例】COVID-19 與 e-mail 在 1,2,3 之間，價格 3, 元。',
    ];
    for (const s of samples) {
      expect(tokenizeWords(s)).toHaveLength(countWords(s));
    }
  });

  it('返工必修 3：【範例】改處旁新增或刪除空行時，仍保留前後各一段非空未改上下文', () => {
    // 1. 第三段前按 Enter 多一個空行，且改第三段一字；第一、二、四、五段維持原樣
    const oldLines = [
      '【範例】第一段維持原樣。',
      '【範例】第二段維持原樣。',
      '【範例】第三段原本的字。',
      '【範例】第四段維持原樣。',
      '【範例】第五段維持原樣。',
    ];
    const newLinesWithBlank = [
      '【範例】第一段維持原樣。',
      '【範例】第二段維持原樣。',
      '',
      '【範例】第三段修改的字。',
      '【範例】第四段維持原樣。',
      '【範例】第五段維持原樣。',
    ];
    const addedBlankDiff = compareChapterVersions(oldLines.join('\n'), newLinesWithBlank.join('\n'));
    expect(addedBlankDiff.displayItems).toHaveLength(6);
    expect(addedBlankDiff.displayItems[0]).toMatchObject({
      type: 'collapsed',
      hiddenParagraphCount: 1,
    });
    expect(addedBlankDiff.displayItems[1]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'unchanged', segments: [{ kind: 'equal', text: '【範例】第二段維持原樣。' }] },
    });
    expect(addedBlankDiff.displayItems[2]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'added', isBlank: true },
    });
    expect(addedBlankDiff.displayItems[3]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'modified' },
    });
    expect(addedBlankDiff.displayItems[4]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'unchanged', segments: [{ kind: 'equal', text: '【範例】第四段維持原樣。' }] },
    });
    expect(addedBlankDiff.displayItems[5]).toMatchObject({
      type: 'collapsed',
      hiddenParagraphCount: 1,
    });

    // 2. 改處前後原有空行被刪除時，緊鄰空行外的前後非空未改段落同樣保留顯示
    const oldWithBlanks = [
      '【範例】第一段維持原樣。',
      '【範例】第二段維持原樣。',
      '',
      '【範例】第三段原本的字。',
      '',
      '【範例】第四段維持原樣。',
      '【範例】第五段維持原樣。',
    ];
    const newWithoutBlanks = [
      '【範例】第一段維持原樣。',
      '【範例】第二段維持原樣。',
      '【範例】第三段修改的字。',
      '【範例】第四段維持原樣。',
      '【範例】第五段維持原樣。',
    ];
    const removedBlankDiff = compareChapterVersions(oldWithBlanks.join('\n'), newWithoutBlanks.join('\n'));
    expect(removedBlankDiff.displayItems).toHaveLength(7);
    expect(removedBlankDiff.displayItems[0]).toMatchObject({
      type: 'collapsed',
      hiddenParagraphCount: 1,
    });
    expect(removedBlankDiff.displayItems[1]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'unchanged', segments: [{ kind: 'equal', text: '【範例】第二段維持原樣。' }] },
    });
    expect(removedBlankDiff.displayItems[2]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'removed', isBlank: true },
    });
    expect(removedBlankDiff.displayItems[3]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'modified' },
    });
    expect(removedBlankDiff.displayItems[4]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'removed', isBlank: true },
    });
    expect(removedBlankDiff.displayItems[5]).toMatchObject({
      type: 'paragraph',
      paragraph: { kind: 'unchanged', segments: [{ kind: 'equal', text: '【範例】第四段維持原樣。' }] },
    });
    expect(removedBlankDiff.displayItems[6]).toMatchObject({
      type: 'collapsed',
      hiddenParagraphCount: 1,
    });
  });

  it('返工 2 必修：【範例】跨段移句並各改一字時，小結計為改了 2 段且移句不誤標增刪', () => {
    // 1. 複審 1 指定【範例】：第一段末句移至第二段開頭，且兩段各有改字
    const oldMoveForward = '她推開門。雨聲停了。\n他放下書。';
    const newMoveForward = '她推開窗。\n雨聲停了。他放下筆。';
    const forwardDiff = compareChapterVersions(oldMoveForward, newMoveForward);

    expect(forwardDiff.hasChanges).toBe(true);
    expect(forwardDiff.changedParagraphs).toBe(2);
    expect(forwardDiff.removedWords).toBe(2);
    expect(forwardDiff.addedWords).toBe(2);
    expect(
      versionCompareSummary(forwardDiff.addedWords, forwardDiff.removedWords, forwardDiff.changedParagraphs),
    ).toBe('比這一版多了 2 字、少了 2 字，改了 2 段');
    expect(countWords(oldMoveForward) - forwardDiff.removedWords + forwardDiff.addedWords).toBe(
      countWords(newMoveForward),
    );
    const forwardSegments = forwardDiff.paragraphs.flatMap((p) => p.segments);
    expect(forwardSegments).toContainEqual({ kind: 'equal', text: '雨聲停了。' });
    expect(forwardSegments.some((s) => s.kind !== 'equal' && s.text.includes('雨聲停了'))).toBe(false);

    // 2. 反向跨段移句（第二段移至第一段）並各改一字
    const oldMoveBack = '她推開門。\n雨聲停了。他放下書。';
    const newMoveBack = '她推開窗。雨聲停了。\n他放下筆。';
    const backDiff = compareChapterVersions(oldMoveBack, newMoveBack);

    expect(backDiff.hasChanges).toBe(true);
    expect(backDiff.changedParagraphs).toBe(2);
    expect(backDiff.removedWords).toBe(2);
    expect(backDiff.addedWords).toBe(2);
    const backSegments = backDiff.paragraphs.flatMap((p) => p.segments);
    expect(backSegments).toContainEqual({ kind: 'equal', text: '雨聲停了。' });
    expect(backSegments.some((s) => s.kind !== 'equal' && s.text.includes('雨聲停了'))).toBe(false);

    // 3. 純跨段移句（不改字，兩段內容皆有變動）
    const oldPureMove = '她推開門。雨聲停了。\n他放下書。';
    const newPureMove = '她推開門。\n雨聲停了。他放下書。';
    const pureMoveDiff = compareChapterVersions(oldPureMove, newPureMove);

    expect(pureMoveDiff.hasChanges).toBe(true);
    expect(pureMoveDiff.changedParagraphs).toBe(2);
    expect(pureMoveDiff.removedWords).toBe(0);
    expect(pureMoveDiff.addedWords).toBe(0);
    const pureSegments = pureMoveDiff.paragraphs.flatMap((p) => p.segments);
    expect(pureSegments).toContainEqual({ kind: 'equal', text: '雨聲停了。' });

    // 4. 連續三段跨段移句並各改一字
    const oldThree = '甲推開門。雨聲停了。\n乙放下書。風吹進來。\n丙端起杯。';
    const newThree = '甲推開窗。\n雨聲停了。乙放下筆。\n風吹進來。丙端起碗。';
    const threeDiff = compareChapterVersions(oldThree, newThree);

    expect(threeDiff.hasChanges).toBe(true);
    expect(threeDiff.changedParagraphs).toBe(3);
    expect(threeDiff.removedWords).toBe(3);
    expect(threeDiff.addedWords).toBe(3);
  });
});
