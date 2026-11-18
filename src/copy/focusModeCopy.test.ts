import { describe, expect, it } from 'vitest';
import {
  FOCUS_MODE_ENTER_BUTTON,
  FOCUS_MODE_EXIT_BUTTON,
  FOCUS_MODE_EXIT_EXPAND_LABEL,
  FOCUS_MODE_LANDSCAPE_ENTER_ARIA,
  FOCUS_MODE_LANDSCAPE_EXIT_ARIA,
  FOCUS_MODE_THUMB_ENTER_LABEL,
} from './focusModeCopy';

describe('WO-62：專注模式文案常數驗證', () => {
  it('WO-62：沿用既有常數且符合臺灣繁體中文規範', () => {
    // 專注模式按鈕入口文案沿用 FOCUS_MODE_ENTER_BUTTON
    expect(FOCUS_MODE_ENTER_BUTTON).toBe('專注模式');
    expect(FOCUS_MODE_EXIT_BUTTON).toBe('離開專注模式');

    // 手機橫拿按鈕（只有圖示，朗讀「離開專注模式」；入口朗讀「專注模式」）
    expect(FOCUS_MODE_LANDSCAPE_EXIT_ARIA).toBe('離開專注模式');
    expect(FOCUS_MODE_LANDSCAPE_ENTER_ARIA).toBe('專注模式');

    // 手機直拿拇指區第三顆「專注模式」按鈕標籤
    expect(FOCUS_MODE_THUMB_ENTER_LABEL).toBe('專注模式');

    // 展開文字為「離開專注模式」
    expect(FOCUS_MODE_EXIT_EXPAND_LABEL).toBe('離開專注模式');
  });

  it('WO-62：文案常數嚴格遵守臺灣繁體用詞，無簡體字且無殘留「專心」或「今日」字樣', () => {
    const allCopies = [
      FOCUS_MODE_ENTER_BUTTON,
      FOCUS_MODE_EXIT_BUTTON,
      FOCUS_MODE_LANDSCAPE_EXIT_ARIA,
      FOCUS_MODE_LANDSCAPE_ENTER_ARIA,
      FOCUS_MODE_THUMB_ENTER_LABEL,
      FOCUS_MODE_EXIT_EXPAND_LABEL,
    ];

    for (const copy of allCopies) {
      // 不得含有簡體字或舊用詞
      expect(copy).not.toContain('专注');
      expect(copy).not.toContain('专心');
      expect(copy).not.toContain('專心');
      expect(copy).not.toContain('今日');
      expect(copy).not.toContain('今天的字數');
    }
  });
});

