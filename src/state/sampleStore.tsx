import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
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
import {
  bookAfterRename,
  shouldSaveUnderNewName,
  type BookFileMark,
} from '../domain/bookTitle';
import { exportDbFilename, localDbFilename, projectSaveFilename, sanitizeDbBasename } from '../domain/exportFilename';
import { canPickLocalFiles, pickExistingDatabase, pickSaveFile } from '../db/browserDisk';
import { createBrowserTargetStore } from '../db/browserTargetStore';
import type { DiskFile } from '../db/fileTarget';
import { currentSchemaVersion } from '../db/migrations';
import { recallOpenFile, rememberOpenFile } from '../db/openFileMemory';
import { openMemoryDb } from '../db/wasmDb';
import {
  handOffPrepared,
  saveNotice,
  saveProjectAsNew,
  saveProjectFromClick,
  shouldPickBeforeBuild,
  type SaveEnvironment,
  type SaveOutcome,
} from '../db/saveProject';
import { verifyExportedDatabase } from '../db/verifyDatabase';
import { BOOK_RENAME_FAIL, BOOK_RENAMED_TOAST, STASH_FAIL } from '../copy/userFacing';
import { countManuscriptWords } from '../domain/manuscriptWords';
import { countWords } from '../domain/wordCount';
import { type FileCard, type FileLog, type FileProjectInfo } from '../db/projectFile';
import { importBook, loadStoredBooks, saveBookBytes, shareDatabase } from '../db/library';
import {
  bindLeaveFlush,
  clearLiveDraft,
  flushOpenDraft,
  loadLiveDraft,
  notePersistedDraft,
  readLiveDraftFromEditor,
} from '../editor/liveDraft';
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
import { newChapterId, shapeAfterEdit } from '../domain/openManuscript';
import { addSceneUnderChapter, createScene, loadProjects, saveProjects } from '../domain/outline';

interface SampleState {
  projects: DemoProject[];
  recentIds: string[];
  schedule: GoalSchedule;
  demoSchedule: GoalSchedule;
  goalById: Record<string, GoalSchedule>;
  activeProjectId: string | null;
  logs: WritingLogRow[];
  demoLogs: WritingLogRow[];
  toast: string | null;
  /** 匯入檔的卡片與寫作紀錄，另存時原樣帶出。 */
  fileExtras: Record<string, { info: FileProjectInfo; cards: FileCard[]; logs: FileLog[] }>;
  saveMeta: Record<
    string,
    {
      lastAutoSaveMs: number | null;
      lastManualSaveMs: number | null;
      lastExportMs: number | null;
      lastProjectSaveMs: number | null;
    }
  >;
}

type Action =
  | { type: 'dismiss-recent'; id: string }
  | { type: 'add-project'; id: string; title: string; shape: 'novel' | 'single' }
  | { type: 'remember-place'; projectId: string; nodeId: string; cursor: number }
  | { type: 'toggle'; projectId: string; nodeId: string }
  | { type: 'set-progress'; projectId: string; nodeId: string; progress: ProgressCode }
  | { type: 'commit-text'; projectId: string; nodeId: string; text: string }
  | { type: 'note-large'; delta: TextDelta }
  | { type: 'add-duration'; seconds: number }
  | { type: 'set-goal'; goal: number }
  | { type: 'set-hour'; hour: number }
  | { type: 'set-book-goal'; projectId: string; bookGoal: number }
  | { type: 'add-scene'; projectId: string; chapterId: string; sceneId: string }
  | { type: 'set-nodes'; projectId: string; nodes: DemoProject['nodes'] }
  | { type: 'focus-project'; id: string }
  | {
      type: 'attach-file';
      project: DemoProject;
      schedule: GoalSchedule;
      extras: { info: FileProjectInfo; cards: FileCard[]; logs: FileLog[] };
      quiet?: boolean;
    }
  | { type: 'toast'; message: string | null }
  | { type: 'record-auto-save'; projectId: string; atMs: number }
  | { type: 'record-manual-save'; projectId: string; atMs: number }
  | { type: 'record-export'; projectId: string; atMs: number }
  | { type: 'record-project-save'; projectId: string; atMs: number }
  | { type: 'set-filename'; projectId: string; filename: string }
  | { type: 'rename-book'; projectId: string; title: string; titleSavePending: BookFileMark['titleSavePending'] }
  | { type: 'defer-title-save'; projectId: string }
  | { type: 'note-title-in-file'; projectId: string }
  | { type: 'promote-stored'; projectId: string; key: string; filename: string };

const preparedShare = new Map<string, { key: string; filename: string; bytes: Uint8Array }>();

