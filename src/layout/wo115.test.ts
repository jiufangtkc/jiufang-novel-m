import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WIDE_NAV_RAIL_WIDTH,
  bodyCharAdvance,
  fitWidePanels,
  needsPanelOverlay,
  wideBodyAvailable,
  wideBodyBoxWidth,
  wideChars,
} from './widePanels';

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

/** 取出第一個選擇器完全相符的規則內容 */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`找不到規則：${selector}`);
  return m[1];
}

describe('WO-115：中等開右側卡片不擋底列', () => {
  const drawer = ruleBody('html[data-layout="medium"] .writing-cards-drawer');

  it('抽屜下緣停在底列上緣（56px 按鈕＋1px 邊線＋安全區），不再貼視窗底', () => {
    expect(drawer).toMatch(/bottom:\s*calc\(57px \+ var\(--safe-bottom\)\)/);
    expect(drawer).toMatch(/top:\s*0/);
  });

  it('不再用全高：height 交給 top／bottom，max-height 不限制為 100%', () => {
    expect(drawer).toMatch(/height:\s*auto/);
    expect(drawer).not.toMatch(/height:\s*100%/);
    expect(drawer).toMatch(/max-height:\s*none/);
  });

  it('底列高度與抽屜預留一致：按鈕最小 56px、底列含 1px 上邊線與安全區', () => {
    const nav = ruleBody('.bottom-nav');
    expect(nav).toMatch(/border-top:\s*1px solid/);
    expect(nav).toMatch(/padding-bottom:\s*var\(--safe-bottom\)/);
    expect(css).toMatch(/\.bottom-nav a, \.nav-rail a \{[^}]*min-height:\s*56px/);
  });

  it('鍵盤開啟與專注模式時底列不顯示，抽屜恢復貼齊視窗底', () => {
    expect(css).toMatch(/html\.keyboard-open\[data-layout="medium"\] \.bottom-nav \{\s*display:\s*none/);
    expect(ruleBody('html.keyboard-open[data-layout="medium"] .writing-cards-drawer,\nhtml[data-focus-mode="true"][data-layout="medium"] .writing-cards-drawer')).toMatch(
      /bottom:\s*0/,
    );
  });

  it('只動中等：寬版內嵌抽屜與手機直拿抽屜規則不受影響', () => {
    expect(css).toMatch(/html\[data-layout="wide"\]\s+\.write-aside\s+\.writing-cards-drawer[\s\S]*?position:\s*static\s*!important/);
    // 手機直拿沿用基礎規則（貼底、依螢幕高度）
    expect(ruleBody('.writing-cards-drawer')).toMatch(/height:\s*52dvh/);
  });

  it('中等仍保留讓位與底列顯示規則', () => {
    expect(css).toMatch(/html\[data-layout="medium"\] \.bottom-nav \{ display: grid; \}/);
    expect(css).toMatch(/html\[data-layout="medium"\] \.editor-pane\.yield-right \{|html\[data-layout="medium"\] \.editor\.yield-right,/);
  });

});

describe('WO-115：1440 預設三欄約 40 字（以 CSS 數值核算）', () => {
  const sidePanelCss = Number(/html\[data-layout="wide"\] \.write-aside \{[^}]*?\bwidth:\s*(\d+)px/.exec(css)![1]);
  const editorBody = ruleBody('html[data-layout="wide"] .editor-input');
  const padLeft = Number(/padding-left:\s*(\d+)px/.exec(editorBody)![1]);
  const padRight = Number(/padding-right:\s*(\d+)px/.exec(editorBody)![1]);
  const fontPx = Number(/font-size:\s*calc\((\d+)px/.exec(editorBody)![1]);

  it('1440 兩側全開：左 280、右 280、導覽 72，正文外框 808px', () => {
    expect(sidePanelCss).toBe(280);
    expect(WIDE_NAV_RAIL_WIDTH).toBe(72);
    expect(1440 - 72 - sidePanelCss * 2).toBe(808);
    expect(wideBodyAvailable(1440, { left: true, right: true })).toBe(808);
  });

  it('扣除左右內距後，按實際字級 18px＋字距 0.5px 核算，完整行為 40 字（落在 38–40）', () => {
    expect(fontPx).toBe(18);
    const content = 808 - padLeft - padRight;
    const chars = Math.floor(content / bodyCharAdvance(100));
    expect(chars).toBeGreaterThanOrEqual(38);
    expect(chars).toBeLessThanOrEqual(40);
    expect(wideBodyBoxWidth(40, 100)).toBeLessThanOrEqual(808);
  });

  it('1440 預設（沒存偏好、100% 字級）左右欄同時顯示，字數為 40', () => {
    const wanted = { left: true, right: true };
    const base = { wanted, prefer: 'left' as const, scalePercent: 100, oneSide: false };
    expect(fitWidePanels({ ...base, viewportWidth: 1440 })).toEqual({ left: true, right: true });
    expect(fitWidePanels({ ...base, viewportWidth: 1440, noBody: true })).toEqual({ left: true, right: true });
    expect(wideChars(1440, 100)).toBe(40);
  });

  it('右卡片是並排欄位，不用浮層蓋正文：1440 不需要 data-panel-overlay', () => {
    const input = {
      wanted: { left: true, right: true },
      prefer: 'left' as const,
      viewportWidth: 1440,
      scalePercent: 100,
      oneSide: false,
    };
    expect(needsPanelOverlay(input, 'left')).toBe(false);
    expect(needsPanelOverlay(input, 'right')).toBe(false);
  });

  it('較窄寬度不為 1440 目標被強迫三欄：1024–1435 兩側不會同時常駐', () => {
    for (const width of [1024, 1100, 1180, 1279, 1280, 1366, 1435]) {
      const r = fitWidePanels({
        wanted: { left: true, right: true },
        prefer: 'left',
        viewportWidth: width,
        scalePercent: 100,
        oneSide: width < 1280,
      });
      expect(r.left && r.right).toBe(false);
    }
  });

  it('1100 已選章：左目錄放得下、正文保住 36 字；1024 仍走 WO-94 浮出入口', () => {
    const input = (width: number) => ({
      wanted: { left: true, right: true },
      prefer: 'left' as const,
      viewportWidth: width,
      scalePercent: 100,
      oneSide: true,
    });
    expect(fitWidePanels(input(1100))).toEqual({ left: true, right: false });
    expect(fitWidePanels(input(1024))).toEqual({ left: false, right: false });
  });
});
