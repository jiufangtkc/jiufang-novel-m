import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_ROW_ORDER,
  APPEARANCE_SECTION,
  bodyFontScaleDescription,
  deviceKindPhrase,
  inputModeDescription,
  inputModeGroupAria,
  inputModeOptionAria,
} from '../copy/appearanceCopy';
import { bodyFontScaleAria, bodyPreviewFontPx } from '../layout/bodyFontScale';
import { LayoutProvider } from '../layout';
import type { DeviceKind } from '../layout/inputMode';
import type { LayoutMode, PointerMode } from '../layout/layoutMode';
import { SampleProvider } from '../state/sampleStore';
import { SettingsScreen } from './SettingsScreen';

function renderSettings(
  pointer: PointerMode,
  deviceKind: DeviceKind,
  scale = 100,
  mode: LayoutMode = 'phone-portrait',
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        {
          initialMode: mode,
          initialPointer: pointer,
          initialDeviceKind: deviceKind,
          initialBodyFontScale: scale,
        },
        createElement(
          MemoryRouter,
          { initialEntries: ['/p/fog/settings'] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/settings',
              element: createElement(SettingsScreen),
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-94：設定頁外觀組', () => {
  it('正文字級排在操作方式上方', () => {
    expect(APPEARANCE_ROW_ORDER).toEqual(['body-font-scale', 'input-mode']);
    expect(APPEARANCE_SECTION).toBe('外觀');
    const html = renderSettings('touch', 'phone');
    const font = html.indexOf('data-testid="body-font-setting"');
    const input = html.indexOf('data-testid="input-mode-setting"');
    expect(font).toBeGreaterThan(-1);
    expect(input).toBeGreaterThan(font);
  });

  it('外觀組在這份稿子下方，用手指點在前，沒有介面字級', () => {
    const html = renderSettings('touch', 'phone');
    const book = html.indexOf('這份稿子');
    const appearance = html.indexOf('data-testid="appearance-section"');
    const touch = html.indexOf('data-testid="input-mode-touch"');
    const mouse = html.indexOf('data-testid="input-mode-mouse"');
    expect(book).toBeGreaterThan(-1);
    expect(appearance).toBeGreaterThan(book);
    expect(touch).toBeGreaterThan(appearance);
    expect(mouse).toBeGreaterThan(touch);
    expect(html).toContain('用手指點');
    expect(html).toContain('用滑鼠');
    expect(html).toContain('列和按鈕比較寬，好點中');
    expect(html).toContain('列和按鈕比較窄，一個畫面看得到比較多');
    expect(html).toContain(inputModeDescription('phone'));
    expect(html).toContain('正文字級');
    expect(html).not.toContain('介面字級');
    expect(html).not.toContain('這台裝置');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="操作方式，目前是用手指點"');
    expect(html).toContain('aria-label="用手指點，已選取，列和按鈕比較寬"');
    expect(html).toContain('aria-label="用滑鼠，列和按鈕比較窄，點兩下改成這個"');
  });

  it('說明小字依裝置種類換成這支手機、這台電腦、這台平板或這個裝置', () => {
    expect(deviceKindPhrase('phone')).toBe('這支手機');
    expect(deviceKindPhrase('computer')).toBe('這台電腦');
    expect(deviceKindPhrase('tablet')).toBe('這台平板');
    expect(deviceKindPhrase('unknown')).toBe('這個裝置');
    expect(inputModeDescription('computer')).toBe(
      '依你操作的方式調整列和按鈕的間距。要調正文的字有多大，請用上面的「正文字級」。只會套用在這台電腦。',
    );
    expect(bodyFontScaleDescription('phone')).toBe(
      '調整寫作時正文的字有多大。只會套用在這支手機。',
    );
    expect(bodyFontScaleDescription('computer')).toBe(
      '調整寫作時正文的字有多大。只會套用在這台電腦。',
    );
    expect(bodyFontScaleDescription('tablet')).toBe(
      '調整寫作時正文的字有多大。只會套用在這台平板。',
    );
    expect(bodyFontScaleDescription('unknown')).toBe(
      '調整寫作時正文的字有多大。只會套用在這個裝置。',
    );
    expect(renderSettings('mouse', 'computer')).toContain('只會套用在這台電腦。');
    expect(renderSettings('touch', 'tablet')).toContain('只會套用在這台平板。');
    expect(renderSettings('touch', 'unknown')).toContain('只會套用在這個裝置。');
    expect(inputModeGroupAria('mouse')).toBe('操作方式，目前是用滑鼠');
    expect(inputModeOptionAria('mouse', true)).toBe('用滑鼠，已選取，列和按鈕比較窄');
    expect(inputModeOptionAria('touch', false)).toBe('用手指點，列和按鈕比較寬，點兩下改成這個');
  });

  it('切換鈕至少 44×44，不跟著 --hit-size 縮小', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.input-mode-option\s*\{[^}]*min-width:\s*44px/);
    expect(css).toMatch(/\.input-mode-option\s*\{[^}]*min-height:\s*44px/);
    const block = css.match(/\.input-mode-option\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toContain('--hit-size');
  });
});

