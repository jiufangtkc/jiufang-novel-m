import { describe, expect, it, vi } from 'vitest';
import {
  buildDictUrl,
  cleanSelection,
  dictButtonView,
  dictHintText,
  evaluateSelection,
} from './selectionRules';
import { pressDictLookup } from './dictLookup';
import { createDictSelectionTracker } from './selectionTracker';
import { DICT_OFFLINE_NOTICE, dictAriaLabel } from '../copy/dictionaryCopy';

describe('F-1 清理與可查判定', () => {
  it('「車票」可查，小字車票，網址正確', () => {
    const ev = evaluateSelection('車票');
    expect(ev).toEqual({ word: '車票', canLookup: true });
    expect(dictHintText(ev.word)).toBe('車票');
    expect(buildDictUrl(ev.word)).toBe(
      'https://dict.revised.moe.edu.tw/search.jsp?md=1&word=%E8%BB%8A%E7%A5%A8',
    );
  });

  it.each([' 車票 ', '　車票　', '「車票」', '車票。', '車票，\n', '\u00A0車票\u200B', '\uFEFF車票\t', '『車票』～', '~車票~', '車票\r\n', '車票\u2028'])(
    '%j 清理成車票',
    (raw) => {
      expect(cleanSelection(raw)).toBe('車票');
      expect(evaluateSelection(raw).canLookup).toBe(true);
    },
  );

  it.each(['，。', '　', '', ' \n\t', '\u200B\uFEFF', '～~', '…—·'])('%j 只有標點或空白不可查', (raw) => {
    expect(evaluateSelection(raw).canLookup).toBe(false);
  });

  it.each(['車\n票', '車票。\n「你」', '車\r票', '車\u2028票', '車\u2029票'])('%j 中間有換行不可查', (raw) => {
    expect(evaluateSelection(raw).canLookup).toBe(false);
  });

  it('10 字可查、11 字不可查，前後標點不計', () => {
    expect(evaluateSelection('一二三四五六七八九十').canLookup).toBe(true);
    expect(evaluateSelection('「一二三四五六七八九十」。').canLookup).toBe(true);
    expect(evaluateSelection('一二三四五六七八九十一').canLookup).toBe(false);
    expect(evaluateSelection('「一二三四五六七八九十一」').canLookup).toBe(false);
  });

  it('中間標點與空白保留並計字數，原樣送出', () => {
    const ev = evaluateSelection('月台上，燈');
    expect(ev).toEqual({ word: '月台上，燈', canLookup: true });
    expect(buildDictUrl(ev.word)).toContain(encodeURIComponent('月台上，燈'));
    expect(evaluateSelection('車　票').word).toBe('車　票');
  });

  it('台幣不變臺幣', () => {
    const ev = evaluateSelection('台幣');
    expect(ev.word).toBe('台幣');
    expect(buildDictUrl(ev.word)).toBe(
      'https://dict.revised.moe.edu.tw/search.jsp?md=1&word=' + encodeURIComponent('台幣'),
    );
    expect(buildDictUrl(ev.word)).not.toContain(encodeURIComponent('臺'));
  });

  it('表情符號與罕用字算 1 字', () => {
    expect(evaluateSelection('😀😀😀😀😀😀😀😀😀😀').canLookup).toBe(true);
    expect(evaluateSelection('😀😀😀😀😀😀😀😀😀😀😀').canLookup).toBe(false);
    expect(evaluateSelection('𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇𠀈𠀉').canLookup).toBe(true);
    expect(dictHintText('𠀀𠀁𠀂𠀃')).toBe('𠀀𠀁…');
  });

  it('組字中不可查，結束後重新判斷', () => {
    expect(evaluateSelection('車票', true).canLookup).toBe(false);
    expect(evaluateSelection('車票', false).canLookup).toBe(true);
  });
});

describe('小字與朗讀', () => {
  it('1～3 字全顯示，4 字以上前 2 字加全形刪節號', () => {
    expect(dictHintText('車')).toBe('車');
    expect(dictHintText('車票')).toBe('車票');
    expect(dictHintText('狐狸們')).toBe('狐狸們');
    expect(dictHintText('狐狸沒有')).toBe('狐狸…');
    expect(dictHintText('一二三四五六七八九十')).toBe('一二…');
    expect(dictHintText('狐狸沒有')).not.toContain('...');
  });

  it('朗讀用完整詞', () => {
    expect(dictAriaLabel('車票')).toBe('查字典，車票。會在新分頁開教育部辭典');
    const v = dictButtonView('狐狸沒有');
    expect(v.hint).toBe('狐狸…');
    expect(v.ariaLabel).toBe('查字典，狐狸沒有。會在新分頁開教育部辭典');
    expect(v.label).toBe('查字典');
  });

  it('沒網路提示句', () => {
    expect(DICT_OFFLINE_NOTICE).toBe('現在沒有網路，連上後再按一次。');
  });
});

