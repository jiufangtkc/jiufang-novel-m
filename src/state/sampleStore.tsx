import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  applyWordDelta,
  changeDayEndHour,
  changeGoal,
  countAchievements,
  glowing,
  type GoalSchedule,
} from '../domain/dailyGoal';
import type { ProgressCode } from '../domain/labels';
import { countWords } from '../domain/wordCount';
import {
  applyLargeEvent,
  classifyTextDelta,
  emptyWritingLog,
  withAddedDuration,
  type TextDelta,
  type WritingLogRow,
} from '../domain/writingLog';
import { summarizeStats, type StatsSummary } from '../domain/stats';
import {
  collectContents,
  createDemoSchedule,
  DEMO_PROJECTS,
  demoLogs,
  findNode,
  updateNode,
  type ChapterNode,
  type DemoProject,
} from '../data/demo';

interface SampleState {
  projects: DemoProject[];
  recentIds: string[];
  schedule: GoalSchedule;
  logs: WritingLogRow[];
  toast: string | null;
}

type Action =
  | { type: 'dismiss-recent'; id: string }
  | { type: 'add-project'; id: string; title: string }
  | { type: 'toggle'; projectId: string; nodeId: string }
  | { type: 'set-progress'; projectId: string; nodeId: string; progress: ProgressCode }
  | { type: 'commit-text'; projectId: string; nodeId: string; text: string }
  | { type: 'note-large'; delta: TextDelta }
  | { type: 'add-duration'; seconds: number }
  | { type: 'set-goal'; goal: number }
  | { type: 'set-hour'; hour: number }
  | { type: 'set-book-goal'; projectId: string; bookGoal: number }
  | { type: 'toast'; message: string | null };

function alignToday(logs: WritingLogRow[], schedule: GoalSchedule): WritingLogRow[] {
  if (!schedule.open) return logs;
  const dayKey = schedule.open.dayKey;
  const wordCount = schedule.open.wordCount;
  const existing = logs.some((log) => log.date === dayKey);
  if (!existing) {
    const id = logs.reduce((max, log) => Math.max(max, log.id), 0) + 1;
    return [...logs, { ...emptyWritingLog(id, dayKey), word_count: wordCount }];
  }
  return logs.map((log) => (log.date === dayKey ? { ...log, word_count: wordCount } : log));
}

function mapProject(
  projects: DemoProject[],
  projectId: string,
  updater: (project: DemoProject) => DemoProject,
): DemoProject[] {
  return projects.map((project) => (project.id === projectId ? updater(project) : project));
}

function createState(now: Date): SampleState {
  const schedule = createDemoSchedule(now);
  return {
    projects: DEMO_PROJECTS,
    recentIds: DEMO_PROJECTS.map((project) => project.id),
    schedule,
    logs: alignToday(demoLogs(), schedule),
    toast: null,
  };
}

function reduce(state: SampleState, action: Action): SampleState {
  const now = new Date();
  switch (action.type) {
    case 'toast':
      return { ...state, toast: action.message };
    case 'dismiss-recent':
      return { ...state, recentIds: state.recentIds.filter((id) => id !== action.id) };
    case 'add-project': {
      const title = action.title.trim() || '【示範】未命名專案';
      const project: DemoProject = {
        id: action.id,
        title,
        updatedLabel: '剛剛',
        bookGoal: 100000,
        nodes: [
          {
            id: `${action.id}-ch`,
            type: 'file',
            title: '第一章　起筆',
            progress: 'Draft',
            content: '【示範】在這裡寫作。這段是假資料。\n',
          },
        ],
      };
      return {
        ...state,
        projects: [project, ...state.projects],
        recentIds: [action.id, ...state.recentIds],
        toast: '已新增示範專案（只留在這個畫面裡）',
      };
    }
    case 'toggle':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          nodes: updateNode(project.nodes, action.nodeId, (node) => ({
            ...node,
            expanded: !node.expanded,
          })),
        })),
      };
    case 'set-progress':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          nodes: updateNode(project.nodes, action.nodeId, (node) =>
            node.type === 'folder' ? node : { ...node, progress: action.progress },
          ),
        })),
      };
    case 'set-book-goal':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          bookGoal: action.bookGoal,
        })),
        toast: '已更新全書目標',
      };
    case 'commit-text': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const node = project ? findNode(project.nodes, action.nodeId) : null;
      if (!project || !node || (node.content ?? '') === action.text) return state;
      const delta = classifyTextDelta(node.content ?? '', action.text, { source: 'unknown' });
      const schedule = applyWordDelta(state.schedule, delta.wordDelta, now);
      return {
        ...state,
        schedule,
        logs: alignToday(state.logs, schedule),
        projects: mapProject(state.projects, action.projectId, (current) => ({
          ...current,
          updatedLabel: '剛剛',
          nodes: updateNode(current.nodes, action.nodeId, (item) => ({ ...item, content: action.text })),
        })),
      };
    }
    case 'note-large': {
      if (!state.schedule.open) return state;
      if (!action.delta.largeInsert && !action.delta.largeDelete) return state;
      const dayKey = state.schedule.open.dayKey;
      const logs = alignToday(state.logs, state.schedule).map((log) =>
        log.date === dayKey ? applyLargeEvent(log, action.delta) : log,
      );
      return { ...state, logs };
    }
    case 'add-duration': {
      if (!state.schedule.open || action.seconds <= 0) return state;
      const dayKey = state.schedule.open.dayKey;
      const logs = alignToday(state.logs, state.schedule).map((log) =>
        log.date === dayKey ? withAddedDuration(log, action.seconds) : log,
      );
      return { ...state, logs };
    }
    case 'set-goal':
      return { ...state, schedule: changeGoal(state.schedule, action.goal, now), toast: '已更新今日目標' };
    case 'set-hour':
      return {
        ...state,
        schedule: changeDayEndHour(state.schedule, action.hour, now),
        toast: '已記下結束時刻，從下一個寫作日開始用',
      };
    default:
      return state;
  }
}