function bookkeepingOf(project: DemoProject): BookFileMark {
  return {
    titleInFile: project.titleInFile ?? null,
    hasExternalFile: Boolean(project.hasExternalFile),
    titleSavePending: project.titleSavePending ?? null,
  };
}

function withFileMark(project: DemoProject, mark: Pick<DemoProject, 'hasExternalFile' | 'titleInFile' | 'titleSavePending'>): DemoProject {
  return { ...project, ...mark };
}

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

function retitleFileExtra(state: SampleState, projectId: string, title: string): SampleState['fileExtras'] {
  const project = state.projects.find((item) => item.id === projectId);
  const key = project?.dbKey;
  if (!key || !state.fileExtras[key]) return state.fileExtras;
  const extra = state.fileExtras[key];
  return {
    ...state.fileExtras,
    [key]: { ...extra, info: { ...extra.info, title } },
  };
}

function savedProjects(): DemoProject[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return loadProjects(localStorage);
  } catch {
    return null;
  }
}

function createState(now: Date): SampleState {
  const schedule = createDemoSchedule(now);
  const projects = (savedProjects() ?? DEMO_PROJECTS).map((project) => ({
    ...project,
    origin: project.origin ?? 'demo',
  }));
  const logs = alignToday(demoLogs(), schedule);
  return {
    projects,
    recentIds: projects.map((project) => project.id),
    schedule,
    demoSchedule: schedule,
    goalById: {},
    activeProjectId: null,
    logs,
    demoLogs: logs,
    toast: null,
    fileExtras: {},
    saveMeta: {},
  };
}

function patchSaveMeta(
  state: SampleState,
  projectId: string,
  patch: Partial<SampleState['saveMeta'][string]>,
): SampleState {
  const prev = state.saveMeta[projectId] ?? {
    lastAutoSaveMs: null,
    lastManualSaveMs: null,
    lastExportMs: null,
    lastProjectSaveMs: null,
  };
  return {
    ...state,
    saveMeta: { ...state.saveMeta, [projectId]: { ...prev, ...patch } },
  };
}

function applyLargeToFile(log: FileLog, delta: TextDelta): FileLog {
  return {
    ...log,
    paste_large_count: log.paste_large_count + (delta.largeInsert ? 1 : 0),
    delete_large_count: log.delete_large_count + (delta.largeDelete ? 1 : 0),
  };
}

function bumpFileLog(
  state: SampleState,
  dayKey: string,
  update: (log: FileLog) => FileLog,
): SampleState['fileExtras'] {
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  if (!project?.dbKey || project.origin !== 'file') return state.fileExtras;
  const extra = state.fileExtras[project.dbKey];
  if (!extra) return state.fileExtras;
  let found = false;
  const logs = extra.logs.map((log) => {
    if (log.date !== dayKey) return log;
    found = true;
    return update(log);
  });
  if (!found) {
    logs.push(
      update({
        date: dayKey,
        duration: 0,
        word_count: 0,
        ai_continuation_count: 0,
        ai_continuation_chars: 0,
        ai_chat_count: 0,
        ai_details: '{}',
        paste_large_count: 0,
        delete_large_count: 0,
      }),
    );
  }
  return { ...state.fileExtras, [project.dbKey]: { ...extra, logs } };
}

function fileLogsToRows(logs: readonly FileLog[]): WritingLogRow[] {
  return logs.map((log, index) => ({
    id: index + 1,
    date: log.date,
    duration: log.duration,
    word_count: log.word_count,
    ai_continuation_count: log.ai_continuation_count,
    ai_continuation_chars: log.ai_continuation_chars,
    ai_chat_count: log.ai_chat_count,
    ai_details: log.ai_details,
    paste_large_count: log.paste_large_count,
    delete_large_count: log.delete_large_count,
  }));
}

function rememberFilePlace(
  state: SampleState,
  projectId: string,
  nodeId: string,
  cursor: number,
): SampleState['fileExtras'] {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project?.dbKey || project.origin !== 'file') return state.fileExtras;
  const extra = state.fileExtras[project.dbKey];
  if (!extra) return state.fileExtras;
  return {
    ...state.fileExtras,
    [project.dbKey]: {
      ...extra,
      info: { ...extra.info, lastOpenedNodeId: nodeId, lastCursorPosition: cursor },
    },
  };
}

