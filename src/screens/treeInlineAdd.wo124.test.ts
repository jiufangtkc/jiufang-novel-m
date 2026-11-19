import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  TREE_ADD_CHAPTER,
  TREE_ADD_CHAPTER_BELOW,
  TREE_ADD_SCENE,
  TREE_ADD_VOLUME,
  TREE_INLINE_ADD_CHAPTER,
  TREE_INLINE_ADD_SCENE,
  TREE_INLINE_ADD_VOLUME,
  TREE_NEW_VOLUME,
  TREE_ORGANIZE,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { insertBelowAnchor, locateNode } from '../domain/chapterOps';
import { LayoutProvider } from '../layout';
import { ChapterTree } from './ChapterTree';
import { inlineAddKindFor, showsChildList, volumeStillExists } from './treeInlineAdd';

const noop = () => {};

function scene(id: string): ChapterNode {
  return { id, type: 'scene', title: `幕${id}`, content: '' };
}
function chapter(id: string, children?: ChapterNode[], expanded?: boolean): ChapterNode {
  return { id, type: 'file', title: `章${id}`, content: '', children, expanded };
}
function volume(id: string, children: ChapterNode[], expanded?: boolean): ChapterNode {
  return { id, type: 'folder', title: `卷${id}`, children, expanded };
}

function sample(): ChapterNode[] {
  return [
    chapter('r1'),
    volume('v1', [chapter('c1', [scene('s1'), scene('s2')], true), chapter('c2'), chapter('c3', [scene('s3')], true)], true),
    volume('v2', [], true),
    volume('v3', [chapter('c4', [scene('s4')], true)], false),
    volume('v4', [chapter('c5', [scene('s5')], false)], true),
  ];
}

function render(nodes: ChapterNode[], opts: { organizing?: boolean; withAdd?: boolean } = {}): string {
  const inlineAdd = opts.withAdd === false ? undefined : { onAddVolume: noop, onAddChapter: noop, onAddScene: noop };
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: 'wide', initialWideColumns: 'both' },
      createElement(
        MemoryRouter,
        null,
        createElement(ChapterTree, {
          projectId: 'p',
          nodes,
          depth: 0,
          organizing: opts.organizing ?? false,
          desktop: true,
          draggingId: null,
          drop: null,
          editingId: null,
          onToggle: noop,
          onMore: noop,
          onPick: noop,
          onProgress: noop,
          onDragStart: noop,
          onRename: noop,
          onCancelRename: noop,
          onDismissInline: noop,
          onInlineRename: noop,
          inlineAdd,
        }),
      ),
    ),
  );
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe('WO-124 用字常數', () => {
  it('字串完全照工單（全形加號後一個半形空白）', () => {
    expect(TREE_INLINE_ADD_VOLUME).toBe('＋ 新增卷');
    expect(TREE_INLINE_ADD_CHAPTER).toBe('＋ 在這卷新增章');
    expect(TREE_INLINE_ADD_SCENE).toBe('＋ 在這章新增幕');
  });
  it('既有用字不變', () => {
    expect(TREE_ORGANIZE).toBe('整理目錄');
    expect(TREE_ADD_CHAPTER).toBe('新增章');
    expect(TREE_ADD_VOLUME).toBe('在下方新增一卷');
    expect(TREE_ADD_CHAPTER_BELOW).toBe('在下方新增一章');
    expect(TREE_ADD_SCENE).toBe('在這章裡新增幕');
    expect(TREE_NEW_VOLUME).toBe('新卷');
  });
});

describe('WO-124 出現規則（純函式）', () => {
  const [, v1, v2, v3, v4] = sample();
  it('根層一律新增卷，整理模式全部隱藏', () => {
    expect(inlineAddKindFor(null, false)).toBe('volume');
    expect(inlineAddKindFor(null, true)).toBeNull();
    expect(inlineAddKindFor(v1, true)).toBeNull();
  });
  it('卷展開才有新增章，收合沒有；省略展開值視為展開', () => {
    expect(inlineAddKindFor(v1, false)).toBe('chapter');
    expect(inlineAddKindFor(v2, false)).toBe('chapter');
    expect(inlineAddKindFor(v3, false)).toBeNull();
    expect(inlineAddKindFor(volume('x', []), false)).toBe('chapter');
  });
  it('章要展開且已有幕才有新增幕', () => {
    expect(inlineAddKindFor(chapter('a', [scene('s')], true), false)).toBe('scene');
    expect(inlineAddKindFor(chapter('a', [], true), false)).toBeNull();
    expect(inlineAddKindFor(chapter('a'), false)).toBeNull();
    expect(inlineAddKindFor(v4.children![0], false)).toBeNull();
  });
  it('空卷展開要畫子清單，收合或整理模式不畫', () => {
    expect(showsChildList(v2, false)).toBe(true);
    expect(showsChildList({ ...v2, expanded: false }, false)).toBe(false);
    expect(showsChildList(v2, true)).toBe(false);
    expect(showsChildList(chapter('a'), false)).toBe(false);
  });
  it('目標卷不存在或不是卷就停止', () => {
    expect(volumeStillExists(sample(), 'v2')).toBe(true);
    expect(volumeStillExists(sample(), 'gone')).toBe(false);
    expect(volumeStillExists(sample(), 'c1')).toBe(false);
  });
});

