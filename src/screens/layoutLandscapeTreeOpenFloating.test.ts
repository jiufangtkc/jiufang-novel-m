import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const focusCss = readFileSync(new URL('./focusMode.css', import.meta.url), 'utf8');
const writeScreenSrc = readFileSync(new URL('./WriteScreen.tsx', import.meta.url), 'utf8');
const editorSrc = readFileSync(new URL('./EditorPane.tsx', import.meta.url), 'utf8');

/** 取出「選擇器清單含指定片段」的規則區塊（選擇器文字與宣告內容）。 */
function rulesContaining(css: string, fragment: string): Array<{ selectors: string; body: string }> {
  const out: Array<{ selectors: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selectors.includes(fragment)) out.push({ selectors, body: m[2] });
  }
  return out;
}

function hiddenBy(css: string, selector: string) {
  return rulesContaining(css, selector).filter(
    (r) =>
      r.selectors.split(',').some((s) => s.trim() === selector) &&
      /display:\s*none\s*!important/.test(r.body),
  );
}

describe('WO-87 橫拿目錄打開時避讓浮動鈕（CSS／原始碼靜態驗證，非實際幾何或點擊量測）', () => {
  const treeOpenTree =
    'html[data-layout="phone-landscape"] .write-layout.tree-open .floating-tree-trigger';
  const treeOpenCards =
    'html[data-layout="phone-landscape"] .write-layout.tree-open .landscape-cards-trigger';
  const treeOpenFocus =
    'html[data-layout="phone-landscape"] .write-layout.tree-open .landscape-focus-trigger';

  it('目錄開啟時，目錄鈕與看卡片鈕以 display:none 收起（不是只改層級或透明）', () => {
    expect(hiddenBy(globalCss, treeOpenTree).length).toBeGreaterThan(0);
    expect(hiddenBy(globalCss, treeOpenCards).length).toBeGreaterThan(0);
    const rule = rulesContaining(globalCss, treeOpenTree)[0];
    expect(rule.body).not.toMatch(/opacity|z-index|pointer-events/);
  });

  it('專注鈕在目錄開啟時仍被收起（既有防護保留）', () => {
    expect(hiddenBy(focusCss, treeOpenFocus).length).toBeGreaterThan(0);
  });

  it('本張規則只看 .tree-open，不依賴 WO-68 的 data-landscape-rail', () => {
    expect(treeOpenTree).not.toContain('data-landscape-rail');
    // 有分頁標記時的既有規則仍在，兩者並存
    expect(globalCss).toContain(
      'html[data-layout="phone-landscape"] .workspace[data-landscape-rail="show"] .write-layout.tree-open .floating-tree-trigger',
    );
  });

  it('規則限定手機橫拿，直拿、中等、寬版不受影響', () => {
    for (const r of [...rulesContaining(globalCss, '.write-layout.tree-open .landscape-cards-trigger')]) {
      for (const s of r.selectors.split(',')) {
        if (s.includes('.tree-open') && s.includes('-trigger')) {
          expect(s.trim().startsWith('html[data-layout="phone-landscape"]')).toBe(true);
        }
      }
    }
  });

  it('關閉時三顆浮動鈕的定位與尺寸不變，且關目錄後不被強制顯示', () => {
    const base = rulesContaining(globalCss, '.floating-tree-trigger,').find((r) =>
      /position:\s*fixed/.test(r.body),
    );
    expect(base?.body).toMatch(/width:\s*44px/);
    expect(base?.body).toMatch(/height:\s*44px/);
    expect(base?.body).toMatch(/z-index:\s*80/);
    expect(focusCss).toMatch(/top:\s*calc\(50% \+ 28px\)/);
    // 本張規則不含任何 display: grid/flex 的強制顯示
    expect(rulesContaining(globalCss, treeOpenTree)[0].body).not.toMatch(/display:\s*(grid|flex|block)/);
  });

  it('既有看卡片避讓規則（aside-open／yield-right）保留', () => {
    expect(hiddenBy(globalCss, 'html[data-layout="phone-landscape"] .write-layout.aside-open .floating-tree-trigger').length).toBeGreaterThan(0);
    expect(hiddenBy(globalCss, 'html[data-layout="phone-landscape"] .write-layout.yield-right .landscape-cards-trigger').length).toBeGreaterThan(0);
    expect(hiddenBy(focusCss, 'html[data-layout="phone-landscape"] .write-layout.yield-right .landscape-focus-trigger').length).toBeGreaterThan(0);
  });

  it('目錄開關狀態與入口連接保留：tree-open／tree-closed、togglePanel(left)、三顆入口 testid', () => {
    expect(writeScreenSrc).toContain("sidePanels.left ? 'tree-open' : 'tree-closed'");
    expect(editorSrc).toContain("togglePanel('left')");
    expect(editorSrc).toContain('data-testid="toggle-tree-floating"');
    expect(editorSrc).toContain('data-testid="toggle-cards-landscape"');
    expect(editorSrc).toContain('data-testid="toggle-focus-landscape"');
  });
});
