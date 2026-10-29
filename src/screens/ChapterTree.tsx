import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookmarkIcon, ChevronIcon, FileIcon, FolderIcon, GripIcon, MoreIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { TREE_SAVE_NAME } from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';

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
  onInlineRename,
}: {
  projectId: string;
  nodes: readonly ChapterNode[];
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
  onInlineRename: (id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        const hasChildren = Boolean(node.children?.length);
        const canToggle = node.type === 'folder' || node.type === 'file';
        const dropClass =
          drop?.id === node.id ? (drop.after ? 'drop-after' : 'drop-before') : '';
        return (
          <li key={node.id}>
            <div
              className={[
                'tree-row',
                node.id === selectedId ? 'is-selected' : '',
                node.id === draggingId ? 'is-dragging' : '',
                dropClass,
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ paddingLeft: 4 + depth * 16 }}
              data-node-id={node.id}
              onContextMenu={(event) => {
                if (!desktop) return;
                event.preventDefault();
                onPick(node.id);
                onMore(node.id);
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
                  <ChevronIcon expanded={Boolean(node.expanded)} />
                </button>
              ) : (
                <span className="tree-chevron-spacer" />
              )}
              {editingId === node.id && desktop ? (
                <InlineRename
                  title={node.title}
                  onSave={(title) => onRename(node.id, title)}
                  onCancel={onCancelRename}
                />
              ) : (
                <button
                  type="button"
                  className="tree-main"
                  onClick={() => {
                    if (organizing && !desktop) {
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
                  <span className={`tree-icon type-${node.type}`}>
                    {node.type === 'folder' ? (
                      <FolderIcon size={20} />
                    ) : node.type === 'scene' ? (
                      <BookmarkIcon size={20} />
                    ) : (
                      <FileIcon size={20} />
                    )}
                  </span>
                  <span className={node.type === 'folder' ? 'folder-name' : 'node-name'}>{node.title}</span>
                </button>
              )}
              {node.progress ? (
                <button
                  type="button"
                  className="tree-progress"
                  aria-label={`${node.title}的進度`}
                  onClick={() => onProgress(node.id)}
                >
                  <StatusBadge code={node.progress} />
                </button>
              ) : (
                <span className="tree-progress-spacer" />
              )}
              {organizing && !desktop ? null : (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${node.title}的更多操作`}
                  onClick={() => {
                    onPick(node.id);
                    onMore(node.id);
                  }}
                >
                  <MoreIcon size={18} />
                </button>
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
            </div>
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
                onInlineRename={onInlineRename}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function InlineRename({
  title,
  onSave,
  onCancel,
}: {
  title: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      className="tree-inline-rename"
      onSubmit={(event) => {
        event.preventDefault();
        const next = ref.current?.value ?? '';
        if (!next.trim()) return;
        onSave(next);
      }}
    >
      <input
        ref={ref}
        defaultValue={title}
        aria-label={TREE_SAVE_NAME}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </form>
  );
}