describe('WO-124 渲染', () => {
  it('空書只有根層新增卷', () => {
    const html = render([]);
    expect(count(html, TREE_INLINE_ADD_VOLUME)).toBe(1);
    expect(count(html, TREE_INLINE_ADD_CHAPTER)).toBe(0);
    expect(count(html, TREE_INLINE_ADD_SCENE)).toBe(0);
  });

  it('範例資料：各行數量、層級與按鈕語意', () => {
    const html = render(sample());
    expect(count(html, TREE_INLINE_ADD_VOLUME)).toBe(1);
    // v1、v2、v4 展開；v3 收合
    expect(count(html, TREE_INLINE_ADD_CHAPTER)).toBe(3);
    // c1、c3 展開有幕；c2 無幕；c5 收合；c4 在收合的卷裡
    expect(count(html, TREE_INLINE_ADD_SCENE)).toBe(2);
    expect(count(html, 'type="button" class="tree-inline-add"')).toBe(6);
    expect(html).toContain('<li class="tree-inline-add-item" data-inline-add="volume" style="--tree-depth:0">');
    expect(html).toContain('<li class="tree-inline-add-item" data-inline-add="chapter" style="--tree-depth:1">');
    expect(html).toContain('<li class="tree-inline-add-item" data-inline-add="scene" style="--tree-depth:2">');
  });

  it('新增行不帶 data-node-id，節點列數量不變', () => {
    const html = render(sample());
    const items = html.match(/<li class="tree-inline-add-item"[^>]*>.*?<\/li>/g) ?? [];
    expect(items).toHaveLength(6);
    for (const item of items) expect(item).not.toContain('data-node-id');
    // 可見節點：r1,v1,c1,s1,s2,c2,c3,s3,v2,v3,v4,c5
    expect(count(html, 'data-node-id=')).toBe(12);
  });

  it('根層新增卷在最後一個根層節點之後；卷內新增章在該卷最後一章子樹之後', () => {
    const html = render(sample());
    const rootAdd = html.lastIndexOf('data-inline-add="volume"');
    expect(rootAdd).toBeGreaterThan(html.indexOf('data-node-id="v4"'));
    expect(rootAdd).toBeGreaterThan(html.indexOf('data-node-id="c5"'));
    expect(html.endsWith('</li></ul>')).toBe(true);
    const v1Add = html.indexOf('data-inline-add="chapter"');
    expect(v1Add).toBeGreaterThan(html.indexOf('data-node-id="s3"'));
    expect(v1Add).toBeLessThan(html.indexOf('data-node-id="v2"'));
    const sceneAdd = html.indexOf('data-inline-add="scene"');
    expect(sceneAdd).toBeGreaterThan(html.indexOf('data-node-id="s2"'));
    expect(sceneAdd).toBeLessThan(html.indexOf('data-node-id="c2"'));
  });

  it('空卷展開時，清單只有新增章行', () => {
    const html = render([volume('e', [], true)]);
    expect(count(html, 'data-node-id=')).toBe(1);
    expect(count(html, TREE_INLINE_ADD_CHAPTER)).toBe(1);
    expect(html).toContain('aria-expanded="true"');
  });

  it('空卷收合：沒有新增章行，箭頭為收合', () => {
    const html = render([volume('e', [], false)]);
    expect(count(html, TREE_INLINE_ADD_CHAPTER)).toBe(0);
    expect(html).toContain('aria-expanded="false"');
  });

  it('展開值省略的舊資料：箭頭和畫面一致都是展開', () => {
    const html = render([volume('old', [chapter('k')])]);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-node-id="k"');
    expect(count(html, TREE_INLINE_ADD_CHAPTER)).toBe(1);
  });

  it('整理模式隱藏全部三種，也不為空卷多畫清單', () => {
    const html = render([...sample(), volume('e', [], true)], { organizing: true });
    expect(count(html, 'tree-inline-add')).toBe(0);
    expect(count(html, TREE_INLINE_ADD_VOLUME)).toBe(0);
    expect(count(html, 'data-node-id="e"')).toBe(1);
  });

  it('沒給新增回呼（例如搜尋結果區不使用）就不畫新增行', () => {
    const html = render(sample(), { withAdd: false });
    expect(count(html, 'tree-inline-add')).toBe(0);
  });
});

