/**
 * WO-129 乙段畫面、樣式與接線測試：
 * - 設定頁「關於」組「看改版內容」入口（四種版面、順位、無 Provider 相容）
 * - WhatsNewDialog 對話框結構、ARIA、單版／歷版展開與無條目防呆
 * - 鍵盤 Esc／Tab 繞圈／焦點移入還原、App 掛載與歡迎導覽互斥接線守衛
 * - CSS 觸控熱區 ≥ 44px 與色票／變數守衛
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../copy/aboutCopy';
import {
  WHATS_NEW_CONFIRM,
  WHATS_NEW_EMPTY_CURRENT,
  WHATS_NEW_PREVIOUS_TOGGLE,
  WHATS_NEW_SETTINGS_HINT,
  WHATS_NEW_SETTINGS_TITLE,
  WHATS_NEW_TITLE,
  whatsNewVersionLabel,
} from '../copy/userFacing';
import { RELEASE_NOTES, type ReleaseNote } from '../data/whatsNew';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SettingsScreen } from '../screens/SettingsScreen';
import { isWelcomeTourActive } from '../screens/WhatsNewHost';
import { Workspace } from '../screens/Workspace';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { WhatsNewDialog, whatsNewDialogTabTarget } from './WhatsNewDialog';

const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];

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

function renderDialog(props: {
  version?: string;
  notes?: readonly ReleaseNote[];
  initialExpanded?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    createElement(WhatsNewDialog, {
      version: props.version ?? APP_VERSION,
      onClose: () => {},
      notes: props.notes,
      initialExpanded: props.initialExpanded,
    }),
  );
}

function extractAboutSection(html: string): string {
  const match = html.match(/<section\b[^>]*data-testid="about-section"[^>]*>[\s\S]*?<\/section>/);
  expect(match).not.toBeNull();
  return match![0];
}

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `找不到樣式規則 ${selector}`).not.toBeNull();
  return match![1]!;
}

describe('WO-129 設定頁「關於」組「看改版內容」入口', () => {
  it.each(MODES)('%s：渲染於 about-section 內，位於版本列之後、歡迎導覽之前', (mode) => {
    const html = renderSettings(mode);
    const aboutSection = extractAboutSection(html);

    const buttonMatch = aboutSection.match(
      /<button\b[^>]*data-testid="about-whats-new-button"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(buttonMatch).not.toBeNull();
    const buttonHtml = buttonMatch![0];

    expect(buttonHtml).toContain('type="button"');
    expect(buttonHtml).toContain('setting-row');
    expect(buttonHtml).toContain('about-whats-new-row');
    expect(buttonHtml).toContain(`<strong>${WHATS_NEW_SETTINGS_TITLE}</strong>`);
    expect(buttonHtml).toContain(`<small>${WHATS_NEW_SETTINGS_HINT}</small>`);

    const versionIdx = aboutSection.indexOf('data-testid="about-version"');
    const whatsNewIdx = aboutSection.indexOf('data-testid="about-whats-new-button"');
    const welcomeIdx = aboutSection.indexOf('data-testid="about-welcome-link"');
    const sponsorIdx = aboutSection.indexOf('data-testid="about-sponsor-link"');

    expect(versionIdx).toBeGreaterThanOrEqual(0);
    expect(whatsNewIdx).toBeGreaterThan(versionIdx);
    expect(welcomeIdx).toBeGreaterThan(whatsNewIdx);
    expect(sponsorIdx).toBeGreaterThan(welcomeIdx);
  });

  it('SettingsScreen 使用 userFacing 常數而非硬寫中文，且未包 WhatsNewProvider 仍可安全渲染', () => {
    const settingsSrc = readFileSync(new URL('../screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(settingsSrc).toContain('WHATS_NEW_SETTINGS_TITLE');
    expect(settingsSrc).toContain('WHATS_NEW_SETTINGS_HINT');
    expect(settingsSrc).toContain('useWhatsNew');
    expect(settingsSrc).not.toContain(WHATS_NEW_SETTINGS_TITLE);
    expect(settingsSrc).not.toContain(WHATS_NEW_SETTINGS_HINT);
  });
});

describe('WO-129 WhatsNewDialog 結構、ARIA 與歷版展開', () => {
  it('具備標準 dialog ARIA 屬性、標題 tabindex=-1、版號不寫 v、條列與「知道了」主按鈕', () => {
    const html = renderDialog();

    expect(html).toContain('role="presentation"');
    expect(html).toContain('data-testid="whats-new-backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="whats-new-title"');
    expect(html).toContain('data-testid="whats-new-dialog"');

    expect(html).toMatch(/<h2[^>]*id="whats-new-title"[^>]*tabindex="-1"[^>]*>這一版新增了什麼<\/h2>/);
    expect(html).toContain(`>${whatsNewVersionLabel(APP_VERSION)}<`);
    expect(html).not.toContain(`v${APP_VERSION}`);

    expect(html).toContain('<ul class="whats-new-list" data-testid="whats-new-list">');
    // WO-142：最新一版是 0.10.0；0.9.1 起移到歷版（見下面歷版展開的檢查）。
    expect(RELEASE_NOTES[0]?.version).toBe('0.10.0');
    for (const item of RELEASE_NOTES[0]!.items) {
      expect(html).toContain(`<li>${item}</li>`);
    }
    expect(RELEASE_NOTES[1]?.version).toBe('0.9.1');
    expect(RELEASE_NOTES[2]?.version).toBe('0.9.0');
    expect(RELEASE_NOTES[2]?.items).toEqual([
      '版本清單新增「比較」：可逐字對照任一份舊版與現在這一章的差異，並自動統計增減字數與改動段數',
      '連續未改動的段落會先收起來，只留前後各一段方便對照，點一下即可展開原文',
    ]);

    const confirmMatch = html.match(
      /<button\b[^>]*data-testid="whats-new-confirm"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(confirmMatch).not.toBeNull();
    expect(confirmMatch![0]).toContain('button primary whats-new-confirm');
    expect(confirmMatch![0]).toContain(WHATS_NEW_CONFIRM);

    // 升版為 0.4.1（三筆改版資料）時，預設呈現收合的「之前的版本」展開鈕
    expect(html).toContain('data-testid="whats-new-history-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(WHATS_NEW_PREVIOUS_TOGGLE);
    expect(html).not.toContain('id="whats-new-history"');

    // 只有單一版本時不渲染「之前的版本」展開鈕
    const singleVersionHtml = renderDialog({
      version: '0.3.0',
      notes: [{ version: '0.3.0', items: ['單版測試條目'] }],
    });
    expect(singleVersionHtml).not.toContain('data-testid="whats-new-history-toggle"');
    expect(singleVersionHtml).not.toContain(WHATS_NEW_PREVIOUS_TOGGLE);
  });

  it('多版本時顯示具 aria-expanded／aria-controls 的「之前的版本」鈕，展開後依新版在前顯示歷版', () => {
    const sampleNotes: readonly ReleaseNote[] = [
      { version: '0.3.1', items: ['修正匯入預覽偶發捲動偏移'] },
      { version: '0.3.0', items: ['事件時間線功能', '贊助入口'] },
      { version: '0.2.0', items: ['加入歡迎導覽'] },
    ];

    const collapsedHtml = renderDialog({ version: '0.3.1', notes: sampleNotes, initialExpanded: false });
    const toggleMatch = collapsedHtml.match(
      /<button\b[^>]*data-testid="whats-new-history-toggle"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(toggleMatch).not.toBeNull();
    expect(toggleMatch![0]).toContain('aria-expanded="false"');
    expect(toggleMatch![0]).toContain('aria-controls="whats-new-history"');
    expect(toggleMatch![0]).toContain('aria-hidden="true"');
    expect(toggleMatch![0]).toContain('▸');
    expect(toggleMatch![0]).toContain(WHATS_NEW_PREVIOUS_TOGGLE);
    expect(collapsedHtml).not.toContain('id="whats-new-history"');

    const expandedHtml = renderDialog({ version: '0.3.1', notes: sampleNotes, initialExpanded: true });
    expect(expandedHtml).toContain('aria-expanded="true"');
    expect(expandedHtml).toContain('▾');
    expect(expandedHtml).toContain('id="whats-new-history"');
    expect(expandedHtml).toContain('<h3>版本 0.3.0</h3>');
    expect(expandedHtml).toContain('<li>事件時間線功能</li>');
    expect(expandedHtml).toContain('<h3>版本 0.2.0</h3>');
    expect(expandedHtml).toContain('<li>加入歡迎導覽</li>');
    expect(expandedHtml.indexOf('版本 0.3.0')).toBeLessThan(expandedHtml.indexOf('版本 0.2.0'));
  });

  it('當版無條目時顯示防呆白話說明，且有歷版時仍可展開閱讀', () => {
    const sampleNotes: readonly ReleaseNote[] = [
      { version: '0.3.0', items: ['範例舊版條目'] },
    ];
    const html = renderDialog({ version: '0.3.1', notes: sampleNotes });
    expect(html).toContain(WHATS_NEW_EMPTY_CURRENT);
    expect(html).toContain('data-testid="whats-new-history-toggle"');
  });
});

describe('WO-129 鍵盤、焦點管理、App 掛載與用字守衛', () => {
  it('Tab 繞圈輔助函式在頭尾正確循環，含焦點在標題時（index -1）', () => {
    expect(whatsNewDialogTabTarget(2, 1, false)).toBe(0);
    expect(whatsNewDialogTabTarget(2, 0, true)).toBe(1);
    expect(whatsNewDialogTabTarget(2, 0, false)).toBeNull();
    expect(whatsNewDialogTabTarget(2, -1, false)).toBe(0);
    expect(whatsNewDialogTabTarget(2, -1, true)).toBe(1);
    expect(whatsNewDialogTabTarget(0, -1, false)).toBeNull();
  });

  it('WhatsNewDialog 具備 document Esc（排除組字）、Tab trap、焦點移入標題與卸載還原焦點', () => {
    const dialogSrc = readFileSync(new URL('./WhatsNewDialog.tsx', import.meta.url), 'utf8');

    expect(dialogSrc).toContain("document.addEventListener('keydown', onKeyDown)");
    expect(dialogSrc).toContain("document.removeEventListener('keydown', onKeyDown)");
    expect(dialogSrc).toContain("event.key === 'Escape' && !event.isComposing");
    expect(dialogSrc).toContain('titleRef.current?.focus()');
    expect(dialogSrc).toContain('previousFocus.isConnected');
    expect(dialogSrc).toContain('previousFocus.focus()');
    expect(dialogSrc).toContain('whatsNewDialogTabTarget');
    expect(dialogSrc).toContain('onClick={(event) => event.stopPropagation()}');

    for (const text of [
      WHATS_NEW_TITLE,
      WHATS_NEW_CONFIRM,
      WHATS_NEW_PREVIOUS_TOGGLE,
      WHATS_NEW_EMPTY_CURRENT,
    ]) {
      expect(dialogSrc).not.toContain(text);
    }
  });

  it('App.tsx 正確掛載 WhatsNewProvider 與 WhatsNewLayer，且協調歡迎導覽互斥順序', () => {
    const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const hostSrc = readFileSync(new URL('../screens/WhatsNewHost.tsx', import.meta.url), 'utf8');

    expect(appSrc).toContain('<WhatsNewProvider>');
    expect(appSrc).toContain('<WhatsNewLayer />');
    expect(appSrc.indexOf('<BrowserRouter>')).toBeLessThan(appSrc.indexOf('<WhatsNewProvider>'));
    expect(appSrc.indexOf('<WhatsNewLayer />')).toBeGreaterThan(appSrc.indexOf('</div>'));
    expect(appSrc.indexOf('<WhatsNewLayer />')).toBeLessThan(appSrc.indexOf('</WhatsNewProvider>'));

    expect(hostSrc).toContain('deviceLoaded');
    expect(hostSrc).toContain('hasStoredDeviceTheme');
    expect(hostSrc).toContain('hasThemePreference');
    expect(hostSrc).toContain('hasPriorUsage');
    expect(hostSrc).toContain('decideWhatsNew');
    expect(hostSrc).toContain('readSeenVersion');
    expect(hostSrc).toContain('writeSeenVersion');
    expect(hostSrc).toContain("'/welcome'");
    expect(hostSrc).toContain('[data-testid="welcome-tour"]');

    expect(isWelcomeTourActive('/p/fog/welcome', null)).toBe(true);
    expect(isWelcomeTourActive('/p/fog/settings', { querySelector: () => null })).toBe(false);
    expect(isWelcomeTourActive('/', { querySelector: () => ({} as Element) })).toBe(true);
  });

  it('乙段新增與修改程式碼不含簡體字或禁止術語', () => {
    const dialogSrc = readFileSync(new URL('./WhatsNewDialog.tsx', import.meta.url), 'utf8');
    const hostSrc = readFileSync(new URL('../screens/WhatsNewHost.tsx', import.meta.url), 'utf8');
    const cssSrc = readFileSync(new URL('./whatsNewDialog.css', import.meta.url), 'utf8');

    const simplifiedChars = new RegExp(
      '[' +
        '\\u7b80\\u4f53\\u8bf4\\u8d44\\u8fd9\\u4e3a\\u4e0e\\u4ece\\u5bf9\\u8fdb\\u8fc7\\u8fde\\u9009\\u95e8\\u95ee\\u95f4\\u70b9\\u8c01\\u8ba9\\u5c06\\u5219\\u867d\\u4ec5\\u5e76\\u65e0\\u4f1a\\u987b\\u8be5\\u5f53\\u7ecf\\u521a\\u4eec\\u6863\\u8bbe\\u6761\\u9635\\u65ad\\u9690\\u6682\\u8d5e\\u65f6\\u987a\\u5bbd\\u53cc\\u94ae\\u6d4f\\u89c8\\u50a8\\u8bb0\\u5fc6\\u663e\\u5220\\u5199\\u8bfb\\u5173\\u5f00\\u88c5\\u9879\\u5bfc\\u5f55\\u9519\\u8bef\\u786e\\u8ba4\\u9a8c\\u8bc1\\u6d4b\\u8bd5' +
        ']',
    );
    const forbiddenTerms = /Changelog|Release\s+Notes|更新日誌|版本歷程|彈窗/i;

    for (const [name, content] of [
      ['WhatsNewDialog.tsx', dialogSrc],
      ['WhatsNewHost.tsx', hostSrc],
      ['whatsNewDialog.css', cssSrc],
    ] as const) {
      expect(content, `${name} 不可含簡體字`).not.toMatch(simplifiedChars);
      expect(content, `${name} 不可含術語`).not.toMatch(forbiddenTerms);
    }
  });
});

describe('WO-129 CSS 觸控熱區與主題變數守衛', () => {
  const css = readFileSync(new URL('./whatsNewDialog.css', import.meta.url), 'utf8');

  it('按鈕、歷版展開鈕與設定入口列觸控熱區皆 ≥ 44px，且不跟 --hit-size 縮小', () => {
    const confirmRule = cssBlock(css, '.whats-new-confirm');
    const confirmHeight = /min-height:\s*(\d+)px/.exec(confirmRule);
    const confirmWidth = /min-width:\s*(\d+)px/.exec(confirmRule);
    expect(confirmHeight).not.toBeNull();
    expect(confirmWidth).not.toBeNull();
    expect(Number(confirmHeight![1])).toBeGreaterThanOrEqual(44);
    expect(Number(confirmWidth![1])).toBeGreaterThanOrEqual(44);

    const toggleRule = cssBlock(css, '.whats-new-history-toggle');
    const toggleHeight = /min-height:\s*(\d+)px/.exec(toggleRule);
    const toggleWidth = /min-width:\s*(\d+)px/.exec(toggleRule);
    expect(toggleHeight).not.toBeNull();
    expect(toggleWidth).not.toBeNull();
    expect(Number(toggleHeight![1])).toBeGreaterThanOrEqual(44);
    expect(Number(toggleWidth![1])).toBeGreaterThanOrEqual(44);

    const rowRule = cssBlock(css, '.about-whats-new-row');
    const rowHeight = /min-height:\s*(\d+)px/.exec(rowRule);
    expect(rowHeight).not.toBeNull();
    expect(Number(rowHeight![1])).toBeGreaterThanOrEqual(44);
  });

  it('嚴格遵守主題色票守衛：不用 --hit-size、--editor、--warning、rgba 或寫死主題色碼', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toContain('--hit-size');
    expect(stripped).not.toContain('--editor');
    expect(stripped).not.toContain('--warning');
    expect(stripped.toLowerCase()).not.toContain('rgba(');
    expect(stripped.toLowerCase()).not.toContain('#fff');
    expect(stripped).toContain('html[data-layout="phone-landscape"]');
    expect(stripped).toContain('html[data-layout="wide"]');
    expect(stripped).toContain('overflow-wrap: anywhere');
    expect(stripped).toContain('--safe-top');
    expect(stripped).toContain('--safe-bottom');
  });
});
