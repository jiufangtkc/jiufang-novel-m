import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatInteger } from '../domain/formatNumber';
import { formatCalendarDateFromDate } from '../domain/formatCalendarDate';
import { formatClockTime } from '../domain/saveClock';
import {
  canMoveBy,
  expandToNode,
  insertBelowAnchor,
  locateNode,
  moveBy,
  moveChapterToVolume,
  moveNode,
  placeRecovered,
  removalImpact,
  renameNode,
  resolveDrop,
  discardFreshChapter,
  withoutNode,
} from '../domain/chapterOps';
import { titleForNewChapter } from '../domain/chapterTitle';
import { nodesAfterStructureUndo, type StructureChange } from '../domain/structureUndo';
import { nodesAfterDeleteUndo } from '../domain/undoDelete';
import {
  archiveDeletion,
  deletedFromNode,
  forgetDeleted,
  nodeAfterVersionRestore,
  versionFromNode,
  versionsForNode,
  withVersion,
  type ChapterVersion,
  type DeletedRecord,
} from '../domain/chapterVersions';
import { createScene } from '../domain/outline';
import { PROGRESS_ORDER, progressLabel } from '../domain/labels';
import { findNode, updateNode, type ChapterNode } from '../data/demo';
import { readLiveDraftFromEditor } from '../editor/liveDraft';
import {
  CHAPTER_NOT_FOUND,
  MANUSCRIPT_NOT_FOUND,
  TREE_ADD_CHAPTER,
  TREE_ADD_CHAPTER_BELOW,
  TREE_ADD_SCENE,
  TREE_ADD_VOLUME,
  TREE_CANCEL,
  TREE_CONFIRM_DELETE,
  TREE_DELETE_CHAPTER,
  TREE_DELETE_SCENE,
  TREE_DELETE_VOLUME,
  TREE_DESKTOP_HINT,
  TREE_DONE,
  TREE_DRAG_HINT,
  TREE_DELETE_RECOVERABLE,
  deleteConfirmShowsRecoverable,
  contentAfterVersionRestore,
  TREE_EMPTY_NAME,
  TREE_FIND_DELETED,
  TREE_FIND_VERSION,
  TREE_PUT_BACK,
  TREE_PUT_END,
  TREE_RESTORE_VERSION,
  TREE_VERSION_EMPTY,
  TREE_VERSION_PREVIEW,
  TREE_VERSION_READONLY,
  TREE_KEEP,
  TREE_KIND_CHAPTER,
  TREE_KIND_SCENE,
  TREE_KIND_VOLUME,
  TREE_MORE,
  TREE_MOVE_DOWN,
  TREE_MOVE_ROOT,
  TREE_MOVE_UP,
  TREE_MOVE_VOLUME,
  TREE_NEW_VOLUME,
  TREE_ORGANIZE,
  TREE_PROGRESS,
  TREE_RENAME,
  TREE_SAVE_NAME,
  TREE_UNDO,
  TREE_UNDO_HINT,
  treeAddedToast,
  treeDeletedToast,
  treeDeleteImpact,
  treeDeleteQuestion,
  treeMoreSummary,
  versionRowLabel,
  treeMovedToast,
  treeSelectedHint,
} from '../copy/userFacing';
import { useProject, useSample } from '../state/sampleStore';
import { ChapterTree } from './ChapterTree';
import { EditorPane } from './EditorPane';
import { focusTitleInput } from './titleCaret';
import { loadTreePlace, saveTreePlace, scrollTopForRow, type TreePlace } from './treeScroll';
import { reduceDrag, type DragState } from './dragSession';
import { useBookArchive } from './useBookArchive';