interface SampleActions {
  dismissRecent: (id: string) => void;
  addProject: (title: string) => string;
  toggleNode: (projectId: string, nodeId: string) => void;
  setProgress: (projectId: string, nodeId: string, progress: ProgressCode) => void;
  commitText: (projectId: string, nodeId: string, text: string) => void;
  noteLarge: (delta: TextDelta) => void;
  addDuration: (seconds: number) => void;
  setGoal: (goal: number) => void;
  setHour: (hour: number) => void;
  setBookGoal: (projectId: string, bookGoal: number) => void;
  toast: (message: string | null) => void;
}

interface SampleContextValue {
  state: SampleState;
  actions: SampleActions;
  achievementCount: number;
  isGlowing: boolean;
  stats: StatsSummary;
  bookWords: (projectId: string) => number;
}

const SampleContext = createContext<SampleContextValue | null>(null);

export function SampleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, undefined, () => createState(new Date()));

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: 'toast', message: null }), 2400);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  const actions = useMemo<SampleActions>(
    () => ({
      dismissRecent: (id) => dispatch({ type: 'dismiss-recent', id }),
      addProject: (title) => {
        const id = `p-${Date.now()}`;
        dispatch({ type: 'add-project', id, title });
        return id;
      },
      toggleNode: (projectId, nodeId) => dispatch({ type: 'toggle', projectId, nodeId }),
      setProgress: (projectId, nodeId, progress) =>
        dispatch({ type: 'set-progress', projectId, nodeId, progress }),
      commitText: (projectId, nodeId, text) =>
        dispatch({ type: 'commit-text', projectId, nodeId, text }),
      noteLarge: (delta) => dispatch({ type: 'note-large', delta }),
      addDuration: (seconds) => dispatch({ type: 'add-duration', seconds }),
      setGoal: (goal) => dispatch({ type: 'set-goal', goal }),
      setHour: (hour) => dispatch({ type: 'set-hour', hour }),
      setBookGoal: (projectId, bookGoal) => dispatch({ type: 'set-book-goal', projectId, bookGoal }),
      toast: (message) => dispatch({ type: 'toast', message }),
    }),
    [],
  );

  const achievementCount = countAchievements(state.schedule.settled);
  const isGlowing = glowing(state.schedule);
  const stats = summarizeStats(state.schedule, state.logs, achievementCount);
  const bookWords = useCallback(
    (projectId: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return 0;
      return collectContents(project.nodes).reduce((sum, text) => sum + countWords(text), 0);
    },
    [state.projects],
  );

  const value = useMemo(
    () => ({ state, actions, achievementCount, isGlowing, stats, bookWords }),
    [state, actions, achievementCount, isGlowing, stats, bookWords],
  );

  return <SampleContext.Provider value={value}>{children}</SampleContext.Provider>;
}

export function useSample(): SampleContextValue {
  const value = useContext(SampleContext);
  if (!value) throw new Error('SampleProvider 尚未掛上');
  return value;
}

export function useProject(projectId: string | undefined): DemoProject | null {
  const { state } = useSample();
  return state.projects.find((project) => project.id === projectId) ?? null;
}

export function useChapter(projectId: string | undefined, chapterId: string | undefined): ChapterNode | null {
  const project = useProject(projectId);
  if (!project || !chapterId) return null;
  return findNode(project.nodes, chapterId);
}
