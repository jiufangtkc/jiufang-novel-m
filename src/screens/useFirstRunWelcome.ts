import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LIVE_DRAFT_KEY } from '../editor/liveDraft';
import {
  decideFirstRun,
  deviceHasExistingData,
  hasOnboardingRecord,
  writeOnboardingRecord,
  type OnboardingReadStore,
  type OnboardingWriteStore,
} from '../state/onboardingRecord';
import { useSample } from '../state/sampleStore';

type Store = OnboardingReadStore & OnboardingWriteStore;

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 還沒寫回稿子的即時草稿也算「這台裝置有資料」。讀不到時當作沒有。 */
function hasLiveDraft(store: OnboardingReadStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(LIVE_DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * 首頁第一次自動出現的判斷，並處理「舊裝置已有資料 → 直接記 skipped」（規格 D-1、G）。
 * 回傳 'show' 才顯示；'wait' 表示裝置資料還沒載完，之後再判斷一次；'none' 表示這次不出現。
 */
export function resolveFirstRun(
  input: { atHome: boolean; deviceLoaded: boolean; projectIds: readonly string[]; recentIds: readonly string[] },
  store: Store | null = browserStore(),
  now: Date = new Date(),
): 'show' | 'wait' | 'none' {
  const decision = decideFirstRun({
    hasRecord: hasOnboardingRecord(store),
    atHome: input.atHome,
    deviceLoaded: input.deviceLoaded,
    hasExistingData: deviceHasExistingData({
      projectIds: input.projectIds,
      recentIds: input.recentIds,
      hasLiveDraft: hasLiveDraft(store),
    }),
  });
  if (decision === 'mark-skipped') {
    writeOnboardingRecord('skipped', now, store);
    return 'none';
  }
  return decision === 'show' ? 'show' : decision === 'wait' ? 'wait' : 'none';
}

/**
 * 首頁用：等裝置資料（含非同步暫存稿回復）載完才判斷一次；判斷完這次就不再改。
 * 不在首頁（直接開稿子網址）時不判斷，回首頁再判斷。
 */
export function useFirstRunWelcome(): { show: boolean; dismiss: () => void } {
  const { state, deviceLoaded } = useSample();
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  const decidedRef = useRef(false);
  const atHome = pathname === '/';
  useEffect(() => {
    if (decidedRef.current || !atHome) return;
    const result = resolveFirstRun({
      atHome,
      deviceLoaded,
      projectIds: state.projects.map((project) => project.id),
      recentIds: state.recentIds,
    });
    if (result === 'wait') return;
    decidedRef.current = true;
    if (result === 'show') setShow(true);
  }, [atHome, deviceLoaded, state.projects, state.recentIds]);
  return { show, dismiss: () => setShow(false) };
}
