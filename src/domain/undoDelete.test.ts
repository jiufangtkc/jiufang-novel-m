import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { deletedFromNode } from './chapterVersions';
import { nodesAfterDeleteUndo } from './undoDelete';

function chapter(id: string, title: string, content: string, children: ChapterNode[] = []): ChapterNode {
  return { id, type: 'file', title, content, progress: 'Draft', children };
}

describe('刪除復原只放回那一章', () => {
  it('復原後別章新打的字還在，被刪的章含幕、位置、章名、進度、正文', () => {
    const scene: ChapterNode = {
      id: 's1',
      type: 'scene',
      title: '幕 1',
      content: '幕的原稿',
      progress: '1st Edit',
    };
    const original = [
      chapter('ch-12', '第十二章', '十二的原稿', [scene]),
      chapter('ch-07', '第七章', '七的原稿'),
    ];
    const deleted = deletedFromNode(original, 'ch-12', 1, 'del-12');
    expect(deleted).not.toBeNull();
    const typed = [chapter('ch-07', '第七章', '七在這十秒打的新字')];
    const restored = nodesAfterDeleteUndo(typed, { snapshot: original, deleted: deleted! });
    expect(restored.map((node) => node.id)).toEqual(['ch-12', 'ch-07']);
    const back = restored[0];
    expect(back?.title).toBe('第十二章');
    expect(back?.progress).toBe('Draft');
    expect(back?.content).toBe('十二的原稿');
    expect(back?.children?.[0]).toMatchObject({ id: 's1', title: '幕 1', content: '幕的原稿', progress: '1st Edit' });
    expect(restored[1]?.content).toBe('七在這十秒打的新字');
  });
});
