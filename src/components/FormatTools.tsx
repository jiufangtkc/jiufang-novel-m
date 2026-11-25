import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { executeFormat, executeUndo, type FormatFlowDeps } from '../editor/formatFlow';
import type { FormatScope } from '../editor/formatScope';
import type { FormatKind } from '../editor/formatText';
import { useSample } from '../state/sampleStore';
import {
  FORMAT_BACK,
  FORMAT_CANCEL,
  FORMAT_COMPOSING_TOAST,
  FORMAT_CONFIRM_BOOK_NOTE,
  FORMAT_CONFIRM_TITLE,
  FORMAT_DIALOG_HINT,
  FORMAT_DIALOG_TITLE,
  FORMAT_DONE,
  FORMAT_KIND_GROUP_ARIA,
  FORMAT_KIND_INDENT,
  FORMAT_KIND_SPACE_PARAGRAPHS,
  FORMAT_KIND_STRIP_BLANK,
  FORMAT_MENU_ITEM,
  FORMAT_MORE_ARIA,
  FORMAT_MORE_GLYPH,
  FORMAT_NO_TARGET_TOAST,
  FORMAT_NOTICE_CLOSE,
  FORMAT_NOTICE_CLOSE_ARIA,
  FORMAT_SCOPE_BOOK,
  FORMAT_SCOPE_CHAPTER,
  FORMAT_SCOPE_GROUP_ARIA,
  FORMAT_SCOPE_TITLE,
  FORMAT_STALE_TOAST,
  FORMAT_START,
  FORMAT_UNCHANGED_TOAST,
  FORMAT_UNDO_BUTTON,
  FORMAT_UNDO_GONE_TOAST,
  FORMAT_UNDO_WARNING,
  FORMAT_UNDONE_TOAST,
  formatConfirmSentence,
} from '../copy/userFacing';

export interface FormatExtraMenuItem {
  id: string;
  label: string;
  badge?: string;
  onSelect: () => void;
}

export type FormatStep = 'menu' | 'kind' | 'scope' | 'confirm';

const KIND_LABEL: Record<FormatKind, string> = {
  indent: FORMAT_KIND_INDENT,
  'strip-blank': FORMAT_KIND_STRIP_BLANK,
  'space-paragraphs': FORMAT_KIND_SPACE_PARAGRAPHS,
};
const KIND_ORDER: FormatKind[] = ['indent', 'strip-blank', 'space-paragraphs'];
const SCOPE_LABEL: Record<FormatScope, string> = {
  chapter: FORMAT_SCOPE_CHAPTER,
  book: FORMAT_SCOPE_BOOK,
};
const MENU_WIDTH = 204;
const MENU_ITEM_HEIGHT = 48;

function menuHeightFor(itemCount: number): number {
  return 16 + Math.max(1, itemCount) * MENU_ITEM_HEIGHT;
}

interface FlowState {
  step: FormatStep;
  kind: FormatKind | null;
  scope: FormatScope | null;
  menuPos: { left: number; top: number };
}

/** 選單放在入口旁邊；入口在畫面邊緣時往內收，不超出畫面。 */
function menuPositionFor(origin: HTMLElement | null, itemCount = 1): { left: number; top: number } {
  const vw = typeof window === 'undefined' ? 390 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 844 : window.innerHeight;
  const menuHeight = menuHeightFor(itemCount);
  const rect = origin?.getBoundingClientRect();
  if (!rect) return { left: Math.max(8, vw - MENU_WIDTH - 12), top: 64 };
  const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), Math.max(8, vw - MENU_WIDTH - 8));
  const below = rect.bottom + 4;
  const top = below + menuHeight <= vh - 8 ? below : Math.max(8, rect.top - menuHeight - 4);
  return { left, top };
}

/**
 * WO-122：排版入口、選單、確認視窗與完成／復原提示的狀態與流程。
 * 只做畫面流程；正文改動全部交給 editor/formatFlow（不走 paste／input／noteLarge）。
 */
