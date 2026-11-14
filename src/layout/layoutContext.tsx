import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyBodyFontScale,
  commitBodyFontScale,
  isBodyFontScale,
  readBodyFontScale,
  rememberBodyFontCaret,
  BODY_FONT_SCALE_DEFAULT,
  type BodyFontScale,
} from './bodyFontScale';
import {
  commitInputMode,
  ensureInputMode,
  readDeviceSignals,
  type DeviceKind,
} from './inputMode';
import {
  resolveLayoutMode,
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
  /** 第一次猜到的裝置種類，只決定說明小字，不跟著操作方式改。 */
  deviceKind: DeviceKind;
  /** 立刻改操作方式：寫進本機、更新 data-pointer。不重載、不改目錄和游標。 */
  setInputMode: (mode: PointerMode) => void;
  /** 正文字級百分比。只放大正文，立刻生效，存在這個瀏覽器。 */
  bodyFontScale: BodyFontScale;
  setBodyFontScale: (scale: BodyFontScale) => void;
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

export interface InputPreference {
  inputMode: PointerMode;
  deviceKind: DeviceKind;
}

/** 讀本機已存的操作方式。沒存過就猜一次並寫入。寫不進去就只用這一頁的猜測。 */
/** 讀本機正文字級。沒存過或不認得就用 100。寫不進去不影響這一頁。 */
export function loadBodyFontScale(): BodyFontScale {
  if (typeof localStorage === 'undefined') return BODY_FONT_SCALE_DEFAULT;
  try {
    return readBodyFontScale(localStorage);
  } catch {
    return BODY_FONT_SCALE_DEFAULT;
  }
}

function scaleFromProp(value: number | undefined): BodyFontScale {
  if (value != null && isBodyFontScale(value)) return value;
  return BODY_FONT_SCALE_DEFAULT;
}

export function loadInputPreference(): InputPreference {
  const signals = readDeviceSignals();
  if (typeof localStorage === 'undefined') {
    const guess = ensureInputMode(
      {
        getItem: () => null,
        setItem: () => {},
      },
      signals,
    );
    return { inputMode: guess.inputMode, deviceKind: guess.deviceKind };
  }
  try {
    const stored = ensureInputMode(localStorage, signals);
    return { inputMode: stored.inputMode, deviceKind: stored.deviceKind };
  } catch {
    const guess = ensureInputMode(
      {
        getItem: () => null,
        setItem: () => {},
      },
      signals,
    );
    return { inputMode: guess.inputMode, deviceKind: guess.deviceKind };
  }
}

export const LayoutContext = createContext<LayoutContextValue | null>(null);

export interface LayoutProviderProps {
  children?: ReactNode;
  initialMode?: LayoutMode;
  initialWideColumns?: WideColumns | null;
  initialPointer?: PointerMode;
  /** 測試用。正式畫面不傳，改由本機儲存或第一次猜測決定。 */
  initialDeviceKind?: DeviceKind;
  /** 測試用。正式畫面不傳，改讀本機的正文字級。 */
  initialBodyFontScale?: number;
  initialPanels?: Partial<SidePanelsState> & { focusMode?: boolean };
  initialFocusMode?: boolean;
}

export function LayoutProvider({
  children,
  initialMode,
  initialWideColumns,
  initialPointer,
  initialDeviceKind,
  initialBodyFontScale,
  initialPanels,
  initialFocusMode,
}: LayoutProviderProps) {
  const [layoutState, setLayoutState] = useState<{
    mode: LayoutMode;
    wideColumns: WideColumns | null;
    pointer: PointerMode;
    deviceKind: DeviceKind;
    bodyFontScale: BodyFontScale;
  }>(() => {
    const bodyFontScale = initialMode ? scaleFromProp(initialBodyFontScale) : loadBodyFontScale();
    applyBodyFontScale(bodyFontScale);
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
        deviceKind: initialDeviceKind ?? 'unknown',
        bodyFontScale,
      };
    }
    const res = getCurrentWindowResolution();
    const pref = loadInputPreference();
    return {
      mode: res.mode,
      wideColumns: res.wideColumns,
      pointer: pref.inputMode,
      deviceKind: pref.deviceKind,
      bodyFontScale,
    };
  });

  const [panelsState, setPanelsState] = useState<PanelsState>(() => {
    const isWide =
      initialMode === 'wide' ||
      (typeof window !== 'undefined' && window.innerWidth >= WIDE_ONE_SIDE_MIN);
    const combinedPanels = {
      ...initialPanels,
      focusMode: initialFocusMode ?? initialPanels?.focusMode,
    };
    return createInitialPanelsState(
      combinedPanels,
      isWide ? { mode: 'wide', wideColumns: initialWideColumns ?? 'one-side' } : undefined,
    );
  });

  const panelsRef = useRef(panelsState);
  panelsRef.current = panelsState;

  const layoutRef = useRef(layoutState);
  layoutRef.current = layoutState;
  const pointerRef = useRef(layoutState.pointer);
  pointerRef.current = layoutState.pointer;
  const bodyFontScaleRef = useRef(layoutState.bodyFontScale);
  bodyFontScaleRef.current = layoutState.bodyFontScale;

  useLayoutEffect(() => {
    applyBodyFontScale(layoutState.bodyFontScale);
  }, [layoutState.bodyFontScale]);

  const windowDimsRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  });

  // 同步側欄與專注模式狀態至 <html> 屬性（WO-55）
  useEffect(() => {
    applyPanelsHtmlAttributes(panelsState.sidePanels, panelsState.focusMode);
  }, [panelsState.sidePanels, panelsState.focusMode]);

  // 監聽視窗變化（使用 requestAnimationFrame 做節流）。
  // 操作方式不在這裡重猜：data-pointer 只跟已存的設定走（WO-94）。
  // 實體鍵盤收合仍由 useWritingKeyboard 讀 (pointer: fine)，不跟這項設定走。
  useEffect(() => {
    if (initialMode) {
      // 若外部強制指定，同步至 <html> 屬性後返回。不寫本機儲存。
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
        const ptr = pointerRef.current;

        applyHtmlLayoutAttributes(res.mode, res.wideColumns, ptr);

        setLayoutState((prev) => {
          if (prev.mode === res.mode && prev.wideColumns === res.wideColumns) {
            return prev;
          }
          // 版面切換時校正側欄。操作方式與裝置稱呼保持原樣。
          setPanelsState((currentPanels) => normalizePanelsForLayout(currentPanels, res));
          return {
            mode: res.mode,
            wideColumns: res.wideColumns,
            pointer: prev.pointer,
            deviceKind: prev.deviceKind,
            bodyFontScale: prev.bodyFontScale,
          };
        });
      });
    };

    const currentRes = getCurrentWindowResolution();
    applyHtmlLayoutAttributes(currentRes.mode, currentRes.wideColumns, pointerRef.current);

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
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

  const setInputMode = useCallback((mode: PointerMode) => {
    if (mode !== 'touch' && mode !== 'mouse') return;
    pointerRef.current = mode;
    if (typeof localStorage !== 'undefined') {
      try {
        commitInputMode(localStorage, mode);
      } catch {
        // 私人瀏覽可能不准寫入。這一頁仍先改過去。
      }
    }
    setLayoutState((prev) => {
      applyHtmlLayoutAttributes(prev.mode, prev.wideColumns, mode);
      if (prev.pointer === mode) return prev;
      return { ...prev, pointer: mode };
    });
  }, []);

  const setBodyFontScale = useCallback((scale: BodyFontScale) => {
    if (!isBodyFontScale(scale) || scale === bodyFontScaleRef.current) return;
    if (typeof document !== 'undefined' && typeof HTMLTextAreaElement !== 'undefined') {
      const found = document.querySelector('textarea.editor-input');
      if (found instanceof HTMLTextAreaElement) {
        rememberBodyFontCaret(found, bodyFontScaleRef.current);
      }
    }
    applyBodyFontScale(scale);
    if (typeof localStorage !== 'undefined') {
      try {
        commitBodyFontScale(localStorage, scale);
      } catch {
        // 私人瀏覽可能不准寫入。這一頁仍先改過去。
      }
    }
    bodyFontScaleRef.current = scale;
    setLayoutState((prev) => (prev.bodyFontScale === scale ? prev : { ...prev, bodyFontScale: scale }));
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
      deviceKind: layoutState.deviceKind,
      setInputMode,
      bodyFontScale: layoutState.bodyFontScale,
      setBodyFontScale,
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
  }, [layoutState, panelsState, openPanel, closePanel, togglePanel, enterFocus, exitFocus, toggleFocus, setInputMode, setBodyFontScale]);

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (context) return context;

  // 若在 Provider 外被呼叫，提供安全預設值
  const res = getCurrentWindowResolution();
  const pref = loadInputPreference();
  const bodyFontScale = loadBodyFontScale();
  const isAtLeastMedium = res.mode === 'medium' || res.mode === 'wide';
  const isWide = res.mode === 'wide';
  const isPhone = res.mode === 'phone-portrait' || res.mode === 'phone-landscape';

  return {
    mode: res.mode,
    wideColumns: res.wideColumns,
    pointer: pref.inputMode,
    deviceKind: pref.deviceKind,
    setInputMode: () => {},
    bodyFontScale,
    setBodyFontScale: () => {},
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
