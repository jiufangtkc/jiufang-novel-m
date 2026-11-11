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
import {
  resolveLayoutMode,
  resolvePointerMode,
  WIDE_ONE_SIDE_MIN,
  type LayoutMode,
  type LayoutResolution,
  type PointerMode,
  type PreviousLayoutContext,
  type WideColumns,
} from './layoutMode';
import {
  closeSidePanel,
  createInitialPanelsState,
  enterFocusMode,
  exitFocusMode,
  normalizePanelsForLayout,
  openSidePanel,
  toggleFocusMode,
  toggleSidePanel,
  type PanelsState,
  type SidePanelName,
  type SidePanelsState,
} from './sidePanels';

export interface LayoutContextValue {
  mode: LayoutMode;
  wideColumns: WideColumns | null;
  pointer: PointerMode;
  isAtLeastMedium: boolean;
  isWide: boolean;
  isPhone: boolean;
  sidePanels: SidePanelsState;
  focusMode: boolean;
  openPanel: (side: SidePanelName) => void;
  closePanel: (side: SidePanelName) => void;
  togglePanel: (side: SidePanelName) => void;
  enterFocusMode: () => void;
  exitFocusMode: () => void;
  toggleFocusMode: () => void;
}

export function applyHtmlLayoutAttributes(
  mode: LayoutMode,
  wideColumns: WideColumns | null,
  pointer: PointerMode,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.layout = mode;
  if (wideColumns) {
    root.dataset.wideColumns = wideColumns;
  } else {
    delete root.dataset.wideColumns;
  }
  root.dataset.pointer = pointer;
}

export function applyPanelsHtmlAttributes(
  sidePanels: SidePanelsState,
  focusMode: boolean,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.sidePanelLeft = String(sidePanels.left);
  root.dataset.sidePanelRight = String(sidePanels.right);
  if (focusMode) {
    root.dataset.focusMode = 'true';
  } else {
    delete root.dataset.focusMode;
  }
}

export function getCurrentWindowResolution(previous?: PreviousLayoutContext): LayoutResolution {
  if (typeof window === 'undefined') {
    return { mode: 'phone-portrait', wideColumns: null };
  }
  // 版面骨架判定以 window.innerWidth 與 window.innerHeight 為準，不看 visualViewport
  return resolveLayoutMode(window.innerWidth, window.innerHeight, previous);
}

export function getCurrentWindowPointer(): PointerMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'touch';
  }
  const pointerCoarse = window.matchMedia('(pointer: coarse)').matches;
  const anyPointerCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  return resolvePointerMode({ pointerCoarse, anyPointerCoarse });
}

export const LayoutContext = createContext<LayoutContextValue | null>(null);

export interface LayoutProviderProps {
  children?: ReactNode;
  initialMode?: LayoutMode;
  initialWideColumns?: WideColumns | null;
  initialPointer?: PointerMode;
  initialPanels?: Partial<SidePanelsState>;
}

