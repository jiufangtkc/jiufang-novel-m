/**
 * 歡迎導覽外框的純函式（WO-110，歡迎-3）。畫面在 WelcomeTour.tsx。
 *
 * 五頁：歡迎 → 第 1 關每天 → 第 2 關全書 → 第 3 關出發 → 收尾。
 * 三關內容與設定寫入、收尾四種分流在 WO-111 的 WelcomeSteps.tsx／welcomeStepsModel.ts；這裡只管頁序、小徑、紀錄時機、鍵盤與版面排法。
 */

import type { LayoutMode } from '../layout';
import type { OnboardingStatus } from '../state/onboardingRecord';
import type { TourStepNumber } from '../copy/welcomeCopy';

export type TourPage = 'welcome' | TourStepNumber | 'finish';

/** 'first'：首頁第一次自動出現。'revisit'：從「設定 › 關於 › 再看一次歡迎導覽」叫出來。 */
export type TourEntry = 'first' | 'revisit';

export const TOUR_PAGES: readonly TourPage[] = ['welcome', 1, 2, 3, 'finish'];

export function isStep(page: TourPage): page is TourStepNumber {
  return page === 1 || page === 2 || page === 3;
}

/** 主要按鈕或某關「跳過」之後的下一頁（收尾沒有下一頁）。 */
export function nextPage(page: TourPage): TourPage | null {
  const at = TOUR_PAGES.indexOf(page);
  return at >= 0 && at < TOUR_PAGES.length - 1 ? TOUR_PAGES[at + 1] : null;
}

/** 「上一步」回到的頁。只有三關有上一步；上一步不回滾任何設定。 */
export function backPage(page: TourPage): TourPage | null {
  if (!isStep(page)) return null;
  return page === 1 ? 'welcome' : ((page - 1) as TourStepNumber);
}

export function hasBack(page: TourPage): boolean {
  return isStep(page);
}

/** 右上角：歡迎頁是整趟跳過（再看一次時是關閉），三關是這一關跳過，收尾沒有。 */
export type CornerAction = 'skip-all' | 'close' | 'skip-step' | null;

export function cornerAction(page: TourPage, entry: TourEntry): CornerAction {
  if (page === 'welcome') return entry === 'first' ? 'skip-all' : 'close';
  if (isStep(page)) return 'skip-step';
  return null;
}

/** 頂端小徑三點的狀態。歡迎頁沒有小徑（null）；收尾三點全亮（都走過、沒有目前這關）。 */
export type TrailDot = 'todo' | 'current' | 'done';

export function trailDots(page: TourPage): [TrailDot, TrailDot, TrailDot] | null {
  if (page === 'welcome') return null;
  if (page === 'finish') return ['done', 'done', 'done'];
  return ([1, 2, 3] as const).map((n) => (n < page ? 'done' : n === page ? 'current' : 'todo')) as [
    TrailDot,
    TrailDot,
    TrailDot,
  ];
}

/**
 * 這一下要不要寫 onboarding.v1，寫什麼（規格 C、D、G）。
 * - 按任何一頁的「跳過」（整趟或某一關）→ 按下當下就記 skipped；走到收尾 → done。
 * - WO-111：第 1、2 關按過跳過（已記 skipped）之後照常走到收尾，依 C 節改記 done；
 *   第 3 關按跳過（skip-last-step）直接到收尾，維持 skipped，不被 done 蓋掉。
 * - 同一趟已記過 skipped 再按別關跳過，不重寫。
 * - 「關閉」（再看一次）什麼都不改，不寫。
 * - 再看一次時本機原本已有紀錄，就不覆寫；沒有紀錄（例如一直是直接開稿子網址）才補寫。
 * - 中途關掉不會走到這裡，所以不寫；也從不刪鍵。
 */
export type TourEvent = 'skip-all' | 'skip-step' | 'skip-last-step' | 'close' | 'reach-finish';

export function recordStatusFor(
  event: TourEvent,
  ctx: { entry: TourEntry; writtenThisRun: boolean; hadRecordAtStart: boolean; skippedLastStep?: boolean },
): OnboardingStatus | null {
  if (event === 'close') return null;
  if (ctx.entry === 'revisit' && ctx.hadRecordAtStart) return null;
  if (event === 'reach-finish') return ctx.skippedLastStep ? null : 'done';
  if (ctx.writtenThisRun) return null;
  return 'skipped';
}

/* ── 鍵盤 ── */

export interface KeyTarget {
  tagName: string;
  role?: string | null;
  type?: string | null;
  isContentEditable?: boolean;
}

/**
 * Enter 要不要代按主要按鈕。
 * 焦點在其他按鈕或連結上時，Enter 照原生行為按那一顆（例如「跳過」「上一步」）；
 * 在單選選項、輸入框或頁面本身上時，Enter 按主要按鈕。多行輸入與可編輯區不攔。
 */
export function enterTriggersPrimary(target: KeyTarget): boolean {
  const tag = target.tagName.toUpperCase();
  const role = target.role ?? '';
  if (target.isContentEditable) return false;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'A') return false;
  if (tag === 'BUTTON') return role === 'radio';
  if (tag === 'INPUT') {
    const type = (target.type ?? 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'file', 'image'].includes(type);
  }
  return true;
}

/** 方向鍵在同一組單選裡移動：下、右往後，上、左往前，頭尾相接。不是方向鍵回 null。 */
export function radioArrowTarget(key: string, index: number, count: number): number | null {
  if (count <= 0 || index < 0) return null;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  return null;
}

/** 不設 Esc 關閉：Esc 一律不做任何事（避免一按就整趟跳過）。 */
export function escapeClosesTour(): false {
  return false;
}

/* ── 四種版面 ── */

export interface TourPresentation {
  /** 'page'：手機直拿、橫拿整頁；'card'：中等、寬版置中卡片，後面變暗。 */
  kind: 'page' | 'card';
  /** 手機橫拿左右兩欄，其他一欄。 */
  columns: 1 | 2;
  /** 卡片寬：中等 480、寬版 520；整頁為 null。 */
  cardWidth: number | null;
  /** 卡片最高＝畫面高度減 80；整頁為 null。 */
  cardMaxHeightInset: number | null;
  /** 手機橫拿左右各留 60（並依安全區避瀏海）；其他 null。 */
  sideInset: number | null;
}

export function tourPresentation(mode: LayoutMode): TourPresentation {
  switch (mode) {
    case 'phone-landscape':
      return { kind: 'page', columns: 2, cardWidth: null, cardMaxHeightInset: null, sideInset: 60 };
    case 'medium':
      return { kind: 'card', columns: 1, cardWidth: 480, cardMaxHeightInset: 80, sideInset: null };
    case 'wide':
      return { kind: 'card', columns: 1, cardWidth: 520, cardMaxHeightInset: 80, sideInset: null };
    default:
      return { kind: 'page', columns: 1, cardWidth: null, cardMaxHeightInset: null, sideInset: null };
  }
}

/** 按鈕尺寸：四版相同，寬版用滑鼠也不縮小（主要 52、上一步約 96×52、選項 64 間距 10、跳過 44×44 以上）。 */
export const TOUR_SIZES = {
  primaryHeight: 52,
  backWidth: 96,
  backHeight: 52,
  optionHeight: 64,
  optionGap: 10,
  skipMin: 44,
} as const;
