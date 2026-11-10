// @ts-ignore
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @ts-ignore
import { unlinkSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOOK_GOAL_LABEL,
  SETTINGS_EDIT_GOAL_ARIA,
  settingsBookGoalLine,
  settingsDailyGoalLine,
} from '../copy/userFacing';
import { formatInteger } from '../domain/formatNumber';

function isChromeAvailable(): boolean {
  try {
    execSync('google-chrome --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface ScenarioLayoutResult {
  label: string;
  width: number;
  scale: number;
  zoom: number;
  text1Right: number;
  text2Right: number;
  btnLeft: number;
  btnWidth: number;
  btnHeight: number;
  cardRight: number;
  line1OverlapsBtn: boolean;
  line2OverlapsBtn: boolean;
  line1Clipped: boolean;
  line2Clipped: boolean;
}

function runChromeLayoutSuite(): ScenarioLayoutResult[] {
  const cssUrl = new URL('../styles/global.css', import.meta.url);
  const css = readFileSync(cssUrl, 'utf8');

  // 測試情境：包含 iPhone 窄畫面（320px、375px、390px）與寬畫面（600px），
  // 字級比例：100%（預設）、160%、180%、200%，以及頁面縮放（zoom）160%、180%、200%。
  const scenarios = [
    { label: '320px-字級100%', width: 320, scale: 1.0, zoom: 1.0 },
    { label: '320px-字級160%', width: 320, scale: 1.6, zoom: 1.0 },
    { label: '320px-字級180%', width: 320, scale: 1.8, zoom: 1.0 },
    { label: '320px-字級200%', width: 320, scale: 2.0, zoom: 1.0 },
    { label: '375px-字級100%', width: 375, scale: 1.0, zoom: 1.0 },
    { label: '375px-字級160%', width: 375, scale: 1.6, zoom: 1.0 },
    { label: '375px-字級180%', width: 375, scale: 1.8, zoom: 1.0 },
    { label: '375px-字級200%', width: 375, scale: 2.0, zoom: 1.0 },
    { label: '390px-字級200%', width: 390, scale: 2.0, zoom: 1.0 },
    { label: '600px-字級200%', width: 600, scale: 2.0, zoom: 1.0 },
    { label: '375px-頁面縮放160%', width: 375, scale: 1.0, zoom: 1.6 },
    { label: '375px-頁面縮放180%', width: 375, scale: 1.0, zoom: 1.8 },
    { label: '375px-頁面縮放200%', width: 375, scale: 1.0, zoom: 2.0 },
  ];

  // 僅使用範例數字
  const sampleBookGoalText = settingsBookGoalLine(formatInteger(100000));
  const sampleDailyGoalText = settingsDailyGoalLine(formatInteger(1000));

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<style>
${css}
.suite-row {
  margin-bottom: 32px;
}
</style>
</head>
<body style="margin: 0; background: #1e1e1e;">
  ${scenarios
    .map(
      (s) => `
    <div
      class="suite-row"
      id="scenario-${s.label}"
      style="width: ${s.zoom !== 1 ? s.width / s.zoom : s.width}px; font-size: ${14 * s.scale}px; ${s.zoom !== 1 ? `zoom: ${s.zoom};` : ''}"
    >
      <div class="scroll-pane settings-page" style="font-size: ${14 * s.scale}px;">
        <article class="setting-card goal-card" aria-labelledby="heading-${s.label}">
          <span class="project-icon">
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2v20"/></svg>
          </span>
          <span class="goal-copy">
            <strong id="heading-${s.label}" style="font-size: ${16 * s.scale}px;">${BOOK_GOAL_LABEL}</strong>
            <small class="goal-lines" style="font-size: ${12 * s.scale}px;">
              <span class="line-book">${sampleBookGoalText}</span>
              <span class="line-daily">${sampleDailyGoalText}</span>
            </small>
          </span>
          <button type="button" class="icon-button" aria-label="${SETTINGS_EDIT_GOAL_ARIA}">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>
          </button>
        </article>
      </div>
    </div>
  `,
    )
    .join('\n')}
  <script>
    window.addEventListener('load', () => {
      const scenarios = ${JSON.stringify(scenarios)};
      const results = scenarios.map(s => {
        const root = document.getElementById('scenario-' + s.label);
        const card = root.querySelector('.goal-card').getBoundingClientRect();
        const btn = root.querySelector('.icon-button').getBoundingClientRect();
        const lineBook = root.querySelector('.line-book');
        const lineDaily = root.querySelector('.line-daily');

        const r1 = document.createRange();
        r1.selectNodeContents(lineBook);
        const t1 = r1.getBoundingClientRect();

        const r2 = document.createRange();
        r2.selectNodeContents(lineDaily);
        const t2 = r2.getBoundingClientRect();

        return {
          label: s.label,
          width: s.width,
          scale: s.scale,
          zoom: s.zoom,
          text1Right: t1.right,
          text2Right: t2.right,
          btnLeft: btn.left,
          btnWidth: btn.width,
          btnHeight: btn.height,
          cardRight: card.right,
          line1OverlapsBtn: t1.right > btn.left,
          line2OverlapsBtn: t2.right > btn.left,
          line1Clipped: t1.right > card.right,
          line2Clipped: t2.right > card.right,
        };
      });
      const pre = document.createElement('pre');
      pre.id = 'measure-results';
      pre.textContent = JSON.stringify(results);
      document.body.appendChild(pre);
    });
  </script>
</body>
</html>`;

  const tmpHtmlUrl = new URL(`./tmp_suite_${Date.now()}_${Math.random().toString(36).slice(2)}.html`, import.meta.url);
  writeFileSync(tmpHtmlUrl, html, 'utf8');

  try {
    const cmd = `google-chrome --headless --disable-gpu --dump-dom --virtual-time-budget=3000 "${tmpHtmlUrl.href}"`;
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const match = out.match(/<pre id="measure-results">([\s\S]*?)<\/pre>/);
    if (!match) throw new Error('無法從 Chrome 輸出取得量測結果：' + out);
    return JSON.parse(match[1]);
  } finally {
    try {
      unlinkSync(tmpHtmlUrl);
    } catch {}
  }
}

describe('工單 WO-43：設定頁寫作目標卡樣式規則', () => {
  it('目標卡行文字不可強制 nowrap，應允許折行並保持單詞完整', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    const spanRule = css.match(/\.goal-card\s+\.goal-lines\s+span\s*\{[^}]+\}/)?.[0] ?? '';

    expect(spanRule).toBeTruthy();
    expect(spanRule).not.toContain('white-space: nowrap');
    expect(spanRule).toMatch(/white-space:\s*normal;/);
    expect(spanRule).toMatch(/word-break:\s*keep-all;/);
    expect(spanRule).toMatch(/overflow-wrap:\s*anywhere;/);
  });

  it('鉛筆按鈕維持右側貼齊且不被擠壓', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    const buttonRule = css.match(/\.goal-card\s+\.icon-button\s*\{[^}]+\}/)?.[0] ?? '';

    expect(buttonRule).toMatch(/margin-left:\s*auto;/);
    expect(buttonRule).toMatch(/flex-shrink:\s*0;/);
  });
});

describe('工單 WO-43：目標卡字級放大版面量測（Headless Chrome）', () => {
  it('在 160%、180%、200% 字級與頁面縮放下，兩行文字不壓到鉛筆、不被切掉，鉛筆點擊面積不小於 44×44', () => {
    if (!isChromeAvailable()) {
      return;
    }
    const results = runChromeLayoutSuite();
    expect(results.length).toBeGreaterThanOrEqual(10);

    for (const r of results) {
      expect(r.line1OverlapsBtn, `${r.label} 全書目標不可壓到鉛筆按鈕`).toBe(false);
      expect(r.line2OverlapsBtn, `${r.label} 每日目標不可壓到鉛筆按鈕`).toBe(false);
      expect(r.line1Clipped, `${r.label} 全書目標不可被卡片右邊緣切掉`).toBe(false);
      expect(r.line2Clipped, `${r.label} 每日目標不可被卡片右邊緣切掉`).toBe(false);
      expect(r.btnWidth, `${r.label} 鉛筆按鈕寬度不可小於 44px`).toBeGreaterThanOrEqual(44);
      expect(r.btnHeight, `${r.label} 鉛筆按鈕高度不可小於 44px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('字級在 320px 窄畫面放大至 200% 時，換行精確落在全形空白處（標題與數字符號各成一行）', () => {
    if (!isChromeAvailable()) {
      return;
    }
    const cssUrl = new URL('../styles/global.css', import.meta.url);
    const css = readFileSync(cssUrl, 'utf8');
    const sampleLine = settingsBookGoalLine(formatInteger(100000));

    const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<style>
${css}
</style>
</head>
<body style="margin: 0; background: #1e1e1e;">
  <div style="width: 320px; font-size: 28px;">
    <div class="scroll-pane settings-page" style="font-size: 28px;">
      <article class="setting-card goal-card">
        <span class="project-icon">
          <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2v20"/></svg>
        </span>
        <span class="goal-copy">
          <strong style="font-size: 32px;">${BOOK_GOAL_LABEL}</strong>
          <small class="goal-lines" style="font-size: 24px;">
            <span id="target-line">${sampleLine}</span>
          </small>
        </span>
        <button type="button" class="icon-button" aria-label="${SETTINGS_EDIT_GOAL_ARIA}">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>
        </button>
      </article>
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {
      const line = document.getElementById('target-line');
      const textNode = line.childNodes[0];
      const text = textNode.nodeValue;
      const chars = [];
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(textNode, i);
        r.setEnd(textNode, i + 1);
        const rect = r.getBoundingClientRect();
        chars.push({ char: text[i], top: rect.top });
      }
      const pre = document.createElement('pre');
      pre.id = 'chars-result';
      pre.textContent = JSON.stringify(chars);
      document.body.appendChild(pre);
    });
  </script>
</body>
</html>`;

    const tmpHtmlUrl = new URL(`./tmp_wrap_${Date.now()}_${Math.random().toString(36).slice(2)}.html`, import.meta.url);
    writeFileSync(tmpHtmlUrl, html, 'utf8');

    try {
      const cmd = `google-chrome --headless --disable-gpu --dump-dom --virtual-time-budget=2000 "${tmpHtmlUrl.href}"`;
      const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
      const match = out.match(/<pre id="chars-result">([\s\S]*?)<\/pre>/);
      if (!match) throw new Error('無法取得字元折行量測：' + out);
      const chars: Array<{ char: string; top: number }> = JSON.parse(match[1]);

      const linesMap: Record<number, string> = {};
      for (const c of chars) {
        linesMap[c.top] = (linesMap[c.top] || '') + c.char;
      }
      const lines = Object.values(linesMap).map((line) => line.replace(/&nbsp;/g, '\u00A0'));
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('全書目標　');
      expect(lines[1]).toBe('100,000\u00A0字');
    } finally {
      try {
        unlinkSync(tmpHtmlUrl);
      } catch {}
    }
  });
});
