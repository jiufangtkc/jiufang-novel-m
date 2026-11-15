import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { countBodyWords, countBookWords, countWords } from './wordCount';
import { classifyTextDelta } from './writingLog';

/** 存檔再開自動測試用的兩段正文（qa/存檔再開/run.mjs），本章應為 28。 */
const P1 = '港口起霧，燈塔還看得見。';
const P2 = '她把舊地圖攤在桌上，等潮水退去。';

describe('WO-76 全 App 同一套字數（對齊 Word）', () => {
  it('WO-76：中文字與全形標點各算 1', () => {
    expect(countWords('霧港，有燈。')).toBe(6);
    expect(countWords('「走吧？」她說：「好！」、；')).toBe(14);
    expect(countWords(P1)).toBe(12);
    expect(countWords(P2)).toBe(16);
    expect(countWords(`${P1}\n${P2}`)).toBe(28);
  });

  it('WO-76：「……」「——」各算 2', () => {
    expect(countWords('……')).toBe(2);
    expect(countWords('——')).toBe(2);
    expect(countWords('他停了……又說——走。')).toBe(11);
  });

  it('WO-76：全形空白、半形空白、換行、空行都不算', () => {
    expect(countWords('　　霧港')).toBe(2);
    expect(countWords('霧 港\n紀事')).toBe(4);
    expect(countWords('霧港\n\n\n紀事\r\n\t')).toBe(4);
    expect(countWords('   \n　\n')).toBe(0);
    expect(countWords('')).toBe(0);
  });

  it('WO-76：英文一個單字算 1，不逐字母算', () => {
    expect(countWords('iPhone')).toBe(1);
    expect(countWords('OK')).toBe(1);
    expect(countWords('Hello 世界')).toBe(3);
    expect(countWords('她拿起iPhone說OK。')).toBe(7);
    expect(countWords('café')).toBe(1);
  });

  it('WO-76：一串阿拉伯數字整串算 1（含 3.5、1,000）', () => {
    expect(countWords('2026')).toBe(1);
    expect(countWords('3.5')).toBe(1);
    expect(countWords('1,000')).toBe(1);
    expect(countWords('2026年寫了3.5萬字')).toBe(7);
  });

  it('WO-76：半形標點夾在中文裡每個算 1，黏在英文單字上的不另算', () => {
    expect(countWords('他說,走吧.')).toBe(6);
    expect(countWords('等等...')).toBe(5);
    expect(countWords('OK, let\'s go.')).toBe(3);
    expect(countWords('OK, let’s go.')).toBe(3);
    expect(countWords('約12:30見')).toBe(3);
  });

  it('WO-76 第 1 輪必修：數字旁的半形標點不被吞掉，分開的數字不合算', () => {
    // 3、5 各算 1，中間的半形逗號不是千分位，算 1。
    expect(countWords('數量是3,價格是5。')).toBe(10);
    // 1、2、3 各算 1，兩個半形逗號各算 1，加上「她喊」與「！」。
    expect(countWords('她喊1,2,3！')).toBe(8);
    expect(countWords('1,2,3')).toBe(5);
  });

  it('WO-76 第 1 輪回歸：小數點、千分位、時間仍是數字內部', () => {
    expect(countWords('3.5')).toBe(1);
    expect(countWords('1,000')).toBe(1);
    expect(countWords('12:30')).toBe(1);
    expect(countWords('2026')).toBe(1);
    expect(countWords('1,000,000')).toBe(1);
    expect(countWords('約12:30見')).toBe(3);
    expect(countWords('霧散了，她說OK，潮位3.5米。')).toBe(13);
    expect(countWords('OK, let\'s go.')).toBe(3);
    expect(countWords('e-mail')).toBe(1);
    expect(countWords(`${P1}\n${P2}`)).toBe(28);
  });

  it('WO-76：增補字區與異體字選擇符不多算', () => {
    expect(countWords('𰻞')).toBe(1);
    expect(countWords('葛\u{E0100}')).toBe(1);
  });

  it('WO-76：本章不含章名，全書含卷章幕名稱', () => {
    const tree: ChapterNode[] = [
      {
        id: 'v',
        type: 'folder',
        title: '第一卷',
        children: [
          { id: 'c', type: 'file', title: '第一章', content: `${P1}\n${P2}` },
          { id: 's', type: 'scene', title: '夜', content: 'OK。' },
        ],
      },
    ];
    expect(countWords(tree[0]!.children![0]!.content!)).toBe(28);
    expect(countBookWords(tree)).toBe(3 + 3 + 28 + 1 + 2);
    expect(countBodyWords(tree[0]!)).toBe(30);
  });

  it('WO-76：接續打英文單字或小數時，今日增量不會逐字母累加', () => {
    let before = '她買了';
    let total = 0;
    for (const next of ['她買了i', '她買了iP', '她買了iPh', '她買了iPhone', '她買了iPhone。']) {
      total += classifyTextDelta(before, next, { source: 'type' }).wordDelta;
      before = next;
    }
    // 打進來的是「iPhone」與「。」：各算 1，共 2
    expect(total).toBe(countWords('她買了iPhone。') - countWords('她買了'));
    expect(total).toBe(2);

    before = '漲了';
    total = 0;
    for (const next of ['漲了3', '漲了3.', '漲了3.5', '漲了3.5%']) {
      total += classifyTextDelta(before, next, { source: 'type' }).wordDelta;
      before = next;
    }
    // 打進來的是「3.5%」：3.5 整串算 1；「%」不是小數點、千分位或時間內部符號，依定案另算 1（WO-76 第 1 輪必修後）
    expect(total).toBe(countWords('漲了3.5%') - countWords('漲了'));
    expect(total).toBe(2);
  });

  it('WO-76：在段落中間改字，增量等於整章前後字數相減', () => {
    const before = `${P1}\n${P2}\nHello world 2026`;
    const after = `${P1}\n她把新的iPhone攤在桌上，等潮水退去。\nHello world 2026`;
    expect(classifyTextDelta(before, after).wordDelta).toBe(countWords(after) - countWords(before));
    expect(classifyTextDelta(after, before).wordDelta).toBe(countWords(before) - countWords(after));
  });
});
