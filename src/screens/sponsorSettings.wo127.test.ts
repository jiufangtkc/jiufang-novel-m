import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SPONSOR_BUTTON_LABEL, SPONSOR_DESCRIPTION, SPONSOR_NEW_TAB_HINT } from '../copy/userFacing';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { SPONSOR_URL, SettingsScreen } from './SettingsScreen';
import { Workspace } from './Workspace';

const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];
const EXPECTED_SPONSOR_URL = 'https://www.paypal.com/ncp/payment/22LC8GY9JRDYL';
const EXPECTED_BUTTON_LABEL = '贊助九方思想貓';
const EXPECTED_DESCRIPTION =
  '編輯器M免費使用。如果它幫上你的忙，歡迎請作者喝杯咖啡。';
const EXPECTED_NEW_TAB_HINT = '（另開新分頁）';

function renderSettings(mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: mode },
        createElement(
          MemoryRouter,
          { initialEntries: ['/p/fog/settings'] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId',
              element: createElement(Workspace),
              children: [
                createElement(Route, { path: 'settings', element: createElement(SettingsScreen) }),
              ],
            }),
          ),
        ),
      ),
    ),
  );
}

function extractAboutSection(html: string): string {
  const match = html.match(/<section\b[^>]*data-testid="about-section"[^>]*>[\s\S]*?<\/section>/);
  expect(match).not.toBeNull();
  return match![0];
}

function extractSponsorLink(html: string): string {
  const match = html.match(/<a\b[^>]*data-testid="about-sponsor-link"[^>]*>[\s\S]*?<\/a>/);
  expect(match).not.toBeNull();
  return match![0];
}

