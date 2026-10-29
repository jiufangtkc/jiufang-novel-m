import { useNavigate } from 'react-router-dom';
import { DailyProgressBar } from '../components/DailyProgressBar';
import { BackIcon, SaveIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import type { ChapterNode } from '../data/demo';
import { countWords } from '../domain/wordCount';
import { useWritingSurface } from '../editor/useWritingSurface';
import { useSample } from '../state/sampleStore';

export function EditorPane({ projectId, chapter }: { projectId: string; chapter: ChapterNode }) {
  const navigate = useNavigate();
  const { actions, state, isGlowing } = useSample();
  const { ref, dirty } = useWritingSurface({
    chapterId: chapter.id,
    onCommit: (text) => actions.commitText(projectId, chapter.id, text),
    onLarge: actions.noteLarge,
    onDuration: actions.addDuration,
    onToast: (message) => actions.toast(message),
  });
  const goal = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  const todayWords = state.schedule.open?.wordCount ?? 0;

  return (
    <div className="editor" data-testid="editor">
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
        <button
          type="button"
          className="icon-button save-button"
          aria-label={dirty ? '有修改，停筆後會記下' : '已記下'}
          data-dirty={dirty ? 'true' : 'false'}
          data-testid="save-button"
        >
          <SaveIcon />
          {dirty && <span className="save-dot" />}
        </button>
      </header>
      <textarea
        ref={ref}
        className="editor-input"
        data-testid="writing-input"
        defaultValue={chapter.content ?? ''}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="【示範】在這裡寫作。"
        aria-label="正文"
      />
      <footer className="editor-status" data-testid="status-bar">
        <DailyProgressBar words={todayWords} goal={goal} met={isGlowing} />
        <div className="status-row">
          <span data-testid="chapter-word-count">本章字數：{countWords(chapter.content ?? '')}</span>
          {chapter.progress && <StatusBadge code={chapter.progress} />}
        </div>
      </footer>
    </div>
  );
}
