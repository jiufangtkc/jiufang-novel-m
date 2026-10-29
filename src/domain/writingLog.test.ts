import { describe, expect, it } from 'vitest';
import { countWords } from './wordCount';
import {
  applyLargeEvent,
  classifyTextDelta,
  emptyWritingLog,
  formatDuration,
  LARGE_TEXT_THRESHOLD,
} from './writingLog';

const paragraph =
  '【範例】第一章 第 1 段：霧氣自港口緩緩爬上石階，路燈一盞接一盞亮起。她把信紙摺成四折，塞進大衣口袋，想著明天要不要再去一趟燈塔。';

describe('字數', () => {
  it('空白與換行不算，標點算，一個字算一個', () => {
    expect(countWords('霧 港\n紀事')).toBe(4);
    expect(countWords(paragraph)).toBe(countWords(paragraph.replace(/\s+/gu, '')));
    expect(countWords(`${paragraph}\n\n${paragraph}`)).toBe(countWords(paragraph) * 2);
  });

  it('增補字區的一個字只算一個', () => {
    expect(countWords('𰻞')).toBe(1);
  });
});

describe('大量文字', () => {
  it('一次貼上超過門檻就記一次，打字的小變更不記', () => {
    const pasted = '示'.repeat(LARGE_TEXT_THRESHOLD);
    const delta = classifyTextDelta('原本。', `原本。${pasted}`, { source: 'paste' });
    expect(delta.largeInsert).toBe(true);
    expect(delta.wordDelta).toBe(LARGE_TEXT_THRESHOLD);
    expect(classifyTextDelta('原本。', '原本。好', { source: 'type' }).largeInsert).toBe(false);
  });

  it('組字送出長詞不算大量貼上', () => {
    const phrase = '示'.repeat(LARGE_TEXT_THRESHOLD);
    const delta = classifyTextDelta('', phrase, { source: 'composition' });
    expect(delta.largeInsert).toBe(false);
    expect(delta.wordDelta).toBe(LARGE_TEXT_THRESHOLD);
  });

  it('一次刪掉超過門檻就記大量刪除', () => {
    const text = '示'.repeat(80);
    const delta = classifyTextDelta(text, '示'.repeat(10), { source: 'type' });
    expect(delta.largeDelete).toBe(true);
    expect(delta.wordDelta).toBe(-70);
  });

  it('事件累加到當日那一列，欄位對得上電腦版', () => {
    let row = emptyWritingLog(1, '2026-10-29');
    row = applyLargeEvent(row, classifyTextDelta('', '示'.repeat(60), { source: 'paste' }));
    row = applyLargeEvent(row, classifyTextDelta('示'.repeat(60), '', { source: 'type' }));
    expect(row).toMatchObject({
      id: 1,
      date: '2026-10-29',
      paste_large_count: 1,
      delete_large_count: 1,
      ai_continuation_count: 0,
      ai_continuation_chars: 0,
      ai_chat_count: 0,
      ai_details: null,
    });
  });

  it('時間用臺灣說法', () => {
    expect(formatDuration(0)).toBe('0 分');
    expect(formatDuration(90)).toBe('1 分');
    expect(formatDuration(3600 + 120)).toBe('1 小時 2 分');
  });
});
