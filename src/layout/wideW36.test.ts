import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutProvider, useLayout } from './layoutContext';
import {
  WIDE_PANELS_STORAGE_KEY,
  bodyCharAdvance,
  fitWidePanels,
  loadWidePanels,
  parseWidePanels,
  saveWidePanels,
  WIDE_EDITOR_PADDING_TOTAL,
  WIDE_SIDE_PANEL_OUTER,
  wideBodyAvailable,
  wideBodyBoxWidth,
  wideChars,
  wideEditorMaxWidthCalc,
} from './widePanels';

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

function fit(width: number, wanted = { left: true, right: true }, extra: Record<string, unknown> = {}) {
  return fitWidePanels({
    wanted,
    prefer: 'left',
    viewportWidth: width,
    scalePercent: 100,
    oneSide: width < 1280,
    ...extra,
  } as Parameters<typeof fitWidePanels>[0]);
}

describe('WO-W36：36／40 字容量', () => {
  it('WO-115：100% 字級 q=18.5；36 字外框 730、40 字外框 804（內距合計 64px）', () => {
    expect(bodyCharAdvance(100)).toBe(18.5);
    expect(wideBodyBoxWidth(36, 100)).toBe(730);
    expect(wideBodyBoxWidth(40, 100)).toBe(804);
  });

  it('WO-115：1280 為 36，1440、1920 為 40', () => {
    expect(wideChars(1280, 100)).toBe(36);
    expect(wideChars(1440, 100)).toBe(40);
    expect(wideChars(1920, 100)).toBe(40);
  });

  it('WO-115：40 字門檻邊界（72+280×2+804=1436；等於算容得下）', () => {
    expect(wideChars(1435, 100)).toBe(36);
    expect(wideChars(1436, 100)).toBe(40);
  });

  it('WO-115：1440 兩側全開後正文外框 808px，容得下 40 字外框 804px', () => {
    expect(wideBodyAvailable(1440, { left: true, right: true })).toBe(808);
    expect(wideBodyAvailable(1440, { left: true, right: true })).toBeGreaterThanOrEqual(wideBodyBoxWidth(40, 100));
  });

  it('WO-W36：字級放大後門檻跟著增加', () => {
    expect(wideChars(1920, 175)).toBe(36);
    expect(wideChars(1920, 90)).toBe(40);
    expect(wideBodyBoxWidth(36, 200)).toBe(36 * 36.5 + 64);
  });

  it('WO-115：限寬公式為 N 字內容寬加左右內距 64px，CSS 與之等價', () => {
    expect(wideEditorMaxWidthCalc(36)).toBe('calc(36 * (1em + 0.5px) + 64px)');
    expect(css).toMatch(/html\[data-layout="wide"\] \.editor-input \{\s*max-width: min\(calc\(36 \* \(1em \+ 0\.5px\) \+ 64px\), 100%\)/);
    expect(css).toMatch(/html\[data-layout="wide"\]\[data-wide-chars="40"\] \.editor-input \{\s*max-width: min\(calc\(40 \* \(1em \+ 0\.5px\) \+ 64px\), 100%\)/);
  });

  it('WO-115：容量常數與 CSS 實際尺寸一致（側欄 280、正文內距各 32）', () => {
    expect(WIDE_SIDE_PANEL_OUTER).toBe(280);
    expect(WIDE_EDITOR_PADDING_TOTAL).toBe(64);
    expect(css).toMatch(/html\[data-layout="wide"\] \.editor-input \{[^}]*padding-left: 32px;\s*padding-right: 32px;/);
    expect(css).toMatch(/html\[data-layout="wide"\] \.write-aside \{[^}]*flex: 0 0 280px;\s*width: 280px;\s*min-width: 280px;\s*max-width: 280px;/);
    expect(css).toMatch(/\.write-layout:not\(\.has-chapter\) \.tree-pane \{[^}]*flex: 0 0 280px !important;\s*width: 280px !important;/);
  });

  it('WO-W36：手機直拿、橫拿、中等限寬與內距不變', () => {
    expect(css).toMatch(/phone-portrait"\] \.editor-input \{\s*max-width: min\(calc\(19 \* \(1em \+ 0\.5px\)\), 100%\);[^}]*padding-left: 16px/);
    expect(css).toMatch(/phone-landscape"\] \.editor-input \{\s*max-width: min\(calc\(30 \* \(1em \+ 0\.5px\)\), 100%\);[^}]*padding-left: 16px/);
    expect(css).toMatch(/medium"\] \.editor-input \{\s*max-width: min\(calc\(30 \* \(1em \+ 0\.5px\)\), 100%\);[^}]*padding-left: 40px/);
  });
});

describe('WO-W36：三欄容量與暫時收合', () => {
  it('WO-115：預設選擇（左右都開）1440、1920 三欄；1280、1435 仍左開右暫收', () => {
    expect(fit(1920)).toEqual({ left: true, right: true });
    expect(fit(1440)).toEqual({ left: true, right: true });
    expect(fit(1436)).toEqual({ left: true, right: true });
    expect(fit(1435)).toEqual({ left: true, right: false });
    expect(fit(1366)).toEqual({ left: true, right: false });
    expect(fit(1280)).toEqual({ left: true, right: false });
  });

  it('WO-115：1440 字級放大到放不下 40 字時右側暫收，不縮字', () => {
    expect(fit(1440, undefined, { scalePercent: 110 })).toEqual({ left: true, right: false });
  });

  it('WO-115：1440 已存的收右側偏好仍被尊重', () => {
    expect(fit(1440, { left: true, right: false })).toEqual({ left: true, right: false });
    expect(fit(1440, { left: false, right: true })).toEqual({ left: false, right: true });
  });

  it('WO-W36：one-side（1279）一次只一側；兩側都想開時左優先', () => {
    expect(fit(1279)).toEqual({ left: true, right: false });
    expect(fit(1279, { left: true, right: true }, { prefer: 'right' })).toEqual({ left: false, right: true });
  });

  it('WO-W36：手動打開資料集放不下時左目錄讓位，關掉後左目錄回來', () => {
    expect(fit(1280, { left: true, right: true }, { prefer: 'right' })).toEqual({ left: false, right: true });
    expect(fit(1280, { left: true, right: false })).toEqual({ left: true, right: false });
  });

  it('WO-115：1024 單側仍壓縮正文時左側也暫收；放寬後恢復（72+280+730=1082）', () => {
    expect(fit(1024)).toEqual({ left: false, right: false });
    expect(fit(1100)).toEqual({ left: true, right: false });
    expect(fit(1082, { left: true, right: false })).toEqual({ left: true, right: false });
    expect(fit(1081, { left: true, right: false })).toEqual({ left: false, right: false });
  });

  it('WO-W36：使用者收合右側後，任何寬度都維持收合', () => {
    expect(fit(1920, { left: true, right: false })).toEqual({ left: true, right: false });
  });

  it('WO-W36：字級放大後三欄門檻重算，不縮字', () => {
    expect(fit(1920, undefined, { scalePercent: 175 })).toEqual({ left: true, right: false });
  });
});

describe('WO-W36：偏好讀寫', () => {
  it('WO-W36：沒存過、格式不符、讀取失敗都用預設（左右都開）', () => {
    expect(parseWidePanels(null)).toBeNull();
    expect(parseWidePanels('xx')).toBeNull();
    expect(parseWidePanels('{"left":1,"right":true}')).toBeNull();
    expect(loadWidePanels({ getItem: () => null })).toEqual({ left: true, right: true });
    expect(loadWidePanels({ getItem: () => { throw new Error('x'); } })).toEqual({ left: true, right: true });
  });

  it('WO-W36：存了就照存的；寫入失敗不中斷', () => {
    const data: Record<string, string> = {};
    const store = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => { data[k] = v; },
    };
    expect(saveWidePanels({ left: true, right: false }, store)).toBe(true);
    expect(WIDE_PANELS_STORAGE_KEY).toBe('wo-w36-wide-panels-v1');
    expect(loadWidePanels(store)).toEqual({ left: true, right: false });
    expect(saveWidePanels({ left: true, right: true }, { setItem: () => { throw new Error('x'); } })).toBe(false);
  });
});

describe('WO-W36：LayoutProvider 整合', () => {
  afterEach(() => vi.unstubAllGlobals());

  function render(width: number, stored: string | null, extra: Record<string, unknown> = {}) {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === WIDE_PANELS_STORAGE_KEY ? stored : null),
      setItem: () => {},
    });
    function C() {
      const l = useLayout();
      return createElement('i', { 'data-l': String(l.sidePanels.left), 'data-r': String(l.sidePanels.right) });
    }
    return renderToStaticMarkup(
      createElement(
        LayoutProvider,
        {
          initialMode: 'wide',
          initialWideColumns: width >= 1280 ? 'both' : 'one-side',
          initialPointer: 'mouse',
          initialViewportWidth: width,
          ...extra,
        },
        createElement(C),
      ),
    );
  }

  it('WO-115：乾淨環境 1440、1920 三欄，1280 右側暫收', () => {
    expect(render(1920, null)).toContain('data-l="true" data-r="true"');
    expect(render(1440, null)).toContain('data-l="true" data-r="true"');
    expect(render(1280, null)).toContain('data-l="true" data-r="false"');
  });

  it('WO-W36：記住使用者收合；放寬到 1920 或 1440 仍收合', () => {
    expect(render(1920, '{"left":true,"right":false}')).toContain('data-l="true" data-r="false"');
    expect(render(1440, '{"left":true,"right":false}')).toContain('data-l="true" data-r="false"');
  });

  it('WO-W36：專注模式進場時全收，不因容量足夠而展開', () => {
    expect(render(1920, null, { initialFocusMode: true })).toContain('data-l="false" data-r="false"');
    expect(render(1440, null, { initialFocusMode: true })).toContain('data-l="false" data-r="false"');
  });

  it('WO-W36：非寬版不讀寬版偏好、行為不變', () => {
    const html = render(390, '{"left":false,"right":true}', { initialMode: 'phone-portrait', initialWideColumns: null });
    expect(html).toContain('data-l="false" data-r="false"');
  });
});