export function LayoutProvider({
  children,
  initialMode,
  initialWideColumns,
  initialPointer,
  initialPanels,
}: LayoutProviderProps) {
  const [layoutState, setLayoutState] = useState<{
    mode: LayoutMode;
    wideColumns: WideColumns | null;
    pointer: PointerMode;
  }>(() => {
    if (initialMode) {
      return {
        mode: initialMode,
        wideColumns:
          initialWideColumns !== undefined
            ? initialWideColumns
            : initialMode === 'wide'
              ? 'one-side'
              : null,
        pointer: initialPointer ?? 'touch',
      };
    }
    const res = getCurrentWindowResolution();
    const ptr = initialPointer ?? getCurrentWindowPointer();
    return {
      mode: res.mode,
      wideColumns: res.wideColumns,
      pointer: ptr,
    };
  });

  const [panelsState, setPanelsState] = useState<PanelsState>(() => {
    const isWide =
      initialMode === 'wide' ||
      (typeof window !== 'undefined' && window.innerWidth >= WIDE_ONE_SIDE_MIN);
    return createInitialPanelsState(
      initialPanels,
      isWide ? { mode: 'wide', wideColumns: initialWideColumns ?? 'one-side' } : undefined,
    );
  });

  const panelsRef = useRef(panelsState);
  panelsRef.current = panelsState;

  const layoutRef = useRef(layoutState);
  layoutRef.current = layoutState;

  const windowDimsRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  });

  // 同步側欄與專注模式狀態至 <html> 屬性（WO-55）
  useEffect(() => {
    applyPanelsHtmlAttributes(panelsState.sidePanels, panelsState.focusMode);
  }, [panelsState.sidePanels, panelsState.focusMode]);

  // 監聽視窗變化與指標變化（使用 requestAnimationFrame 做節流）
  useEffect(() => {
    if (initialMode) {
      // 若外部強制指定，同步至 <html> 屬性後返回
      applyHtmlLayoutAttributes(
        initialMode,
        initialWideColumns !== undefined
          ? initialWideColumns
          : initialMode === 'wide'
            ? 'one-side'
            : null,
        initialPointer ?? 'touch',
      );
      return;
    }

    if (typeof window === 'undefined') return;

    let rafId: number | null = null;

    const update = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const prevCtx: PreviousLayoutContext = {
          width: windowDimsRef.current.width,
          height: windowDimsRef.current.height,
          mode: layoutRef.current.mode,
        };
        const res = getCurrentWindowResolution(prevCtx);
        windowDimsRef.current = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const ptr = getCurrentWindowPointer();

        applyHtmlLayoutAttributes(res.mode, res.wideColumns, ptr);

        setLayoutState((prev) => {
          if (
            prev.mode === res.mode &&
            prev.wideColumns === res.wideColumns &&
            prev.pointer === ptr
          ) {
            return prev;
          }
          // 版面切換時校正側欄
          setPanelsState((currentPanels) => normalizePanelsForLayout(currentPanels, res));
          return {
            mode: res.mode,
            wideColumns: res.wideColumns,
            pointer: ptr,
          };
        });
      });
    };

    // 初始寫入 <html> 屬性
    const currentRes = getCurrentWindowResolution();
    const currentPtr = getCurrentWindowPointer();
    applyHtmlLayoutAttributes(currentRes.mode, currentRes.wideColumns, currentPtr);

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);

    let coarseMedia: MediaQueryList | undefined;
    let anyCoarseMedia: MediaQueryList | undefined;
    if (typeof window.matchMedia === 'function') {
      try {
        coarseMedia = window.matchMedia('(pointer: coarse)');
        anyCoarseMedia = window.matchMedia('(any-pointer: coarse)');
        coarseMedia.addEventListener?.('change', update);
        anyCoarseMedia.addEventListener?.('change', update);
      } catch {
        // 部分測試環境不支援 addEventListener 於 MediaQueryList
      }
    }

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      try {
        coarseMedia?.removeEventListener?.('change', update);
        anyCoarseMedia?.removeEventListener?.('change', update);
      } catch {
        // 忽略移除錯誤
      }
    };
  }, [initialMode, initialWideColumns, initialPointer]);

  const openPanel = useCallback((side: SidePanelName) => {
    setPanelsState((prev) => {
      const res: LayoutResolution = {
        mode: layoutRef.current.mode,
        wideColumns: layoutRef.current.wideColumns,
      };
      return openSidePanel(prev, side, res);
    });
  }, []);

  const closePanel = useCallback((side: SidePanelName) => {
    setPanelsState((prev) => {
      const res: LayoutResolution = {
        mode: layoutRef.current.mode,
        wideColumns: layoutRef.current.wideColumns,
      };
      return closeSidePanel(prev, side, res);
    });
  }, []);

  const togglePanel = useCallback((side: SidePanelName) => {
    setPanelsState((prev) => {
      const res: LayoutResolution = {
        mode: layoutRef.current.mode,
        wideColumns: layoutRef.current.wideColumns,
      };
      return toggleSidePanel(prev, side, res);
    });
  }, []);

  const enterFocus = useCallback(() => {
    setPanelsState((prev) => enterFocusMode(prev));
  }, []);

  const exitFocus = useCallback(() => {
    setPanelsState((prev) => {
      const res: LayoutResolution = {
        mode: layoutRef.current.mode,
        wideColumns: layoutRef.current.wideColumns,
      };
      return exitFocusMode(prev, res);
    });
  }, []);

  const toggleFocus = useCallback(() => {
    setPanelsState((prev) => {
      const res: LayoutResolution = {
        mode: layoutRef.current.mode,
        wideColumns: layoutRef.current.wideColumns,
      };
      return toggleFocusMode(prev, res);
    });
  }, []);

  const value = useMemo<LayoutContextValue>(() => {
    const isAtLeastMedium =
      layoutState.mode === 'medium' || layoutState.mode === 'wide';
    const isWide = layoutState.mode === 'wide';
    const isPhone =
      layoutState.mode === 'phone-portrait' || layoutState.mode === 'phone-landscape';

    return {
      mode: layoutState.mode,
      wideColumns: layoutState.wideColumns,
      pointer: layoutState.pointer,
      isAtLeastMedium,
      isWide,
      isPhone,
      sidePanels: panelsState.sidePanels,
      focusMode: panelsState.focusMode,
      openPanel,
      closePanel,
      togglePanel,
      enterFocusMode: enterFocus,
      exitFocusMode: exitFocus,
      toggleFocusMode: toggleFocus,
    };
  }, [layoutState, panelsState, openPanel, closePanel, togglePanel, enterFocus, exitFocus, toggleFocus]);

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (context) return context;

  // 若在 Provider 外被呼叫，提供安全預設值
  const res = getCurrentWindowResolution();
  const ptr = getCurrentWindowPointer();
  const isAtLeastMedium = res.mode === 'medium' || res.mode === 'wide';
  const isWide = res.mode === 'wide';
  const isPhone = res.mode === 'phone-portrait' || res.mode === 'phone-landscape';

  return {
    mode: res.mode,
    wideColumns: res.wideColumns,
    pointer: ptr,
    isAtLeastMedium,
    isWide,
    isPhone,
    sidePanels: { left: false, right: false },
    focusMode: false,
    openPanel: () => {},
    closePanel: () => {},
    togglePanel: () => {},
    enterFocusMode: () => {},
    exitFocusMode: () => {},
    toggleFocusMode: () => {},
  };
}

export function useLayoutMode(): LayoutContextValue {
  return useLayout();
}
