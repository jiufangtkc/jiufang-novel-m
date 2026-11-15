import { describe, expect, it } from 'vitest';
import {
  applyHalfWidthMarks,
  caretAfterReplace,
  convertHalfWidthInChapter,
  findHalfWidthMarks,
  markAtCaret,
  shiftMarksForEdit,
} from './halfWidthPunct';

const texts = (text: string) => findHalfWidthMarks(text).map((mark) => text.slice(mark.start, mark.end));

describe('WO-76 乙段：哪些半形標點要提醒', () => {
  it('WO-76 乙段：中文字旁的 , . ? ! : ; 要提醒，並對應到全形', () => {
    const text = '他說,走吧.真的嗎?好!注意:先這樣;';
    const marks = findHalfWidthMarks(text);
    expect(marks.map((mark) => text.slice(mark.start, mark.end))).toEqual([',', '.', '?', '!', ':', ';']);
    expect(marks.map((mark) => mark.replacement)).toEqual(['，', '。', '？', '！', '：', '；']);
    expect(marks.map((mark) => mark.kind)).toEqual([
      'comma',
      'period',
      'question',
      'exclamation',
      'colon',
      'semicolon',
    ]);
  });

  it('WO-76 乙段：三個以上連續半形點號算一處，改成「……」', () => {
    expect(texts('她停了一下...才開口')).toEqual(['...']);
    expect(texts('然後呢.....')).toEqual(['.....']);
    const marks = findHalfWidthMarks('她停了一下...才開口');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.replacement).toBe('……');
    expect(marks[0]!.kind).toBe('ellipsis');
  });

  it('WO-76 乙段：數字內部、英文字句、網址、時間不提醒', () => {
    expect(texts('潮位3.5米')).toEqual([]);
    expect(texts('一共1,000元')).toEqual([]);
    expect(texts('一共1,000,000元')).toEqual([]);
    expect(texts('約12:30見')).toEqual([]);
    expect(texts('OK, let\'s go.')).toEqual([]);
    expect(texts('她說OK, let\'s go.')).toEqual([]);
    expect(texts('見https://example.com/a.b?x=1,y:2')).toEqual([]);
    expect(texts('到www.example.com.tw看看')).toEqual([]);
    expect(texts('霧散了，她說OK，潮位3.5米。')).toEqual([]);
  });

  it('WO-76 乙段：混合正文只挑中文旁的那幾個，不整章替換所有半形符號', () => {
    const text = '他說,約12:30見.價格1,000元,OK, let\'s go.網址https://a.tw/b.c,再說!';
    expect(texts(text)).toEqual([',', '.', ',', ',', '!']);
    const converted = convertHalfWidthInChapter(text, 0);
    expect(converted.text).toBe('他說，約12:30見。價格1,000元，OK, let\'s go.網址https://a.tw/b.c，再說！');
    expect(converted.count).toBe(5);
  });

  it('WO-76 乙段：全形標點與沒有半形標點的正文不提醒', () => {
    expect(texts('她把信紙摺成四折，塞進大衣口袋……「走吧！」')).toEqual([]);
    expect(texts('')).toEqual([]);
  });
});

describe('WO-76 乙段：改成全形後游標不亂跳', () => {
  it('WO-76 乙段：游標留在原本那個字旁邊，依替換長度位移', () => {
    const text = '好...他說,走吧.真的';
    // 游標在「吧」後面（句點前）
    const caret = text.indexOf('吧') + 1;
    const converted = convertHalfWidthInChapter(text, caret);
    expect(converted.text).toBe('好……他說，走吧。真的');
    expect(converted.text.slice(0, converted.caret)).toBe('好……他說，走吧');
    // 游標在句末
    const end = convertHalfWidthInChapter(text, text.length);
    expect(end.caret).toBe(end.text.length);
    // 游標在章首
    expect(convertHalfWidthInChapter(text, 0).caret).toBe(0);
  });

  it('WO-76 乙段：游標夾在連續點號中間時，放到換好的刪節號後面', () => {
    const text = '好...了';
    const marks = findHalfWidthMarks(text);
    expect(caretAfterReplace(marks, 2)).toBe(3);
    expect(applyHalfWidthMarks(text, marks, 2).text).toBe('好……了');
  });

  it('WO-76 乙段：小泡泡只改游標旁那一個', () => {
    const text = '他說,走吧.';
    const marks = findHalfWidthMarks(text);
    const mark = markAtCaret(marks, 3);
    expect(mark && text.slice(mark.start, mark.end)).toBe(',');
    const converted = applyHalfWidthMarks(text, [mark!], 3);
    expect(converted.text).toBe('他說，走吧.');
    expect(converted.caret).toBe(3);
    expect(markAtCaret(marks, 1)).toBeNull();
  });

  it('WO-76 乙段：打字中底線跟著平移，被改到的那個先拿掉', () => {
    const before = '他說,走吧.';
    const marks = findHalfWidthMarks(before);
    const after = '我和他說,走吧.';
    const shifted = shiftMarksForEdit(marks, before, after);
    expect(shifted.map((mark) => after.slice(mark.start, mark.end))).toEqual([',', '.']);
    const deleted = '他說走吧.';
    const kept = shiftMarksForEdit(marks, before, deleted);
    expect(kept.map((mark) => deleted.slice(mark.start, mark.end))).toEqual(['.']);
  });
});