type UndoBar = { text: string; token: number; deleted?: DeletedRecord; structure?: StructureChange };
type RenameIntent = 'stay' | 'write';
type MenuKind = 'short' | 'full' | 'more' | 'progress' | 'volume';

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 600px)').matches : false,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 600px)');
    const onChange = () => setDesktop(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

export function WriteScreen() {
  const { projectId = '', chapterId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const { actions } = useSample();
  const { archive, update: updateArchive, archivePersistOk } = useBookArchive(projectId);
  const desktop = useDesktop();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<ChapterNode[]>(project?.nodes ?? []);
  const [organizing, setOrganizing] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: MenuKind } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [inlineId, setInlineId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoBar | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [nameError, setNameError] = useState(false);
  const [renameIntent, setRenameIntent] = useState<RenameIntent>('stay');
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChapterVersion | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [freshChapterId, setFreshChapterId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(chapterId ?? null);
  const pendingScroll = useRef<string | null>(null);
  const restoredKey = useRef<string | null>(null);
  const dragSession = useRef<DragState>({ dragId: null, drop: null });
  const undoAction = useRef<(() => void) | null>(null);
  nodesRef.current = project?.nodes ?? [];

  const showOrganize = organizing && !desktop;

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useLayoutEffect(() => {
    if (!project) return;
    if (chapterId) {
      restoredKey.current = null;
      return;
    }
    const token = `${project.id}:tree`;
    if (restoredKey.current === token) return;
    const place = loadTreePlace(window.sessionStorage, project.id);
    if (!place) {
      restoredKey.current = token;
      return;
    }
    const alive = findNode(project.nodes, place.nodeId) ? place.nodeId : place.prevId;
    if (!alive || !findNode(project.nodes, alive)) {
      restoredKey.current = token;
      return;
    }
    const expanded = expandToNode(project.nodes, alive);
    if (JSON.stringify(expanded) !== JSON.stringify(project.nodes)) {
      actions.setNodes(project.id, expanded);
      return;
    }
    const pane = scrollRef.current;
    const row = pane?.querySelector<HTMLElement>(`[data-node-id="${alive}"]`);
    if (pane && row) pane.scrollTop = scrollTopForRow(row.offsetTop, place.offset);
    setHighlightId(alive);
    restoredKey.current = token;
  }, [chapterId, project, actions]);

  useLayoutEffect(() => {
    const id = pendingScroll.current;
    if (!id || !scrollRef.current) return;
    const row = scrollRef.current.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    pendingScroll.current = null;
  });

  useEffect(() => {
    if (!draggingId || !project) return;
    dragSession.current = reduceDrag({ dragId: null, drop: null }, { type: 'start', id: draggingId }).state;
    const move = (event: PointerEvent) => {
      const pane = scrollRef.current;
      if (!pane) return;
      const rect = pane.getBoundingClientRect();
      if (event.clientY < rect.top + 56) pane.scrollTop -= 16;
      if (event.clientY > rect.bottom - 56) pane.scrollTop += 16;
      const rows = [...pane.querySelectorAll<HTMLElement>('[data-node-id]')];
      const hit = rows.find((row) => {
        const box = row.getBoundingClientRect();
        return event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (!hit?.dataset.nodeId) return;
      const box = hit.getBoundingClientRect();
      const step = reduceDrag(dragSession.current, {
        type: 'hover',
        drop: { id: hit.dataset.nodeId, after: event.clientY > box.top + box.height / 2 },
      });
      dragSession.current = step.state;
      setDrop(step.state.drop);
    };
    const finish = (type: 'pointerup' | 'pointercancel' | 'lostpointercapture') => {
      const step = reduceDrag(dragSession.current, { type });
      dragSession.current = step.state;
      setDraggingId(step.state.dragId);
      setDrop(step.state.drop);
      if (!step.move) return;
      const nodes = nodesRef.current;
      const target = resolveDrop(nodes, step.move.dragId, step.move.drop.id, step.move.drop.after);
      if (!target) return;
      const next = moveNode(nodes, step.move.dragId, target.parentId, target.index);
      if (!next || JSON.stringify(next) === JSON.stringify(nodes)) return;
      const title = findNode(nodes, step.move.dragId)?.title ?? '';
      const location = locateNode(nodes, step.move.dragId);
      setUndo({
        text: treeMovedToast(title),
        token: Date.now(),
        structure: location
          ? { kind: 'move', id: step.move.dragId, parentId: location.parentId, index: location.index }
          : undefined,
      });
      actions.setNodes(project.id, next);
      pendingScroll.current = step.move.dragId;
    };
    const onUp = () => finish('pointerup');
    const onCancel = () => finish('pointercancel');
    const onLost = () => finish('lostpointercapture');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onLost, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onLost, true);
    };
  }, [draggingId, actions, project]);

  useEffect(() => {
    if (!desktop || !project) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const id = pickedId ?? highlightId;
      if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && undoAction.current) {
        event.preventDefault();
        undoAction.current();
        return;
      }
      if (!id) return;
      if (event.key === 'F2') {
        event.preventDefault();
        setInlineId(id);
      } else if (event.key === 'Delete') {
        event.preventDefault();
        requestDelete(id);
      } else if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        shift(id, -1);
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        shift(id, 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!project) return <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>;
  const book = project;

  const picked = pickedId ? findNode(book.nodes, pickedId) : null;
  const menuNode = menu ? findNode(book.nodes, menu.id) : null;
  const confirmNode = confirmId ? findNode(book.nodes, confirmId) : null;
  const renameNodeNow = renameId ? findNode(book.nodes, renameId) : null;
  const chapter = chapterId ? findNode(book.nodes, chapterId) : null;
  const volumes = book.nodes.filter((node) => node.type === 'folder');

  function remember(id: string) {
    const pane = scrollRef.current;
    const row = pane?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    const offset = row && pane ? row.getBoundingClientRect().top - pane.getBoundingClientRect().top : 0;
    const location = locateNode(book.nodes, id);
    let prevId: string | null = null;
    if (location) {
      const list = location.parentId
        ? (findNode(book.nodes, location.parentId)?.children ?? [])
        : book.nodes;
      prevId = list[location.index - 1]?.id ?? null;
    }
    const place: TreePlace = { nodeId: id, prevId, offset };
    saveTreePlace(window.sessionStorage, book.id, place);
    setHighlightId(id);
  }

  function commit(
    next: ChapterNode[] | null,
    bar: string | null,
    extra?: { deleted?: DeletedRecord | null; structure?: StructureChange },
  ) {
    if (!next) return;
    if (bar) {
      setUndo({
        text: bar,
        token: Date.now(),
        deleted: extra?.deleted ?? undefined,
        structure: extra?.structure,
      });
    } else setUndo(null);
    actions.setNodes(book.id, next);
  }

  function undoNow() {
    if (!undo) return;
    const current = liveNodes();
    if (undo.deleted) {
      const deleted = undo.deleted;
      const next = nodesAfterDeleteUndo(current, { snapshot: [], deleted });
      actions.setNodes(book.id, expandToNode(next, deleted.node.id));
      updateArchive((archiveNow) => ({ ...archiveNow, deleted: forgetDeleted(archiveNow.deleted, deleted.id) }));
      pendingScroll.current = deleted.node.id;
    } else if (undo.structure) {
      actions.setNodes(book.id, nodesAfterStructureUndo(current, undo.structure));
      if (undo.structure.kind === 'move' || undo.structure.kind === 'rename' || undo.structure.kind === 'progress') {
        pendingScroll.current = undo.structure.id;
      }
    }
    setUndo(null);
  }
  undoAction.current = undo ? undoNow : null;

  function liveNodes(): ChapterNode[] {
    const live = readLiveDraftFromEditor();
    if (!live || live.projectId !== book.id || !findNode(book.nodes, live.chapterId)) return book.nodes;
    return updateNode(book.nodes, live.chapterId, (item) => ({ ...item, content: live.text }));
  }

  function removeNode(id: string) {
    const node = findNode(book.nodes, id);
    const next = withoutNode(book.nodes, id);
    if (!node || !next) return;
    const stamped = liveNodes();
    const when = Date.now();
    const record = deletedFromNode(stamped, id, when, `del-${when}-${id}`);
    if (record) void updateArchive((current) => archiveDeletion(current, record, versionsForNode(record.node, when)), 'delete');
    commit(next, treeDeletedToast(node.title), { deleted: record });
    if (pickedId === id) setPickedId(null);
    setConfirmId(null);
    setMenu(null);
  }

  function finishRename(id: string, title: string, intent: RenameIntent) {
    const next = renameNode(book.nodes, id, title);
    if (!next) {
      setNameError(true);
      return;
    }
    commit(next, null);
    setRenameId(null);
    setInlineId(null);
    setNameError(false);
    setRenameIntent('stay');
    if (id === freshChapterId) setFreshChapterId(null);
    if (intent === 'write') navigate(`/p/${book.id}/write/${id}`, { state: { focusWriting: true } });
  }

  function cancelFresh(id: string | null) {
    if (id && id === freshChapterId) {
      const node = findNode(book.nodes, id);
      const next = discardFreshChapter(book.nodes, {
        id,
        freshId: freshChapterId,
        content: node?.content ?? '',
        childCount: node?.children?.length ?? 0,
      });
      if (next) {
        actions.setNodes(book.id, next);
        setUndo(null);
      }
    }
    setFreshChapterId(null);
    setRenameId(null);
    setInlineId(null);
    setNameError(false);
    setRenameIntent('stay');
  }

  function whenLabel(savedAt: number): string {
    const date = new Date(savedAt);
    return `${formatCalendarDateFromDate(date)} ${formatClockTime(date)}`;
  }

  function recover(record: DeletedRecord, atEnd: boolean) {
    const placed = placeRecovered(book.nodes, record, atEnd);
    actions.setNodes(book.id, expandToNode(placed, record.node.id));
    updateArchive((current) => ({ ...current, deleted: forgetDeleted(current.deleted, record.id) }));
    setDeletedOpen(false);
    setUndo(null);
    pendingScroll.current = record.node.id;
  }

  async function restoreVersion(version: ChapterVersion) {
    const node = findNode(book.nodes, version.nodeId);
    if (!node || node.type === 'folder') return;
    const live = readLiveDraftFromEditor();
    const content = live && live.projectId === book.id && live.chapterId === node.id ? live.text : (node.content ?? '');
    const savedAt = Date.now();
    let kept = true;
    try {
      await updateArchive(
        (current) =>
          withVersion(
            current,
            versionFromNode({ id: node.id, title: node.title, content }, savedAt, `v-${savedAt}-${node.id}`),
          ),
        'restore',
      );
    } catch {
      kept = false;
    }
    const nextContent = contentAfterVersionRestore(kept, content, version.content);
    if (nextContent === content && !kept) return;
    actions.setNodes(
      book.id,
      updateNode(book.nodes, node.id, (item) => nodeAfterVersionRestore(item, { content: nextContent })),
    );
    if (chapterId === node.id) setEditorEpoch((value) => value + 1);
    setPreview(null);
    setVersionFor(null);
  }

  function shift(id: string, delta: -1 | 1) {
    const location = locateNode(book.nodes, id);
    const next = moveBy(book.nodes, id, delta);
    const title = findNode(book.nodes, id)?.title ?? '';
    if (next && location) {
      commit(next, treeMovedToast(title), {
        structure: { kind: 'move', id, parentId: location.parentId, index: location.index },
      });
      pendingScroll.current = id;
    }
  }

  function requestDelete(id: string) {
    const node = findNode(book.nodes, id);
    if (!node) return;
    if (removalImpact(node).needsConfirm) {
      setConfirmId(id);
      setMenu(null);
      return;
    }
    removeNode(id);
  }

  function addChapter(anchorId: string | null) {
    const id = `ch-${Date.now()}`;
    const title = titleForNewChapter(book.nodes, anchorId);
    const node: ChapterNode = {
      id,
      type: 'file',
      title,
      progress: 'Draft',
      content: '',
      expanded: true,
    };
    const next = insertBelowAnchor(book.nodes, anchorId, node);
    commit(next, treeAddedToast(title), { structure: { kind: 'add', id } });
    pendingScroll.current = id;
    setPickedId(id);
    setFreshChapterId(id);
    setRenameIntent('write');
    if (desktop) setInlineId(id);
    else setRenameId(id);
    setMenu(null);
  }

  function addVolume(anchorId: string | null) {
    const id = `vol-${Date.now()}`;
    const node: ChapterNode = { id, type: 'folder', title: TREE_NEW_VOLUME, expanded: true, children: [] };
    const anchor = anchorId ? locateNode(book.nodes, anchorId) : null;
    let rootIndex = book.nodes.length;
    if (anchor) {
      let cursor = anchorId;
      let location = locateNode(book.nodes, cursor ?? '');
      while (location?.parentId) {
        cursor = location.parentId;
        location = locateNode(book.nodes, cursor);
      }
      if (location) rootIndex = location.index + 1;
    }
    const next = book.nodes.slice();
    next.splice(rootIndex, 0, node);
    commit(next, treeAddedToast(TREE_NEW_VOLUME), { structure: { kind: 'add', id } });
    pendingScroll.current = id;
    setRenameId(id);
    setMenu(null);
  }

  function addScene(chapterNodeId: string) {
    const chapterNode = findNode(book.nodes, chapterNodeId);
    if (!chapterNode || chapterNode.type !== 'file') return;
    const scene = createScene(chapterNode, `sc-${Date.now()}`);
    const parent = locateNode(book.nodes, chapterNodeId);
    if (!parent) return;
    const walk = (list: readonly ChapterNode[]): ChapterNode[] =>
      list.map((node) => {
        if (node.id !== chapterNodeId) {
          return node.children ? { ...node, children: walk(node.children) } : node;
        }
        return { ...node, expanded: true, children: [...(node.children ?? []), scene] };
      });
    commit(walk(book.nodes), treeAddedToast(scene.title), { structure: { kind: 'add', id: scene.id } });
    setMenu(null);
  }

  const deleteLabel = (node: ChapterNode) =>
    node.type === 'folder' ? TREE_DELETE_VOLUME : node.type === 'scene' ? TREE_DELETE_SCENE : TREE_DELETE_CHAPTER;

  const impact = confirmNode ? removalImpact(confirmNode) : null;

  return (
    <div className={chapterId ? 'write-layout has-chapter' : 'write-layout'} data-testid="write-screen">
      <section className={showOrganize ? 'tree-pane is-organizing' : 'tree-pane'} data-testid="chapter-tree">
        <header className="topbar">
          <h1>{showOrganize ? TREE_ORGANIZE : book.title}</h1>
          {showOrganize ? (
            <button type="button" className="button primary" data-testid="organize-done" onClick={() => setOrganizing(false)}>
              {TREE_DONE}
            </button>
          ) : null}
        </header>
        <div className="scroll-pane" ref={scrollRef}>
          <ChapterTree
            projectId={book.id}
            nodes={book.nodes}
            depth={0}
            selectedId={(showOrganize ? pickedId : chapterId ?? highlightId) ?? undefined}
            organizing={showOrganize}
            desktop={desktop}
            draggingId={draggingId}
            drop={drop}
            editingId={inlineId}
            onToggle={(id) => actions.toggleNode(book.id, id)}
            onMore={(id) => setMenu({ id, kind: desktop ? 'full' : 'short' })}
            onOpenChapter={remember}
            onPick={setPickedId}
            onProgress={(id) => setMenu({ id, kind: 'progress' })}
            onDragStart={(id) => {
              if (!desktop && !showOrganize) return;
              setDraggingId(id);
              setPickedId(id);
            }}
            onRename={(id, title) => finishRename(id, title, renameIntent)}
            onCancelRename={() => cancelFresh(inlineId)}
            onInlineRename={(id) => {
              setPickedId(id);
              setInlineId(id);
            }}
          />
          {archive.deleted.length > 0 ? (
            <button type="button" className="recover-deleted" data-testid="find-deleted" onClick={() => setDeletedOpen(true)}>
              {TREE_FIND_DELETED}
            </button>
          ) : null}
        </div>
        {undo ? (
          <div className="undo-bar" data-testid="tree-undo" key={undo.token}>
            <span>{undo.text}</span>
            <button
              type="button"
              onClick={undoNow}
            >
              {TREE_UNDO}
            </button>
            <span className="undo-meter" />
          </div>
        ) : null}
        {showOrganize ? (
          <div className="organize-dock">
            <p className="hint">{picked ? treeSelectedHint(picked.title) : TREE_DRAG_HINT}</p>
            <div className="organize-actions">
              <button type="button" disabled={!picked || !canMoveBy(book.nodes, picked.id, -1)} onClick={() => picked && shift(picked.id, -1)}>
                {TREE_MOVE_UP}
              </button>
              <button type="button" disabled={!picked || !canMoveBy(book.nodes, picked.id, 1)} onClick={() => picked && shift(picked.id, 1)}>
                {TREE_MOVE_DOWN}
              </button>
              <button type="button" disabled={!picked} onClick={() => {
                if (!picked) return;
                setRenameIntent('stay');
                setRenameId(picked.id);
              }}>
                {TREE_RENAME}
              </button>
              <button type="button" disabled={!picked} onClick={() => picked && setMenu({ id: picked.id, kind: 'more' })}>
                {TREE_MORE}
              </button>
            </div>
          </div>
        ) : !desktop ? (
          <div className="tree-tools" data-testid="tree-tools">
            <button type="button" className="button secondary" data-testid="organize-toggle" onClick={() => setOrganizing(true)}>
              {TREE_ORGANIZE}
            </button>
            <button
              type="button"
              className="button primary"
              data-testid="add-chapter"
              onClick={() => addChapter(highlightId ?? loadTreePlace(window.sessionStorage, book.id)?.nodeId ?? null)}
            >
              {TREE_ADD_CHAPTER}
            </button>
          </div>
        ) : null}
        {desktop ? <p className="hint tree-desktop-hint">{TREE_DESKTOP_HINT}</p> : null}
      </section>
      <section className="editor-pane">
        {chapter ? (
          <EditorPane key={`${chapter.id}:${editorEpoch}`} projectId={book.id} chapter={chapter} />
        ) : chapterId ? (
          <div className="editor-empty">
            <p>{CHAPTER_NOT_FOUND}</p>
          </div>
        ) : (
          <div className="editor-empty wide-hint">
            <p>點左邊的章或幕開始寫作。</p>
          </div>
        )}
      </section>

      {menuNode && menu?.kind === 'progress' ? (
        <Sheet title={TREE_PROGRESS} testId="progress-menu" onClose={() => setMenu(null)}>
          <div className="menu-list">
            {PROGRESS_ORDER.map((code) => (
              <button
                key={code}
                type="button"
                className={menuNode.progress === code ? 'menu-item is-current' : 'menu-item'}
                onClick={() => {
                  actions.setProgress(book.id, menuNode.id, code);
                  setMenu(null);
                }}
              >
                {progressLabel(code)}
                {menuNode.progress === code ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}

      {menuNode && (menu?.kind === 'short' || menu?.kind === 'full' || menu?.kind === 'more') ? (
        <Sheet title={menuNode.title} testId="node-menu" onClose={() => setMenu(null)}>
          {menu.kind === 'more' ? (
            <p className="hint">
              {treeMoreSummary(
                menuNode.type === 'folder' ? TREE_KIND_VOLUME : menuNode.type === 'scene' ? TREE_KIND_SCENE : TREE_KIND_CHAPTER,
                removalImpact(menuNode).chapters,
                removalImpact(menuNode).scenes,
                formatInteger(removalImpact(menuNode).words),
              )}
            </p>
          ) : null}
          <button type="button" className="menu-item" onClick={() => {
            setMenu(null);
            setRenameIntent('stay');
            if (desktop) setInlineId(menuNode.id);
            else setRenameId(menuNode.id);
          }}>
            {TREE_RENAME}
            {desktop ? <small>F2</small> : null}
          </button>
          {menu.kind !== 'short' ? (
            <button type="button" className="menu-item" onClick={() => addChapter(menuNode.id)}>
              {TREE_ADD_CHAPTER_BELOW}
            </button>
          ) : null}
          {menu.kind !== 'short' ? (
            <button type="button" className="menu-item" onClick={() => addVolume(menuNode.id)}>
              {TREE_ADD_VOLUME}
            </button>
          ) : null}
          {menuNode.type === 'file' ? (
            <button type="button" className="menu-item" onClick={() => addScene(menuNode.id)}>
              {TREE_ADD_SCENE}
            </button>
          ) : null}
          {menu.kind !== 'short' ? (
            <>
              <button type="button" className="menu-item" disabled={!canMoveBy(book.nodes, menuNode.id, -1)} onClick={() => { shift(menuNode.id, -1); setMenu(null); }}>
                {TREE_MOVE_UP}
                {desktop ? <small>Alt+↑</small> : null}
              </button>
              <button type="button" className="menu-item" disabled={!canMoveBy(book.nodes, menuNode.id, 1)} onClick={() => { shift(menuNode.id, 1); setMenu(null); }}>
                {TREE_MOVE_DOWN}
                {desktop ? <small>Alt+↓</small> : null}
              </button>
              {menuNode.type === 'file' ? (
                <button type="button" className="menu-item" onClick={() => setMenu({ id: menuNode.id, kind: 'volume' })}>
                  {TREE_MOVE_VOLUME}
                </button>
              ) : null}
            </>
          ) : null}
          {menuNode.type !== 'folder' ? (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setVersionFor(menuNode.id);
                setMenu(null);
              }}
            >
              {TREE_FIND_VERSION}
            </button>
          ) : null}
          <div className="menu-sep" />
          <button type="button" className="menu-item danger" onClick={() => requestDelete(menuNode.id)}>
            {deleteLabel(menuNode)}
            {desktop ? <small>Del</small> : null}
          </button>
        </Sheet>
      ) : null}

      {menu?.kind === 'volume' && menuNode?.type === 'file' ? (
        <Sheet title={TREE_MOVE_VOLUME} testId="volume-menu" onClose={() => setMenu(null)}>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              const location = locateNode(book.nodes, menuNode.id);
              const next = moveChapterToVolume(book.nodes, menuNode.id, null);
              commit(
                next,
                treeMovedToast(menuNode.title),
                location
                  ? { structure: { kind: 'move', id: menuNode.id, parentId: location.parentId, index: location.index } }
                  : undefined,
              );
              setMenu(null);
            }}
          >
            {TREE_MOVE_ROOT}
          </button>
          {volumes.map((volume) => (
            <button
              key={volume.id}
              type="button"
              className="menu-item"
              onClick={() => {
                const location = locateNode(book.nodes, menuNode.id);
                const next = moveChapterToVolume(book.nodes, menuNode.id, volume.id);
                commit(
                  next,
                  treeMovedToast(menuNode.title),
                  location
                    ? { structure: { kind: 'move', id: menuNode.id, parentId: location.parentId, index: location.index } }
                    : undefined,
                );
                setMenu(null);
              }}
            >
              {volume.title}
            </button>
          ))}
        </Sheet>
      ) : null}

      {renameNodeNow ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => cancelFresh(renameId)}>
          <form
            className="dialog"
            role="dialog"
            data-testid="rename-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('title');
              const value = input instanceof HTMLInputElement ? input.value : '';
              finishRename(renameNodeNow.id, value, renameIntent);
            }}
          >
            <h2>{TREE_RENAME}</h2>
            <input
              name="title"
              data-testid="rename-title"
              defaultValue={renameNodeNow.title}
              autoFocus
              onFocus={(event) => focusTitleInput(event.currentTarget)}
            />
            {nameError ? <p className="hint">{TREE_EMPTY_NAME}</p> : null}
            <div className="dialog-actions rename-actions">
              <button type="button" className="button secondary" onClick={() => cancelFresh(renameNodeNow.id)}>
                {TREE_CANCEL}
              </button>
              <button type="submit" className="button primary">
                {TREE_SAVE_NAME}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmNode && impact ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => setConfirmId(null)}>
          <div className="dialog" role="dialog" data-testid="delete-confirm" onClick={(event) => event.stopPropagation()}>
            <h2>{treeDeleteQuestion(confirmNode.title)}</h2>
            <p>{treeDeleteImpact(impact.chapters, impact.scenes, formatInteger(impact.words))}</p>
            <p className="hint">{TREE_UNDO_HINT}</p>
            {deleteConfirmShowsRecoverable(archivePersistOk) ? (
              <p className="hint">{TREE_DELETE_RECOVERABLE}</p>
            ) : null}
            <div className="dialog-actions delete-actions">
              <button
                type="button"
                className="button danger"
                onClick={() => removeNode(confirmNode.id)}
              >
                {TREE_CONFIRM_DELETE}
              </button>
              <button type="button" className="button secondary keep" onClick={() => setConfirmId(null)}>
                {TREE_KEEP}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {versionFor ? (
        <Sheet title={TREE_FIND_VERSION} testId="version-sheet" onClose={() => { setVersionFor(null); setPreview(null); }}>
          {(archive.versions[versionFor] ?? []).length === 0 ? (
            <p className="hint">{TREE_VERSION_EMPTY}</p>
          ) : (
            <div className="version-list">
              {(archive.versions[versionFor] ?? []).map((version) => (
                <div key={version.id} className="version-row">
                  <span>{versionRowLabel(whenLabel(version.savedAt), formatInteger(version.wordCount))}</span>
                  <button type="button" onClick={() => setPreview(version)}>
                    {TREE_VERSION_PREVIEW}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      ) : null}

      {preview ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => setPreview(null)}>
          <div className="dialog" role="dialog" data-testid="version-preview" onClick={(event) => event.stopPropagation()}>
            <h2>{preview.title}</h2>
            <p className="hint">{TREE_VERSION_READONLY}</p>
            <textarea className="version-preview" readOnly value={preview.content} aria-label={TREE_VERSION_PREVIEW} />
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setPreview(null)}>
                {TREE_CANCEL}
              </button>
              <button type="button" className="button primary" onClick={() => restoreVersion(preview)}>
                {TREE_RESTORE_VERSION}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deletedOpen ? (
        <Sheet title={TREE_FIND_DELETED} testId="deleted-sheet" onClose={() => setDeletedOpen(false)}>
          <div className="version-list">
            {archive.deleted.map((record) => (
              <div key={record.id} className="deleted-row">
                <strong>{record.title}</strong>
                <p className="hint">{versionRowLabel(whenLabel(record.deletedAt), formatInteger(removalImpact(record.node).words))}</p>
                <div className="dialog-actions">
                  <button type="button" className="button secondary" onClick={() => recover(record, false)}>
                    {TREE_PUT_BACK}
                  </button>
                  <button type="button" className="button secondary" onClick={() => recover(record, true)}>
                    {TREE_PUT_END}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function Sheet({
  title,
  testId,
  onClose,
  children,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" data-testid={testId} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
