import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { TREE_ADD_CHAPTER, TREE_ORGANIZE } from '../copy/userFacing';
import { WriteScreen } from './WriteScreen';

function renderWrite(mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: mode === 'wide' ? 'both' : null },
        createElement(
          MemoryRouter,
          { initialEntries: ['/p/fog/write'] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/write/:chapterId?',
              element: createElement(WriteScreen),
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-70 目錄選單浮在最上層', () => {
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  it('中等與手機橫拿的選單蓋過目錄抽屜和看卡片抽屜', () => {
    expect(css).toMatch(
      /html\[data-layout="phone-landscape"\] \.write-layout > \.sheet-backdrop,\s*html\[data-layout="medium"\] \.write-layout > \.sheet-backdrop\s*\{[^}]*z-index:\s*200/,
    );
    expect(css).toMatch(
      /html\[data-layout="phone-landscape"\] \.write-layout > \.sheet-backdrop,\s*html\[data-layout="medium"\] \.write-layout > \.sheet-backdrop\s*\{[^}]*position:\s*fixed/,
    );
  });
});

describe('WO-71 中等、橫拿、寬版看得到新增章和整理目錄', () => {
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  it('不再用寬度 600 以上把底部按鈕整排藏起來', () => {
    expect(css).not.toMatch(/\.tree-tools,\s*\.organize-dock\s*\{[^}]*display:\s*none/);
  });

  it('四種版面的目錄都只有一排「整理目錄」和「新增章」', () => {
    for (const mode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const) {
      const html = renderWrite(mode);
      expect(html.split('data-testid="tree-tools"').length - 1).toBe(1);
      expect(html).toContain(TREE_ORGANIZE);
      expect(html).toContain(TREE_ADD_CHAPTER);
      expect(html).toContain('data-testid="organize-toggle"');
      expect(html).toContain('data-testid="add-chapter"');
    }
  });
});
