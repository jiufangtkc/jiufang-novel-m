import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { isTabActive } from '../components/AppNav';
import { PRIVACY_PARAGRAPHS, PRIVACY_TITLE } from '../copy/userFacing';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { PrivacyScreen } from './PrivacyScreen';
import { SettingsScreen } from './SettingsScreen';
import { Workspace } from './Workspace';

const PROJECT_ID = 'fog';
const LAYOUT_MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];

// 九方 2026-11-16 15:13 定稿六行，寫死逐字比對（不拿常數比自己）
const FINAL_SIX = [
  'JiufangM 不用註冊，也不用登入。',
  '您的稿子、卡片和寫作紀錄只存在您自己的裝置裡，不會傳到我們這邊或任何伺服器。',
  '您用「儲存」存成 .db 檔時，檔案會存到您自己選的地方，像是「檔案」App 或 iCloud 雲碟。',
  '我們不收集您的姓名、聯絡方式或稿子內容，也不放廣告。',
  '網站放在 Cloudflare 上，Cloudflare 只會留一般網站都有的連線紀錄，裡面沒有稿子內容。',
  '清除瀏覽器資料或刪掉 App 時，沒有另外存成 .db 檔的稿子可能會不見，記得定期存檔。',
];

function renderWorkspaceAt(path: string, mode: LayoutMode): string {
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
                createElement(Route, { path: 'privacy', element: createElement(PrivacyScreen) }),
              ],
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-97 隱私說明', () => {
  it('a. 常數與定稿六句逐字相同、順序一致，標題為「隱私說明」', () => {
    expect(PRIVACY_TITLE).toBe('隱私說明');
    expect([...PRIVACY_PARAGRAPHS]).toEqual(FINAL_SIX);
  });

  it('a2. 若定稿來源檔存在，正文（去掉標題列與空行）與常數相同', () => {
    let source: string;
    try {
      source = readFileSync('/workspace/delivery/novel-editor-mobile/隱私說明-文案初稿-2026-11-16.md', 'utf8');
    } catch {
      return;
    }
    const lines = source.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(lines).toEqual([...PRIVACY_PARAGRAPHS]);
  });

  it('b. 設定頁最後一個入口是「隱私說明」，在字型授權之後、無副標、連到新路由', () => {
    const html = renderWorkspaceAt(`/p/${PROJECT_ID}/settings`, 'phone-portrait');
    const links = [...html.matchAll(/<a\b[^>]*class="setting-row"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
    const last = links[links.length - 1];
    expect(last).toContain('data-testid="privacy-link"');
    expect(last).toContain(`href="/p/${PROJECT_ID}/privacy"`);
    expect(last).toContain('<strong>隱私說明</strong>');
    expect(last).not.toContain('<small>');
    expect(html.indexOf('data-testid="font-license-link"')).toBeLessThan(html.indexOf('data-testid="privacy-link"'));
  });

  it('c. 隱私頁有「返回設定」按鈕，返回同一稿子的設定頁，六句各一段', () => {
    for (const mode of LAYOUT_MODES) {
      const html = renderWorkspaceAt(`/p/${PROJECT_ID}/privacy`, mode);
      expect(html).toContain('data-testid="privacy-screen"');
      expect(html).toContain('data-testid="privacy-back"');
      expect(html).toContain('aria-label="返回設定"');
      expect(html).toContain('<h1>隱私說明</h1>');
      expect(html).not.toContain('<pre');
      const paragraphs = [...html.matchAll(/<p class="privacy-paragraph">([^<]*)<\/p>/g)].map((m) => m[1]);
      expect(paragraphs.length).toBe(6);
    }
    const html = renderWorkspaceAt(`/p/${PROJECT_ID}/privacy`, 'wide');
    const text = [...html.matchAll(/<p class="privacy-paragraph">([^<]*)<\/p>/g)].map((m) => m[1]);
    // 「」與 . 不會被 HTML 轉義，逐句比對
    expect(text).toEqual(FINAL_SIX);

    const source = readFileSync(new URL('./PrivacyScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain("navigate(`/p/${project.id}/settings`)");
    expect(source).toContain('<ManuscriptNotFound />');
    expect(source).toContain('PRIVACY_PARAGRAPHS');
  });

  it('設定分頁在隱私頁亮起', () => {
    expect(isTabActive('settings', `/p/${PROJECT_ID}/privacy`)).toBe(true);
    expect(isTabActive('write', `/p/${PROJECT_ID}/privacy`)).toBe(false);
  });

  it('d. App.tsx 在 /p/:projectId 子路由內註冊 privacy', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("import { PrivacyScreen } from './screens/PrivacyScreen';");
    const workspaceStart = app.indexOf('<Route path="/p/:projectId"');
    const workspaceEnd = app.indexOf('</Route>', workspaceStart);
    const block = app.slice(workspaceStart, workspaceEnd);
    expect(block).toContain('<Route path="privacy" element={<PrivacyScreen />} />');
  });
});