export function useFormatTools(options: {
  projectId: string;
  chapterId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isComposingRef: RefObject<boolean>;
  replaceText: (next: string, caret: number) => boolean;
  focusMode: boolean;
  getMenuItemCount?: () => number;
}) {
  const { projectId, chapterId, textareaRef, isComposingRef, replaceText, focusMode, getMenuItemCount } = options;
  const { state, actions } = useSample();
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const replaceRef = useRef(replaceText);
  replaceRef.current = replaceText;
  const getMenuItemCountRef = useRef(getMenuItemCount);
  getMenuItemCountRef.current = getMenuItemCount;
  const [flow, setFlow] = useState<FlowState | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const openedFor = useRef({ projectId, chapterId });

  const restoreFocus = () => {
    const origin = originRef.current;
    originRef.current = null;
    if (origin && origin.isConnected) origin.focus();
  };

  const close = () => {
    setFlow(null);
    restoreFocus();
  };

  const dismissMenu = () => {
    setFlow(null);
    originRef.current = null;
  };

  // 進入專注模式時關掉殘留的選單／視窗（專注模式不露出頁首與「⋯」）
  useEffect(() => {
    if (focusMode) {
      setFlow(null);
      originRef.current = null;
    }
  }, [focusMode]);

  const open = (origin: HTMLElement | null) => {
    if (focusMode) return;
    originRef.current = origin;
    openedFor.current = { projectId, chapterId };
    const itemCount = Math.max(1, getMenuItemCountRef.current?.() ?? 1);
    setFlow({ step: 'menu', kind: null, scope: null, menuPos: menuPositionFor(origin, itemCount) });
  };

  const deps = (): FormatFlowDeps => ({
    getNodes: () => stateRef.current.projects.find((item) => item.id === projectId)?.nodes ?? null,
    readLive: () => textareaRef.current?.value ?? null,
    isComposing: () => Boolean(isComposingRef.current),
    syncCurrent: (next) => {
      const el = textareaRef.current;
      const caret = Math.min(el?.selectionStart ?? next.length, next.length);
      return replaceRef.current(next, caret);
    },
    applyOthers: (changes, snapshot) => actionsRef.current.applyFormat(projectId, changes, snapshot),
    undoOthers: (entries) => actionsRef.current.undoFormat(projectId, entries),
    clearSnapshot: () => actionsRef.current.clearFormatUndo(),
  });

  const confirm = () => {
    if (!flow || !flow.kind || !flow.scope) return;
    const outcome = executeFormat(deps(), {
      projectId,
      currentId: chapterId,
      openedProjectId: openedFor.current.projectId,
      openedChapterId: openedFor.current.chapterId,
      kind: flow.kind,
      scope: flow.scope,
    });
    setFlow(null);
    restoreFocus();
    switch (outcome.status) {
      case 'unchanged':
        actionsRef.current.toast(FORMAT_UNCHANGED_TOAST);
        break;
      case 'composing':
        actionsRef.current.toast(FORMAT_COMPOSING_TOAST);
        break;
      case 'no-target':
        actionsRef.current.toast(FORMAT_NO_TARGET_TOAST);
        break;
      case 'stale':
        actionsRef.current.toast(FORMAT_STALE_TOAST);
        break;
      case 'applied':
        break;
    }
  };

  const undo = () => {
    const outcome = executeUndo(deps(), {
      projectId,
      currentId: chapterId,
      snapshot: stateRef.current.formatUndo,
    });
    if (outcome.status === 'restored') actionsRef.current.toast(FORMAT_UNDONE_TOAST);
    else if (outcome.status === 'invalid') actionsRef.current.toast(FORMAT_UNDO_GONE_TOAST);
    else if (outcome.status === 'composing') actionsRef.current.toast(FORMAT_COMPOSING_TOAST);
  };

  const hasSnapshot = Boolean(state.formatUndo && state.formatUndo.projectId === projectId);

  return {
    flow,
    isOpen: flow !== null,
    open,
    close,
    dismissMenu,
    confirm,
    undo,
    dismissNotice: () => actionsRef.current.clearFormatUndo(),
    hasSnapshot,
    pick: {
      menu: () => setFlow((f) => (f ? { ...f, step: 'kind' } : f)),
      kind: (kind: FormatKind) => setFlow((f) => (f ? { ...f, kind, step: 'scope' } : f)),
      scope: (scope: FormatScope) => setFlow((f) => (f ? { ...f, scope, step: 'confirm' } : f)),
      back: () =>
        setFlow((f) => {
          if (!f) return f;
          if (f.step === 'confirm') return { ...f, step: 'scope' };
          if (f.step === 'scope') return { ...f, step: 'kind' };
          return f;
        }),
    },
  };
}

export type FormatTools = ReturnType<typeof useFormatTools>;

/** 頁首與橫拿浮動入口共用的「⋯」按鈕。 */
export function FormatMoreButton(props: {
  tools: FormatTools;
  className: string;
  testId: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const pointerDownHandledRef = useRef(false);
  return (
    <button
      type="button"
      className={props.className}
      aria-label={FORMAT_MORE_ARIA}
      aria-haspopup="menu"
      aria-expanded={props.tools.isOpen}
      data-testid={props.testId}
      onPointerDown={(event) => {
        pointerDownHandledRef.current = true;
        props.onPointerDown?.(event);
      }}
      onPointerCancel={() => {
        pointerDownHandledRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          pointerDownHandledRef.current = false;
        }
      }}
      onClick={(event) => {
        const handledOnPointerDown = pointerDownHandledRef.current;
        pointerDownHandledRef.current = false;
        if (!handledOnPointerDown) {
          props.onPointerDown?.(event as unknown as ReactPointerEvent<HTMLButtonElement>);
        }
        props.tools.open(event.currentTarget);
      }}
    >
      <span aria-hidden="true" className="format-more-glyph">
        {FORMAT_MORE_GLYPH}
      </span>
    </button>
  );
}

