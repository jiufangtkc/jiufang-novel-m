import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { rememberTreeScroll } from './treeScroll';

function fakeChapters(count: number): ChapterNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `ch-${index + 1}`,
    type: 'file' as const,
    title: `第 ${index + 1} 章　【示範】假章`,
    progress: 'Draft' as const,
    content: '【示範】這是假句子。',
  }));
}

describe('手機章節目錄', () => {
  it('四十章以上的假書，返回目錄時還原捲動並保持高亮', () => {
    const chapters = fakeChapters(41);
    expect(chapters.length).toBeGreaterThan(40);
    const opened = rememberTreeScroll(null, { type: 'open', chapterId: 'ch-28', scrollTop: 1578 });
    const back = rememberTreeScroll(opened, { type: 'back' });
    expect(back.highlightId).toBe('ch-28');
    expect(back.scrollTop).toBe(1578);
    expect(chapters.some((chapter) => chapter.id === back.highlightId)).toBe(true);
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    const mobile = css.split('@media (min-width: 600px)')[0] ?? '';
    expect(mobile).toMatch(/\.tree-pane\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;/);
  });
});