describe('WO-124 新增位置（沿用既有 insertBelowAnchor）', () => {
  const fresh = (type: ChapterNode['type'], id: string): ChapterNode => ({ id, type, title: id, content: '' });

  it('卷內新增章只追加到指定卷末尾，包含空卷', () => {
    const nodes = sample();
    const next = insertBelowAnchor(nodes, 'v1', fresh('file', 'n1'))!;
    expect(next.find((n) => n.id === 'v1')!.children!.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'n1']);
    expect(next.find((n) => n.id === 'v4')!.children!.map((c) => c.id)).toEqual(['c5']);
    const empty = insertBelowAnchor(nodes, 'v2', fresh('file', 'n2'))!;
    expect(empty.find((n) => n.id === 'v2')!.children!.map((c) => c.id)).toEqual(['n2']);
  });

  it('根層新增卷（無錨點）落在所有根層節點之後', () => {
    const nodes = sample();
    const next = insertBelowAnchor(nodes, null, fresh('folder', 'nv'))!;
    expect(next.map((n) => n.id)).toEqual([...nodes.map((n) => n.id), 'nv']);
    expect(locateNode(next, 'nv')).toEqual({ parentId: null, index: nodes.length });
  });
});

describe('WO-124 接線（原始碼）', () => {
  const write = readFileSync(new URL('./WriteScreen.tsx', import.meta.url), 'utf8');
  const tree = readFileSync(new URL('./ChapterTree.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

  it('三個回呼重用既有函式；新增卷走 addVolume(null) 並用 stay 意圖', () => {
    expect(write).toContain('onAddVolume: () => addVolume(null)');
    expect(write).toContain('onAddChapter: addChapterInVolume');
    expect(write).toContain('onAddScene: addScene');
    expect(write).toMatch(/function addChapterInVolume\(volumeId: string\) \{\s*if \(!volumeStillExists\(book\.nodes, volumeId\)\) return;\s*addChapter\(volumeId\);/);
    const body = write.slice(write.indexOf('function addVolume('), write.indexOf('function addChapterInVolume'));
    expect(body).toContain("setRenameIntent('stay')");
    expect(body).toContain('setRenameId(id)');
    expect(body).not.toContain("'write'");
  });

  it('底部按鈕列仍只有整理目錄與新增章，新增行不在其中', () => {
    const start = write.indexOf('className="tree-tools"');
    const tools = write.slice(start, start + 900);
    expect(tools).toContain('data-testid="organize-toggle"');
    expect(tools).toContain('data-testid="add-chapter"');
    expect(tools).not.toContain('INLINE_ADD');
  });

  it('新增行不接節點事件，也不記成上次開到的位置', () => {
    const start = tree.indexOf('data-inline-add={addKind}');
    const block = tree.slice(start, tree.indexOf('</ul>', start));
    for (const bad of ['data-node-id', 'onDragStart', 'onOpenChapter', 'onMore', 'onPointerDown', 'onPick']) {
      expect(block).not.toContain(bad);
    }
  });

  it('節點快捷鍵遇到新增按鈕就略過，但 Ctrl／Cmd+Z 復原要先處理', () => {
    const skip = write.indexOf("target.closest('.tree-inline-add')");
    const undoKey = write.indexOf("(event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey)");
    expect(skip).toBeGreaterThan(-1);
    expect(undoKey).toBeGreaterThan(-1);
    expect(undoKey).toBeLessThan(skip);
    // 略過之後才是 F2、Delete、Alt+方向
    expect(write.indexOf("event.key === 'F2'")).toBeGreaterThan(skip);
    expect(write.indexOf("event.key === 'Delete'")).toBeGreaterThan(skip);
    expect(write.indexOf("event.altKey && event.key === 'ArrowUp'")).toBeGreaterThan(skip);
  });

  it('樣式：淡色小字、焦點樣式、手機至少 44px、整理模式隱藏', () => {
    expect(css).toMatch(/\.tree-inline-add \{[^}]*color: var\(--muted\)[^}]*font-size: 13px/);
    expect(css).toMatch(/\.tree-inline-add:focus-visible \{[^}]*outline/);
    expect(css).toMatch(/html\[data-pointer="touch"\] \.tree-inline-add \{[^}]*min-height: 44px/);
    // 手機兩種版面不論 mouse 或 touch 都要 44px：規則必須獨立於 data-pointer，且排在 mouse 規則之後
    const phone = css.match(
      /html\[data-layout="phone-portrait"\] \.tree-inline-add,\s*html\[data-layout="phone-landscape"\] \.tree-inline-add \{[^}]*min-height: 44px/,
    );
    expect(phone).not.toBeNull();
    const phoneAt = css.indexOf('html[data-layout="phone-portrait"] .tree-inline-add');
    const mouseAt = css.indexOf('html[data-pointer="mouse"] .tree-inline-add {');
    expect(mouseAt).toBeGreaterThan(-1);
    expect(phoneAt).toBeGreaterThan(mouseAt);
    // 中等／寬版滑鼠維持既有高度
    expect(css).toMatch(/html\[data-pointer="mouse"\] \.tree-inline-add \{ min-height: var\(--hit-size, 36px\); \}/);
    expect(css).toMatch(/\.tree-pane\.is-organizing \.tree-inline-add-item \{ display: none; \}/);
  });
});
