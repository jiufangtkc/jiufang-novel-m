import { describe, expect, it } from 'vitest';
import { shouldUseCompactWritingLayout, shouldUsePhoneLandscapeWriting } from './useWritingKeyboard';

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

describe('手機橫放打字', () => {
  const phone = {
    focused: true,
    pointerFine: false,
    orientationLandscape: true,
    viewportHeight: 180,
    screenShortEdge: 390,
    visualViewportWidth: 844,
    visualViewportHeight: 180,
  };

  it('手機橫放、可見高度被鍵盤壓矮、而且正在打字，才只留正文', () => {
    expect(shouldUsePhoneLandscapeWriting(phone)).toBe(true);
    expect(shouldUsePhoneLandscapeWriting({ ...phone, focused: false })).toBe(false);
    expect(
      shouldUsePhoneLandscapeWriting({ ...phone, viewportHeight: 390, visualViewportHeight: 390 }),
    ).toBe(false);
  });

  it('直向就算鍵盤把高度壓過寬度，也不藏標題', () => {
    expect(
      shouldUsePhoneLandscapeWriting({
        ...phone,
        orientationLandscape: false,
        viewportHeight: 250,
        visualViewportWidth: 390,
        visualViewportHeight: 250,
      }),
    ).toBe(false);
  });

  it('平板與電腦維持原樣', () => {
    expect(
      shouldUsePhoneLandscapeWriting({ ...phone, screenShortEdge: 768, visualViewportWidth: 1024 }),
    ).toBe(false);
    expect(shouldUsePhoneLandscapeWriting({ ...phone, pointerFine: true })).toBe(false);
  });

  it('版面高還沒跟上時，看得到很矮的橫向 visualViewport 也算', () => {
    expect(
      shouldUsePhoneLandscapeWriting({
        ...phone,
        orientationLandscape: false,
        viewportHeight: 844,
        visualViewportWidth: 844,
        visualViewportHeight: 180,
      }),
    ).toBe(true);
  });
});