function syncFileLog(
  extras: SampleState['fileExtras'],
  project: DemoProject,
  schedule: GoalSchedule,
  nodeId?: string,
): SampleState['fileExtras'] {
  if (project.origin !== 'file' || !project.dbKey) return extras;
  const extra = extras[project.dbKey];
  const open = schedule.open;
  if (!extra || !open) return extras;
  const logs = extra.logs.map((log) => ({ ...log }));
  const found = logs.find((log) => log.date === open.dayKey);
  if (found) found.word_count = open.wordCount;
  else {
    logs.push({
      date: open.dayKey,
      duration: 0,
      word_count: open.wordCount,
      ai_continuation_count: 0,
      ai_continuation_chars: 0,
      ai_chat_count: 0,
      ai_details: '{}',
      paste_large_count: 0,
      delete_large_count: 0,
    });
  }
  return {
    ...extras,
    [project.dbKey]: {
      ...extra,
      info: {
        ...extra.info,
        lastOpenedNodeId: nodeId ?? extra.info.lastOpenedNodeId,
        dailyTargetWordCount: open.goals.at(-1)?.goal ?? extra.info.dailyTargetWordCount,
        targetWordCount: project.bookGoal,
      },
      logs,
    },
  };
}

function keepSchedule(state: SampleState, schedule: GoalSchedule): SampleState {
  const active = state.projects.find((project) => project.id === state.activeProjectId);
  if (active?.origin === 'file' && state.activeProjectId) {
    return {
      ...state,
      schedule,
      goalById: { ...state.goalById, [state.activeProjectId]: schedule },
    };
  }
  return { ...state, schedule, demoSchedule: schedule };
}