describe('WO-96：設定頁正文字級', () => {
  it('預設 100%（標準），預覽字照正文大小，朗讀跳過預覽', () => {
    const html = renderSettings('touch', 'phone');
    expect(html).toContain('>100%（標準）<');
    expect(html).toContain('A−');
    expect(html).toContain('A＋');
    expect(html).toContain(bodyFontScaleDescription('phone'));
    expect(html).toMatch(/class="body-font-preview"[^>]*aria-hidden="true"[^>]*>月台上的狐狸/);
    expect(html).toContain(`font-size:${bodyPreviewFontPx('phone-portrait', 100)}px`);
    expect(html).toContain(`aria-label="${bodyFontScaleAria(100)}"`);
    expect(html).toContain('aria-valuetext="正文字級，目前是百分之一百，標準大小，上下滑動可以調整"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemin="90"');
    expect(html).toContain('aria-valuemax="200"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).not.toContain('disabled');
  });

  it('120% 的朗讀與預覽，90% 時不能再縮小，200% 時不能再放大', () => {
    const at120 = renderSettings('touch', 'phone', 120);
    expect(at120).toContain('>120%<');
    expect(at120).toContain(`aria-label="${bodyFontScaleAria(120)}"`);
    expect(at120).toContain(`font-size:${bodyPreviewFontPx('phone-portrait', 120)}px`);
    const at90 = renderSettings('touch', 'phone', 90);
    expect(at90).toMatch(/<button[^>]*data-testid="body-font-decrease"[^>]*disabled[^>]*>/);
    expect(at90).not.toMatch(/<button[^>]*data-testid="body-font-increase"[^>]*disabled[^>]*>/);
    const at200 = renderSettings('touch', 'phone', 200);
    expect(at200).toMatch(/<button[^>]*data-testid="body-font-increase"[^>]*disabled[^>]*>/);
    expect(at200).not.toMatch(/<button[^>]*data-testid="body-font-decrease"[^>]*disabled[^>]*>/);
    expect(renderSettings('mouse', 'computer', 100, 'medium')).toContain(
      `font-size:${bodyPreviewFontPx('medium', 100)}px`,
    );
  });

  it('A− 與 A＋ 至少 44×44，不跟著 --hit-size 縮小；正文用字級倍率，行寬上限不變', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.body-font-step\s*\{[^}]*min-width:\s*44px/);
    expect(css).toMatch(/\.body-font-step\s*\{[^}]*min-height:\s*44px/);
    const block = css.match(/\.body-font-step\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toContain('--hit-size');
    expect(css).toMatch(/html\[data-layout="phone-portrait"\] \.editor-input \{[^}]*font-size:\s*calc\(18px \* var\(--body-font-scale, 100\) \/ 100\)/);
    expect(css).toMatch(/html\[data-layout="medium"\] \.editor-input \{[^}]*font-size:\s*calc\(20px \* var\(--body-font-scale, 100\) \/ 100\)/);
    expect(css).toMatch(/html\[data-layout="wide"\] \.editor-input \{[^}]*font-size:\s*calc\(18px \* var\(--body-font-scale, 100\) \/ 100\)/);
    expect(css).toMatch(/max-width:\s*min\(\s*calc\(19\s*\*\s*\(1em\s*\+\s*0\.5px\)\)\s*,\s*100%\)/);
    expect(css).toMatch(/max-width:\s*min\(\s*calc\(36\s*\*\s*\(1em\s*\+\s*0\.5px\)\)\s*,\s*100%\)/);
  });
});
