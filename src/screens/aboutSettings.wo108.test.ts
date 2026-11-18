import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  channelForHostname,
  settingsVersionText,
  versionAria,
  welcomeVersionText,
} from '../copy/aboutCopy';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { SettingsScreen } from './SettingsScreen';
import { WelcomePlaceholder } from './WelcomePlaceholder';
import { Workspace } from './Workspace';

const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];

function render(path: string, mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
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
                createElement(Route, { path: 'welcome', element: createElement(WelcomePlaceholder) }),
              ],
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-108 版本來源', () => {
  it('版本號碼等於 package.json 的 version（單一來源）', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});

describe('WO-108 正式／預覽判斷', () => {
  it('只有精確的正式站 hostname 是正式版', () => {
    expect(channelForHostname('jiufang-novel-m.pages.dev')).toBe('production');
  });
  it('分支預覽、本機、含字串但不相等、空值都是預覽版', () => {
    for (const h of [
      'abc123.jiufang-novel-m.pages.dev',
      'm-welcome.jiufang-novel-m.pages.dev',
      'localhost',
      '127.0.0.1',
      'jiufang-novel-m.pages.dev.evil.example',
      'xjiufang-novel-m.pages.dev',
      '',
      null,
      undefined,
    ]) {
      expect(channelForHostname(h)).toBe('preview');
    }
  });
});

describe('WO-108 版本字串與朗讀', () => {
  it('逐字比對，全形括號、不寫 v', () => {
    expect(settingsVersionText('0.1.0', 'preview')).toBe('0.1.0（預覽版）');
    expect(settingsVersionText('0.1.0', 'production')).toBe('0.1.0（正式版）');
    expect(welcomeVersionText('0.1.0')).toBe('版本 0.1.0');
    expect(versionAria('0.1.0', 'preview')).toBe('版本 0.1.0，預覽版');
    expect(versionAria('0.1.0', 'production')).toBe('版本 0.1.0，正式版');
  });
});

describe('WO-108 設定頁關於組', () => {
  for (const mode of MODES) {
    it(`${mode}：關於組在隱私列之後，兩列可見，原組順序不變`, () => {
      const html = render('/p/fog/settings', mode);
      const order = ['settings-goal-heading', 'day-end-hour', 'appearance-section', 'half-width-setting', 'privacy-link', 'about-section'];
      const at = order.map((k) => html.indexOf(k));
      expect(at.every((n) => n >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(html).toContain('>關於</h2>');
      expect(html).toContain('>版本</strong>');
      expect(html).toContain('0.1.0（預覽版）');
      expect(html).toContain('>再看一次歡迎導覽</strong>');
      expect(html).toContain('調整每日目標和新稿子的全書目標');
      expect(html).toContain('aria-label="再看一次歡迎導覽，可以調整每日目標和新稿子的全書目標"');
    });
  }

  it('版本列不可點：沒有按鈕、連結語意，朗讀合併一次', () => {
    const html = render('/p/fog/settings', 'phone-portrait');
    const m = html.match(/<div[^>]*data-testid="about-version"[^>]*>[\s\S]*?<\/div>/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/<(a|button)\b|onclick|role="button"/i);
    expect(m![0]).toContain('aria-label="版本 0.1.0，預覽版"');
  });

  it('再看一次是整列連結，指向過渡空頁', () => {
    const html = render('/p/fog/settings', 'phone-portrait');
    expect(html).toMatch(/<a[^>]*class="setting-row about-welcome-row"[^>]*href="\/p\/fog\/welcome"/);
  });

  it('列高不低於 52', () => {
    const css = readFileSync('src/styles/global.css', 'utf8');
    const row = Number(/\.setting-row \{[^}]*min-height: (\d+)px/.exec(css)![1]);
    const welcome = Number(/\.about-welcome-row \{ min-height: (\d+)px/.exec(css)![1]);
    expect(Math.max(row, welcome)).toBeGreaterThanOrEqual(52);
  });
});

describe('WO-108 過渡空頁', () => {
  it('有返回設定按鈕，不含任何輸入欄位', () => {
    const html = render('/p/fog/welcome', 'phone-portrait');
    expect(html).toContain('data-testid="welcome-placeholder"');
    expect(html).toContain('aria-label="返回設定"');
    expect(html).not.toContain('<input');
  });
});
