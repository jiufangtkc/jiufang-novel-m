import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WO-79 底部分頁版面可捲內容底部留白', () => {
  it('直拿與中等：檔案／統計／設定／紀錄頁 scroll-pane 有額外底部內距與 scroll-padding', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).toMatch(/WO-79/);
    expect(css).toMatch(
      /html\[data-layout="phone-portrait"\][\s\S]*?\.workspace\s+\.scroll-pane\.files-page[\s\S]*?padding-bottom:\s*calc\(16px \+ var\(--hit-size\)\)/,
    );
    expect(css).toMatch(
      /html\[data-layout="medium"\][\s\S]*?\.workspace\s+\.scroll-pane\.settings-page[\s\S]*?scroll-padding-bottom:\s*var\(--hit-size\)/,
    );
  });

  it('手機橫拿與寬版未套用 WO-79 額外底部內距規則', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).not.toMatch(/html\[data-layout="phone-landscape"\][^\n{]*\.scroll-pane\.files-page/);
    expect(css).not.toMatch(/html\[data-layout="wide"\][^\n{]*\.scroll-pane\.files-page/);
  });
});