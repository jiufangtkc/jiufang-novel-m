import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as copy from '../copy/symbolBarCopy';
import { WRITING_SYMBOLS } from '../editor/writingSymbols';
import { SymbolBar } from './SymbolBar';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SIMPLIFIED_CHARS = /[删暂记说这为没现还进时请标样选会备储复预关条满丢仅写显确认实体处个变无损坏较资击顿问号单书叹]/u;

function render(showTitles: boolean) {
  return renderToStaticMarkup(
    React.createElement(SymbolBar, {
      textareaRef: { current: null },
      onInsert: () => undefined,
      onCollapse: () => undefined,
      showTitles,
    }),
  );
}

describe('WO-142 SymbolBar 結構', () => {
  it('14 個符號鍵、收起鈕，全部是 type="button"，有 aria 名稱', () => {
    const html = render(false);
    expect(html).toContain(`aria-label="${copy.SYMBOL_BAR_ARIA}"`);
    expect(html).toContain('role="toolbar"');
    expect(html.match(/data-symbol-id="/g)).toHaveLength(14);
    for (const symbol of WRITING_SYMBOLS) {
      expect(html).toContain(`aria-label="${symbol.ariaLabel}"`);
      expect(html).toContain(`>${symbol.face}</button>`);
    }
    expect(html).toContain(`aria-label="${copy.SYMBOL_BAR_COLLAPSE_ARIA}"`);
    expect(html).toContain(`>${copy.SYMBOL_BAR_COLLAPSE_LABEL}</button>`);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(15);
    for (const tag of buttons) expect(tag).toContain('type="button"');
  });

  it('兩條分隔線（三組之間）', () => {
    expect(render(false).match(/role="separator"/g)).toHaveLength(2);
  });

  it('全形空白 title 只在電腦（showTitles）出現', () => {
    expect(render(true)).toContain(`title="${copy.SYMBOL_SPACE_TITLE}"`);
    expect(render(false)).not.toContain('title=');
  });

  it('長鍵：空白、刪節號、破折號', () => {
    const html = render(false);
    expect(html.match(/symbol-key is-long/g)).toHaveLength(3);
  });
});

describe('WO-142 SymbolBar 不搶焦點（原始碼比對）', () => {
  const src = read('./SymbolBar.tsx');

  it('pointerdown 呼叫 keepBodyFocusOnPointerDown 並 preventDefault；mousedown 也 preventDefault；點擊用 onClick', () => {
    expect(src).toContain("import { keepBodyFocusOnPointerDown } from '../editor/bodyFocusGuard'");
    expect(src).toContain('keepBodyFocusOnPointerDown(textareaRef.current, event)');
    expect(src).toMatch(/onPointerDown: guard/);
    expect(src).toMatch(/event\.preventDefault\(\)/);
    expect(src).toMatch(/onMouseDown:[^\n]*preventDefault\(\)/);
    expect(src).toContain('onClick={() => onInsert(symbol.id)}');
    expect(src).toContain('onClick={onCollapse}');
    // 收起鈕與符號鍵都套用同一組不搶焦點的處理
    expect((src.match(/\{\.\.\.noSteal\}/g) ?? []).length).toBe(2);
  });

  it('不硬寫畫面字串（只引用 symbolBarCopy）', () => {
    expect(src).toContain("from '../copy/symbolBarCopy'");
    expect(src).not.toMatch(/>\s*收起\s*</);
    expect(src).not.toContain('全形標點符號列');
  });
});

describe('WO-142 用字守衛', () => {
  const expected: Record<string, string> = {
    SYMBOL_BAR_ARIA: '全形標點符號列',
    SYMBOL_BAR_COLLAPSE_LABEL: '收起',
    SYMBOL_BAR_COLLAPSE_ARIA: '收起符號列',
    SYMBOL_BAR_MENU_SHOW: '顯示符號列',
    SYMBOL_BAR_MENU_HIDE: '隱藏符號列',
    SYMBOL_BAR_COMPOSING_TOAST: '先把正在輸入的字打完，再點符號。',
    SYMBOL_SPACE_FACE: '空白',
    SYMBOL_SPACE_ARIA: '全形空白',
    SYMBOL_SPACE_TITLE: '全形空白（段首空兩格用）',
    SYMBOL_ARIA_COMMA: '逗號',
    SYMBOL_ARIA_PERIOD: '句號',
    SYMBOL_ARIA_ENUM_COMMA: '頓號',
    SYMBOL_ARIA_QUESTION: '問號',
    SYMBOL_ARIA_EXCLAMATION: '驚嘆號',
    SYMBOL_ARIA_COLON: '冒號',
    SYMBOL_ARIA_SEMICOLON: '分號',
    SYMBOL_ARIA_ELLIPSIS: '刪節號',
    SYMBOL_ARIA_DASH: '破折號',
    SYMBOL_ARIA_QUOTE: '引號',
    SYMBOL_ARIA_DOUBLE_QUOTE: '雙引號',
    SYMBOL_ARIA_BOOK_TITLE: '書名號',
    SYMBOL_ARIA_ARTICLE_TITLE: '篇名號',
  };

  it('常數齊全且逐字相符（沒有多餘常數）', () => {
    expect(Object.keys(copy).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      expect((copy as Record<string, string>)[key]).toBe(value);
    }
  });

  it('無簡體字', () => {
    for (const value of Object.values(copy)) expect(value).not.toMatch(SIMPLIFIED_CHARS);
  });

  it('符號清單的無障礙名稱來自 copy 常數', () => {
    expect(WRITING_SYMBOLS.map((s) => s.ariaLabel)).toEqual([
      '全形空白',
      '逗號',
      '句號',
      '頓號',
      '問號',
      '驚嘆號',
      '冒號',
      '分號',
      '刪節號',
      '破折號',
      '引號',
      '雙引號',
      '書名號',
      '篇名號',
    ]);
  });
});

describe('WO-142 EditorPane 接線（原始碼比對）', () => {
  const src = read('../screens/EditorPane.tsx');
  const surface = read('../editor/useWritingSurface.ts');

  it('選單項、選單項數與 getMenuItemCount 一致', () => {
    expect(src).toContain("id: 'symbol-bar-toggle'");
    expect(src).toContain('symbolBarEnabled ? SYMBOL_BAR_MENU_HIDE : SYMBOL_BAR_MENU_SHOW');
    // extraMenuItems 的固定項（不含有選取才出現的那個）：quick-idea-open（WO-144）、versions-open、trash-open、symbol-bar-toggle
    const block = src.slice(src.indexOf('const extraMenuItems'), src.indexOf('const formatTools'));
    const ids = [...block.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    expect(ids).toEqual([
      'quick-idea-open',
      'versions-open',
      'trash-open',
      'symbol-bar-toggle',
      'trash-move-selection',
    ]);
    // 扣掉有選取才出現的 trash-move-selection、橫拿打字時不列的 quick-idea-open（WO-144 返工 B）
    const fixed = ids.length - 2;
    // getMenuItemCount = 排版項（1）＋固定額外項＋（非橫拿打字時的）記靈感＋選取項
    expect(src).toContain(
      `return ${fixed + 1} + (quickIdeaAvailable ? 1 : 0) + (hasSel ? 1 : 0);`,
    );
    // 記靈感只在 quickIdeaAvailable 時列入選單；橫拿打字（keyboard.landscape）時為 false
    // （返工 B）選單開著時用開啟當下鎖定的值，不直接用即時的 keyboard.landscape
    expect(src).toContain(
      'const quickIdeaAvailable = isQuickIdeaAvailable(quickIdeaGuardRef.current, keyboard.landscape);',
    );
    expect(block).toMatch(/\.\.\.\(quickIdeaAvailable\s*\?\s*\[\s*\{\s*id: 'quick-idea-open'/);
  });

  it('符號列用 insertSymbol，不用 replaceText；組字中提示用 copy 常數', () => {
    expect(src).toContain('const { ref, replaceText, insertSymbol } = useWritingSurface(');
    const handler = src.slice(src.indexOf('const handleInsertSymbol'), src.indexOf('const isYieldLeft'));
    expect(handler).toContain('insertSymbol(symbolId)');
    expect(handler).not.toContain('replaceText');
    expect(handler).toContain('SYMBOL_BAR_COMPOSING_TOAST');
    expect(handler).toContain('isComposingRef.current');
    expect(src).toContain("from '../copy/symbolBarCopy'");
    expect(src).not.toContain('先把正在輸入的字打完，再點符號');
  });

  it('顯示條件：開著、非編輯卡片、手指需有焦點、滑鼠一直顯示；收起鈕＝把設定關掉', () => {
    expect(src).toContain('symbolBarEnabled && !cardEdit.editing && (pointer === \'mouse\' || focused)');
    expect(src).toContain('onCollapse={() => setSymbolBarEnabled(false)}');
    expect(src).toContain("showSymbolBar ? 'has-symbol-bar' : ''");
    // 符號列在正文與底部狀態列之間
    const textarea = src.indexOf('<textarea');
    const bar = src.indexOf('<SymbolBar');
    const footer = src.indexOf('<footer className="editor-status"');
    expect(textarea).toBeGreaterThan(0);
    expect(bar).toBeGreaterThan(textarea);
    expect(footer).toBeGreaterThan(bar);
  });

  it('useWritingSurface 回傳 insertSymbol；插入走 execCommand 並以 insertSymbolInto 處理，不用 replaceText 路徑', () => {
    expect(surface).toContain("document.execCommand('insertText', false, text)");
    expect(surface).toContain('return { ref, dirty, replaceText, insertSymbol };');
    expect(surface).toContain('insertSymbolInto(symbolId');
    const core = read('../editor/symbolInsert.ts');
    expect(core).toContain('setRangeText(plan.insertText, start, end');
    expect(core).not.toContain('replaceText');
  });

  it('專注模式與橫拿的版面規則存在，且只用主題變數（不寫死色碼）', () => {
    const css = read('./symbolBar.css');
    expect(css).toContain('html.landscape-writing .symbol-bar');
    expect(css).toContain('--sb-key: 36px');
    expect(css).toContain('html[data-focus-mode="true"][data-layout="wide"] .editor.has-symbol-bar');
    expect(css).toContain('--sb-key: 44px');
    expect(css).toContain('--sb-long: 60px');
    expect(css).toContain('--sb-long: 56px');
    expect(css).toContain('var(--panel)');
    expect(css).toContain('var(--border)');
    // 手機橫拿：左右各內縮 72px，讓出 44px 圓形浮動鈕（距邊 12px）
    expect(css).toMatch(
      /html\[data-layout="phone-landscape"\] \.symbol-bar,\s*html\.landscape-writing \.symbol-bar \{\s*padding-left: calc\(72px/,
    );
    expect(css).toContain('padding-right: calc(72px');
    // 唯一的色碼是淡出遮罩用的 #000（只決定透明度，不是畫面顏色）
    const hexes = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(new Set(hexes)).toEqual(new Set(['#000']));
  });
});
