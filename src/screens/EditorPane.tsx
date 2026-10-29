import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DailyProgressBar } from '../components/DailyProgressBar';
import { BackIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { TREE_NEXT_CHAPTER, TREE_PREV_CHAPTER } from '../copy/userFacing';
import { bookArchive } from '../db/chapterArchive';
import type { ChapterNode } from '../data/demo';
import { canPickLocalFiles } from '../db/browserDisk';
import { neighborChapterId } from '../domain/chapterOps';
import { sessionVersions, VERSION_INTERVAL_MS, withVersion } from '../domain/chapterVersions';
import { countManuscriptWords } from '../domain/manuscriptWords';
import { latestSaveTimestamp } from '../domain/saveClock';
import { countWords } from '../domain/wordCount';
import { revealCaret } from '../editor/caret';
import { useWritingKeyboard } from '../editor/useWritingKeyboard';
import { useWritingSurface } from '../editor/useWritingSurface';
import { useProject, useSample } from '../state/sampleStore';
import { editorSaveStatus } from './editorSaveStatus';

export function EditorPane({ projectId, chapter }: { projectId: string; chapter: ChapterNode }) {
  const navigate = useNavigate();
  const { actions, state, isGlowing } = useSample();
  const project = useProject(projectId);
  const [focused, setFocused] = useState(false);
  const keyboardOpen = useWritingKeyboard(focused);
  const { ref } = useWritingSurface({
    bookId: projectId,
    chapterId: chapter.id,
    openingText: chapter.content ?? '',
    onCommit: (text) => actions.commitText(projectId, chapter.id, text),
    onLarge: actions.noteLarge,
    onDuration: actions.addDuration,
    onToast: (message) => actions.toast(message),
  });
  const goal = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  const todayWords = state.schedule.open?.wordCount ?? 0;
  const meta = state.saveMeta[projectId] ?? {
    lastAutoSaveMs: null,
    lastManualSaveMs: null,
    lastExportMs: null,
    lastProjectSaveMs: null,
  };
  const saveStatus = editorSaveStatus({
    directWriteback: canPickLocalFiles(),
    lastSaveMs: latestSaveTimestamp(meta),
    lastExportMs: meta.lastExportMs,
    now: new Date(),
  });
  const titleRef = useRef(chapter.title);
  titleRef.current = chapter.title;
  const rememberRef = useRef(actions.rememberPlace);
  rememberRef.current = actions.rememberPlace;
  const prevId = project ? neighborChapterId(project.nodes, chapter.id, -1) : null;
  const nextId = project ? neighborChapterId(project.nodes, chapter.id, 1) : null;

  const placedCursor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (placedCursor.current === chapter.id) return;
    const el = ref.current;
    if (!el || !project) return;
    placedCursor.current = chapter.id;
    if (project.lastOpenedNodeId !== chapter.id) return;
    const cursor = Math.max(0, Math.min(project.lastCursor ?? 0, el.value.length));
    el.setSelectionRange(cursor, cursor);
  }, [chapter.id, project, ref]);

  useEffect(() => {
    const textarea = ref.current;
    const nodeId = chapter.id;
    let baseline = textarea?.value ?? '';
    let lastKept = baseline;
    let baselineStored = false;
    const keep = () => {
      const content = textarea?.value ?? '';
      const taken = sessionVersions({
        baseline,
        lastKept,
        content,
        baselineStored,
        node: { id: nodeId, title: titleRef.current },
        savedAt: Date.now(),
      });
      lastKept = taken.lastKept;
      baselineStored = taken.baselineStored;
      if (taken.versions.length === 0) return;
      void bookArchive.update(projectId, (archive) => {
        let next = archive;
        for (const version of taken.versions) next = withVersion(next, version);
        return next;
      });
    };
    const timer = window.setInterval(keep, VERSION_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      keep();
    };
  }, [chapter.id, projectId, ref]);

  useEffect(() => {
    const savePlace = () => {
      const el = ref.current;
      if (!el) return;
      rememberRef.current(projectId, chapter.id, el.selectionStart ?? 0);
    };
    window.addEventListener('pagehide', savePlace);
    return () => {
      window.removeEventListener('pagehide', savePlace);
      savePlace();
    };
  }, [chapter.id, projectId, ref]);

  useEffect(() => {
    if (keyboardOpen && ref.current) revealCaret(ref.current);
  }, [keyboardOpen, ref]);

  function go(id: string | null) {
    if (!id) return;
    const el = ref.current;
    const text = el?.value ?? chapter.content ?? '';
    const cursor = el?.selectionStart ?? 0;
    actions.commitText(projectId, chapter.id, text);
    actions.rememberPlace(projectId, chapter.id, cursor);
    navigate(`/p/${projectId}/write/${id}`);
  }

  return (
    <div className={keyboardOpen ? 'editor is-keyboard' : 'editor'} data-testid="editor">
      <header className="topbar">
        <button
          type="button"
          className="icon-button back-button"
          aria-label="返回目錄"
          onClick={() => navigate(`/p/${projectId}/write`)}
        >
          <BackIcon />
        </button>
        <h1>{chapter.title}</h1>
      </header>
      <textarea
        ref={ref}
        className="editor-input"
        data-testid="writing-input"
        defaultValue={chapter.content ?? ''}
        name="jiufang-manuscript"
        inputMode="text"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        placeholder="【範例】在這裡寫作。"
        aria-label="正文"
        enterKeyHint="enter"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const el = ref.current;
          if (el) actions.rememberPlace(projectId, chapter.id, el.selectionStart ?? 0);
        }}
      />
      <footer className="editor-status" data-testid="status-bar">
        <DailyProgressBar words={todayWords} goal={goal} met={isGlowing} compact={keyboardOpen} />
        <div className="status-row">
          <span className="status-cluster">
            <span data-testid="chapter-word-count">
              本章字數：
              {project?.origin === 'file'
                ? countManuscriptWords(chapter.content ?? '')
                : countWords(chapter.content ?? '')}
            </span>
            {chapter.progress && <StatusBadge code={chapter.progress} />}
          </span>
          {saveStatus.openFiles ? (
            <button
              type="button"
              className="save-status"
              data-testid="save-status"
              onClick={() => navigate(`/p/${projectId}/files`)}
            >
              {saveStatus.label}
            </button>
          ) : (
            <span className="save-status" data-testid="save-status">
              {saveStatus.label}
            </span>
          )}
        </div>
        <div className="chapter-jump" data-testid="chapter-jump">
          <button type="button" data-testid="chapter-prev" disabled={!prevId} onClick={() => go(prevId)}>
            {TREE_PREV_CHAPTER}
          </button>
          <button type="button" data-testid="chapter-next" disabled={!nextId} onClick={() => go(nextId)}>
            {TREE_NEXT_CHAPTER}
          </button>
        </div>
      </footer>
    </div>
  );
}