function reduce(state: SampleState, action: Action): SampleState {
  const now = new Date();
  switch (action.type) {
    case 'toast':
      return { ...state, toast: action.message };
    case 'record-auto-save':
      return patchSaveMeta(state, action.projectId, { lastAutoSaveMs: action.atMs });
    case 'record-manual-save':
      return patchSaveMeta(state, action.projectId, { lastManualSaveMs: action.atMs });
    case 'record-export':
      return patchSaveMeta(state, action.projectId, { lastExportMs: action.atMs });
    case 'record-project-save':
      return patchSaveMeta(state, action.projectId, { lastProjectSaveMs: action.atMs });
    case 'set-filename':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          filename: action.filename,
        })),
      };
    case 'rename-book':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          title: action.title,
          titleSavePending: action.titleSavePending,
          updatedLabel: '剛剛',
        })),
        fileExtras: retitleFileExtra(state, action.projectId, action.title),
      };
    case 'defer-title-save':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          titleSavePending: 'export',
        })),
      };
    case 'note-title-in-file':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => withFileMark(project, {
          hasExternalFile: true,
          titleInFile: project.title,
          titleSavePending: null,
        })),
      };
    case 'promote-stored': {
      const project = state.projects.find((item) => item.id === action.projectId);
      if (!project) return state;
      const key = project.dbKey ?? action.key;
      const goal = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
      const existing = state.fileExtras[key];
      const extras = existing ?? {
        info: {
          title: project.title,
          logline: '',
          currentTheme: '',
          globalFontFamily: '',
          globalFontSize: 12,
          editorFontFamily: '',
          editorFontSize: 16,
          targetWordCount: project.bookGoal,
          dailyTargetWordCount: goal,
          categoryOrder: null,
          expandedCategories: null,
          categoriesMeta: '{}',
          lastOpenedNodeId: project.lastOpenedNodeId ?? null,
          lastCursorPosition: project.lastCursor ?? 0,
        },
        cards: [],
        logs: state.logs.map((log) => ({
          date: log.date,
          duration: log.duration,
          word_count: log.word_count,
          ai_continuation_count: log.ai_continuation_count,
          ai_continuation_chars: log.ai_continuation_chars,
          ai_chat_count: log.ai_chat_count,
          ai_details: log.ai_details ?? '{}',
          paste_large_count: log.paste_large_count,
          delete_large_count: log.delete_large_count,
        })),
      };
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (current) => ({
          ...current,
          origin: 'file',
          dbKey: key,
          filename: current.filename || action.filename,
        })),
        fileExtras: { ...state.fileExtras, [key]: extras },
        goalById: { ...state.goalById, [project.id]: state.goalById[project.id] ?? state.schedule },
      };
    }
    case 'dismiss-recent':
      return { ...state, recentIds: state.recentIds.filter((id) => id !== action.id) };
    case 'add-project': {
      const title = action.title.trim() || '未命名稿子';
      const chapterId = newChapterId(action.id);
      const single = action.shape === 'single';
      const project: DemoProject = {
        id: action.id,
        title,
        updatedLabel: '剛剛',
        bookGoal: 100000,
        shape: action.shape,
        lastOpenedNodeId: single ? chapterId : null,
        lastCursor: 0,
        nodes: [
          {
            id: chapterId,
            type: 'file',
            title: single ? title : '第一章　',
            progress: 'Draft',
            content: '',
          },
        ],
      };
      return {
        ...state,
        projects: [project, ...state.projects],
        recentIds: [action.id, ...state.recentIds],
        toast: '已開新稿子',
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
      const deltaWords =
        project.origin === 'file'
          ? countManuscriptWords(action.text) - countManuscriptWords(node.content ?? '')
          : classifyTextDelta(node.content ?? '', action.text, { source: 'unknown' }).wordDelta;
      const schedule = applyWordDelta(state.schedule, deltaWords, now);
      const next = keepSchedule(state, schedule);
      const projects = mapProject(next.projects, action.projectId, (current) => ({
        ...current,
        updatedLabel: '剛剛',
        nodes: updateNode(current.nodes, action.nodeId, (item) => ({ ...item, content: action.text })),
      }));
      const extras = syncFileLog(next.fileExtras, project, schedule, action.nodeId);
      return {
        ...next,
        projects,
        logs: alignToday(next.logs, schedule),
        fileExtras: extras,
      };
    }
    case 'note-large': {
      if (!state.schedule.open) return state;
      if (!action.delta.largeInsert && !action.delta.largeDelete) return state;
      const dayKey = state.schedule.open.dayKey;
      const logs = alignToday(state.logs, state.schedule).map((log) =>
        log.date === dayKey ? applyLargeEvent(log, action.delta) : log,
      );
      return { ...state, logs, fileExtras: bumpFileLog(state, dayKey, (log) => applyLargeToFile(log, action.delta)) };
    }
    case 'add-duration': {
      if (!state.schedule.open || action.seconds <= 0) return state;
      const dayKey = state.schedule.open.dayKey;
      const logs = alignToday(state.logs, state.schedule).map((log) =>
        log.date === dayKey ? withAddedDuration(log, action.seconds) : log,
      );
      return {
        ...state,
        logs,
        fileExtras: bumpFileLog(state, dayKey, (log) => ({ ...log, duration: log.duration + action.seconds })),
      };
    }
    case 'set-goal':
      return { ...keepSchedule(state, changeGoal(state.schedule, action.goal, now)), toast: '已更新今日目標' };
    case 'set-hour':
      return {
        ...keepSchedule(state, changeDayEndHour(state.schedule, action.hour, now)),
        toast: '已記下結束時刻，從下一個寫作日開始用',
      };
    case 'focus-project': {
      const project = state.projects.find((item) => item.id === action.id);
      if (!project || state.activeProjectId === action.id) return state;
      if (project.origin === 'file') {
        const schedule = state.goalById[project.id] ?? state.schedule;
        const extra = state.fileExtras[project.dbKey ?? ''];
        return {
          ...state,
          activeProjectId: project.id,
          schedule,
          logs: extra ? fileLogsToRows(extra.logs) : state.logs,
        };
      }
      return {
        ...state,
        activeProjectId: project.id,
        schedule: state.demoSchedule,
        logs: state.demoLogs,
      };
    }
    case 'remember-place':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          lastOpenedNodeId: action.nodeId,
          lastCursor: action.cursor,
        })),
        fileExtras: rememberFilePlace(state, action.projectId, action.nodeId, action.cursor),
      };
    case 'attach-file': {
      if (action.quiet && state.projects.some((item) => item.id === action.project.id)) return state;
      const project: DemoProject = {
        ...action.project,
        lastOpenedNodeId: action.project.lastOpenedNodeId ?? action.extras.info.lastOpenedNodeId,
        lastCursor: action.project.lastCursor ?? action.extras.info.lastCursorPosition,
      };
      const projects = [project, ...state.projects.filter((item) => item.id !== project.id)];
      return {
        ...state,
        projects,
        recentIds: [action.project.id, ...state.recentIds.filter((id) => id !== action.project.id)],
        goalById: { ...state.goalById, [action.project.id]: action.schedule },
        fileExtras: { ...state.fileExtras, [project.dbKey ?? project.id]: action.extras },
        activeProjectId: action.quiet ? state.activeProjectId : project.id,
        schedule: action.quiet ? state.schedule : action.schedule,
        logs: action.quiet ? state.logs : fileLogsToRows(action.extras.logs),
        toast: action.quiet ? state.toast : '已匯入檔案',
      };
    }
    case 'set-nodes':
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          updatedLabel: '剛剛',
          shape: shapeAfterEdit(project.shape, action.nodes),
          nodes: action.nodes,
        })),
      };
    case 'add-scene': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const chapter = project ? findNode(project.nodes, action.chapterId) : null;
      if (!project || !chapter) return state;
      const scene = createScene(chapter, action.sceneId);
      const nodes = addSceneUnderChapter(project.nodes, action.chapterId, scene);
      if (!nodes) return state;
      return {
        ...state,
        toast: '已在此章新增幕',
        projects: mapProject(state.projects, action.projectId, (current) => ({
          ...current,
          updatedLabel: '剛剛',
          nodes,
        })),
      };
    }
    default:
      return state;
  }
}

