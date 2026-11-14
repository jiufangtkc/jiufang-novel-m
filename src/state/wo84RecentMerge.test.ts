import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DemoProject } from '../data/demo';
import { manuscriptWritePath } from '../domain/openManuscript';
import { lastSuccessfulSaveMs, recentDisplayProjects } from './recentProjects';

function proj(id: string, title: string, text: string, origin?: 'file'): DemoProject {
  return {
    id,
    title,
    updatedLabel: '已在手機',
    nodes: [{ id: `${id}-c1`, kind: 'chapter', title: '第一章', content: text, children: [] }],
    ...(origin ? { origin } : {}),
  } as unknown as DemoProject;
}
const meta = (o: Record<string, number | null>) => ({
  lastAutoSaveMs: null,
  lastManualSaveMs: null,
  lastExportMs: null,
  lastProjectSaveMs: null,
  ...o,
});
const textOf = (p: DemoProject) => (p.nodes[0] as { content: string }).content;

describe('WO-84：首頁同名稿子合併成一筆', () => {
  it('WO-84：同名兩份只列一筆，且是較晚另存的那份（與清單順序無關）', () => {
    const old = proj('old', '【範例】同名稿', '舊的正文');
    const fresh = proj('fresh', '【範例】同名稿', '剛存的正文');
    const saveMeta = { old: meta({ lastExportMs: 1000 }), fresh: meta({ lastExportMs: 2000 }) };
    // 較舊那份排在清單最前面（剛被開啟），仍應選剛存那份
    const shown = recentDisplayProjects([old, fresh], ['old', 'fresh'], saveMeta);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.id).toBe('fresh');
    expect(textOf(shown[0]!)).toBe('剛存的正文');
    expect(manuscriptWritePath(shown[0]!)).toContain('fresh');
  });

  it('WO-84：自動暫存較晚、開啟較晚都不能取代存檔先後', () => {
    const a = proj('a', '【範例】稿', 'A');
    const b = proj('b', '【範例】稿', 'B');
    const saveMeta = {
      a: meta({ lastProjectSaveMs: 5000 }),
      b: meta({ lastAutoSaveMs: 9000, lastExportMs: 3000 }),
    };
    expect(recentDisplayProjects([b, a], ['b', 'a'], saveMeta)[0]!.id).toBe('a');
  });

  it('WO-84：較舊那份後來「立刻暫存」（App 空間）不取代較晚另存的那份', () => {
    const jia = proj('jia', '【範例】同名稿', '正文甲');
    const yi = proj('yi', '【範例】同名稿', '正文乙');
    const saveMeta = {
      jia: meta({ lastExportMs: 1000, lastManualSaveMs: 9000 }),
      yi: meta({ lastExportMs: 2000 }),
    };
    for (const ids of [['jia', 'yi'], ['yi', 'jia']]) {
      const shown = recentDisplayProjects([jia, yi], ids, saveMeta);
      expect(shown).toHaveLength(1);
      expect(shown[0]!.id).toBe('yi');
      expect(textOf(shown[0]!)).toBe('正文乙');
      expect(manuscriptWritePath(shown[0]!)).toContain('yi');
    }
    expect(lastSuccessfulSaveMs(meta({ lastManualSaveMs: 9000 }))).toBe(-1);
  });

  it('WO-84：不同書名不合併，清單順序維持', () => {
    const x = proj('x', '【範例】甲', '1');
    const y = proj('y', '【範例】乙', '2');
    expect(recentDisplayProjects([x, y], ['y', 'x'], {}).map((p) => p.id)).toEqual(['y', 'x']);
  });

  it('WO-84：存檔時間相同時留從檔案開回的那份，再平手留清單前面的', () => {
    const draft = proj('d', '【範例】稿', '草稿');
    const file = proj('f', '【範例】稿', '檔案', 'file');
    const same = { d: meta({ lastExportMs: 7 }), f: meta({ lastExportMs: 7 }) };
    expect(recentDisplayProjects([draft, file], ['d', 'f'], same)[0]!.id).toBe('f');
    const p1 = proj('p1', '【範例】稿', '1');
    const p2 = proj('p2', '【範例】稿', '2');
    expect(recentDisplayProjects([p1, p2], ['p2', 'p1'], {})[0]!.id).toBe('p2');
  });

  it('WO-84：沒有紀錄視為最舊；不刪底層專案', () => {
    expect(lastSuccessfulSaveMs(undefined)).toBe(-1);
    const a = proj('a', '【範例】稿', 'A');
    const b = proj('b', '【範例】稿', 'B');
    const all = [a, b];
    const shown = recentDisplayProjects(all, ['a', 'b'], { b: meta({ lastExportMs: 1 }) });
    expect(shown.map((p) => p.id)).toEqual(['b']);
    expect(all).toHaveLength(2);
  });

  it('WO-84：首頁實際使用同一個選取函式', () => {
    const source = readFileSync(new URL('../screens/HomeScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('recentDisplayProjects(state.projects, state.recentIds, state.saveMeta)');
  });
});
