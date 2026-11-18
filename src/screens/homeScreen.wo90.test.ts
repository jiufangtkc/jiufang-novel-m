import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WO-90：首頁建立新稿導向', () => {
  it('WO-90：長篇與單篇建立後皆導向第一章正文路徑', () => {
    const source = readFileSync(new URL('./HomeScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('navigate(writePath(id, newChapterId(id)))');
    expect(source).not.toMatch(/shape === 'single' \? writePath/);
  });
});