interface SampleActions {
  dismissRecent: (id: string) => void;
  addProject: (title: string, shape?: 'novel' | 'single') => string;
  rememberPlace: (projectId: string, nodeId: string, cursor: number) => void;
  toggleNode: (projectId: string, nodeId: string) => void;
  setProgress: (projectId: string, nodeId: string, progress: ProgressCode) => void;
  commitText: (projectId: string, nodeId: string, text: string) => void;
  noteLarge: (delta: TextDelta) => void;
  addDuration: (seconds: number) => void;
  setGoal: (goal: number) => void;
  setHour: (hour: number) => void;
  setBookGoal: (projectId: string, bookGoal: number) => void;
  addScene: (projectId: string, chapterId: string) => void;
  setNodes: (projectId: string, nodes: DemoProject['nodes']) => void;
  focusProject: (id: string) => void;
  attachImported: (payload: {
    project: DemoProject;
    schedule: GoalSchedule;
    extras: { info: FileProjectInfo; cards: FileCard[]; logs: FileLog[] };
  }) => void;
  importFile: (file: File, diskFile?: DiskFile | null) => Promise<{ id: string; chapterId: string | null }>;
  openWithPicker: () => Promise<{ id: string; chapterId: string | null } | null>;
  stashDraft: () => Promise<void>;
  renameBook: (projectId: string, rawTitle: string) => {
    ok: boolean;
    unchanged: boolean;
    askSaveAs: boolean;
    title: string;
  };
  deferTitleSave: (projectId: string) => void;
  prepareShare: (projectId: string, title: string) => Promise<void>;
  saveProject: () => Promise<SaveOutcome | null>;
  saveProjectAs: () => Promise<SaveOutcome | null>;
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

function browserSaveEnv(): SaveEnvironment {
  return {
    canPickFiles: canPickLocalFiles(),
    targets: createBrowserTargetStore(),
    verify: async (bytes) => {
      await verifyExportedDatabase(bytes, async (payload) => {
        const db = await openMemoryDb(payload);
        try {
          return currentSchemaVersion(db.sql);
        } finally {
          db.close();
        }
      });
    },
    pickSaveLocation: (suggestedName, startIn) => pickSaveFile(suggestedName, startIn?.directoryHint),
    share: (filename, bytes) => shareDatabase(filename, bytes),
  };
}

async function snapshotManuscript(
  state: SampleState,
  project: DemoProject,
  persist = true,
): Promise<{ key: string; bytes: Uint8Array }> {
  const key = project.dbKey ?? project.id;
  const extra = project.dbKey ? state.fileExtras[project.dbKey] : undefined;
  const goal = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  const info: FileProjectInfo = {
    title: project.title,
    logline: extra?.info.logline ?? '',
    currentTheme: extra?.info.currentTheme ?? '',
    globalFontFamily: extra?.info.globalFontFamily ?? '',
    globalFontSize: extra?.info.globalFontSize ?? 12,
    editorFontFamily: extra?.info.editorFontFamily ?? '',
    editorFontSize: extra?.info.editorFontSize ?? 16,
    targetWordCount: project.bookGoal,
    dailyTargetWordCount: goal,
    categoryOrder: extra?.info.categoryOrder ?? null,
    expandedCategories: extra?.info.expandedCategories ?? null,
    categoriesMeta: extra?.info.categoriesMeta ?? '{}',
    lastOpenedNodeId: extra?.info.lastOpenedNodeId ?? project.lastOpenedNodeId ?? null,
    lastCursorPosition: extra?.info.lastCursorPosition ?? project.lastCursor ?? 0,
  };
  const logs: FileLog[] = extra?.logs ?? state.logs.map((log) => ({
    date: log.date,
    duration: log.duration,
    word_count: log.word_count,
    ai_continuation_count: log.ai_continuation_count,
    ai_continuation_chars: log.ai_continuation_chars,
    ai_chat_count: log.ai_chat_count,
    ai_details: log.ai_details ?? '{}',
    paste_large_count: log.paste_large_count,
    delete_large_count: log.delete_large_count,
  }));
  const bytes = await saveBookBytes(
    key,
    projectSaveFilename(project.title, project.filename),
    project.title,
    info,
    project.nodes,
    extra?.cards ?? [],
    logs,
    bookkeepingOf(project),
    persist,
  );
  return { key, bytes };
}

function applySaveOutcome(
  dispatch: (action: Action) => void,
  projectId: string,
  outcome: SaveOutcome,
  mode: 'save' | 'save-as',
) {
  const text = saveNotice(outcome);
  if (text) dispatch({ type: 'toast', message: text });
  if (outcome.kind === 'saved' || outcome.kind === 'saved-under-new-title') {
    dispatch({ type: 'record-project-save', projectId, atMs: Date.now() });
    dispatch({ type: 'set-filename', projectId, filename: outcome.filename });
    dispatch({ type: 'note-title-in-file', projectId });
  }
  if (mode === 'save-as' && outcome.kind === 'saved-as') {
    dispatch({ type: 'record-export', projectId, atMs: Date.now() });
    dispatch({ type: 'set-filename', projectId, filename: outcome.filename });
    dispatch({ type: 'note-title-in-file', projectId });
  }
  if (mode === 'save-as' && outcome.kind === 'handed-off') {
    dispatch({ type: 'record-export', projectId, atMs: Date.now() });
    dispatch({ type: 'note-title-in-file', projectId });
  }
}

export function SampleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, undefined, () => createState(new Date()));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      saveProjects(
        localStorage,
        state.projects.filter((project) => project.origin !== 'file'),
      );
      const active = state.projects.find((project) => project.id === state.activeProjectId);
      if (active && active.origin !== 'file') {
        dispatch({ type: 'record-auto-save', projectId: active.id, atMs: Date.now() });
      }
    } catch {
      // 私人瀏覽可能不准寫入，畫面仍可繼續用。
    }
  }, [state.projects, state.activeProjectId]);

  useEffect(() => {
    let cancelled = false;
    void loadStoredBooks()
      .then((books) => {
        if (cancelled) return;
        const draft = typeof localStorage === 'undefined' ? null : loadLiveDraft(localStorage);
        let appliedDraft = false;
        for (const book of books) {
          let tree = book.tree;
          if (draft && draft.projectId === book.key && findNode(book.tree, draft.chapterId)) {
            tree = updateNode(book.tree, draft.chapterId, (node) => ({ ...node, content: draft.text }));
            appliedDraft = true;
          }
          dispatch({
            type: 'attach-file',
            quiet: true,
            project: {
              id: book.key,
              title: book.title,
              updatedLabel: '已在手機',
              bookGoal: book.info.targetWordCount,
              nodes: tree,
              origin: 'file',
              dbKey: book.key,
              filename: book.filename,
              hasExternalFile: book.hasExternalFile,
              titleInFile: book.titleInFile,
              titleSavePending: book.titleSavePending,
            },
            schedule: book.schedule,
            extras: { info: book.info, cards: book.cards, logs: book.logs },
          });
        }
        if (appliedDraft && typeof localStorage !== 'undefined') clearLiveDraft(localStorage);
        for (const book of books) {
          void createBrowserTargetStore()
            .load(book.key)
            .then((target) => {
              if (recallOpenFile(book.key) === undefined) rememberOpenFile(book.key, target?.file ?? null);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        // 沒有手機儲存空間時，範例專案仍可寫。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    if (!project || project.origin !== 'file' || !project.dbKey) return;
    const extra = state.fileExtras[project.dbKey];
    if (!extra) return;
    const save = () =>
      saveBookBytes(
        project.dbKey!,
        localDbFilename(project.title, project.filename),
        project.title,
        { ...extra.info, title: project.title, targetWordCount: project.bookGoal },
        project.nodes,
        extra.cards,
        extra.logs,
        bookkeepingOf(project),
      ).then(() => {
        dispatch({ type: 'record-auto-save', projectId: project.id, atMs: Date.now() });
      });
    const timer = window.setTimeout(() => void save(), 250);
    return () => {
      window.clearTimeout(timer);
      void save();
    };
  }, [state.projects, state.fileExtras, state.activeProjectId]);

  useEffect(() => {
    const flush = () => {
      const current = stateRef.current;
      let projects = current.projects;
      const live = readLiveDraftFromEditor();
      try {
        if (typeof localStorage !== 'undefined') {
          projects = flushOpenDraft({ store: localStorage, projects: current.projects });
        }
      } catch {
        projects = current.projects;
      }
      if (live) {
        dispatch({ type: 'commit-text', projectId: live.projectId, nodeId: live.chapterId, text: live.text });
      }
      const projectId = live?.projectId ?? current.activeProjectId;
      const project = projects.find((item) => item.id === projectId);
      if (!project) return;
      const startedAt = Date.now();
      void snapshotManuscript({ ...current, projects }, project)
        .then((result) => {
          if (live && typeof localStorage !== 'undefined') notePersistedDraft(localStorage, live, startedAt);
          dispatch({ type: 'record-auto-save', projectId: project.id, atMs: startedAt });
          dispatch({
            type: 'promote-stored',
            projectId: project.id,
            key: result.key,
            filename: project.filename || projectSaveFilename(project.title, project.filename),
          });
        })
        .catch(() => undefined);
    };
    return bindLeaveFlush(window, document, flush);
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: 'toast', message: null }), 2400);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  const actions = useMemo<SampleActions>(
    () => ({
      dismissRecent: (id) => dispatch({ type: 'dismiss-recent', id }),
      addProject: (title, shape = 'novel') => {
        const id = `p-${Date.now()}`;
        dispatch({ type: 'add-project', id, title, shape });
        return id;
      },
      rememberPlace: (projectId, nodeId, cursor) =>
        dispatch({ type: 'remember-place', projectId, nodeId, cursor }),
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
      addScene: (projectId, chapterId) =>
        dispatch({ type: 'add-scene', projectId, chapterId, sceneId: `sc-${Date.now()}` }),
      setNodes: (projectId, nodes) => dispatch({ type: 'set-nodes', projectId, nodes }),
      focusProject: (id) => dispatch({ type: 'focus-project', id }),
      attachImported: (payload) => dispatch({ type: 'attach-file', ...payload }),
      importFile: async (file: File, diskFile?: DiskFile | null) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const book = await importBook(file.name, bytes);
        await createBrowserTargetStore().save(book.key, { filename: book.filename, file: diskFile ?? null });
        rememberOpenFile(book.key, diskFile ?? null);
        dispatch({
          type: 'attach-file',
          project: {
            id: book.key,
            title: book.title,
            updatedLabel: '剛剛',
            bookGoal: book.info.targetWordCount,
            nodes: book.tree,
            origin: 'file',
            dbKey: book.key,
            filename: book.filename,
            hasExternalFile: book.hasExternalFile,
            titleInFile: book.titleInFile,
            titleSavePending: book.titleSavePending,
          },
          schedule: book.schedule,
          extras: { info: book.info, cards: book.cards, logs: book.logs },
        });
        return { id: book.key, chapterId: findNode(book.tree, book.info.lastOpenedNodeId ?? '') ? book.info.lastOpenedNodeId : null };
      },
      openWithPicker: async () => {
        const picked = await pickExistingDatabase();
        if (!picked) return null;
        const copy = new Uint8Array(picked.bytes.byteLength);
        copy.set(picked.bytes);
        const book = await importBook(picked.file.name, copy);
        await createBrowserTargetStore().save(book.key, { filename: book.filename, file: picked.file });
        rememberOpenFile(book.key, picked.file);
        dispatch({
          type: 'attach-file',
          project: {
            id: book.key,
            title: book.title,
            updatedLabel: '剛剛',
            bookGoal: book.info.targetWordCount,
            nodes: book.tree,
            origin: 'file',
            dbKey: book.key,
            filename: book.filename,
            hasExternalFile: book.hasExternalFile,
            titleInFile: book.titleInFile,
            titleSavePending: book.titleSavePending,
          },
          schedule: book.schedule,
          extras: { info: book.info, cards: book.cards, logs: book.logs },
        });
        return {
          id: book.key,
          chapterId: findNode(book.tree, book.info.lastOpenedNodeId ?? '') ? book.info.lastOpenedNodeId : null,
        };
      },
      stashDraft: async () => {
        const project = state.projects.find((item) => item.id === state.activeProjectId);
        if (!project) return;
        try {
          const { key } = await snapshotManuscript(state, project);
          dispatch({
            type: 'promote-stored',
            projectId: project.id,
            key,
            filename: projectSaveFilename(project.title, project.filename),
          });
          dispatch({ type: 'record-manual-save', projectId: project.id, atMs: Date.now() });
          dispatch({ type: 'toast', message: '已暫存' });
        } catch {
          dispatch({ type: 'toast', message: STASH_FAIL });
        }
      },
      renameBook: (projectId, rawTitle) => {
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) {
          dispatch({ type: 'toast', message: BOOK_RENAME_FAIL });
          return { ok: false, unchanged: true, askSaveAs: false, title: '' };
        }
        const next = bookAfterRename(project, rawTitle, canPickLocalFiles());
        if (next.followUp.kind === 'unchanged') {
          return { ok: true, unchanged: true, askSaveAs: false, title: project.title };
        }
        dispatch({
          type: 'rename-book',
          projectId,
          title: next.book.title,
          titleSavePending: next.followUp.pending,
        });
        if (next.followUp.askSaveAs) {
          return { ok: true, unchanged: false, askSaveAs: true, title: next.followUp.title };
        }
        dispatch({ type: 'toast', message: BOOK_RENAMED_TOAST });
        return { ok: true, unchanged: false, askSaveAs: false, title: next.followUp.title };
      },
      deferTitleSave: (projectId) => dispatch({ type: 'defer-title-save', projectId }),
      prepareShare: async (projectId, title) => {
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) return;
        try {
          const snap = await snapshotManuscript(state, { ...project, title }, false);
          await browserSaveEnv().verify(snap.bytes);
          preparedShare.set(projectId, {
            key: snap.key,
            filename: exportDbFilename(title),
            bytes: snap.bytes,
          });
        } catch {
          preparedShare.delete(projectId);
        }
      },
      saveProject: async () => {
        const project = state.projects.find((item) => item.id === state.activeProjectId);
        if (!project) return null;
        const key = project.dbKey ?? project.id;
        const remembered = recallOpenFile(key);
        const needsNewName = shouldSaveUnderNewName({
          hasExternalFile: Boolean(project.hasExternalFile),
          titleInFile: project.titleInFile ?? null,
          title: project.title,
          filename: project.filename ?? null,
        });
        const pickFirst = shouldPickBeforeBuild({
          canPick: canPickLocalFiles(),
          needsNewName,
          remembered,
          hasExternalFile: Boolean(project.hasExternalFile),
        });
        const plan = needsNewName ? 'pick-new-name' : pickFirst ? 'pick-first-save' : 'write-back';
        try {
          const outcome = await saveProjectFromClick({
            env: browserSaveEnv(),
            bookKey: key,
            plan,
            writeBackName: projectSaveFilename(project.title, project.filename),
            newTitleName: `${sanitizeDbBasename(project.title)}.db`,
            startIn: needsNewName && remembered ? remembered : null,
            onRemember: (file) => rememberOpenFile(key, file),
            buildBytes: async () => {
              const snap = await snapshotManuscript(state, project);
              dispatch({
                type: 'promote-stored',
                projectId: project.id,
                key: snap.key,
                filename: project.filename || projectSaveFilename(project.title, project.filename),
              });
              return snap.bytes;
            },
          });
          applySaveOutcome(dispatch, project.id, outcome, 'save');
          if (
            (outcome.kind === 'saved' || outcome.kind === 'saved-under-new-title')
            && recallOpenFile(key) == null
          ) {
            const target = await createBrowserTargetStore().load(key);
            if (target?.file) rememberOpenFile(key, target.file);
          }
          return outcome;
        } catch {
          dispatch({ type: 'toast', message: '儲存失敗，稿子仍留在這支裝置' });
          return null;
        }
      },
      saveProjectAs: async () => {
        const project = state.projects.find((item) => item.id === state.activeProjectId);
        if (!project) return null;
        const ready = preparedShare.get(project.id) ?? null;
        preparedShare.delete(project.id);
        try {
          if (ready && !canPickLocalFiles()) {
            dispatch({
              type: 'promote-stored',
              projectId: project.id,
              key: ready.key,
              filename: project.filename || projectSaveFilename(project.title, project.filename),
            });
            const outcome = await handOffPrepared(browserSaveEnv(), ready.filename, ready.bytes);
            applySaveOutcome(dispatch, project.id, outcome, 'save-as');
            return outcome;
          }
          const { key, bytes } = await snapshotManuscript(state, project);
          dispatch({
            type: 'promote-stored',
            projectId: project.id,
            key,
            filename: projectSaveFilename(project.title, project.filename),
          });
          const outcome = await saveProjectAsNew(browserSaveEnv(), key, bytes, exportDbFilename(project.title));
          applySaveOutcome(dispatch, project.id, outcome, 'save-as');
          if (outcome.kind === 'saved-as') {
            const target = await createBrowserTargetStore().load(key);
            if (target?.file) rememberOpenFile(key, target.file);
          }
          return outcome;
        } catch {
          dispatch({ type: 'toast', message: '另存失敗，稿子仍留在這支裝置' });
          return null;
        }
      },
      toast: (message) => dispatch({ type: 'toast', message }),
    }),
    [state],
  );

  const achievementCount = countAchievements(state.schedule.settled);
  const isGlowing = glowing(state.schedule);
  const stats = summarizeStats(state.schedule, state.logs, achievementCount);
  const bookWords = useCallback(
    (projectId: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return 0;
      return collectContents(project.nodes).reduce(
        (sum, text) => sum + (project.origin === 'file' ? countManuscriptWords(text) : countWords(text)),
        0,
      );
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
