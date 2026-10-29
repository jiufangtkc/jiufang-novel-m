import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { discardFreshChapter } from './chapterOps';

function file(id: string, content: string, children: ChapterNode[] = []): ChapterNode {
  return { id, type: 'file', title: '新章', content, children };
}

describe('取消剛新增的空章', () => {
  it('還沒寫字就取消，這章會被拿掉', () => {
    const nodes = [file('old', '舊章的字'), file('fresh', '')];
    const next = discardFreshChapter(nodes, { id: 'fresh', freshId: 'fresh', content: '', childCount: 0 });
    expect(next?.map((node) => node.id)).toEqual(['old']);
  });

  it('已有正文，或不是剛新增的章，取消改名不會刪', () => {
    const nodes = [file('old', '舊章的字'), file('fresh', '已經寫了')];
    expect(discardFreshChapter(nodes, { id: 'fresh', freshId: 'fresh', content: '已經寫了', childCount: 0 })).toBeNull();
    expect(discardFreshChapter(nodes, { id: 'old', freshId: 'fresh', content: '', childCount: 0 })).toBeNull();
    expect(discardFreshChapter(nodes, { id: 'fresh', freshId: 'fresh', content: '', childCount: 1 })).toBeNull();
  });
});
