/**
 * WO-121：開稿 busy 用字集中、四個入口共用同一段開檔流程、點擊直接開選檔。
 * node 環境：只用純函式、靜態畫面輸出與原始碼檢查；不依賴 jsdom／testing-library。
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OPEN_DB_FAIL, OPEN_FILE_BUSY, openButtonLabel } from '../copy/userFacing';
import { LayoutProvider } from '../layout';
import { WelcomeTour, type WelcomeTourProps } from './WelcomeTour';

const src = (path: string) => readFileSync(path, 'utf8');

function renderFinish(extra: Partial<WelcomeTourProps>): string {
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: 'phone-portrait' },
      createElement(
        MemoryRouter,
        null,
        createElement(WelcomeTour, {
          entry: 'first',
          todayWords: 0,
          dailyGoal: 1000,
          met: false,
          onExit: () => undefined,
          initialPage: 'finish',
          channel: 'preview',
          ...extra,
        }),
      ),
    ),
  );
}

describe('WO-121：「正在開啟…」用字與切換', () => {
  it('用字集中在 userFacing，使用單一省略號字元', () => {
    expect(OPEN_FILE_BUSY).toBe('正在開啟…');
    expect(OPEN_FILE_BUSY).not.toContain('...');
    expect(OPEN_FILE_BUSY.endsWith('…')).toBe(true);
    expect(OPEN_DB_FAIL).toBe('這個檔案打不開。請選擇使用九方編輯器編寫的 .db 稿件檔。');
  });

  it('busy 時各入口顯示「正在開啟…」，結束（成功、失敗、取消）後恢復原名', () => {
    for (const idle of ['開啟稿子', '開啟別的稿子']) {
      expect(openButtonLabel(true, idle)).toBe('正在開啟…');
      expect(openButtonLabel(false, idle)).toBe(idle);
    }
  });

  it('導覽收尾「開始寫」（開啟稿子）：busy 顯示「正在開啟…」且不能再按，結束後恢復', () => {
    const busy = renderFinish({ finishOutcome: 'open', openBusy: true });
    expect(busy).toContain('正在開啟…');
    expect(busy).not.toContain('開始寫');
    expect(busy).toMatch(/data-testid="welcome-primary"[^>]*disabled/);
    expect(busy).toContain('aria-busy="true"');
    const idle = renderFinish({ finishOutcome: 'open', openBusy: false });
    expect(idle).toContain('開始寫');
    expect(idle).not.toContain('正在開啟…');
    expect(idle).not.toMatch(/data-testid="welcome-primary"[^>]*disabled/);
  });

  it('導覽收尾「開始寫」（開新稿子）與回首頁不受開檔 busy 影響', () => {
    const fresh = renderFinish({ finishOutcome: 'new', openBusy: true });
    expect(fresh).toContain('開始寫');
    expect(fresh).not.toContain('正在開啟…');
    const home = renderFinish({ finishOutcome: 'home', openBusy: true });
    expect(home).not.toContain('正在開啟…');
  });

  it('首頁、檔案頁的按鈕文字都經過 openButtonLabel，沒有自己寫死「正在開啟」', () => {
    const home = src('src/screens/HomeScreen.tsx');
    const files = src('src/screens/FilesScreen.tsx');
    expect(home).toContain("openButtonLabel(openFile.busy, '開啟稿子')");
    expect(files).toContain("openButtonLabel(openFile.busy, '開啟別的稿子')");
    for (const text of [home, files, src('src/screens/WelcomeTour.tsx'), src('src/screens/useOpenManuscriptFile.tsx')]) {
      expect(text).not.toContain('正在開啟');
    }
  });
});

describe('WO-121：入口共用同一段開檔流程', () => {
  it('首頁、檔案頁、再看一次都用 useOpenManuscriptFile；檔案頁沒有自己的 picker／importFile', () => {
    expect(src('src/screens/HomeScreen.tsx')).toContain('useOpenManuscriptFile()');
    expect(src('src/screens/WelcomeRevisitScreen.tsx')).toContain('useOpenManuscriptFile()');
    const files = src('src/screens/FilesScreen.tsx');
    expect(files).toContain('useOpenManuscriptFile()');
    expect(files).toContain('{openFile.input}');
    expect(files).not.toContain('openWithPicker');
    expect(files).not.toContain('actions.importFile');
    expect(files).not.toContain('openInputRef');
    expect(files).not.toContain('OPEN_DB_FAIL');
    // 文字檔匯入已搬到首頁（WO-120），檔案頁不再保留匯入入口。
    expect(files).not.toContain('actions.importTextFile');
    expect(files).not.toContain('data-testid="import-text-input"');
    expect(src('src/screens/HomeScreen.tsx')).toContain('useImportTextFile()');
    expect(src('src/screens/HomeScreen.tsx')).toContain('data-testid="import-text-file"');
  });

  it('檔案頁在條件 return（找不到稿子）之前呼叫 hook', () => {
    const files = src('src/screens/FilesScreen.tsx');
    expect(files.indexOf('useOpenManuscriptFile()')).toBeGreaterThan(-1);
    expect(files.indexOf('useOpenManuscriptFile()')).toBeLessThan(files.indexOf('if (!project) return'));
  });

  it('點擊直接呼叫 open（不先 await／effect／計時器）', () => {
    expect(src('src/screens/HomeScreen.tsx')).toContain('onClick={() => openFile.open()}');
    expect(src('src/screens/FilesScreen.tsx')).toContain('onClick={() => openFile.open()}');
    expect(src('src/screens/FilesScreen.tsx')).not.toMatch(/onClick=\{async/);
    const revisit = src('src/screens/WelcomeRevisitScreen.tsx');
    expect(revisit).toMatch(/exit === 'finish-open'\) \{[\s\S]*?openFile\.open\(/);
    expect(src('src/screens/HomeScreen.tsx')).toContain('openFile.open(() => welcome.dismiss())');
    const hook = src('src/screens/useOpenManuscriptFile.tsx');
    const open = hook.slice(hook.indexOf('const open ='), hook.indexOf('const input ='));
    expect(open).not.toMatch(/setTimeout|await |requestAnimationFrame|useEffect/);
  });

  it('導覽把 busy 傳到實際觸發的按鈕（首頁導覽與再看一次）', () => {
    expect(src('src/screens/HomeScreen.tsx')).toContain('openBusy={openFile.busy}');
    expect(src('src/screens/WelcomeRevisitScreen.tsx')).toContain('openBusy={openFile.busy}');
  });

  it('hook：支援 picker 走 openWithPicker、否則走 file input；成功、失敗、取消都解除 busy 並通知結果', () => {
    const hook = src('src/screens/useOpenManuscriptFile.tsx');
    expect(hook).toContain('if (busyRef.current) return;');
    expect(hook).toContain('if (canPickLocalFiles()) {');
    expect(hook).toContain('.openWithPicker()');
    expect(hook).toContain('inputRef.current?.click();');
    expect(hook).toContain('.importFile(file)');
    // 兩條路都在 finally 解除 busy。
    expect(hook.match(/\.finally\(end\)/g)?.length).toBe(2);
    expect(hook).toContain("settle('opened')");
    expect(hook).toContain("settle('cancelled')");
    expect(hook).toContain("settle('failed')");
    expect(hook.match(/actions\.toast\(OPEN_DB_FAIL\)/g)?.length).toBe(2);
    expect(hook).toContain("input.addEventListener('cancel'");
  });

  it('開檔流程沒有任何索取寫入權限的呼叫', () => {
    for (const file of [
      'src/screens/useOpenManuscriptFile.tsx',
      'src/screens/HomeScreen.tsx',
      'src/screens/FilesScreen.tsx',
      'src/screens/WelcomeRevisitScreen.tsx',
    ]) {
      expect(src(file)).not.toContain('requestPermission');
    }
    const disk = src('src/db/browserDisk.ts');
    const pick = disk.slice(disk.indexOf('export async function pickExistingDatabase'), disk.indexOf('async function pickSaveOnce'));
    expect(pick).not.toContain('requestPermission');
    expect(pick).not.toContain('queryPermission');
  });
});
