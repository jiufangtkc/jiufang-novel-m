/**
 * 查字典按鈕放哪裡（WO-105，規格 D）
 * 只看現有版面判斷（版面模式、專注模式、手機橫拿打字中），不量鍵盤高度、不用 visualViewport。
 */

import type { LayoutMode } from '../layout/layoutMode';

/** topbar：頁首裡；floating：浮在畫面左上角（頁首被收起時） */
export type DictPlacement = 'topbar' | 'floating';

export interface DictPlacementInput {
  layoutMode: LayoutMode;
  focusMode: boolean;
  /** 手機橫拿打字中（頁首被收起，即 html.landscape-writing） */
  landscapeTyping: boolean;
}

export function dictPlacement({ layoutMode, focusMode, landscapeTyping }: DictPlacementInput): DictPlacement {
  if (focusMode) return 'floating';
  if (layoutMode === 'phone-landscape' && landscapeTyping) return 'floating';
  return 'topbar';
}
