import { describe, expect, it } from 'vitest';
import { focusWritingBody } from './focusWriting';

describe('新章進入正文', () => {
  it('確定後把游標放進正文框', () => {
    let focused = false;
    let range: [number, number] | null = null;
    const box = {
      value: '【範例】在這裡寫作。',
      focus() {
        focused = true;
      },
      setSelectionRange(start: number, end: number) {
        range = [start, end];
      },
    };
    expect(focusWritingBody(box)).toBe(true);
    expect(focused).toBe(true);
    expect(range).toEqual([box.value.length, box.value.length]);
    expect(focusWritingBody(null)).toBe(false);
  });
});
