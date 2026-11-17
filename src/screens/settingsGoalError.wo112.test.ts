import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_BOOK, ERROR_DAILY } from '../copy/welcomeCopy';
import { checkGoalSubmit, goalApplyPlan } from './SettingsScreen';

const DAILY_MSG = '每日目標請填 300 以上的整數。';
const BOOK_MSG = '全書目標請填 1 以上的整數。';

describe('WO-112 設定頁目標錯誤句', () => {
  it('兩句逐字正確，且與歡迎頁常數一致', () => {
    expect(ERROR_DAILY).toBe(DAILY_MSG);
    expect(ERROR_BOOK).toBe(BOOK_MSG);
  });

  it('每日不合格：空白、非數字、小數、小於下限（全書維持合格）', () => {
    for (const bad of ['', ' ', 'abc', '300.5', '299', '0', '-1']) {
      expect(checkGoalSubmit(bad, '100000')).toEqual({ ok: false, error: DAILY_MSG });
    }
  });

  it('全書不合格：空白、非數字、小數、小於下限（每日維持合格）', () => {
    for (const bad of ['', ' ', 'abc', '1.5', '0', '-1']) {
      expect(checkGoalSubmit('500', bad)).toEqual({ ok: false, error: BOOK_MSG });
    }
  });

  it('兩欄皆不合格時先顯示每日句', () => {
    expect(checkGoalSubmit('abc', '0')).toEqual({ ok: false, error: DAILY_MSG });
    expect(checkGoalSubmit('', '')).toEqual({ ok: false, error: DAILY_MSG });
  });

  it('每日合格但全書不合格：整體不通過，不會有可存的每日值', () => {
    const r = checkGoalSubmit('800', 'abc');
    expect(r).toEqual({ ok: false, error: BOOK_MSG });
    expect('nextDaily' in r).toBe(false);
  });

  it('下限每日 300、全書 1 可通過；修正後可套用', () => {
    expect(checkGoalSubmit('300', '1')).toEqual({ ok: true, nextDaily: 300, nextBook: 1 });
    expect(checkGoalSubmit('299', '1').ok).toBe(false);
    const fixed = checkGoalSubmit('600', '90000');
    expect(fixed).toEqual({ ok: true, nextDaily: 600, nextBook: 90000 });
  });

  it('更新計畫維持只更新有變動的項目', () => {
    expect(goalApplyPlan(500, 600, 1000, 1000)).toEqual({ daily: true, book: false });
    expect(goalApplyPlan(500, 500, 1000, 2000)).toEqual({ daily: false, book: true });
    expect(goalApplyPlan(500, 500, 1000, 1000)).toEqual({ daily: false, book: false });
  });

  it('送出流程：驗證失敗先 return，存檔動作都在驗證之後', () => {
    const src = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
    const submit = src.slice(src.indexOf('checkGoalSubmit(daily, book)'));
    const iReturn = submit.indexOf('return;');
    const iSetGoal = submit.indexOf('actions.setGoal(');
    const iSetBook = submit.indexOf('actions.setBookGoal(');
    const iClose = submit.indexOf('setEditing(false)');
    expect(iReturn).toBeGreaterThan(0);
    expect(iSetGoal).toBeGreaterThan(iReturn);
    expect(iSetBook).toBeGreaterThan(iReturn);
    expect(iClose).toBeGreaterThan(iReturn);
  });
});