describe('按下流程', () => {
  it('沒網路不開窗，回報 offline', () => {
    const open = vi.fn();
    expect(pressDictLookup('車票', true, { isOnline: () => false, open })).toBe('offline');
    expect(open).not.toHaveBeenCalled();
  });

  it('有網路同步呼叫一次 window.open，noopener 回 null 不算失敗', () => {
    let inCall = false;
    const open = vi.fn(() => {
      expect(inCall).toBe(true);
      return null;
    });
    inCall = true;
    const r = pressDictLookup('車票', true, { isOnline: () => true, open });
    inCall = false;
    expect(r).toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(buildDictUrl('車票'), '_blank', 'noopener');
  });

  it('不可查時什麼都不做', () => {
    const open = vi.fn();
    expect(pressDictLookup('', false, { isOnline: () => true, open })).toBe('nothing');
    expect(open).not.toHaveBeenCalled();
  });

  it('函式本身不是 async（同一同步堆疊）', () => {
    expect(pressDictLookup.constructor.name).toBe('Function');
  });
});

describe('暫存選取', () => {
  const reading = (over: Partial<Parameters<ReturnType<typeof createDictSelectionTracker>['update']>[0]> = {}) => ({
    source: 'body' as const,
    focused: true,
    value: '他搭上車票的那一班',
    selectionStart: 3,
    selectionEnd: 5,
    ...over,
  });

  it('暫存後按下不再讀選取', () => {
    const t = createDictSelectionTracker();
    t.update(reading());
    expect(t.getState()).toEqual({ word: '車票', canLookup: true, source: 'body' });
    const open = vi.fn(() => null);
    // 之後輸入框內容改了、選取清了，但沒再呼叫 update：仍用暫存
    expect(t.press({ isOnline: () => true, open })).toBe('opened');
    expect(open).toHaveBeenCalledWith(buildDictUrl('車票'), '_blank', 'noopener');
  });

  it('按下後暫存仍在，可再查一次', () => {
    const t = createDictSelectionTracker();
    t.update(reading());
    const open = vi.fn(() => null);
    t.press({ isOnline: () => true, open });
    t.press({ isOnline: () => true, open });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('選取變空或不合格就清掉', () => {
    const t = createDictSelectionTracker();
    t.update(reading());
    t.update(reading({ selectionStart: 4, selectionEnd: 4 }));
    expect(t.getState().canLookup).toBe(false);
    t.update(reading());
    t.update(reading({ value: '一二三四五六七八九十一二', selectionStart: 0, selectionEnd: 12 }));
    expect(t.getState().canLookup).toBe(false);
  });

  it('來源互斥：卡片接手後正文不能清掉卡片', () => {
    const t = createDictSelectionTracker();
    t.update(reading());
    t.update(reading({ source: 'card' }));
    expect(t.getState().source).toBe('card');
    t.update(reading({ source: 'body', focused: false }));
    expect(t.getState()).toEqual({ word: '車票', canLookup: true, source: 'card' });
    t.blur('body');
    expect(t.getState().source).toBe('card');
    t.blur('card');
    expect(t.getState().source).toBeNull();
  });

  it('組字中清掉，結束後重新判斷', () => {
    const t = createDictSelectionTracker();
    t.update(reading());
    t.compositionStart('body');
    expect(t.getState().canLookup).toBe(false);
    t.update(reading());
    expect(t.getState().canLookup).toBe(false);
    t.compositionEnd('body');
    t.update(reading());
    expect(t.getState().canLookup).toBe(true);
  });

  it('失焦清掉，但正在按查字典時不藏', () => {
    const t = createDictSelectionTracker();
    t.update(reading());
    t.beginPress();
    t.blur('body');
    t.update(reading({ focused: false }));
    expect(t.getState().canLookup).toBe(true);
    t.endPress();
    t.blur('body');
    expect(t.getState().canLookup).toBe(false);
  });

  it('反向選取（起點大於終點）也能判斷', () => {
    const t = createDictSelectionTracker();
    t.update(reading({ selectionStart: 5, selectionEnd: 3 }));
    expect(t.getState().word).toBe('車票');
  });

  it('通知訂閱者，狀態沒變不重複通知', () => {
    const t = createDictSelectionTracker();
    const fn = vi.fn();
    t.subscribe(fn);
    t.update(reading());
    t.update(reading());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