describe('WO-127 設定頁「關於」區贊助連結', () => {
  for (const mode of MODES) {
    it(`${mode}：在 about-section 內渲染贊助連結，且位於 about-welcome-link 之後`, () => {
      const html = renderSettings(mode);
      const aboutSection = extractAboutSection(html);
      const sponsorLink = extractSponsorLink(aboutSection);
      expect(sponsorLink).toContain('data-testid="about-sponsor-link"');

      const versionIndex = aboutSection.indexOf('data-testid="about-version"');
      const welcomeIndex = aboutSection.indexOf('data-testid="about-welcome-link"');
      const sponsorIndex = aboutSection.indexOf('data-testid="about-sponsor-link"');
      expect(versionIndex).toBeGreaterThanOrEqual(0);
      expect(welcomeIndex).toBeGreaterThan(versionIndex);
      expect(sponsorIndex).toBeGreaterThan(welcomeIndex);
    });
  }

  it('連結為原生 <a> 且具備完整網址、target="_blank"、rel 安全屬性與專用 class', () => {
    const html = renderSettings('phone-portrait');
    const aboutSection = extractAboutSection(html);
    const link = extractSponsorLink(aboutSection);

    expect(link.startsWith('<a ')).toBe(true);
    expect(link).not.toMatch(/<button\b/i);
    expect(SPONSOR_URL).toBe(EXPECTED_SPONSOR_URL);
    expect(link).toContain(`href="${EXPECTED_SPONSOR_URL}"`);
    expect(link).toContain('target="_blank"');

    const relMatch = link.match(/\brel="([^"]*)"/);
    expect(relMatch).not.toBeNull();
    const relTokens = relMatch![1].split(/\s+/).filter(Boolean);
    expect(relTokens).toContain('noopener');
    expect(relTokens).toContain('noreferrer');

    const classMatch = link.match(/\bclass="([^"]*)"/);
    expect(classMatch).not.toBeNull();
    const classTokens = classMatch![1].split(/\s+/).filter(Boolean);
    expect(classTokens).toContain('setting-row');
    expect(classTokens).toContain('about-sponsor-row');
  });

  it('按鈕、說明與朗讀提示文案來自 userFacing.ts，標註暫定待審且元件未硬寫文案', () => {
    expect(SPONSOR_BUTTON_LABEL).toBe(EXPECTED_BUTTON_LABEL);
    expect(SPONSOR_DESCRIPTION).toBe(EXPECTED_DESCRIPTION);
    expect(SPONSOR_NEW_TAB_HINT).toBe(EXPECTED_NEW_TAB_HINT);

    const html = renderSettings('phone-portrait');
    const link = extractSponsorLink(extractAboutSection(html));

    const strongMatch = link.match(/<strong>([\s\S]*?)<\/strong>/);
    expect(strongMatch).not.toBeNull();
    expect(strongMatch![1]).toContain(SPONSOR_BUTTON_LABEL);
    expect(strongMatch![1]).toContain('class="about-sponsor-icon"');
    expect(strongMatch![1]).toContain('<svg');

    expect(link).toContain(`<small>${SPONSOR_DESCRIPTION}</small>`);

    const srOnlyMatch = link.match(/<span\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>([^<]*)<\/span>/);
    expect(srOnlyMatch).not.toBeNull();
    expect(srOnlyMatch![1]).toBe(SPONSOR_NEW_TAB_HINT);
    expect(srOnlyMatch![1]).toBe('（另開新分頁）');

    const settingsSource = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(settingsSource).toContain('SPONSOR_BUTTON_LABEL');
    expect(settingsSource).toContain('SPONSOR_DESCRIPTION');
    expect(settingsSource).toContain('SPONSOR_NEW_TAB_HINT');
    expect(settingsSource).not.toContain(EXPECTED_BUTTON_LABEL);
    expect(settingsSource).not.toContain(EXPECTED_DESCRIPTION);
    expect(settingsSource).not.toContain(EXPECTED_NEW_TAB_HINT);
    expect(settingsSource).not.toContain('另開新分頁');

    const copySource = readFileSync(new URL('../copy/userFacing.ts', import.meta.url), 'utf8');
    const sponsorBlockIndex = copySource.indexOf('export const SPONSOR_BUTTON_LABEL');
    expect(sponsorBlockIndex).toBeGreaterThan(0);
    const commentContext = copySource.slice(Math.max(0, sponsorBlockIndex - 120), sponsorBlockIndex);
    expect(commentContext).toContain('暫定');
    expect(commentContext).toContain('待九方審');
    expect(copySource).toContain('export const SPONSOR_NEW_TAB_HINT');
  });

  it('連結內含內嵌 SVG 另開新分頁圖示且不含寫死色碼或外部資源', () => {
    const html = renderSettings('phone-portrait');
    const link = extractSponsorLink(extractAboutSection(html));

    const svgMatch = link.match(/<svg\b[^>]*>/);
    expect(svgMatch).not.toBeNull();
    expect(svgMatch![0]).toContain('aria-hidden="true"');
    expect(svgMatch![0]).toContain('stroke="currentColor"');

    const iconsSource = readFileSync(new URL('../components/Icons.tsx', import.meta.url), 'utf8');
    const iconStart = iconsSource.indexOf('export function ExternalLinkIcon');
    expect(iconStart).toBeGreaterThan(0);
    const iconSnippet = iconsSource.slice(iconStart);
    expect(iconSnippet.toLowerCase()).not.toContain('<img');
    expect(iconSnippet.toLowerCase()).not.toContain('url(');

    const css = readFileSync('src/styles/global.css', 'utf8');
    const iconRules = [...css.matchAll(/\.about-sponsor-icon[^{]*\{([^}]*)\}/g)];
    expect(iconRules.length).toBeGreaterThan(0);
    for (const rule of iconRules) {
      const body = rule[1];
      expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(body.toLowerCase()).not.toContain('rgb(');
      expect(body.toLowerCase()).not.toContain('rgba(');
      expect(body.toLowerCase()).not.toContain('hsl(');
    }
  });

  it('不含外部腳本、圖片、表單、追蹤參數、window.open 或 navigator.onLine 隱藏條件', () => {
    const html = renderSettings('phone-portrait');
    const link = extractSponsorLink(extractAboutSection(html));
    for (const forbidden of ['<script', '<img', '<form', 'paypalobjects', 'utm_', 'onclick', 'window.open']) {
      expect(link.toLowerCase()).not.toContain(forbidden);
    }

    const settingsSource = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(settingsSource).not.toContain('navigator.onLine');
    expect(settingsSource).not.toContain('window.open');
    expect(settingsSource).not.toContain('paypalobjects');
    expect(settingsSource).not.toContain('utm_');
    expect(settingsSource).not.toMatch(/<script\b/i);
    expect(settingsSource).not.toMatch(/<img\b/i);
  });

  it('觸控高度至少 44px（沿用 .setting-row 且 .about-sponsor-row 未縮小高度）', () => {
    const css = readFileSync('src/styles/global.css', 'utf8');
    const rowMatch = /\.setting-row\s*\{[^}]*min-height:\s*(\d+)px/.exec(css);
    expect(rowMatch).not.toBeNull();
    expect(Number(rowMatch![1])).toBeGreaterThanOrEqual(44);

    const sponsorRules = [...css.matchAll(/\.about-sponsor-row[^{]*\{([^}]*)\}/g)];
    expect(sponsorRules.length).toBeGreaterThan(0);
    for (const rule of sponsorRules) {
      const body = rule[1];
      expect(body).not.toMatch(/white-space\s*:\s*nowrap/i);
      const heightMatch = /(?:min-)?height\s*:\s*(\d+)px/.exec(body);
      if (heightMatch) {
        expect(Number(heightMatch[1])).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