function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'),
  );
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** 選單與三步視窗。只在非專注模式、流程開著時產生。 */
export function FormatLayer({
  tools,
  extraMenuItems = [],
}: {
  tools: FormatTools;
  extraMenuItems?: readonly FormatExtraMenuItem[];
}) {
  const { flow } = tools;
  const panelRef = useRef<HTMLDivElement>(null);
  const step = flow?.step ?? null;
  const isOpen = flow !== null;

  useEffect(() => {
    if (!step) return;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [step]);

  // Esc 只關排版視窗；專注模式時視窗本來就不存在，WO-119 的 Esc 離開專注模式不受影響。
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) tools.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!flow) return null;
  const kindLabel = flow.kind ? KIND_LABEL[flow.kind] : '';
  const scopeLabel = flow.scope ? SCOPE_LABEL[flow.scope] : '';

  if (flow.step === 'menu') {
    return (
      <div className="format-backdrop is-menu" role="presentation" onClick={tools.close} data-testid="format-backdrop">
        <div
          ref={panelRef}
          className="format-menu"
          role="menu"
          aria-label={FORMAT_MORE_ARIA}
          style={{ left: flow.menuPos.left, top: flow.menuPos.top }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={trapTab}
          data-testid="format-menu"
        >
          <button type="button" role="menuitem" className="menu-item" onClick={tools.pick.menu} data-testid="format-menu-item">
            <span>{FORMAT_MENU_ITEM}</span>
          </button>
          {extraMenuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid={`format-menu-${item.id}`}
              onClick={() => {
                tools.dismissMenu();
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.badge ? <small>{item.badge}</small> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="format-backdrop" role="presentation" onClick={tools.close} data-testid="format-backdrop">
      <div
        ref={panelRef}
        className="dialog format-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="format-dialog-title"
        data-testid={`format-step-${flow.step}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
      >
        {flow.step === 'kind' ? (
          <>
            <h2 id="format-dialog-title">{FORMAT_DIALOG_TITLE}</h2>
            <p>{FORMAT_DIALOG_HINT}</p>
            <div className="format-options" role="group" aria-label={FORMAT_KIND_GROUP_ARIA}>
              {KIND_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="button secondary format-option"
                  data-testid={`format-kind-${kind}`}
                  onClick={() => tools.pick.kind(kind)}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" className="button secondary" data-testid="format-cancel" onClick={tools.close}>
                {FORMAT_CANCEL}
              </button>
            </div>
          </>
        ) : null}
        {flow.step === 'scope' ? (
          <>
            <h2 id="format-dialog-title">{FORMAT_SCOPE_TITLE}</h2>
            <div className="format-options" role="group" aria-label={FORMAT_SCOPE_GROUP_ARIA}>
              {(['chapter', 'book'] as FormatScope[]).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className="button secondary format-option"
                  data-testid={`format-scope-${scope}`}
                  onClick={() => tools.pick.scope(scope)}
                >
                  {SCOPE_LABEL[scope]}
                </button>
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" className="button secondary" data-testid="format-back" onClick={tools.pick.back}>
                {FORMAT_BACK}
              </button>
              <button type="button" className="button secondary" data-testid="format-cancel" onClick={tools.close}>
                {FORMAT_CANCEL}
              </button>
            </div>
          </>
        ) : null}
        {flow.step === 'confirm' ? (
          <>
            <h2 id="format-dialog-title">{FORMAT_CONFIRM_TITLE}</h2>
            <p data-testid="format-confirm-sentence">{formatConfirmSentence(scopeLabel, kindLabel)}</p>
            {flow.scope === 'book' ? <p>{FORMAT_CONFIRM_BOOK_NOTE}</p> : null}
            <p>{FORMAT_UNDO_WARNING}</p>
            <div className="dialog-actions">
              <button type="button" className="button secondary" data-testid="format-back" onClick={tools.pick.back}>
                {FORMAT_BACK}
              </button>
              <button type="button" className="button secondary" data-testid="format-cancel" onClick={tools.close}>
                {FORMAT_CANCEL}
              </button>
              <button type="button" className="button primary" data-testid="format-start" onClick={tools.confirm}>
                {FORMAT_START}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 完成提示：持續顯示到關閉、復原、下一次有效排版或離開稿子；復原是真正的按鈕。 */
export function FormatNotice({ tools }: { tools: FormatTools }) {
  if (!tools.hasSnapshot) return null;
  return (
    <div className="format-notice" role="status" aria-live="polite" data-testid="format-notice">
      <div className="format-notice-row">
        <strong>{FORMAT_DONE}</strong>
        <button type="button" className="format-notice-undo" data-testid="format-undo" onClick={tools.undo}>
          {FORMAT_UNDO_BUTTON}
        </button>
        <button
          type="button"
          className="format-notice-close"
          aria-label={FORMAT_NOTICE_CLOSE_ARIA}
          data-testid="format-notice-close"
          onClick={tools.dismissNotice}
        >
          {FORMAT_NOTICE_CLOSE}
        </button>
      </div>
      <p>{FORMAT_UNDO_WARNING}</p>
    </div>
  );
}
