import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ChevronIcon, FolderIcon, GripIcon, MoreIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { TREE_SAVE_NAME } from '../copy/userFacing';
import { commitInlineChapterTitle, type TitleEditVia } from '../domain/bookTitle';
import { progressLabel } from '../domain/labels';
import { decideEnterKey } from '../editor/enterGuard';
import { useLayout } from '../layout';
import { focusTitleInput } from './titleCaret';
import type { ChapterNode } from '../data/demo';

const TIP_DELAY_MS = 500;
const LONG_PRESS_MS = 500;

type TreeHandlers = {
  projectId: string;
  depth: number;
  selectedId?: string;
  organizing: boolean;
  desktop: boolean;
  draggingId: string | null;
  drop: { id: string; after: boolean } | null;
  editingId: string | null;
  onToggle: (id: string) => void;
  onMore: (id: string) => void;
  onOpenChapter?: (id: string) => void;
  onPick: (id: string) => void;
  onProgress: (id: string) => void;
  onDragStart: (id: string, pointerId: number) => void;
  onRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onDismissInline: () => void;
  onInlineRename: (id: string) => void;
};

export function ChapterTree({
  projectId,
  nodes,
  depth,
  selectedId,
  organizing,
  desktop,
  draggingId,
  drop,
  editingId,
  onToggle,
  onMore,
  onOpenChapter,
  onPick,
  onProgress,
  onDragStart,
  onRename,
  onCancelRename,
  onDismissInline,
  onInlineRename,
}: TreeHandlers & { nodes: readonly ChapterNode[] }) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        const hasChildren = Boolean(node.children?.length);
        return (
          <li key={node.id}>
            <TreeRow
              node={node}
              projectId={projectId}
              depth={depth}
              selectedId={selectedId}
              organizing={organizing}
              desktop={desktop}
              draggingId={draggingId}
              drop={drop}
              editingId={editingId}
              onToggle={onToggle}
              onMore={onMore}
              onOpenChapter={onOpenChapter}
              onPick={onPick}
              onProgress={onProgress}
              onDragStart={onDragStart}
              onRename={onRename}
              onCancelRename={onCancelRename}
              onDismissInline={onDismissInline}
              onInlineRename={onInlineRename}
            />
            {hasChildren && node.expanded !== false && (
              <ChapterTree
                projectId={projectId}
                nodes={node.children ?? []}
                depth={depth + 1}
                selectedId={selectedId}
                organizing={organizing}
                desktop={desktop}
                draggingId={draggingId}
                drop={drop}
                editingId={editingId}
                onToggle={onToggle}
                onMore={onMore}
                onOpenChapter={onOpenChapter}
                onPick={onPick}
                onProgress={onProgress}
                onDragStart={onDragStart}
                onRename={onRename}
                onCancelRename={onCancelRename}
                onDismissInline={onDismissInline}
                onInlineRename={onInlineRename}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TreeRow({
  node,
  projectId,
  depth,
  selectedId,
  organizing,
  desktop,
  draggingId,
  drop,
  editingId,
  onToggle,
  onMore,
  onOpenChapter,
  onPick,
  onProgress,
  onDragStart,
  onRename,
  onCancelRename,
  onDismissInline,
  onInlineRename,
}: TreeHandlers & { node: ChapterNode }) {
  const navigate = useNavigate();
  const { pointer } = useLayout();
  const rowRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const tipTimer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number; flip: boolean } | null>(null);
  const canToggle = node.type === 'folder' || node.type === 'file';
  const dropClass = drop?.id === node.id ? (drop.after ? 'drop-after' : 'drop-before') : '';
  const selected = node.id === selectedId;
  const compact = pointer === 'mouse';

  function clearTipTimer() {
    if (tipTimer.current != null) window.clearTimeout(tipTimer.current);
    tipTimer.current = null;
  }

  function hideTip() {
    clearTipTimer();
    setTip(null);
  }

  function nameTruncated() {
    const name = nameRef.current;
    return Boolean(name && name.scrollWidth > name.clientWidth + 1);
  }

  function showTip() {
    const row = rowRef.current;
    if (!compact || node.type === 'folder' || !row || !nameTruncated()) return;
    const rect = row.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 16));
    const below = rect.bottom + 4;
    const flip = below + 72 > window.innerHeight && rect.top > 72;
    setTip({ text: node.title, top: flip ? rect.top - 4 : below, left, flip });
  }

  function scheduleTip(delay: number) {
    clearTipTimer();
    if (!compact || node.type === 'folder') return;
    tipTimer.current = window.setTimeout(showTip, delay);
  }

  function clearPress() {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  }

  function openMenu() {
    onPick(node.id);
    onMore(node.id);
  }

  useEffect(() => () => {
    clearTipTimer();
    clearPress();
  }, []);

  useEffect(() => {
    if (!tip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideTip();
    };
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hideTip, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [tip]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (organizing || event.pointerType !== 'touch' || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.tree-chevron, .tree-progress, .tree-handle, .icon-button, input')) {
      return;
    }
    pressStart.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      openMenu();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pressStart.current) return;
    const dx = event.clientX - pressStart.current.x;
    const dy = event.clientY - pressStart.current.y;
    if (dx * dx + dy * dy > 64) clearPress();
  }

  return (
    <div
      ref={rowRef}
      className={[
        'tree-row',
        selected ? 'is-selected' : '',
        node.id === draggingId ? 'is-dragging' : '',
        dropClass,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--tree-depth': depth } as CSSProperties}
      data-node-id={node.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        clearPress();
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
      onPointerCancel={clearPress}
      onMouseEnter={() => scheduleTip(TIP_DELAY_MS)}
      onMouseLeave={hideTip}
      onFocus={(event) => {
        const target = event.target;
        if (target instanceof Element && target.matches(':focus-visible')) scheduleTip(0);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        hideTip();
      }}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest('input, textarea')) return;
        event.preventDefault();
        openMenu();
      }}
    >
      {canToggle ? (
        <button
          type="button"
          className="tree-chevron"
          aria-expanded={Boolean(node.expanded)}
          aria-label={node.expanded ? `收合${node.title}` : `展開${node.title}`}
          onClick={() => onToggle(node.id)}
        >
          <ChevronIcon expanded={Boolean(node.expanded)} size={compact ? 16 : 18} />
        </button>
      ) : (
        <span className="tree-chevron-spacer" />
      )}
      {editingId === node.id && desktop ? (
        <InlineRename
          title={node.title}
          onSave={(title) => onRename(node.id, title)}
          onCancel={onCancelRename}
          onDismiss={onDismissInline}
        />
      ) : (
        <button
          type="button"
          className="tree-main"
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (organizing) {
              onPick(node.id);
              return;
            }
            if (node.type === 'folder') onToggle(node.id);
            else {
              onOpenChapter?.(node.id);
              navigate(`/p/${projectId}/write/${node.id}`);
            }
          }}
          onDoubleClick={() => {
            if (desktop) onInlineRename(node.id);
          }}
        >
          {node.type === 'folder' ? (
            <span className="tree-icon type-folder">
              <FolderIcon size={compact ? 16 : 20} />
            </span>
          ) : null}
          <span ref={nameRef} className={node.type === 'folder' ? 'folder-name' : 'node-name'}>
            {node.title}
          </span>
        </button>
      )}
      {node.progress ? (
        <button
          type="button"
          className="tree-progress"
          aria-label={`${node.title}的進度，${progressLabel(node.progress)}`}
          onClick={() => onProgress(node.id)}
        >
          <StatusBadge code={node.progress} />
        </button>
      ) : (
        <span className="tree-progress-spacer" />
      )}
      <button
        type="button"
        className={organizing || desktop ? 'tree-handle' : 'tree-handle is-hidden'}
        aria-label={`${node.title}的拖曳把手`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onDragStart(node.id, event.pointerId);
        }}
      >
        <GripIcon size={18} />
      </button>
      {organizing ? null : (
        <button
          type="button"
          className="icon-button"
          aria-label={`${node.title}的更多操作`}
          tabIndex={!compact && !selected ? -1 : undefined}
          onClick={() => openMenu()}
        >
          <MoreIcon size={compact ? 16 : 18} />
        </button>
      )}
      {tip && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="tree-title-tip"
              role="tooltip"
              aria-hidden="true"
              data-testid="tree-title-tip"
              style={{
                top: tip.top,
                left: tip.left,
                transform: tip.flip ? 'translateY(-100%)' : undefined,
              }}
            >
              {tip.text}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function InlineRename({
  title,
  onSave,
  onCancel,
  onDismiss,
}: {
  title: string;
  onSave: (title: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef(onSave);
  const cancelRef = useRef(onCancel);
  const dismissRef = useRef(onDismiss);
  const composing = useRef(false);
  const lastEnd = useRef<number | null>(null);
  saveRef.current = onSave;
  cancelRef.current = onCancel;
  dismissRef.current = onDismiss;

  function commit(via: TitleEditVia) {
    const raw = ref.current?.value ?? '';
    const decision = commitInlineChapterTitle(via, raw);
    if (decision === 'blank') return;
    if (decision === 'apply') {
      saveRef.current(raw);
      return;
    }
    if (via === 'outside') dismissRef.current();
    else cancelRef.current();
  }

  useEffect(() => {
    if (ref.current) focusTitleInput(ref.current);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const form = formRef.current;
      if (!form || (event.target instanceof Node && form.contains(event.target))) return;
      commit('outside');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  return (
    <form
      ref={formRef}
      className="tree-inline-rename"
      onSubmit={(event) => {
        event.preventDefault();
        if (composing.current) return;
        commit('confirm');
      }}
    >
      <input
        ref={ref}
        defaultValue={title}
        aria-label={TREE_SAVE_NAME}
        enterKeyHint="done"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          lastEnd.current = event.timeStamp;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            commit('cancel');
            return;
          }
          const decision = decideEnterKey({
            key: event.key,
            isComposing: event.nativeEvent.isComposing,
            keyCode: event.keyCode,
            timeStamp: event.timeStamp,
            lastCompositionEndTimeStamp: lastEnd.current,
            composingFlag: composing.current,
          });
          if (event.key === 'Enter' && decision.suppressActions && !event.nativeEvent.isComposing && !composing.current) {
            event.preventDefault();
          }
        }}
      />
    </form>
  );
}
