import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { formatInteger } from '../domain/formatNumber';
import {
  canMoveBy,
  expandToNode,
  insertBelowAnchor,
  locateNode,
  moveBy,
  moveChapterToVolume,
  moveNode,
  removalImpact,
  renameNode,
  resolveDrop,
  withoutNode,
} from '../domain/chapterOps';
import { createScene } from '../domain/outline';
import { PROGRESS_ORDER, progressLabel } from '../domain/labels';
import { findNode, type ChapterNode } from '../data/demo';
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
  TREE_EMPTY_NAME,
  TREE_KEEP,
  TREE_KIND_CHAPTER,
  TREE_KIND_SCENE,
  TREE_KIND_VOLUME,
  TREE_MORE,
  TREE_MOVE_DOWN,
  TREE_MOVE_ROOT,
  TREE_MOVE_UP,
  TREE_MOVE_VOLUME,
  TREE_NEW_CHAPTER,
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
  treeMovedToast,
  treeSelectedHint,
} from '../copy/userFacing';
import { useProject, useSample } from '../state/sampleStore';
import { ChapterTree } from './ChapterTree';
import { EditorPane } from './EditorPane';
import { loadTreePlace, saveTreePlace, scrollTopForRow, type TreePlace } from './treeScroll';

type UndoBar = { nodes: ChapterNode[]; text: string; token: number };
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
  const project = useProject(projectId);
  const { actions } = useSample();
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
  const [highlightId, setHighlightId] = useState<string | null>(chapterId ?? null);
  const pendingScroll = useRef<string | null>(null);
  const restoredKey = useRef<string | null>(null);
  const dropRef = useRef(drop);
  dropRef.current = drop;
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
    if (!draggingId) return;
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
      setDrop({ id: hit.dataset.nodeId, after: event.clientY > box.top + box.height / 2 });
    };
    const up = () => {
      const current = dropRef.current;
      const nodes = nodesRef.current;
      const dragId = draggingId;
      setDraggingId(null);
      setDrop(null);
      if (!current || !project) return;
      const target = resolveDrop(nodes, dragId, current.id, current.after);
      if (!target) return;
      const next = moveNode(nodes, dragId, target.parentId, target.index);
      if (!next || JSON.stringify(next) === JSON.stringify(nodes)) return;
      const title = findNode(nodes, dragId)?.title ?? '';
      setUndo({ nodes, text: treeMovedToast(title), token: Date.now() });
      actions.setNodes(project.id, next);
      pendingScroll.current = dragId;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [draggingId, actions, project]);

  useEffect(() => {
    if (!desktop || !project) return;
    const current = project;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const id = pickedId ?? highlightId;
      if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && undo) {
        event.preventDefault();
        actions.setNodes(current.id, undo.nodes);
        setUndo(null);
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

  function commit(next: ChapterNode[] | null, bar: string | null) {
    if (!next) return;
    if (bar) setUndo({ nodes: book.nodes, text: bar, token: Date.now() });
    else setUndo(null);
    actions.setNodes(book.id, next);
  }

  function shift(id: string, delta: -1 | 1) {
    const next = moveBy(book.nodes, id, delta);
    const title = findNode(book.nodes, id)?.title ?? '';
    if (next) {
      commit(next, treeMovedToast(title));
      pendingScroll.current = id;
    }
  }

  function requestDelete(id: string) {
    const node = findNode(book.nodes, id);
    if (!node) return;
    if (removalImpact(node).needsConfirm) setConfirmId(id);
    else {
      commit(withoutNode(book.nodes, id), treeDeletedToast(node.title));
      if (pickedId === id) setPickedId(null);
    }
    setMenu(null);
  }

  function addChapter(anchorId: string | null) {
    const id = `ch-${Date.now()}`;
    const node: ChapterNode = {
      id,
      type: 'file',
      title: TREE_NEW_CHAPTER,
      progress: 'Draft',
      content: '',
      expanded: true,
    };
    const next = insertBelowAnchor(book.nodes, anchorId, node);
    commit(next, treeAddedToast(TREE_NEW_CHAPTER));
    pendingScroll.current = id;
    setPickedId(id);
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
    commit(next, treeAddedToast(TREE_NEW_VOLUME));
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
    commit(walk(book.nodes), treeAddedToast(scene.title));
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
            onRename={(id, title) => {
              const next = renameNode(book.nodes, id, title);
              if (!next) return;
              commit(next, null);
              setInlineId(null);
            }}
            onCancelRename={() => setInlineId(null)}
            onInlineRename={(id) => {
              setPickedId(id);
              setInlineId(id);
            }}
          />
        </div>
        {undo ? (
          <div className="undo-bar" data-testid="tree-undo" key={undo.token}>
            <span>{undo.text}</span>
            <button
              type="button"
              onClick={() => {
                actions.setNodes(book.id, undo.nodes);
                setUndo(null);
              }}
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
              <button type="button" disabled={!picked} onClick={() => picked && setRenameId(picked.id)}>
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
          <EditorPane projectId={book.id} chapter={chapter} />
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
          <button type="button" className="menu-item" onClick={() => { setMenu(null); desktop ? setInlineId(menuNode.id) : setRenameId(menuNode.id); }}>
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
              commit(moveChapterToVolume(book.nodes, menuNode.id, null), treeMovedToast(menuNode.title));
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
                commit(moveChapterToVolume(book.nodes, menuNode.id, volume.id), treeMovedToast(menuNode.title));
                setMenu(null);
              }}
            >
              {volume.title}
            </button>
          ))}
        </Sheet>
      ) : null}

      {renameNodeNow ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => setRenameId(null)}>
          <form
            className="dialog"
            role="dialog"
            data-testid="rename-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('title');
              const value = input instanceof HTMLInputElement ? input.value : '';
              const next = renameNode(book.nodes, renameNodeNow.id, value);
              if (!next) {
                setNameError(true);
                return;
              }
              commit(next, null);
              setRenameId(null);
              setNameError(false);
            }}
          >
            <h2>{TREE_RENAME}</h2>
            <input
              name="title"
              defaultValue={renameNodeNow.title}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
            />
            {nameError ? <p className="hint">{TREE_EMPTY_NAME}</p> : null}
            <div className="dialog-actions rename-actions">
              <button type="button" className="button secondary" onClick={() => setRenameId(null)}>
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
            <div className="dialog-actions delete-actions">
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  commit(withoutNode(book.nodes, confirmNode.id), treeDeletedToast(confirmNode.title));
                  setConfirmId(null);
                  if (pickedId === confirmNode.id) setPickedId(null);
                }}
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
