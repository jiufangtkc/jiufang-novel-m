import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { isTabActive } from '../components/AppNav';
import { type LayoutMode } from '../layout';
import { LayoutProvider } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { FontLicenseScreen } from './FontLicenseScreen';
import { SettingsScreen } from './SettingsScreen';
import { Workspace } from './Workspace';

const PROJECT_ID = 'fog';
const LAYOUT_MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];

function settingsNavAnchor(html: string): string | undefined {
  const match = html.match(/<a\b[^>]*data-testid="nav-settings"[^>]*>/);
  return match?.[0];
}

function renderWorkspaceAt(path: string, mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode },
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
                createElement(Route, { path: 'settings', element: createElement(SettingsScreen) }),
                createElement(Route, { path: 'font-license', element: createElement(FontLicenseScreen) }),
              ],
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-85 芫荽字型授權導覽', () => {
  it('isTabActive：font-license 路徑視為設定分頁啟用', () => {
    expect(isTabActive('settings', `/p/${PROJECT_ID}/font-license`)).toBe(true);
    expect(isTabActive('write', `/p/${PROJECT_ID}/font-license`)).toBe(false);
  });

  it('設定頁可進入授權內頁連結', () => {
    const html = renderWorkspaceAt(`/p/${PROJECT_ID}/settings`, 'phone-portrait');
    expect(html).toContain('data-testid="font-license-link"');
    expect(html).toContain(`href="/p/${PROJECT_ID}/font-license"`);
    expect(html).toContain('芫荽字型授權');
  });

  it('授權頁四種版面皆亮起設定分頁（data-nav-active）', () => {
    for (const mode of LAYOUT_MODES) {
      const html = renderWorkspaceAt(`/p/${PROJECT_ID}/font-license`, mode);
      expect(html).toContain('data-testid="font-license-screen"');
      const settingsNav = settingsNavAnchor(html);
      expect(settingsNav, `${mode} 應有設定分頁`).toBeDefined();
      expect(settingsNav).toContain('data-nav-active="true"');
      expect(settingsNav).toContain('aria-current="page"');
    }
  });

  it('授權頁提供返回設定，且 OFL 全文檔可供載入顯示', () => {
    const html = renderWorkspaceAt(`/p/${PROJECT_ID}/font-license`, 'phone-portrait');
    expect(html).toContain('data-testid="font-license-back"');
    expect(html).toContain('aria-label="返回設定"');

    const screenSource = readFileSync(new URL('./FontLicenseScreen.tsx', import.meta.url), 'utf8');
    expect(screenSource).toContain("navigate(`/p/${project.id}/settings`)");
    expect(screenSource).toContain('data-testid="font-license-body"');

    const ofl = readFileSync(new URL('../../public/fonts/OFL.txt', import.meta.url), 'utf8');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(ofl).toContain('PERMISSION & CONDITIONS');
    expect(ofl.length).toBeGreaterThan(2000);
  });
});