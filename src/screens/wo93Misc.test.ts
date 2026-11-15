import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LayoutProvider } from '../layout';
import { createState, reduce, SampleProvider } from '../state/sampleStore';
import { CardsScreen } from './CardsScreen';
import { FilesScreen } from './FilesScreen';
import { SettingsScreen } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { Workspace } from './Workspace';
import { WriteScreen } from './WriteScreen';
import { treeAddedToast } from '../copy/userFacing';

describe('WO-93 其餘小事包', () => {
  const workspaceSrc = () => readFileSync(new URL('./Workspace.tsx', import.meta.url), 'utf8');
  const writeSrc = () => readFileSync(new URL('./WriteScreen.tsx', import.meta.url), 'utf8');
  const categoryMgrSrc = () => readFileSync(new URL('../components/CategoryManager.tsx', import.meta.url), 'utf8');
  const globalCss = () => readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  it('1. 換分頁時只在路徑變了且有提示才清 toast，effect 不依賴 actions', () => {
    const src = workspaceSrc();
    expect(src).toContain('WO-93');
    expect(src).toContain('previousPathnameRef');
    expect(src).toMatch(/if \(state\.toast != null\)/);
    expect(src).not.toMatch(/\}, \[pathname, actions\]\)/);
    expect(src).toMatch(/\}, \[pathname\]\)/);
  });

  it('1b. 重複 toast\(null\) 不產生新 state，避免換分頁後畫面卡在寫作頁', () => {
    const base = reduce(createState(new Date()), { type: 'toast', message: '測試' });
    const cleared = reduce(base, { type: 'toast', message: null });
    expect(cleared.toast).toBeNull();
    const again = reduce(cleared, { type: 'toast', message: null });
    expect(again).toBe(cleared);
  });

  it('1c. 分頁路由各自渲染對應畫面（換分頁後不應仍停在寫作目錄）', () => {
    const renderAt = (path: string) =>
      renderToStaticMarkup(
        createElement(
          SampleProvider,
          null,
          createElement(
            LayoutProvider,
            { initialMode: 'phone-portrait' },
            createElement(
              MemoryRouter,
              { initialEntries: [path] },
              createElement(
                Routes,
                null,
                createElement(Route, {
                  path: '/p/:projectId',
                  element: createElement(Workspace),
                  children: [
                    createElement(Route, { path: 'write/:chapterId?', element: createElement(WriteScreen) }),
                    createElement(Route, { path: 'cards', element: createElement(CardsScreen) }),
                    createElement(Route, { path: 'files', element: createElement(FilesScreen) }),
                    createElement(Route, { path: 'stats', element: createElement(StatsScreen) }),
                    createElement(Route, { path: 'settings', element: createElement(SettingsScreen) }),
                  ],
                }),
              ),
            ),
          ),
        ),
      );

    const write = renderAt('/p/fog/write');
    const cards = renderAt('/p/fog/cards');
    const files = renderAt('/p/fog/files');
    expect(write).toContain('data-testid="write-screen"');
    expect(write).not.toContain('data-testid="cards-screen"');
    expect(cards).toContain('data-testid="cards-screen"');
    expect(cards).not.toContain('data-testid="write-screen"');
    expect(files).toContain('data-testid="files-screen"');
    expect(files).not.toContain('data-testid="write-screen"');
  });

  it('2. 手機直拿與中等版面的底部分頁維持 grid 平均分布', () => {
    const css = globalCss();
    expect(css).toContain('grid-template-columns: repeat(5, 1fr)');
    expect(css).toContain('html[data-layout="phone-portrait"] .bottom-nav { display: grid; }');
    expect(css).toContain('html[data-layout="medium"] .bottom-nav { display: grid; }');
  });

  it('3. 刪除正在看的章後會導向相鄰章', () => {
    const src = writeSrc();
    expect(src).toContain('neighborChapterId');
    expect(src).toContain('loseCurrentChapter');
    expect(src).toMatch(/navigate\(`\/p\/\$\{book\.id\}\/write\/\$\{neighborId\}`\)/);
  });

  it('4. 分類改名與新增對話框支援 Enter 送出', () => {
    const src = categoryMgrSrc();
    expect(src).toMatch(/category-rename-input[\s\S]*event\.key === 'Enter'/);
    expect(src).toMatch(/category-add-input[\s\S]*event\.key === 'Enter'/);
  });

  it('6. 觸控版面不顯示滑鼠與鍵盤快捷鍵提示', () => {
    const src = writeSrc();
    expect(src).toContain('showKeyboardHints = desktop && pointer !== \'touch\'');
    expect(src).toContain('showKeyboardHints ? <small>F2</small>');
    expect(src).not.toMatch(/treeDesktopHint\(\)[\s\S]*desktop &&/);
  });

  it('5. 分類清單下方同時有「整理分類」與「新增分類」', () => {
    const src = readFileSync(new URL('./CardsScreen.tsx', import.meta.url), 'utf8');
    expect(src).toContain('data-testid="cards-categories-footer"');
    expect(src).toContain('data-testid="organize-categories-btn"');
    expect(src).toContain('data-testid="add-category-entry-btn"');
    expect(src).toContain('cards-add-cat-btn');
    expect(src).toContain('openAddCategoryDialog');
  });

  it('7. 新增章 toast 不帶尾端全形空白', () => {
    expect(treeAddedToast('第02章\u3000')).toBe('已新增「第02章」');
    expect(treeAddedToast('新章')).toBe('已新增「新章」');
  });
});