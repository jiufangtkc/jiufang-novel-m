import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { findNode } from '../data/demo';
import { addSceneUnderChapter } from '../domain/outline';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { TREE_ADD_CHAPTER, TREE_INLINE_ADD_VOLUME, TREE_ORGANIZE } from '../copy/userFacing';
import { WriteScreen } from './WriteScreen';
import { demoFixtureState } from '../state/testing/sampleFixture';

function renderWrite(mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
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

  it('WO-124：底部按鈕列仍只有兩顆按鈕，樹內新增行不混進來', () => {
    for (const mode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const) {
      const html = renderWrite(mode);
      const start = html.indexOf('data-testid="tree-tools"');
      const row = html.slice(start, html.indexOf('</div>', start));
      expect(row.split('<button').length - 1).toBe(2);
      expect(row).toContain(`>${TREE_ORGANIZE}<`);
      expect(row).toContain(`>${TREE_ADD_CHAPTER}<`);
      expect(row).not.toContain(TREE_INLINE_ADD_VOLUME);
      // 樹內的根層新增卷在樹裡，每個版面只有一行
      expect(html.split(TREE_INLINE_ADD_VOLUME).length - 1).toBe(1);
    }
  });
});

describe('WO-124b 新增幕接線與結果', () => {
  const write = readFileSync(new URL('./WriteScreen.tsx', import.meta.url), 'utf8');
  const tree = readFileSync(new URL('./ChapterTree.tsx', import.meta.url), 'utf8');
  const file = (id: string, children?: ChapterNode[]): ChapterNode => ({
    id,
    type: 'file',
    title: id,
    content: '',
    expanded: false,
    children,
  });
  const sc = (id: string): ChapterNode => ({ id, type: 'scene', title: id, content: '' });
  const flat = (list: readonly ChapterNode[]): string[] => list.flatMap((n) => [n.id, ...flat(n.children ?? [])]);

  it('畫面回呼：章內新增行以章 id 呼叫 onAddScene，不會落到新增章', () => {
    const start = tree.indexOf('onClick={() => {', tree.indexOf('className="tree-inline-add"') - 80);
    const handler = tree.slice(start, tree.indexOf('}}', start));
    expect(handler).toContain("addKind === 'volume'");
    expect(handler).toContain('inlineAdd.onAddVolume()');
    expect(handler).toContain("addKind === 'chapter'");
    expect(handler).toContain('inlineAdd.onAddChapter(parent.id)');
    expect(handler).toContain('inlineAdd.onAddScene(parent.id)');
    expect(write).toContain('onAddScene: addScene');
    // addScene 只認章，並走既有的 createScene 與結構提交
    const body = write.slice(write.indexOf('function addScene('), write.indexOf('const deleteLabel'));
    expect(body).toContain("chapterNode.type !== 'file'");
    expect(body).toContain('createScene(chapterNode');
  });

  it('空章與已有幕的章（巢狀、根層）都把新幕加在末尾並展開，其他章順序與結構不變', () => {
    const nodes: ChapterNode[] = [
      file('root-empty'),
      { id: 'v', type: 'folder', title: '卷', expanded: true, children: [file('c-empty'), file('c-full', [sc('a'), sc('b')])] },
      file('root-full', [sc('x')]),
    ];
    for (const target of ['root-empty', 'c-empty', 'c-full', 'root-full']) {
      const next = addSceneUnderChapter(nodes, target, sc('new'))!;
      expect(flat(next).filter((id) => id === 'new')).toHaveLength(1);
      expect(flat(next).filter((id) => id !== 'new')).toEqual(flat(nodes));
      const node = findNode(next, target)!;
      expect(node.children!.at(-1)!.id).toBe('new');
      expect(node.expanded).toBe(true);
    }
    const nested = addSceneUnderChapter(nodes, 'c-full', sc('new'))!;
    expect(findNode(nested, 'c-full')!.children!.map((n) => n.id)).toEqual(['a', 'b', 'new']);
    expect(findNode(nested, 'c-empty')!.children).toBeUndefined();
    expect(nested.map((n) => n.id)).toEqual(['root-empty', 'v', 'root-full']);
  });

  it('目標不是章（卷）或不存在就不新增', () => {
    const nodes: ChapterNode[] = [{ id: 'v', type: 'folder', title: '卷', children: [file('c')] }];
    expect(addSceneUnderChapter(nodes, 'v', sc('n'))).toBeNull();
    expect(addSceneUnderChapter(nodes, 'zzz', sc('n'))).toBeNull();
  });
});
