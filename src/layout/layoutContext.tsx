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
import {
  fitWidePanels,
  loadWidePanels,
  saveWidePanels,
  wideChars,
} from './widePanels';

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

/** 電腦寬版正文一行字數（36 或 40）寫在 <html>，CSS 依此選限寬。非寬版移除。 */
export function applyWideCharsAttribute(chars: number | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  if (chars == null) {
    delete root.dataset.wideChars;
  } else {
    root.dataset.wideChars = String(chars);
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
  /**
   * 測試用（WO-W36）。指定後才依視窗寬度判斷電腦寬版放不放得下三欄。
   * 強制指定版面（initialMode）又沒給這項時，不做容量判斷，也不讀寫寬版側欄偏好。
   */
  initialViewportWidth?: number;
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
  initialViewportWidth,
}: LayoutProviderProps) {
  // 強制指定版面且沒給視窗寬時（舊測試），維持舊行為：不判斷容量、不讀寫偏好
  const capacityEnabled = !initialMode || initialViewportWidth !== undefined;
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

  // 電腦寬版：使用者希望展開的側欄（本機偏好）。只在使用者操作時改。
  const widePrefRef = useRef(
    initialPanels && (initialPanels.left !== undefined || initialPanels.right !== undefined)
      ? { left: initialPanels.left ?? true, right: initialPanels.right ?? true }
      : capacityEnabled
        ? loadWidePanels()
        : { left: true, right: false },
  );
  const [panelsState, setPanelsState] = useState<PanelsState>(() => {
    const isWide =
      initialMode === 'wide' ||
      (typeof window !== 'undefined' && window.innerWidth >= WIDE_ONE_SIDE_MIN);
    const realWide = capacityEnabled && layoutState.mode === 'wide';
    const combinedPanels = {
      ...(realWide && !initialPanels ? widePrefRef.current : {}),
      ...initialPanels,
      focusMode: initialFocusMode ?? initialPanels?.focusMode,
    };
    return createInitialPanelsState(
      combinedPanels,
      isWide ? { mode: 'wide', wideColumns: initialWideColumns ?? 'one-side' } : undefined,
    );
  });
  // 兩側都放不下時，先保留哪一邊（最後手動打開的那邊；預設左目錄）
  const [widePrefer, setWidePrefer] = useState<SidePanelName>('left');
  const [viewportWidth, setViewportWidth] = useState<number | null>(() =>
    initialViewportWidth !== undefined
      ? initialViewportWidth
      : !initialMode && typeof window !== 'undefined'
        ? window.innerWidth
        : null,
  );

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

  // 實際顯示的側欄：電腦寬版依視窗容量暫時收起放不下的那一側（不寫進使用者選擇）
  const isWideCapacity = capacityEnabled && layoutState.mode === 'wide';
  const fitted = useMemo<SidePanelsState>(() => {
    if (!isWideCapacity || panelsState.focusMode || viewportWidth == null) {
      return panelsState.sidePanels;
    }
    return fitWidePanels({
      wanted: panelsState.sidePanels,
      prefer: widePrefer,
      viewportWidth,
      scalePercent: layoutState.bodyFontScale,
      oneSide: layoutState.wideColumns === 'one-side',
    });
  }, [
    isWideCapacity,
    panelsState.focusMode,
    panelsState.sidePanels,
    widePrefer,
    viewportWidth,
    layoutState.bodyFontScale,
    layoutState.wideColumns,
  ]);
  const shownLeft = fitted.left;
  const shownRight = fitted.right;
  const shownPanels = useMemo<SidePanelsState>(
    () => ({ left: shownLeft, right: shownRight }),
    [shownLeft, shownRight],
  );
  const shownRef = useRef(shownPanels);
  shownRef.current = shownPanels;
  const bodyChars =
    layoutState.mode !== 'wide'
      ? null
      : viewportWidth == null
        ? 36
        : wideChars(viewportWidth, layoutState.bodyFontScale);

  const windowDimsRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  });

  // 同步側欄與專注模式狀態至 <html> 屬性（WO-55）
  useEffect(() => {
    applyPanelsHtmlAttributes(shownPanels, panelsState.focusMode);
  }, [shownPanels, panelsState.focusMode]);

  // WO-W36：電腦寬版正文一行字數（36／40）
  useEffect(() => {
    applyWideCharsAttribute(bodyChars);
  }, [bodyChars]);

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

        setViewportWidth(window.innerWidth);
        const before = layoutRef.current;
        if (before.mode !== res.mode || before.wideColumns !== res.wideColumns) {
          // 版面切換時校正側欄。操作方式與裝置稱呼保持原樣。
          setPanelsState((currentPanels) => {
            if (res.mode === 'wide') {
              // 寬版內部（one-side／both）切換不動選擇；從別的版面回到寬版，照使用者記住的選擇
              if (before.mode === 'wide') return currentPanels;
              const remembered = { ...widePrefRef.current };
              return currentPanels.focusMode
                ? { ...currentPanels, savedBeforeFocus: remembered }
                : { ...currentPanels, sidePanels: remembered, savedForOneSide: null };
            }
            return normalizePanelsForLayout(currentPanels, res);
          });
        }
        setLayoutState((prev) => {
          if (prev.mode === res.mode && prev.wideColumns === res.wideColumns) {
            return prev;
          }
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

  const currentResolution = (): LayoutResolution => ({
    mode: layoutRef.current.mode,
    wideColumns: layoutRef.current.wideColumns,
  });

  /**
   * 電腦寬版的側欄操作（WO-W36）：只改使用者的選擇（並記住），實際顯示由容量決定。
   * 打開的那一側優先保留；放不下時另一側暫時讓位，關掉後自動回來。
   */
  const wideAction = useCallback(
    (side: SidePanelName, kind: 'open' | 'close' | 'toggle') => {
      const cur = panelsRef.current;
      if (cur.focusMode && kind === 'close') return;
      const base = cur.focusMode ? (cur.savedBeforeFocus ?? widePrefRef.current) : cur.sidePanels;
      const shown = cur.focusMode ? { left: false, right: false } : shownRef.current;
      const open = kind === 'open' ? true : kind === 'close' ? false : !shown[side];
      const next: SidePanelsState = { ...base, [side]: open };
      widePrefRef.current = next;
      saveWidePanels(next);
      if (open) setWidePrefer(side);
      setPanelsState({
        sidePanels: next,
        focusMode: false,
        savedBeforeFocus: null,
        savedForOneSide: null,
      });
    },
    [],
  );
  const usesWideRules = () => capacityEnabled && layoutRef.current.mode === 'wide';

  const openPanel = useCallback(
    (side: SidePanelName) => {
      if (usesWideRules()) return wideAction(side, 'open');
      setPanelsState((prev) => openSidePanel(prev, side, currentResolution()));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capacityEnabled, wideAction],
  );

  const closePanel = useCallback(
    (side: SidePanelName) => {
      if (usesWideRules()) return wideAction(side, 'close');
      setPanelsState((prev) => closeSidePanel(prev, side, currentResolution()));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capacityEnabled, wideAction],
  );

  const togglePanel = useCallback(
    (side: SidePanelName) => {
      if (usesWideRules()) return wideAction(side, 'toggle');
      setPanelsState((prev) => toggleSidePanel(prev, side, currentResolution()));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capacityEnabled, wideAction],
  );

  const enterFocus = useCallback(() => {
    setPanelsState((prev) => enterFocusMode(prev));
  }, []);

  const exitFocus = useCallback(() => {
    setPanelsState((prev) => exitFocusMode(prev, usesWideRules() ? undefined : currentResolution()));
  }, []);

  const toggleFocus = useCallback(() => {
    setPanelsState((prev) =>
      toggleFocusMode(prev, usesWideRules() ? undefined : currentResolution()),
    );
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
      sidePanels: shownPanels,
      focusMode: panelsState.focusMode,
      openPanel,
      closePanel,
      togglePanel,
      enterFocusMode: enterFocus,
      exitFocusMode: exitFocus,
      toggleFocusMode: toggleFocus,
    };
  }, [layoutState, shownPanels, panelsState.focusMode, openPanel, closePanel, togglePanel, enterFocus, exitFocus, toggleFocus, setInputMode, setBodyFontScale]);

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
