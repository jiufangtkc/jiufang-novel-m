import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WO-78 直拿／中等打字時底部分頁收起', () => {
  const css = () => readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  it('直拿與中等平常仍顯示底部分頁', () => {
    const sheet = css();
    expect(sheet).toContain('html[data-layout="phone-portrait"] .bottom-nav { display: flex; }');
    expect(sheet).toContain('html[data-layout="medium"] .bottom-nav { display: flex; }');
  });

  it('keyboard-open 搭配直拿或中等時隱藏底部分頁（優先於顯示規則）', () => {
    const sheet = css();
    expect(sheet).toMatch(/WO-78/);
    expect(sheet).toContain(
      'html.keyboard-open[data-layout="phone-portrait"] .bottom-nav',
    );
    expect(sheet).toContain('html.keyboard-open[data-layout="medium"] .bottom-nav');
    expect(sheet).toMatch(
      /html\.keyboard-open\[data-layout="phone-portrait"\] \.bottom-nav[\s\S]*?display:\s*none/,
    );
    expect(sheet).toMatch(
      /html\.keyboard-open\[data-layout="medium"\] \.bottom-nav[\s\S]*?display:\s*none/,
    );
  });

  it('寬版本來就無底部分頁，keyboard-open 不另改寬版規則', () => {
    const sheet = css();
    expect(sheet).toContain('html[data-layout="wide"] .bottom-nav { display: none; }');
    expect(sheet).not.toMatch(/html\.keyboard-open\[data-layout="wide"\]/);
  });
});