import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  TRASH_CORRUPT_HINT,
  TRASH_EMPTY_HINT,
  TRASH_LIMIT_FULL_EVICTABLE_HINT,
  TRASH_LIMIT_FULL_LOCKED_HINT,
  TRASH_LIMIT_NEAR_HINT,
  TRASH_NEWER_REVISION_HINT,
  TRASH_SHEET_TITLE,
  trashOriginalChapterGone,
  trashUsageSummary,
} from '../copy/trashCopy';
import type { ChapterNode } from '../data/demo';
import { createTrashItem, TRASH_MAX_ITEMS, TRASH_NEAR_ITEMS, type TrashItem } from '../domain/trash';
import { LayoutProvider, type LayoutMode } from '../layout';
import { EditorPane } from '../screens/EditorPane';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { TrashSheet } from './TrashSheet';

const SAMPLE_NODES: ChapterNode[] = [
  {
    id: 'ch-1',
    type: 'file',
    title: '【範例】改名後的新章名',
    content: '正文開頭……結尾。',
    expanded: true,
  },
  {
    id: 'sc-1',
    type: 'scene',
    title: '【範例】第一幕',
    content: '幕正文',
    expanded: true,
  },
];

function makeSampleTrash(overrides?: Partial<TrashItem>): TrashItem {
  return createTrashItem({
    itemId: overrides?.itemId ?? 'trash-1',
    chapterId: overrides?.chapterId !== undefined ? overrides.chapterId : 'ch-1',
    chapterTitleSnapshot: overrides?.chapterTitleSnapshot ?? '【範例】舊章名',
    content: overrides?.content ?? '【範例】這是一段被割愛的段落文字，用來驗證刪稿暫存區畫面渲染。',
    wordCount: overrides?.wordCount ?? 120,
    beforeAnchor: overrides?.beforeAnchor ?? '正文開頭',
    afterAnchor: overrides?.afterAnchor ?? '結尾。',
    charOffset: overrides?.charOffset ?? 4,
    reason: overrides?.reason ?? '',
    deletedAtMs: overrides?.deletedAtMs ?? 1_700_000_000_000,
    sortOrder: overrides?.sortOrder ?? 0,
  });
}

function renderTrashSheet(props: Partial<Parameters<typeof TrashSheet>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TrashSheet, {
      open: true,
      items: [],
      trashRead: { kind: 'ok', revision: 1, items: [] },
      nodes: SAMPLE_NODES,
      layoutMode: 'phone-portrait',
      isComposing: () => false,
      onClose: () => undefined,
      onUpdateReason: () => undefined,
      onPutBack: () => undefined,
      onDiscard: () => undefined,
      onUndoDiscard: () => undefined,
      onToast: () => undefined,
      ...props,
    }),
  );
}

