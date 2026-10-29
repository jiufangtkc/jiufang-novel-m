import { describe, expect, it } from 'vitest';
import { shouldUseCompactWritingLayout } from './useWritingKeyboard';

describe('寫作精簡版面', () => {
  it('手機上一聚焦就進入，失焦就恢復', () => {
    expect(
      shouldUseCompactWritingLayout({ focused: true, pointerFine: false, viewportWidth: 390 }),
    ).toBe(true);
    expect(
      shouldUseCompactWritingLayout({ focused: false, pointerFine: false, viewportWidth: 390 }),
    ).toBe(false);
  });

  it('精細指標或寬度達到 768 的電腦版不精簡', () => {
    expect(
      shouldUseCompactWritingLayout({ focused: true, pointerFine: true, viewportWidth: 390 }),
    ).toBe(false);
    expect(
      shouldUseCompactWritingLayout({ focused: true, pointerFine: false, viewportWidth: 768 }),
    ).toBe(false);
    expect(
      shouldUseCompactWritingLayout({ focused: true, pointerFine: true, viewportWidth: 1280 }),
    ).toBe(false);
  });

  it('觸控平板寬度還在 768 以下時，聚焦仍精簡', () => {
    expect(
      shouldUseCompactWritingLayout({ focused: true, pointerFine: false, viewportWidth: 767 }),
    ).toBe(true);
  });
});
