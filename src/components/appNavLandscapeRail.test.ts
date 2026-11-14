import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LayoutProvider } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { Workspace } from '../screens/Workspace';
import { showsLandscapeRail } from './AppNav';

describe('WO-68 手機橫拿直排分頁何時顯示', () => {
  it('目錄頁（尚未進章）顯示', () => {
    expect(showsLandscapeRail('/p/abc/write', false)).toBe(true);
    expect(showsLandscapeRail('/p/abc/write/', false)).toBe(true);
  });

  it('已進章：目錄抽屜關著不顯示（只留正文），打開才顯示', () => {
    expect(showsLandscapeRail('/p/abc/write/ch-1', false)).toBe(false);
    expect(showsLandscapeRail('/p/abc/write/ch-1', true)).toBe(true);
  });

  it('資料集、檔案、統計、紀錄、設定一律顯示，回得了寫作', () => {
    for (const tab of ['cards', 'files', 'stats', 'logs', 'settings']) {
      expect(showsLandscapeRail(`/p/abc/${tab}`, false)).toBe(true);
    }
  });
});

function renderWorkspace(mode: 'phone-landscape' | 'phone-portrait' | 'medium' | 'wide', path: string) {
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: mode },
      createElement(
        SampleProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId',
              element: createElement(Workspace),
              children: createElement(Route, { path: '*', element: createElement('div') }),
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-68 Workspace 只在手機橫拿標記直排分頁', () => {
  it('手機橫拿的檔案頁加上標記，其他版面不加', () => {
    const projectPath = '/p/fog/files';
    const landscape = renderWorkspace('phone-landscape', projectPath);
    expect(landscape).toContain('data-landscape-rail="show"');
    expect(landscape).toContain('data-testid="nav-rail"');
    expect(renderWorkspace('phone-landscape', '/p/fog/write/ch-1')).not.toContain('data-landscape-rail');
    for (const mode of ['phone-portrait', 'medium', 'wide'] as const) {
      expect(renderWorkspace(mode, projectPath)).not.toContain('data-landscape-rail');
    }
  });
});

describe('WO-68 樣式：只放出橫拿直排分頁，不叫出底部分頁', () => {
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  it('原本橫拿兩組分頁都藏起的規則保留', () => {
    expect(css).toContain('html[data-layout="phone-landscape"] .nav-rail { display: none; }');
    expect(css).toContain('html[data-layout="phone-landscape"] .bottom-nav { display: none; }');
  });

  it('有標記時顯示直排分頁，寬 72，打字時仍藏', () => {
    expect(css).toMatch(
      /html\[data-layout="phone-landscape"\] \.workspace\[data-landscape-rail="show"\] > \.nav-rail \{[^}]*display: flex;[^}]*width: 72px;/,
    );
    expect(css).toMatch(
      /html\.landscape-writing\[data-layout="phone-landscape"\] \.workspace\[data-landscape-rail="show"\] > \.nav-rail \{\s*display: none;/,
    );
    expect(css).not.toMatch(/data-landscape-rail="show"\][^{]*\.bottom-nav/);
  });
});
