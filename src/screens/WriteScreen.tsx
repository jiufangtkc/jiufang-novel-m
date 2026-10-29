import { useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FilePlusIcon, FolderPlusIcon } from '../components/Icons';
import { CHAPTER_NOT_FOUND, FEATURE_PREPARING, MANUSCRIPT_NOT_FOUND } from '../copy/userFacing';
import { findNode } from '../data/demo';
import { PROGRESS_ORDER, progressLabel } from '../domain/labels';
import { useProject, useSample } from '../state/sampleStore';
import { ChapterTree } from './ChapterTree';
import { EditorPane } from './EditorPane';
import { rememberTreeScroll, type TreeScrollMemory } from './treeScroll';

export function WriteScreen() {
  const { projectId = '', chapterId } = useParams();
  const project = useProject(projectId);
  const { actions } = useSample();
  const [menuId, setMenuId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<TreeScrollMemory>({ scrollTop: 0, highlightId: null });
  const [highlightId, setHighlightId] = useState<string | null>(chapterId ?? null);
  useLayoutEffect(() => {
    if (chapterId) {
      setHighlightId(chapterId);
      return;
    }
    setHighlightId(memoryRef.current.highlightId);
    const pane = scrollRef.current;
    if (pane) pane.scrollTop = memoryRef.current.scrollTop;
  }, [chapterId]);
  if (!project) return <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>;
  const menuNode = menuId ? findNode(project.nodes, menuId) : null;
  const chapter = chapterId ? findNode(project.nodes, chapterId) : null;

  return (
    <div className={chapterId ? 'write-layout has-chapter' : 'write-layout'} data-testid="write-screen">
      <section className="tree-pane" data-testid="chapter-tree">
        <header className="topbar">
          <h1>{project.title}</h1>
          <button
            type="button"
            className="icon-button"
            aria-label="新增卷"
            onClick={() => actions.toast(FEATURE_PREPARING)}
          >
            <FolderPlusIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="新增章"
            onClick={() => actions.toast(FEATURE_PREPARING)}
          >
            <FilePlusIcon />
          </button>
        </header>
        <div
          className="scroll-pane"
          ref={scrollRef}
          onScroll={() => {
            if (chapterId || !scrollRef.current) return;
            memoryRef.current = { ...memoryRef.current, scrollTop: scrollRef.current.scrollTop };
          }}
        >
          <ChapterTree
            projectId={project.id}
            nodes={project.nodes}
            depth={0}
            selectedId={chapterId ?? highlightId ?? undefined}
            onOpenChapter={(id) => {
              memoryRef.current = rememberTreeScroll(memoryRef.current, {
                type: 'open',
                chapterId: id,
                scrollTop: scrollRef.current?.scrollTop ?? 0,
              });
              setHighlightId(id);
            }}
            onToggle={(id) => actions.toggleNode(project.id, id)}
            onMore={setMenuId}
          />
        </div>
      </section>
      <section className="editor-pane">
        {chapter ? (
          <EditorPane projectId={project.id} chapter={chapter} />
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
      {menuNode && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setMenuId(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-labelledby="node-menu-title"
            data-testid="node-menu"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="node-menu-title">{menuNode.title}</h2>
            {menuNode.type !== 'folder' ? (
              <p className="hint menu-kind">{menuNode.type === 'file' ? '章' : '幕'}</p>
            ) : null}
            {menuNode.type !== 'folder' && (
              <div className="menu-list">
                {PROGRESS_ORDER.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={menuNode.progress === code ? 'menu-item is-current' : 'menu-item'}
                    onClick={() => {
                      actions.setProgress(project.id, menuNode.id, code);
                      setMenuId(null);
                    }}
                  >
                    {progressLabel(code)}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                if (menuNode.type === 'file') actions.addScene(project.id, menuNode.id);
                else actions.toast(FEATURE_PREPARING);
                setMenuId(null);
              }}
            >
              {menuNode.type === 'file' ? '在此章新增幕' : '調整目錄結構'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
