import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_COPIED_TOAST,
  EDITOR_CUT_TOAST,
  EDITOR_PASTE_BLOCKED_TOAST,
} from '../copy/userFacing';
import { TOAST_DEFAULT_MS, TOAST_PASTE_BLOCKED_MS, toastDurationMs } from './sampleStore';

describe('WO-113：短提示停留時間與朗讀', () => {
  it('被擋提示約 5 秒，其他短提示維持 2.4 秒', () => {
    expect(TOAST_PASTE_BLOCKED_MS).toBe(5000);
    expect(TOAST_DEFAULT_MS).toBe(2400);
    expect(toastDurationMs(EDITOR_PASTE_BLOCKED_TOAST)).toBe(5000);
    expect(toastDurationMs(EDITOR_COPIED_TOAST)).toBe(2400);
    expect(toastDurationMs(EDITOR_CUT_TOAST)).toBe(2400);
  });

  it('Toast 有 role="status" 與 aria-live="polite"，念的就是畫面文字', () => {
    const source = readFileSync(new URL('../components/Toast.tsx', import.meta.url), 'utf8');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).not.toContain('aria-label');
  });
});