describe('WO-138 第 6 段：TrashSheet 畫面、上限提示、版面與專注模式守衛', () => {
  it('空狀態、newer-revision 與 corrupt 唯讀狀態皆正確渲染', () => {
    const emptyHtml = renderTrashSheet({ items: [] });
    expect(emptyHtml).toContain('data-testid="trash-sheet"');
    expect(emptyHtml).toContain(TRASH_SHEET_TITLE);
    expect(emptyHtml).toContain(TRASH_EMPTY_HINT);

    const newerHtml = renderTrashSheet({
      trashRead: { kind: 'newer-revision', revision: 9 },
    });
    expect(newerHtml).toContain('data-testid="trash-newer-revision-hint"');
    expect(newerHtml).toContain(TRASH_NEWER_REVISION_HINT);
    expect(newerHtml).not.toContain(TRASH_EMPTY_HINT);

    const corruptHtml = renderTrashSheet({
      trashRead: { kind: 'corrupt', reason: 'damaged' },
    });
    expect(corruptHtml).toContain('data-testid="trash-corrupt-hint"');
    expect(corruptHtml).toContain(TRASH_CORRUPT_HINT);
    expect(corruptHtml).not.toContain(TRASH_EMPTY_HINT);
  });

  it('列表顯示最新章名、失效章名快照標示、字數、原因與使用量摘要', () => {
    const aliveItem = makeSampleTrash({
      itemId: 'alive-1',
      chapterId: 'ch-1',
      chapterTitleSnapshot: '【範例】舊章名',
      reason: '這段節奏太慢',
    });
    const goneItem = makeSampleTrash({
      itemId: 'gone-1',
      chapterId: 'missing-chapter',
      chapterTitleSnapshot: '【範例】已刪掉的章',
      deletedAtMs: 1_700_000_005_000,
    });
    const sceneItem = makeSampleTrash({
      itemId: 'scene-1',
      chapterId: 'sc-1',
      chapterTitleSnapshot: '【範例】舊幕名',
      deletedAtMs: 1_700_000_003_000,
    });

    const html = renderTrashSheet({
      items: [goneItem, sceneItem, aliveItem],
    });
    // 原章改名後顯示現在的章名
    expect(html).toContain('【範例】改名後的新章名');
    // 原章已不在顯示快照標示
    expect(html).toContain(trashOriginalChapterGone('【範例】已刪掉的章'));
    // 幕（scene）不誤判為原章已刪
    expect(html).toContain('【範例】第一幕');
    expect(html).not.toContain(trashOriginalChapterGone('【範例】舊幕名'));
    // 註記原因與使用量摘要
    expect(html).toContain('這段節奏太慢');
    expect(html).toContain(trashUsageSummary(3, 360));
  });

  it('接近上限與滿額（可清 vs 全有註記鎖定）顯示正確上限提示', () => {
    const nearItems = Array.from({ length: TRASH_NEAR_ITEMS }, (_, idx) =>
      makeSampleTrash({ itemId: `near-${idx}`, deletedAtMs: 1_700_000_000_000 + idx }),
    );
    const nearHtml = renderTrashSheet({ items: nearItems });
    expect(nearHtml).toContain(TRASH_LIMIT_NEAR_HINT);

    const fullEvictable = Array.from({ length: TRASH_MAX_ITEMS }, (_, idx) =>
      makeSampleTrash({
        itemId: `full-ev-${idx}`,
        deletedAtMs: 1_700_000_000_000 + idx,
        reason: idx === 0 ? '' : '留著',
      }),
    );
    expect(renderTrashSheet({ items: fullEvictable })).toContain(TRASH_LIMIT_FULL_EVICTABLE_HINT);

    const fullLocked = Array.from({ length: TRASH_MAX_ITEMS }, (_, idx) =>
      makeSampleTrash({
        itemId: `full-lk-${idx}`,
        deletedAtMs: 1_700_000_000_000 + idx,
        reason: '全部有註記',
      }),
    );
    expect(renderTrashSheet({ items: fullLocked })).toContain(TRASH_LIMIT_FULL_LOCKED_HINT);
  });

  it('四種版面皆可渲染 TrashSheet；EditorPane 專注模式不露出「⋯」但正常模式可開啟', () => {
    const modes: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];
    for (const mode of modes) {
      const sheetHtml = renderTrashSheet({ layoutMode: mode, items: [makeSampleTrash()] });
      expect(sheetHtml).toContain(`data-layout="${mode}"`);
      expect(sheetHtml).toContain('data-testid="trash-sheet"');
    }

    const baseState = demoFixtureState();
    const chapter = baseState.projects[0]!.nodes[0]!;
    const renderEditor = (focusMode: boolean) =>
      renderToStaticMarkup(
        createElement(
          SampleProvider,
          { initialState: baseState },
          createElement(
            LayoutProvider,
            { initialMode: 'phone-portrait', initialPanels: { focusMode } },
            createElement(
              MemoryRouter,
              { initialEntries: [`/p/${baseState.projects[0]!.id}/write/${chapter.id}`] },
              createElement(
                Routes,
                null,
                createElement(Route, {
                  path: '/p/:projectId/write/:chapterId',
                  element: createElement(EditorPane, {
                    projectId: baseState.projects[0]!.id,
                    chapter,
                  }),
                }),
              ),
            ),
          ),
        ),
      );

    const normalHtml = renderEditor(false);
    expect(normalHtml).toContain('data-testid="format-more-topbar"');
    expect(normalHtml).toContain('data-testid="format-more-landscape"');

    const focusHtml = renderEditor(true);
    expect(focusHtml).not.toContain('data-testid="format-more-topbar"');
    expect(focusHtml).not.toContain('data-testid="format-more-landscape"');
    expect(focusHtml).not.toContain('data-testid="trash-corner-notice"');
    expect(focusHtml).not.toContain('data-testid="trash-sheet"');
  });

  it('trashSheet.css 遵守 44px 觸控熱區、CSS 色票變數與專注模式隱藏規則', () => {
    const css = readFileSync(new URL('./trashSheet.css', import.meta.url), 'utf8');
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain('var(--panel)');
    expect(css).toContain('var(--bg)');
    expect(css).toContain('var(--text)');
    expect(css).toContain('var(--muted)');
    expect(css).toContain('var(--border)');
    expect(css).toContain('var(--accent)');
    expect(css).toContain('var(--danger)');
    expect(css).toContain('color-mix(in srgb, var(--accent)');
    expect(css).toContain('.trash-sheet-status');
    expect(css).toMatch(/html\[data-focus-mode="true"\] \.trash-corner-notice[\s\S]*?display:\s*none !important/);
    expect(css).toMatch(/html\[data-focus-mode="true"\] \.trash-sheet-backdrop[\s\S]*?display:\s*none !important/);

    const sheetSrc = readFileSync(new URL('./TrashSheet.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(sheetSrc).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    expect(sheetSrc).toContain("from '../copy/trashCopy'");
  });
});
