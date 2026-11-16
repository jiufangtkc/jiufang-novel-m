import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { topbarTodayWords } from '../copy/userFacing';

/** WO-102 三、四：寬版頁首達標用字、隱私留白樣式關係。 */

describe('WO-102 三：寬版頁首今天字數', () => {
  it('未達標：畫面字無尾字，朗讀句不念「／」', () => {
    expect(topbarTodayWords(320, 1000, false)).toEqual({
      display: '今天 320／1,000 字',
      aria: '今天寫了 320 字，每日目標 1,000 字',
    });
  });
  it('達標：千分位、全形空白 U+3000、達標了；朗讀接已經達標', () => {
    const r = topbarTodayWords(1020, 1000, true);
    expect(r.display).toBe('今天 1,020／1,000 字　達標了');
    expect(r.display).toContain('　');
    expect(r.aria).toBe('今天寫了 1,020 字，每日目標 1,000 字，已經達標');
    expect(r.aria).not.toContain('／');
  });
  it('恰好達標', () => {
    const r = topbarTodayWords(1000, 1000, true);
    expect(r.display).toBe('今天 1,000／1,000 字　達標了');
    expect(r.aria).toBe('今天寫了 1,000 字，每日目標 1,000 字，已經達標');
  });
  it('無有效目標沿用原行為，不判達標、沒有獨立朗讀句', () => {
    for (const goal of [0, -5, null, undefined, Number.NaN]) {
      expect(topbarTodayWords(1020, goal, true)).toEqual({ display: '今天 1,020 字', aria: null });
    }
  });
  it('頁首：畫面字 aria-hidden、獨立朗讀句；進度條與頁首同一目標與達標判斷', () => {
    const source = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');
    expect(source).toContain('topbarTodayWords(todayWords, goal, isGlowing)');
    expect(source).toContain('<DailyProgressBar words={todayWords} goal={goal} met={isGlowing}');
    expect(source).toContain('<span aria-hidden="true">{topbarWords.display}</span>');
    expect(source).toContain('<span className="sr-only">{topbarWords.aria}</span>');
    // 其他呼叫端（專注模式底列）維持原本函式
    expect(source).toContain('<span>{todayWordsLabel(todayWords, goal)}</span>');
  });
});

describe('WO-102 四：隱私說明左右留白', () => {
  const css = readFileSync(new URL('./privacy.css', import.meta.url), 'utf8');
  const privacy = readFileSync(new URL('./PrivacyScreen.tsx', import.meta.url), 'utf8');
  const global = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  function block(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  }

  it('正文容器就是有留白的那一個（捲動容器自己帶左右內距，不會水平溢出）', () => {
    expect(privacy).toContain('className="scroll-pane privacy-page"');
    const base = block('.privacy-page');
    expect(base).toContain('padding-left: max(16px, env(safe-area-inset-left, 0px))');
    expect(base).toContain('padding-right: max(16px, env(safe-area-inset-right, 0px))');
    expect(base).toContain('max-width: 620px');
    expect(base).toContain('box-sizing: border-box');
    // 全域 * 已是 border-box；共用捲動區沒有會蓋掉左右內距的規則
    expect(global).toContain('* { box-sizing: border-box; }');
    const scrollPane = global.slice(global.indexOf('.scroll-pane, .home-main {'), global.indexOf('}', global.indexOf('.scroll-pane, .home-main {')));
    expect(scrollPane).not.toMatch(/padding|margin/);
  });

  it('與設定頁欄位一致：手機橫拿、中等置中，寬版靠左；直拿滿寬（最大寬度之內）', () => {
    expect(block('html[data-layout="phone-landscape"] .privacy-page,\nhtml[data-layout="medium"] .privacy-page')).toContain('margin-left: auto');
    expect(block('html[data-layout="wide"] .privacy-page')).toContain('margin-left: 0');
    // 設定頁同一組規則
    expect(global).toContain('.settings-page {\n  width: 100%;\n  max-width: 620px;');
  });

  it('不改隱私用字與內容：模組不再動 PrivacyScreen 結構', () => {
    expect(privacy).toContain('PRIVACY_PARAGRAPHS.map');
    expect(css).toContain('.privacy-paragraph');
  });
});
