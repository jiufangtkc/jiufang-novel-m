import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  closeSidePanel,
  createInitialPanelsState,
  LayoutProvider,
  openSidePanel,
  type LayoutMode,
} from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { WriteScreen } from './WriteScreen';
import { demoFixtureState } from '../state/testing/sampleFixture';

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

/** 取出第一個選擇器完全相符的規則內容 */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`找不到規則：${selector}`);
  return m[1];
}
function px(body: string, prop: string): number {
  const m = new RegExp(`${prop}:\\s*([0-9.]+)px`).exec(body);
  if (!m) throw new Error(`找不到 ${prop}`);
  return Number(m[1]);
}

// 由正式 CSS 讀出的數值
const BASE_PAD = px(ruleBody('html[data-layout="medium"] .editor-input'), 'padding-left');
const FONT = Number(/font-size:\s*calc\((\d+)px/.exec(ruleBody('html[data-layout="medium"] .editor-input'))![1]);
const MAX_CHARS = Number(/calc\((\d+)\s*\*/.exec(ruleBody('html[data-layout="medium"] .editor-input'))![1]);
const YIELD_PAD = px(ruleBody('html[data-layout="medium"] .is-yielding .editor-input'), 'padding-left');
const TREE_W = px(ruleBody('html[data-layout="medium"] .tree-pane'), 'width');
const cardsVar = /--medium-cards-width:\s*min\((\d+)px,\s*(\d+)vw\)/.exec(css)!;
const CARDS_MAX = Number(cardsVar[1]);
const CARDS_VW = Number(cardsVar[2]);
const CHAR_W = FONT + 0.5; // 標準字級 100%：1em + 字距 0.5px

type State = 'closed' | 'tree' | 'cards';

/** 依正式 CSS 數值計算正文外框寬與有效內容寬 */
function measure(viewport: number, state: State) {
  const cardsW = Math.min(CARDS_MAX, (CARDS_VW / 100) * viewport);
  const taken = state === 'tree' ? TREE_W : state === 'cards' ? cardsW : 0;
  const pane = viewport - taken;
  const yielding = state !== 'closed';
  const pad = yielding ? YIELD_PAD : BASE_PAD;
  const box = Math.min(MAX_CHARS * CHAR_W, pane);
  const content = box - pad * 2;
  return { cardsW, taken, pane, box, content, chars: content / CHAR_W };
}

function render(mode: LayoutMode, panels: { left?: boolean; right?: boolean }): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: null, initialPanels: panels },
        createElement(
          MemoryRouter,
          { initialEntries: ['/p/fog/write/ch-sample-wo55'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/p/:projectId/write/:chapterId', element: createElement(WriteScreen) }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-89：中等開目錄或看卡片時保住正文行寬', () => {
  for (const [w, h] of [[900, 900], [768, 1024]] as const) {
    describe(`${w}×${h}`, () => {
      it('兩側關閉時有效內容寬維持原本（內距 40px）', () => {
        const m = measure(w, 'closed');
        expect(m.content).toBeCloseTo(MAX_CHARS * CHAR_W - BASE_PAD * 2, 5);
        expect(m.chars).toBeGreaterThanOrEqual(25);
      });
      it('開目錄：有效內容寬（扣除實際內距）每行至少約 18 字', () => {
        const m = measure(w, 'tree');
        expect(m.chars).toBeGreaterThanOrEqual(18);
        expect(m.content).toBeLessThan(m.box); // 不可用外框寬取代內容寬
      });
      it('看卡片：讓位寬度等於抽屜寬度，有效內容寬每行至少約 18 字', () => {
        const m = measure(w, 'cards');
        expect(m.taken).toBe(m.cardsW);
        expect(m.chars).toBeGreaterThanOrEqual(18);
      });
      it('關閉後恢復原本寬度與內距', () => {
        expect(measure(w, 'closed').taken).toBe(0);
        expect(measure(w, 'closed').content).toBe(measure(w, 'closed').box - BASE_PAD * 2);
      });
    });
  }

  it('讓位與抽屜共用同一寬度變數；抽屜被 45vw 縮小時不留固定邊距', () => {
    const rule = css.match(/html\[data-layout="medium"\] \.editor\.yield-right,\s*html\[data-layout="medium"\] \.editor-pane\.yield-right\s*\{([^}]*)\}/)!;
    expect(rule[1]).toMatch(/margin-right:\s*var\(--medium-cards-width\)/);
    const drawer = ruleBody('html[data-layout="medium"] .writing-cards-drawer');
    expect(drawer).toMatch(/width:\s*var\(--medium-cards-width\)/);
    expect(drawer).toMatch(/max-width:\s*var\(--medium-cards-width\)/);
    expect(drawer).not.toMatch(/380px/);
    // 子層不重複讓位
    expect(css).toMatch(/\.editor-pane\.yield-right \.editor\.yield-right,[\s\S]*?margin-right:\s*0\s*!important/);
    // 目錄是並排占位，寬度與 flex 基準一致，沒有另加邊距
    const tree = ruleBody('html[data-layout="medium"] .tree-pane');
    expect(tree).toMatch(/flex:\s*0 0 340px/);
    expect(css).not.toMatch(/\.yield-left[^{]*\{[^}]*margin-left/);
  });

  it('縮內距規則只限中等且只在讓位狀態，未套到寬版', () => {
    expect(css).toMatch(/html\[data-layout="medium"\] \.is-yielding \.editor-input/);
    expect(css).not.toMatch(/html\[data-layout="wide"\][^{]*is-yielding[^{]*\{/);
    expect(css).not.toMatch(/html\[data-layout="wide"\][^{]*yield-/);
    expect(ruleBody('html[data-layout="wide"] .editor-input')).toMatch(/padding-left:\s*32px/); // WO-115 由 40px 收到 32px
    expect(ruleBody('html[data-layout="medium"] .editor-input')).toMatch(/padding-left:\s*40px/);
    // WO-72 上限保護仍在
    expect(ruleBody('html[data-layout="medium"] .editor-input')).toMatch(/min\(calc\(30 \* \(1em \+ 0\.5px\)\), 100%\)/);
  });

  it('狀態連接：開目錄／看卡片才有讓位類別，關閉後沒有；寬版不帶讓位類別', () => {
    expect(render('medium', { left: true, right: false })).toContain('is-yielding');
    expect(render('medium', { left: false, right: true })).toContain('yield-right');
    expect(render('medium', { left: false, right: false })).not.toContain('is-yielding');
    expect(render('wide', { left: true, right: false })).not.toContain('is-yielding');
  });

  it('中等左右最多開一邊，關閉後不自動恢復另一邊', () => {
    const opts = { mode: 'medium' as const, wideColumns: null };
    let st = createInitialPanelsState({ left: true, right: false }, opts);
    st = openSidePanel(st, 'right', opts);
    expect(st.sidePanels.left && st.sidePanels.right).toBe(false);
    st = closeSidePanel(st, 'right', opts);
    expect(st.sidePanels.left).toBe(false);
  });
});
