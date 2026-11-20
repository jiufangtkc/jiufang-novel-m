import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { WhatsNewDialog } from '../components/WhatsNewDialog';
import { APP_VERSION } from '../copy/aboutCopy';
import { findReleaseNote } from '../data/whatsNew';
import { hasStoredDeviceTheme } from '../layout/deviceTheme';
import { useSample } from '../state/sampleStore';
import {
  decideWhatsNew,
  hasPriorUsage,
  readSeenVersion,
  writeSeenVersion,
} from '../state/whatsNewRecord';

export interface WhatsNewContextValue {
  openWhatsNew: (origin?: HTMLElement | null) => void;
}

interface WhatsNewLayerContextValue {
  open: boolean;
  returnFocusTo: HTMLElement | null;
  closeWhatsNew: () => void;
}

const WhatsNewContext = createContext<WhatsNewContextValue>({
  openWhatsNew: () => {},
});

const WhatsNewLayerContext = createContext<WhatsNewLayerContextValue | null>(null);

/** 判斷畫面上目前是否正顯示歡迎導覽（或正在重看歡迎導覽路由），避免雙視窗重疊。 */
export function isWelcomeTourActive(
  pathname: string,
  doc: Pick<Document, 'querySelector'> | null = typeof document === 'undefined' ? null : document,
): boolean {
  if (pathname.endsWith('/welcome')) return true;
  return Boolean(doc?.querySelector('[data-testid="welcome-tour"]'));
}

/**
 * WO-129：App 層改版說明協調器。
 * - 等 deviceLoaded 完成後才判斷一次：全新使用者靜默寫入目前版號不跳；舊使用者自動跳出。
 * - 歡迎導覽開啟中或位於 /welcome 時暫緩為 wait，待導覽結束後再接續檢查。
 * - 設定頁「看改版內容」透過 useWhatsNew().openWhatsNew() 開啟同一視窗。
 */
export function WhatsNewProvider({ children }: { children: ReactNode }) {
  const { state, deviceLoaded } = useSample();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);
  const [waitTick, setWaitTick] = useState(0);
  const decidedRef = useRef(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    if (decidedRef.current) return;

    const seen = readSeenVersion();
    const projectIds = state.projects.map((project) => project.id);
    const prior = hasPriorUsage({
      projectIds,
      recentIds: state.recentIds,
      hasThemePreference: hasStoredDeviceTheme(),
    });
    const hasReleaseNote = findReleaseNote(APP_VERSION) !== null;
    const welcomeOpen = isWelcomeTourActive(pathname);

    const decision = decideWhatsNew({
      storageAvailable: seen.available,
      seenVersion: seen.version,
      currentVersion: APP_VERSION,
      hasReleaseNote,
      deviceLoaded,
      hasPriorUsage: prior,
      welcomeOpen,
    });

    if (decision === 'none') {
      decidedRef.current = true;
      return;
    }

    if (decision === 'mark-seen') {
      writeSeenVersion(APP_VERSION);
      decidedRef.current = true;
      return;
    }

    if (decision === 'wait') {
      if (!welcomeOpen || typeof MutationObserver === 'undefined' || !document.body) return;
      const observer = new MutationObserver(() => {
        if (!isWelcomeTourActive(pathnameRef.current)) {
          observer.disconnect();
          setWaitTick((n) => n + 1);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }

    // 延後一個畫格再開啟，確保同一回合由首頁掛上的歡迎導覽先出現在 DOM 上而不會重疊。
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const rafId = window.requestAnimationFrame(() => {
        if (decidedRef.current) return;
        if (isWelcomeTourActive(pathnameRef.current)) {
          setWaitTick((n) => n + 1);
          return;
        }
        decidedRef.current = true;
        setReturnFocusTo(null);
        setOpen(true);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    decidedRef.current = true;
    setReturnFocusTo(null);
    setOpen(true);
  }, [deviceLoaded, pathname, state.projects, state.recentIds, waitTick]);

  const openWhatsNew = useCallback((origin?: HTMLElement | null) => {
    setReturnFocusTo(origin ?? null);
    setOpen(true);
  }, []);

  const closeWhatsNew = useCallback(() => {
    decidedRef.current = true;
    writeSeenVersion(APP_VERSION);
    setOpen(false);
    setReturnFocusTo(null);
  }, []);

  const publicValue = useMemo<WhatsNewContextValue>(() => ({ openWhatsNew }), [openWhatsNew]);
  const layerValue = useMemo<WhatsNewLayerContextValue>(
    () => ({ open, returnFocusTo, closeWhatsNew }),
    [open, returnFocusTo, closeWhatsNew],
  );

  return (
    <WhatsNewContext.Provider value={publicValue}>
      <WhatsNewLayerContext.Provider value={layerValue}>
        {children}
      </WhatsNewLayerContext.Provider>
    </WhatsNewContext.Provider>
  );
}

/** 掛在 .app-shell 外層的改版說明視窗圖層，確保不被頁面捲動或抽屜層級遮擋。 */
export function WhatsNewLayer() {
  const layer = useContext(WhatsNewLayerContext);
  if (!layer || !layer.open) return null;
  return (
    <WhatsNewDialog
      version={APP_VERSION}
      returnFocusTo={layer.returnFocusTo}
      onClose={layer.closeWhatsNew}
    />
  );
}

/** 取得開啟改版說明視窗的方法；未包在 WhatsNewProvider 內時回傳無動作預設值。 */
export function useWhatsNew(): WhatsNewContextValue {
  return useContext(WhatsNewContext);
}
