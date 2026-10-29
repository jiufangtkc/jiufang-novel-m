import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('拖曳把手', () => {
  it('不會被系統選字或叫出選單', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    const block = css.match(/\.tree-handle \{[^}]+\}/)?.[0] ?? '';
    expect(block).toContain('user-select: none');
    expect(block).toContain('-webkit-touch-callout: none');
  });
});
