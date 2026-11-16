import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SampleProvider } from '../state/sampleStore';
import { WriteScreen } from '../screens/WriteScreen';
import { LayoutProvider } from './layoutContext';
import { fitWidePanels, needsPanelOverlay, wideChars, type WideFitInput } from './widePanels';
import { demoFixtureState } from '../state/testing/sampleFixture';

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

function input(width: number, extra: Partial<WideFitInput> = {}): WideFitInput {
  return {
    wanted: { left: true, right: true },
    prefer: 'left',
    viewportWidth: width,
    scalePercent: 100,
    oneSide: width < 1280,
    ...extra,
  };
}

describe('WO-94：尚未選章時目錄不被容量收起', () => {
  it('1024、1138 尚未選章：想開的左目錄照樣顯示；右側資料集仍暫收', () => {
    expect(fitWidePanels(input(1024, { noBody: true }))).toEqual({ left: true, right: false });
    expect(fitWidePanels(input(1138, { noBody: true }))).toEqual({ left: true, right: false });
  });

  it('1024、1138 已選章：正文要保住 36 字，容量規則照舊（左右都暫收）', () => {
    expect(fitWidePanels(input(1024))).toEqual({ left: false, right: false });
    expect(fitWidePanels(input(1138))).toEqual({ left: false, right: false });
    expect(fitWidePanels(input(1139, { wanted: { left: true, right: false } }))).toEqual({ left: true, right: false });
  });

  it('使用者自己收合左目錄：尚未選章也不硬打開（由「展開目錄」鈕打開）', () => {
    expect(fitWidePanels(input(1024, { noBody: true, wanted: { left: false, right: false } }))).toEqual({
      left: false,
      right: false,
    });
  });

  it('1280、1440 預設左開右暫收；1920 預設三欄；有無正文結果一致，不退步', () => {
    for (const noBody of [false, true]) {
      expect(fitWidePanels(input(1280, { noBody }))).toEqual({ left: true, right: false });
      expect(fitWidePanels(input(1440, { noBody }))).toEqual({ left: true, right: false });
      expect(fitWidePanels(input(1920, { noBody }))).toEqual({ left: true, right: true });
    }
    expect(wideChars(1138, 100)).toBe(36);
    expect(wideChars(1280, 100)).toBe(36);
    expect(wideChars(1440, 100)).toBe(36);
    expect(wideChars(1920, 100)).toBe(40);
  });
});

describe('WO-94：放不下時改以浮在正文上顯示，按了不會沒反應', () => {
  it('1024、1138 已選章打開目錄或資料集：需要浮出（正文欄寬不變）', () => {
    for (const width of [1024, 1138]) {
      expect(needsPanelOverlay(input(width), 'left')).toBe(true);
      expect(needsPanelOverlay(input(width), 'right')).toBe(true);
    }
  });

  it('1139 以上放得下單側：不浮出，照一般欄位；1280 開資料集由目錄讓位，也不浮出', () => {
    expect(needsPanelOverlay(input(1139), 'left')).toBe(false);
    expect(needsPanelOverlay(input(1280), 'right')).toBe(false);
    expect(needsPanelOverlay(input(1920), 'right')).toBe(false);
  });

  it('尚未選章時目錄本來就顯示，不需浮出', () => {
    expect(needsPanelOverlay(input(1024, { noBody: true }), 'left')).toBe(false);
  });

  it('CSS：浮出的目錄與資料集用絕對定位蓋在正文上，不擠正文', () => {
    expect(css).toMatch(/\[data-panel-overlay="left"\] \.write-layout \.tree-pane\.is-open \{[^}]*position: absolute/);
    expect(css).toMatch(/\[data-panel-overlay="right"\] \.write-layout \.write-aside\.is-open \{[^}]*position: absolute/);
  });
});

function renderWrite(width: number, chapterId: string | null): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        {
          initialMode: 'wide',
          initialWideColumns: width >= 1280 ? 'both' : 'one-side',
          initialPointer: 'mouse',
          initialViewportWidth: width,
        },
        createElement(
          MemoryRouter,
          { initialEntries: [chapterId ? `/p/fog/write/${chapterId}` : '/p/fog/write'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/p/:projectId/write/:chapterId?', element: createElement(WriteScreen) }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-94：寫作頁入口', () => {
  it('1024、1138 尚未選章：有清楚可按的「展開目錄」', () => {
    for (const width of [1024, 1138]) {
      const html = renderWrite(width, null);
      expect(html).toContain('點左邊的章或幕開始寫作。');
      expect(html).toContain('data-testid="open-tree-empty"');
      expect(html).toContain('展開目錄');
    }
  });

  it('1024、1138 已選章：頁首有「展開目錄」與「看卡片」', () => {
    for (const width of [1024, 1138]) {
      const html = renderWrite(width, 'ch-1');
      expect(html).toContain('data-testid="toggle-tree-topbar"');
      expect(html).toContain('data-testid="toggle-cards-topbar"');
    }
  });
});
