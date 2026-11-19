/**
 * WO-126 返工：匯入視窗鍵盤隔離與輸入法 Enter 防護。node 環境，不依賴 jsdom。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IME_ENTER_WINDOW_MS } from '../editor/enterGuard';
import { importDialogTabTarget, shouldCloseImportOnEscape, shouldHoldImportEnter } from './ImportTextDialog';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('匯入視窗開啟時首頁 inert', () => {
  const home = read('./HomeScreen.tsx');
  it('header、main、footer 在匯入視窗開著時都 inert，視窗放在 inert 區塊外', () => {
    expect(home).toContain('<header className="topbar" inert={welcome.show || importText.open}>');
    expect(home).toContain('<main className="home-main" inert={welcome.show || importText.open}>');
    expect(home).toContain('<footer className="home-actions" inert={welcome.show || importText.open}>');
    expect(home.indexOf('</footer>')).toBeLessThan(home.indexOf('{importText.dialog}'));
  });
  it('背景捲動隔離', () => {
    expect(home).toContain("data-import-open={importText.open ? 'true' : undefined}");
    expect(read('../styles/global.css')).toMatch(/\.home\[data-import-open='true'\] \.home-main\s*\{\s*overflow: hidden;/);
  });
  it('hook 以是否有視窗工作階段回報 open', () => {
    expect(read('./useImportTextFile.tsx')).toContain('open: session !== null');
  });
});

describe('視窗內焦點', () => {
  it('Tab 在視窗內繞圈', () => {
    expect(importDialogTabTarget(3, 2, false)).toBe(0);
    expect(importDialogTabTarget(3, 0, true)).toBe(2);
    expect(importDialogTabTarget(3, 1, false)).toBeNull();
    expect(importDialogTabTarget(3, -1, false)).toBe(0);
    expect(importDialogTabTarget(0, -1, false)).toBeNull();
  });
  it('分批預覽時焦點移到仍可操作的「取消」，預覽中取消鈕不停用，Escape 由表單接收', () => {
    const src = read('./ImportTextDialog.tsx');
    expect(src).toMatch(/if \(working === 'preview'\) cancelRef\.current\?\.focus\(\)/);
    expect(src).toMatch(/ref=\{cancelRef\}[^>]*data-testid="import-text-cancel"[^>]*disabled=\{locked\}/);
    expect(src).toContain('onKeyDown={trapTab}');
  });
  // 驗收路徑：看分章預覽 → 點一下第二章的章名 → 按 Escape（焦點已離開表單）。
  it('Escape 判斷只看按鍵與是否寫入中，不看焦點', () => {
    expect(shouldCloseImportOnEscape('Escape', false)).toBe(true);
    expect(shouldCloseImportOnEscape('Escape', true)).toBe(false);
    expect(shouldCloseImportOnEscape('Enter', false)).toBe(false);
  });
  it('Escape 監聽掛在 document 而非表單，點過章名後仍可取消', () => {
    const src = read('./ImportTextDialog.tsx');
    expect(src).toContain("document.addEventListener('keydown', onKey)");
    expect(src).toContain("document.removeEventListener('keydown', onKey)");
    expect(src).toContain('shouldCloseImportOnEscape(event.key, locked)');
    const formTag = src.slice(src.indexOf('<form'), src.indexOf('<h2 id="import-text-title"'));
    expect(formTag).not.toContain('Escape');
  });
  it('點到視窗內一般文字會把焦點補回視窗內控制項', () => {
    const src = read('./ImportTextDialog.tsx');
    expect(src).toContain('restoreFocusIfLost(event.target as HTMLElement)');
    expect(src).toContain("target.closest('button, input, a, select, textarea')");
    expect(src).toContain('[headingRef, inputRef, cancelRef]');
  });
  it('關閉後焦點回匯入按鈕、寫入期間鎖定保留', () => {
    const hook = read('./useImportTextFile.tsx');
    expect(hook).toContain('buttonRef.current?.focus()');
    expect(hook).toContain('if (lockRef.current) return;');
  });
});

describe('例子欄 Enter 沿用 decideEnterKey', () => {
  const base = { key: 'Enter', isComposing: false, keyCode: 13, timeStamp: 10_000, lastCompositionEndTimeStamp: null, composingFlag: false };
  it('組字期間按 Enter 不送出', () => {
    expect(shouldHoldImportEnter({ ...base, isComposing: true, composingFlag: true })).toBe(true);
  });
  it('組字剛結束的 Enter（旗標已清、非 229）不送出', () => {
    expect(shouldHoldImportEnter({ ...base, lastCompositionEndTimeStamp: 10_000 - IME_ENTER_WINDOW_MS + 10 })).toBe(true);
  });
  it('組字完全結束後的正常 Enter 可送出預覽', () => {
    expect(shouldHoldImportEnter({ ...base, lastCompositionEndTimeStamp: 10_000 - IME_ENTER_WINDOW_MS - 500 })).toBe(false);
    expect(shouldHoldImportEnter(base)).toBe(false);
  });
  it('欄位接線使用 decideEnterKey 並記錄 compositionend 時間', () => {
    const src = read('./ImportTextDialog.tsx');
    expect(src).toContain("import { decideEnterKey } from '../editor/enterGuard'");
    expect(src).toContain('lastCompositionEndRef.current = event.timeStamp');
    expect(src).toContain('lastCompositionEndTimeStamp: lastCompositionEndRef.current');
  });
});
