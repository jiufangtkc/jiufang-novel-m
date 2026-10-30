import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { nodesAfterStructureUndo } from './structureUndo';

function chapter(
  id: string,
  title: string,
  content: string,
  progress: ChapterNode['progress'] = 'Draft',
): ChapterNode {
  return { id, type: 'file', title, content, progress };
}

describe('復原只動該動的地方', () => {
  it('移動後復原只回到原來的位置，別章新打的字、章名、進度都還在', () => {
    const current = [
      chapter('ch-07', '第七章　改過名', '七在這十秒打的新字', '2nd Edit'),
      chapter('ch-12', '第十二章　也改了', '十二也改了', '1st Edit'),
      chapter('ch-03', '第三章', '三的原稿', 'Final'),
    ];
    const restored = nodesAfterStructureUndo(current, {
      kind: 'move',
      id: 'ch-12',
      parentId: null,
      index: 0,
    });
    expect(restored.map((node) => node.id)).toEqual(['ch-12', 'ch-07', 'ch-03']);
    expect(restored[1]).toMatchObject({
      title: '第七章　改過名',
      content: '七在這十秒打的新字',
      progress: '2nd Edit',
    });
    expect(restored[0]).toMatchObject({
      title: '第十二章　也改了',
      content: '十二也改了',
      progress: '1st Edit',
    });
    expect(restored[2]?.content).toBe('三的原稿');
  });

  it('新增後復原只拿掉新章，不蓋回別章的字', () => {
    const current = [
      chapter('ch-07', '第七章', '七在這十秒打的新字'),
      chapter('ch-new', '新章', ''),
    ];
    const restored = nodesAfterStructureUndo(current, { kind: 'add', id: 'ch-new' });
    expect(restored.map((node) => node.id)).toEqual(['ch-07']);
    expect(restored[0]?.content).toBe('七在這十秒打的新字');
  });

  it('改名與改進度的復原不動正文', () => {
    const renamed = nodesAfterStructureUndo([chapter('ch-07', '新名', '七的新字', 'Final')], {
      kind: 'rename',
      id: 'ch-07',
      title: '舊名',
    });
    expect(renamed[0]).toMatchObject({ title: '舊名', content: '七的新字', progress: 'Final' });
    const progressed = nodesAfterStructureUndo([chapter('ch-07', '第七章', '七的新字', 'Final')], {
      kind: 'progress',
      id: 'ch-07',
      progress: 'Draft',
    });
    expect(progressed[0]).toMatchObject({ title: '第七章', content: '七的新字', progress: 'Draft' });
  });
});
