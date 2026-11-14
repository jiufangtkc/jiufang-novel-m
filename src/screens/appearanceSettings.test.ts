import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_ROW_ORDER,
  APPEARANCE_SECTION,
  deviceKindPhrase,
  inputModeDescription,
  inputModeGroupAria,
  inputModeOptionAria,
} from '../copy/appearanceCopy';
import { LayoutProvider } from '../layout';
import type { DeviceKind } from '../layout/inputMode';
import type { PointerMode } from '../layout/layoutMode';
import { SampleProvider } from '../state/sampleStore';
import { SettingsScreen } from './SettingsScreen';

function renderSettings(pointer: PointerMode, deviceKind: DeviceKind): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        {
          initialMode: 'phone-portrait',
          initialPointer: pointer,
          initialDeviceKind: deviceKind,
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
  it('正文字級的位置留在操作方式上方，但現在不顯示', () => {
    expect(APPEARANCE_ROW_ORDER).toEqual(['body-font-scale', 'input-mode']);
    expect(APPEARANCE_SECTION).toBe('外觀');
  });

  it('外觀組在這份稿子下方，用手指點在前，沒有字級列', () => {
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
    expect(html).not.toContain('正文字級');
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
      '依你操作的方式調整列和按鈕的間距。只會套用在這台電腦。',
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
