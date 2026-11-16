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
  createSchedule,
  glowing,
  withClock,
  writingDayKey,
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
import {
  currentShareGeneration,
  dismissRenameSavePrompt,
  peekPreparedShare,
  rememberPreparedShare,
  shareBytesForSaveAs,
} from '../db/preparedShare';
import { openMemoryDb } from '../db/wasmDb';
import {
  saveNotice,
  saveProjectAsNew,
  saveProjectFromClick,
  shouldPickBeforeBuild,
  type SaveEnvironment,
  type SaveOutcome,
} from '../db/saveProject';
import { verifyExportedDatabase } from '../db/verifyDatabase';
import {
  BOOK_RENAME_FAIL,
  BOOK_RENAMED_TOAST,
  IMPORT_DEFAULT_CHAPTER_TITLE,
  IMPORT_PREFACE_TITLE,
  SAVE_FATAL_FAIL,
  STASH_FAIL,
  STORED_ON_PHONE_LABEL,
  TOAST_NEW_BOOK,
} from '../copy/userFacing';
import {
  decodeTextBytes,
  importTitleFromFilename,
  normalizeNewlines,
  splitChaptersInBatches,
  type SplitChapter,
  type StrictDecoderFactory,
} from '../domain/textImport';
import {
  IMPORT_EVENTS_KEY,
  countImportEvents,
  emptyImportEvents,
  importCountOf,
  importOnlyDays,
  projectImportEvents,
  readImportEvents,
  updateImportEvents,
  withAdoptedFile,
  withFileLink,
  withImportEvent,
  writeImportEvents,
  type ImportEventRecord,
  type ProjectImportEvents,
} from './importEvents';
import { countBookWords } from '../domain/wordCount';
import { startedMsFromProjectId } from '../domain/staleSaveReminder';
import { type FileCard, type FileLog, type FileProjectInfo } from '../db/projectFile';
import {
  importBook,
  loadStoredBooks,
  saveBookBytes,
  shareDatabase,
  writeBookBytes,
  type ImportedBook,
} from '../db/library';
import { assertTransferDataWritable, type TransferRead } from '../db/transferMeta';
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
  findNode,
  updateNode,
  type ChapterNode,
  type DemoProject,
} from '../data/demo';
import { DEFAULT_PROJECT_CATEGORY_ORDER_RAW } from '../data/demoCards';
import { isBuiltinSampleBook } from '../domain/builtinSampleBook';
import { navMemoryKey, readNavMemory } from './navMemory';
import { dropUntouchedSamples } from './sampleCleanup';
import { bookArchive, type ArchiveClient } from '../db/chapterArchive';
import {
  archiveCardDeletion,
  archiveCardRestore,
  deletedFromCard,
  placeRecoveredCard,
  type DeletedCardRecord,
} from '../domain/cardArchive';
import { isHiddenCategory, resolveVisibleCategories } from '../domain/cardCategories';
import {
  deleteCard as deleteCardFromList,
  updateCard as updateCardInList,
  type UpdateCardPatch,
} from '../domain/cardOps';
import { newChapterId, shapeAfterEdit } from '../domain/openManuscript';
import {
  addSceneUnderChapter,
  createScene,
  loadProjects,
  normalizeLoadedProject,
  saveProjects,
  type KeyValueStore,
} from '../domain/outline';
import {
  fingerprintBytes,
  loadDeviceSaveRecord,
  recallExportedFile,
  rememberExportedFile,
  saveDeviceSaveRecord,
} from './deviceSaveRecord';

export interface SampleState {
  projects: DemoProject[];
  recentIds: string[];
  schedule: GoalSchedule;
  demoSchedule: GoalSchedule;
  goalById: Record<string, GoalSchedule>;
  activeProjectId: string | null;
  logs: WritingLogRow[];
  demoLogs: WritingLogRow[];
  /** WO-69：新開稿子（還沒升格成檔案）各自的寫作紀錄；每日目標結算狀態放在 goalById。 */
  logsById: Record<string, WritingLogRow[]>;
  toast: string | null;
  /** 匯入檔的卡片與寫作紀錄，另存時原樣帶出。 */
  fileExtras: Record<string, FileExtras>;
  saveMeta: Record<
    string,
    {
      lastAutoSaveMs: number | null;
      lastManualSaveMs: number | null;
      lastExportMs: number | null;
      lastProjectSaveMs: number | null;
    }
  >;
  /** WO-98：各稿在這台裝置的建立（或第一次遇到）時間，只存本機，不寫進 .db。 */
  startedById: Record<string, number>;
  /**
   * WO-99：TXT 匯入事件的本機紀錄（與瀏覽器本機儲存同步）。
   * WO-100：只是新匯入稿存檔前的暫存與舊檔遷移來源；檔內事件放在 fileExtras[...].transfer，
   * 畫面次數一律用 projectImportEventsOf（兩者以事件代號取聯集）。
   */
  importEvents: ImportEventRecord;
}

/** 開檔帶進來、存檔時原樣帶出的檔案額外資訊。 */
export interface FileExtras {
  info: FileProjectInfo;
  cards: FileCard[];
  logs: FileLog[];
  /** WO-100：開檔時讀到的檔內附加資料（匯入事件）。沒有代表不是從檔案讀來的（例如剛升格的新稿）。 */
  transfer?: TransferRead;
}

export type Action =
  | { type: 'dismiss-recent'; id: string }
  | { type: 'add-project'; id: string; title: string; shape: 'novel' | 'single'; startedMs?: number }
  | { type: 'note-started'; startedById: Record<string, number> }
  | { type: 'import-text'; project: DemoProject; dayKey: string; startedMs: number; importEvents: ImportEventRecord }
  | { type: 'set-import-events'; importEvents: ImportEventRecord }
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
      extras: FileExtras;
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
  | { type: 'promote-stored'; projectId: string; key: string; filename: string }
  | { type: 'set-cards'; projectId: string; cards: FileCard[] }
  | { type: 'update-card'; projectId: string; cardId: string; patch: UpdateCardPatch }
  | {
      type: 'set-card-categories';
      projectId: string;
      categoryOrder?: string | null;
      expandedCategories?: string | null;
      categoriesMeta?: string;
      cards?: FileCard[];
    }
  | { type: 'delete-card'; projectId: string; cardId: string }
  | {
      type: 'restore-deleted-card';
      projectId: string;
      record: DeletedCardRecord;
      atEnd?: boolean;
      /**
       * WO-65（WO-53 之後改）：呼叫端已用 reducer 算好的結果。只有在當時的卡片清單
       * （basis）與現在仍是同一份時才直接套用，不再重算；清單已變就由 reducer 依最新狀態計算。
       */
      placed?: { basis: readonly FileCard[]; cards: FileCard[] };
    };


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

function savedProjects(store: KeyValueStore | null): DemoProject[] | null {
  if (!store) return null;
  try {
    return loadProjects(store);
  } catch {
    return null;
  }
}

/** WO-77：這台裝置的瀏覽器本機儲存；私人瀏覽或測試環境沒有時回傳 null。 */
function deviceStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * WO-65（WO-53 之後改）：範例書每次初始化都深層複製一份，章節樹、卡片與欄位彼此不共用，
 * 改其中一份 store 不會動到範例常數、其他書或其他 store。
 * WO-95：App 啟動不再放範例書；這裡只留給測試建立範例情境用。
 */
export function cloneDemoProject(project: DemoProject): DemoProject {
  return structuredClone(project);
}

/** WO-95：沒有任何稿子時的寫作狀態。每日目標與一天結束時刻沿用原本的預設值，字數、結算、紀錄都從 0 開始。 */
function blankSchedule(now: Date): GoalSchedule {
  return withClock(createSchedule({ dayEndHour: 0, defaultGoal: 1000 }), now);
}

/** WO-95：讀位置記憶裡這份稿子有沒有尚未完成的卡片草稿；讀不到時當作有（保守留稿）。 */
function hasPendingCardDrafts(store: KeyValueStore, projectId: string): boolean {
  try {
    // 先直接讀一次：本機儲存讀不到（丟錯）時無法確定，當作有草稿。
    store.getItem(navMemoryKey(projectId));
    return Object.keys(readNavMemory(projectId, store).drafts).length > 0;
  } catch {
    return true;
  }
}

/**
 * WO-95：舊裝置上沒改過的內建範例書清掉並寫回本機；改過、有草稿或拿不準的留著。
 * 沒有拿掉任何一份時不寫入，也不動草稿與位置記憶。
 */
function cleanUpSamples(
  store: KeyValueStore | null,
  projects: DemoProject[],
  record: ReturnType<typeof loadDeviceSaveRecord>,
): DemoProject[] {
  if (!store || projects.length === 0) return projects;
  let liveDraft: ReturnType<typeof loadLiveDraft> = null;
  try {
    liveDraft = loadLiveDraft(store);
  } catch {
    // 讀不到草稿時不清任何範例。
    return projects;
  }
  const { kept, removedIds } = dropUntouchedSamples(projects, {
    liveDraft,
    hasCardDrafts: (id) => hasPendingCardDrafts(store, id),
    record,
  });
  if (removedIds.length === 0) return projects;
  try {
    saveProjects(store, kept.filter((project) => project.origin !== 'file'));
  } catch {
    // 寫不進去時這次畫面仍不顯示，下次開啟會再判斷一次（結果相同）。
  }
  return kept;
}

export function createState(now: Date): SampleState {
  const schedule = blankSchedule(now);
  const store = deviceStore();
  // WO-77：讀回這台裝置留下的存檔時間，以及新稿子自己的今天字數與寫作紀錄。
  const record = loadDeviceSaveRecord(store, now);
  // WO-95：沒有存過稿子就是空的，不再放範例書。
  const loaded = (savedProjects(store) ?? []).map((project) =>
    normalizeLoadedProject({
      ...project,
      origin: project.origin ?? 'demo',
    }),
  );
  const projects = cleanUpSamples(store, loaded, record);
  return {
    projects,
    recentIds: projects.map((project) => project.id),
    schedule,
    demoSchedule: schedule,
    goalById: record.goalById,
    activeProjectId: null,
    logs: [],
    demoLogs: [],
    logsById: record.logsById,
    toast: null,
    fileExtras: {},
    saveMeta: record.saveMeta,
    startedById: record.startedById,
    importEvents: readImportEvents(store),
  };
}

/**
 * WO-77：把存檔時間與新稿子的寫作紀錄留在這台裝置（不寫進 .db）。
 * 寫作紀錄只留還沒升格成檔案、也不是內建範例書的稿子。
 */
export function persistDeviceSaveRecord(store: KeyValueStore, state: SampleState): void {
  saveDeviceSaveRecord(store, {
    saveMeta: state.saveMeta,
    startedById: state.startedById,
    logsById: state.logsById,
    goalById: state.goalById,
    draftIds: state.projects
      .filter((project) => project.origin !== 'file' && !isSampleBook(project))
      .map((project) => project.id),
  });
}

/**
 * WO-99：存成 .db 成功後，把這份稿子的匯入事件對應到寫出去那份檔的內容指紋。
 * 沒有匯入事件的稿子不記。回傳更新後的紀錄；沒變或做不到時回傳 null。
 */
export async function linkImportEventsToBytes(
  store: KeyValueStore,
  projectId: string,
  bytes: Uint8Array,
): Promise<ImportEventRecord | null> {
  if (importCountOf(readImportEvents(store), projectId) === 0) return null;
  const fingerprint = await fingerprintBytes(bytes);
  if (!fingerprint) return null;
  return updateImportEvents(store, (record) => withFileLink(record, projectId, fingerprint));
}

/** WO-99：開回 .db 時，內容指紋對得上就把同一批匯入事件接到新開的稿子（同一事件不重複算）。 */
export async function adoptImportEventsFromBytes(
  store: KeyValueStore,
  bytes: Uint8Array,
  projectId: string,
): Promise<ImportEventRecord | null> {
  return adoptImportEventsByFingerprint(store, await fingerprintBytes(bytes), projectId);
}

/** WO-77：另存成功後，記下交出去的那份檔案指紋，開回同一份檔時對得上另存時間。 */
export async function noteExportedBytes(store: KeyValueStore, bytes: Uint8Array, atMs: number): Promise<void> {
  const fingerprint = await fingerprintBytes(bytes);
  if (fingerprint) rememberExportedFile(store, fingerprint, atMs);
}

/** WO-77：開回的檔若正是這台裝置另存出去的那一份，取回當時的另存時間；內容不同就沒有。 */
export async function exportTimeOfBytes(store: KeyValueStore, bytes: Uint8Array): Promise<number | null> {
  const fingerprint = await fingerprintBytes(bytes);
  return fingerprint ? recallExportedFile(store, fingerprint) : null;
}

/**
 * WO-100：這份稿子的匯入事件集合（統計頁全書、寫作過程紀錄卡、存檔快照共用同一份）。
 * = 檔內附加表的事件 ∪ 本機紀錄裡可靠對應到這份稿子的事件，以事件代號去重。
 * 檔內附加資料損壞時不把它當 0，也不採用；只剩本機可靠對應（外部存檔會被擋下）。
 */
export function projectImportEventsOf(state: SampleState, projectId: string | null | undefined): ProjectImportEvents {
  if (!projectId) return {};
  const project = state.projects.find((item) => item.id === projectId);
  const key = project?.dbKey ?? projectId;
  const transfer = state.fileExtras[key]?.transfer;
  return projectImportEvents(state.importEvents, projectId, transfer?.kind === 'ok' ? transfer.importEvents : null);
}

/**
 * WO-100：寫作過程紀錄卡要顯示的列（新到舊）。有匯入事件、卻沒有紀錄列的寫作日補一張只供顯示的空白卡，
 * 事件不會因為檔案裡沒有那天的紀錄列就消失；補的卡不寫回檔案、不改既有紀錄列。
 */
export function displayLogRows(state: SampleState, projectId: string): WritingLogRow[] {
  const events = projectImportEventsOf(state, projectId);
  const extra = importOnlyDays(state.logs.map((log) => log.date), events).map((day, index) =>
    emptyWritingLog(-(index + 1), day),
  );
  return [...state.logs, ...extra].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * WO-100：開檔時，先用「使用者選入的原始位元組」的指紋查本機 byFile，把同一批事件接到新開的稿子。
 * 指紋必須在任何重新匯出或遷移之前算好再傳進來。
 */
export function adoptImportEventsByFingerprint(
  store: KeyValueStore,
  fingerprint: string | null,
  projectId: string,
): ImportEventRecord | null {
  if (!fingerprint || !readImportEvents(store).byFile[fingerprint]) return null;
  return updateImportEvents(store, (record) => withAdoptedFile(record, fingerprint, projectId));
}

/** 開檔與重整共用：把讀好的檔案變成 attach-file 動作。 */
export function attachActionForBook(
  book: ImportedBook,
  options: { updatedLabel: string; nodes?: ChapterNode[]; quiet?: boolean },
): Action {
  return {
    type: 'attach-file',
    ...(options.quiet ? { quiet: true } : {}),
    project: {
      id: book.key,
      title: book.title,
      updatedLabel: options.updatedLabel,
      bookGoal: book.info.targetWordCount,
      nodes: options.nodes ?? book.tree,
      origin: 'file',
      dbKey: book.key,
      filename: book.filename,
      hasExternalFile: book.hasExternalFile,
      titleInFile: book.titleInFile,
      titleSavePending: book.titleSavePending,
    },
    schedule: book.schedule,
    extras: { info: book.info, cards: book.cards, logs: book.logs, transfer: book.transfer },
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
        ...(Object.prototype.propertyIsEnumerable.call(extra.info, 'dailyTargetWordCount')
          ? { dailyTargetWordCount: open.goals.at(-1)?.goal ?? extra.info.dailyTargetWordCount }
          : {}),
        ...(Object.prototype.propertyIsEnumerable.call(extra.info, 'targetWordCount')
          ? { targetWordCount: project.bookGoal }
          : {}),
      },
      logs,
    },
  };
}

/**
 * WO-69：內建範例書（【範例】霧港紀事等）共用範例寫作紀錄；其他稿子各有自己的紀錄。
 * WO-95：只剩舊裝置上改過而留下的範例書會走這裡；共用紀錄從 0 開始，不再帶固定範例數字。
 */
function isSampleBook(project: DemoProject): boolean {
  return isBuiltinSampleBook(project);
}

/** WO-69：新稿子的空白寫作狀態。每日目標與一天結束時刻沿用目前設定，紀錄與達成次數從 0 開始。 */
function freshSchedule(state: SampleState, now: Date): GoalSchedule {
  const goal = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  return withClock(createSchedule({ dayEndHour: state.schedule.dayEndHour, defaultGoal: goal }), now);
}

/** WO-69：目前 state.schedule／state.logs 代表的是不是這份稿子。沒有開著的稿子時代表範例書（WO-95：沒有範例書時就是空白狀態）。 */
function isCurrentTracking(state: SampleState, project: DemoProject): boolean {
  return state.activeProjectId ? state.activeProjectId === project.id : isSampleBook(project);
}

/** WO-69：讀出某份稿子自己的每日目標結算狀態與寫作紀錄，不借用其他稿子的。 */
function trackingOf(
  state: SampleState,
  project: DemoProject,
  now: Date,
): { schedule: GoalSchedule; logs: WritingLogRow[] } {
  if (isCurrentTracking(state, project)) return { schedule: state.schedule, logs: state.logs };
  if (project.origin === 'file') {
    const extra = state.fileExtras[project.dbKey ?? ''];
    return {
      schedule: state.goalById[project.id] ?? state.schedule,
      logs: extra ? fileLogsToRows(extra.logs) : state.logs,
    };
  }
  if (isSampleBook(project)) return { schedule: state.demoSchedule, logs: state.demoLogs };
  return {
    schedule: state.goalById[project.id] ?? freshSchedule(state, now),
    logs: state.logsById[project.id] ?? [],
  };
}

/** WO-69：把某份稿子的結算狀態與紀錄寫回它自己的位置；是目前那份才一併更新畫面用的 schedule／logs。 */
function storeTracking(
  state: SampleState,
  project: DemoProject,
  schedule: GoalSchedule,
  logs: WritingLogRow[],
): SampleState {
  const current = isCurrentTracking(state, project);
  let next: SampleState = current ? { ...state, schedule, logs } : state;
  if (project.origin === 'file') {
    next = { ...next, goalById: { ...next.goalById, [project.id]: schedule } };
  } else if (isSampleBook(project)) {
    next = { ...next, demoSchedule: schedule, demoLogs: logs };
  } else {
    next = {
      ...next,
      goalById: { ...next.goalById, [project.id]: schedule },
      logsById: { ...next.logsById, [project.id]: logs },
    };
  }
  return next;
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
  // WO-69：新開稿子的目標與結算狀態只存在自己那份，不寫進範例書。
  if (active && !isSampleBook(active)) {
    return { ...state, schedule, goalById: { ...state.goalById, [active.id]: schedule } };
  }
  return { ...state, schedule, demoSchedule: schedule };
}

/** WO-69：更新目前這份稿子的寫作紀錄，同時寫回它自己的位置。 */
function keepLogs(state: SampleState, logs: WritingLogRow[]): SampleState {
  const active = state.projects.find((project) => project.id === state.activeProjectId);
  if (active?.origin === 'file') return { ...state, logs };
  if (active && !isSampleBook(active)) {
    return { ...state, logs, logsById: { ...state.logsById, [active.id]: logs } };
  }
  return { ...state, logs, demoLogs: logs };
}

function toFileLogs(logs: readonly WritingLogRow[]): FileLog[] {
  return logs.map((log) => ({
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
}

export function getProjectCards(state: SampleState, projectId: string): FileCard[] {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return [];
  if (project.origin === 'file') {
    const key = project.dbKey ?? project.id;
    const extra = state.fileExtras[key];
    if (extra) return extra.cards;
  }
  return project.cards ?? [];
}

export function getProjectCategorySettings(
  state: SampleState,
  projectId: string,
): {
  categoryOrder: string | null;
  expandedCategories: string | null;
  categoriesMeta: string;
} {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      categoryOrder: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
      expandedCategories: null,
      categoriesMeta: '{}',
    };
  }
  if (project.origin === 'file') {
    const key = project.dbKey ?? project.id;
    const extra = state.fileExtras[key];
    if (extra) {
      return {
        categoryOrder: extra.info.categoryOrder,
        expandedCategories: extra.info.expandedCategories,
        categoriesMeta: extra.info.categoriesMeta ?? '{}',
      };
    }
  }
  return {
    categoryOrder:
      project.categoryOrderRaw !== undefined
        ? project.categoryOrderRaw
        : DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
    expandedCategories:
      project.expandedCategoriesRaw !== undefined ? project.expandedCategoriesRaw : null,
    categoriesMeta: project.categoriesMetaRaw ?? '{}',
  };
}

function mergeCardsPreservingAiChat(
  existingCards: readonly FileCard[],
  nextCards: readonly FileCard[],
): FileCard[] {
  const nextIds = new Set(nextCards.map((c) => c.id));
  const missingAiChatCards = existingCards.filter(
    (c) => isHiddenCategory(c.category) && !nextIds.has(c.id),
  );
  if (missingAiChatCards.length === 0) {
    return [...nextCards];
  }
  return [...nextCards, ...missingAiChatCards];
}

function applyProjectCards(
  state: SampleState,
  projectId: string,
  nextCardsResolver: (currentCards: readonly FileCard[], project: DemoProject) => FileCard[],
): SampleState {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return state;
  const currentCards = getProjectCards(state, projectId);
  const resolved = nextCardsResolver(currentCards, project);
  const merged = mergeCardsPreservingAiChat(currentCards, resolved);

  const key = project.dbKey ?? project.id;
  const extra = state.fileExtras[key];
  const nextFileExtras = extra
    ? {
        ...state.fileExtras,
        [key]: {
          ...extra,
          cards: merged,
        },
      }
    : state.fileExtras;

  return {
    ...state,
    projects: mapProject(state.projects, projectId, (current) => ({
      ...current,
      updatedLabel: '剛剛',
      cards: merged,
    })),
    fileExtras: nextFileExtras,
  };
}

export function buildFileProjectInfo(state: SampleState, project: DemoProject): FileProjectInfo {
  const key = project.dbKey ?? project.id;
  const extra =
    (project.dbKey ? state.fileExtras[project.dbKey] : undefined) ?? state.fileExtras[key];
  // WO-69：用這份稿子自己的每日目標。
  const own = trackingOf(state, project, new Date()).schedule;
  const goal = own.open?.goals.at(-1)?.goal ?? own.defaultGoal;

  if (extra?.info) {
    const src = extra.info;
    const isEnum = (propKey: keyof FileProjectInfo): boolean =>
      Object.prototype.propertyIsEnumerable.call(src, propKey);

    const info: FileProjectInfo = { ...src };

    if (isEnum('title') || project.title !== (src.title ?? '未命名稿子')) {
      info.title = project.title;
    }
    if (isEnum('targetWordCount') || project.bookGoal !== (src.targetWordCount ?? 100000)) {
      info.targetWordCount = project.bookGoal;
    }
    if (isEnum('dailyTargetWordCount') || goal !== (src.dailyTargetWordCount ?? 1000)) {
      info.dailyTargetWordCount = goal;
    }
    if (project.categoryOrderRaw !== undefined && project.categoryOrderRaw !== src.categoryOrder) {
      info.categoryOrder = project.categoryOrderRaw;
    }
    if (
      project.expandedCategoriesRaw !== undefined &&
      project.expandedCategoriesRaw !== src.expandedCategories
    ) {
      info.expandedCategories = project.expandedCategoriesRaw;
    }
    if (
      isEnum('categoriesMeta') ||
      (project.categoriesMetaRaw !== undefined &&
        project.categoriesMetaRaw !== (src.categoriesMeta ?? '{}'))
    ) {
      info.categoriesMeta = project.categoriesMetaRaw ?? src.categoriesMeta ?? '{}';
    }
    if (project.lastOpenedNodeId !== undefined && project.lastOpenedNodeId !== src.lastOpenedNodeId) {
      info.lastOpenedNodeId = project.lastOpenedNodeId ?? null;
    }
    if (
      isEnum('lastCursorPosition') ||
      (project.lastCursor !== undefined && project.lastCursor !== (src.lastCursorPosition ?? 0))
    ) {
      info.lastCursorPosition = src.lastCursorPosition ?? project.lastCursor ?? 0;
    }
    return info;
  }

  return {
    title: project.title,
    logline: '',
    currentTheme: '',
    globalFontFamily: '',
    globalFontSize: 12,
    editorFontFamily: '',
    editorFontSize: 16,
    targetWordCount: project.bookGoal,
    dailyTargetWordCount: goal,
    categoryOrder: project.categoryOrderRaw !== undefined ? project.categoryOrderRaw : null,
    expandedCategories:
      project.expandedCategoriesRaw !== undefined ? project.expandedCategoriesRaw : null,
    categoriesMeta: project.categoriesMetaRaw ?? '{}',
    lastOpenedNodeId: project.lastOpenedNodeId ?? null,
    lastCursorPosition: project.lastCursor ?? 0,
  };
}

export async function deleteProjectCardWithArchive(
  state: SampleState,
  dispatch: (action: Action) => void,
  projectId: string,
  cardId: string,
  options?: {
    deletedAt?: number;
    recordId?: string;
    archive?: ArchiveClient;
  },
): Promise<DeletedCardRecord | null> {
  const cards = getProjectCards(state, projectId);
  const deletedAt = options?.deletedAt ?? Date.now();
  const recordId = options?.recordId ?? `del-card-${deletedAt}-${cardId}`;
  const record = deletedFromCard(cards, cardId, deletedAt, recordId);
  if (!record) return null;

  dispatch({ type: 'delete-card', projectId, cardId });
  const archive = options?.archive ?? bookArchive;
  await archive.update(projectId, (current) => archiveCardDeletion(current, record), 'delete');
  return record;
}

export async function restoreProjectCardFromArchive(
  state: SampleState,
  dispatch: (action: Action) => void,
  projectId: string,
  recordOrId: DeletedCardRecord | string,
  options?: {
    atEnd?: boolean;
    archive?: ArchiveClient;
  },
): Promise<FileCard[] | null> {
  const archive = options?.archive ?? bookArchive;
  let record: DeletedCardRecord | undefined;
  if (typeof recordOrId === 'string') {
    const bookData = await archive.read(projectId);
    record = (bookData.deletedCards ?? []).find(
      (item) => item.id === recordOrId || item.rootCardId === recordOrId,
    );
  } else {
    record = recordOrId;
  }
  if (!record) return null;

  // WO-65（WO-53 之後改）：放回位置只由 reducer 計算一次；這裡把算好的結果連同當時的卡片清單一起交出去，
  // reducer 看到清單沒變就直接套用，不再重算。
  const atEnd = options?.atEnd ?? false;
  const basis = getProjectCards(state, projectId);
  const nextCards = getProjectCards(
    reduce(state, { type: 'restore-deleted-card', projectId, record, atEnd }),
    projectId,
  );
  dispatch({
    type: 'restore-deleted-card',
    projectId,
    record,
    atEnd,
    placed: { basis, cards: nextCards },
  });
  await archive.update(projectId, (current) => archiveCardRestore(current, record.id), 'restore');
  return nextCards;
}

export function buildPromotedFileExtras(
  state: SampleState,
  project: DemoProject,
  key: string,
): FileExtras {
  const existing =
    state.fileExtras[key] ??
    (project.dbKey ? state.fileExtras[project.dbKey] : undefined) ??
    state.fileExtras[project.id];
  if (existing) return existing;

  // WO-69：升格成檔案時只帶這份稿子自己的目標與寫作紀錄。
  const own = trackingOf(state, project, new Date());
  const goal = own.schedule.open?.goals.at(-1)?.goal ?? own.schedule.defaultGoal;
  return {
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
      categoryOrder: project.categoryOrderRaw !== undefined ? project.categoryOrderRaw : null,
      expandedCategories:
        project.expandedCategoriesRaw !== undefined ? project.expandedCategoriesRaw : null,
      categoriesMeta: project.categoriesMetaRaw ?? '{}',
      lastOpenedNodeId: project.lastOpenedNodeId ?? null,
      lastCursorPosition: project.lastCursor ?? 0,
    },
    cards: project.cards
      ? project.cards.map((card) => ({
          ...card,
          ...(card.extraColumns ? { extraColumns: { ...card.extraColumns } } : {}),
        }))
      : [],
    logs: toFileLogs(own.logs),
  };
}

export function reduce(state: SampleState, action: Action): SampleState {
  const now = new Date();
  switch (action.type) {
    case 'toast':
      if (action.message === state.toast) return state;
      return { ...state, toast: action.message };
    case 'record-auto-save':
      return patchSaveMeta(state, action.projectId, { lastAutoSaveMs: action.atMs });
    case 'record-manual-save':
      return patchSaveMeta(state, action.projectId, { lastManualSaveMs: action.atMs });
    case 'record-export':
      return patchSaveMeta(state, action.projectId, { lastExportMs: action.atMs });
    case 'note-started': {
      // 已有起算時間就不重設；只補還沒有的。
      const missing = Object.entries(action.startedById).filter(([id]) => state.startedById[id] == null);
      if (missing.length === 0) return state;
      return { ...state, startedById: { ...state.startedById, ...Object.fromEntries(missing) } };
    }
    case 'record-project-save':
      return patchSaveMeta(state, action.projectId, { lastProjectSaveMs: action.atMs });
    case 'import-text': {
      // WO-99：一次加入完整新稿子、它自己的空白結算狀態、當日紀錄列與匯入事件；代號重複就不動。
      const id = action.project.id;
      if (state.projects.some((item) => item.id === id)) return state;
      return {
        ...state,
        projects: [action.project, ...state.projects],
        recentIds: [id, ...state.recentIds.filter((item) => item !== id)],
        goalById: { ...state.goalById, [id]: freshSchedule(state, now) },
        logsById: { ...state.logsById, [id]: [emptyWritingLog(1, action.dayKey)] },
        startedById: { ...state.startedById, [id]: action.startedMs },
        importEvents: action.importEvents,
        toast: TOAST_NEW_BOOK,
      };
    }
    case 'set-import-events':
      return action.importEvents === state.importEvents ? state : { ...state, importEvents: action.importEvents };
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
      const extras = buildPromotedFileExtras(state, project, key);
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (current) => ({
          ...current,
          origin: 'file',
          dbKey: key,
          filename: current.filename || action.filename,
        })),
        fileExtras: { ...state.fileExtras, [key]: extras },
        goalById: {
          ...state.goalById,
          [project.id]: state.goalById[project.id] ?? trackingOf(state, project, now).schedule,
        },
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
        lastOpenedNodeId: chapterId,
        lastCursor: 0,
        cards: [],
        categoryOrderRaw: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
        expandedCategoriesRaw: null,
        categoriesMetaRaw: '{}',
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
        // WO-69：新稿子有自己的空白寫作紀錄與結算狀態，不借範例書的。
        goalById: { ...state.goalById, [action.id]: freshSchedule(state, now) },
        logsById: { ...state.logsById, [action.id]: [] },
        startedById: { ...state.startedById, [action.id]: action.startedMs ?? now.getTime() },
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
            expanded: node.expanded === false,
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
    case 'set-book-goal': {
      const targetProject = state.projects.find((item) => item.id === action.projectId);
      const key = targetProject?.dbKey ?? targetProject?.id;
      const extra = key ? state.fileExtras[key] : undefined;
      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          bookGoal: action.bookGoal,
        })),
        fileExtras:
          key && extra
            ? {
                ...state.fileExtras,
                [key]: {
                  ...extra,
                  info: { ...extra.info, targetWordCount: action.bookGoal },
                },
              }
            : state.fileExtras,
        toast: '已更新全書目標',
      };
    }
    case 'commit-text': {
      const project = state.projects.find((item) => item.id === action.projectId);
      const node = project ? findNode(project.nodes, action.nodeId) : null;
      if (!project || !node || (node.content ?? '') === action.text) return state;
      // WO-76：不分來源，一律用同一套算法比較改前與改後的整章字數。
      const deltaWords = classifyTextDelta(node.content ?? '', action.text, { source: 'unknown' }).wordDelta;
      // WO-69：字數只記進被改的那份稿子自己的紀錄，不記到其他稿子或範例書。
      const own = trackingOf(state, project, now);
      const schedule = applyWordDelta(own.schedule, deltaWords, now);
      const next = storeTracking(state, project, schedule, alignToday(own.logs, schedule));
      const projects = mapProject(next.projects, action.projectId, (current) => ({
        ...current,
        updatedLabel: '剛剛',
        nodes: updateNode(current.nodes, action.nodeId, (item) => ({ ...item, content: action.text })),
      }));
      const extras = syncFileLog(next.fileExtras, project, schedule, action.nodeId);
      return {
        ...next,
        projects,
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
      return { ...keepLogs(state, logs), fileExtras: bumpFileLog(state, dayKey, (log) => applyLargeToFile(log, action.delta)) };
    }
    case 'add-duration': {
      if (!state.schedule.open || action.seconds <= 0) return state;
      const dayKey = state.schedule.open.dayKey;
      const logs = alignToday(state.logs, state.schedule).map((log) =>
        log.date === dayKey ? withAddedDuration(log, action.seconds) : log,
      );
      return {
        ...keepLogs(state, logs),
        fileExtras: bumpFileLog(state, dayKey, (log) => ({ ...log, duration: log.duration + action.seconds })),
      };
    }
    case 'set-goal': {
      const nextState = keepSchedule(state, changeGoal(state.schedule, action.goal, now));
      const active = nextState.projects.find((item) => item.id === nextState.activeProjectId);
      const key = active?.dbKey ?? active?.id;
      const extra = active?.origin === 'file' && key ? nextState.fileExtras[key] : undefined;
      return {
        ...nextState,
        fileExtras:
          key && extra
            ? {
                ...nextState.fileExtras,
                [key]: {
                  ...extra,
                  info: { ...extra.info, dailyTargetWordCount: action.goal },
                },
              }
            : nextState.fileExtras,
        toast: '已更新今日目標',
      };
    }
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
      // WO-69：範例書讀範例紀錄；新開稿子讀自己的紀錄（沒有就從 0 開始）。
      const own = isSampleBook(project)
        ? { schedule: state.demoSchedule, logs: state.demoLogs }
        : {
            schedule: state.goalById[project.id] ?? freshSchedule(state, now),
            logs: state.logsById[project.id] ?? [],
          };
      return {
        ...state,
        activeProjectId: project.id,
        schedule: own.schedule,
        logs: own.logs,
        goalById: isSampleBook(project) ? state.goalById : { ...state.goalById, [project.id]: own.schedule },
        logsById: isSampleBook(project) ? state.logsById : { ...state.logsById, [project.id]: own.logs },
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
      const cardsCopy = action.extras.cards.map((card) => ({
        ...card,
        ...(card.extraColumns ? { extraColumns: { ...card.extraColumns } } : {}),
      }));
      const project: DemoProject = {
        ...action.project,
        lastOpenedNodeId: action.project.lastOpenedNodeId ?? action.extras.info.lastOpenedNodeId,
        lastCursor: action.project.lastCursor ?? action.extras.info.lastCursorPosition,
        cards: cardsCopy,
        categoryOrderRaw: action.extras.info.categoryOrder,
        expandedCategoriesRaw: action.extras.info.expandedCategories,
        categoriesMetaRaw: action.extras.info.categoriesMeta,
      };
      const projects = [project, ...state.projects.filter((item) => item.id !== project.id)];
      return {
        ...state,
        projects,
        recentIds: [action.project.id, ...state.recentIds.filter((id) => id !== action.project.id)],
        goalById: { ...state.goalById, [action.project.id]: action.schedule },
        fileExtras: {
          ...state.fileExtras,
          [project.dbKey ?? project.id]: {
            ...action.extras,
            cards: cardsCopy,
          },
        },
        activeProjectId: action.quiet ? state.activeProjectId : project.id,
        schedule: action.quiet ? state.schedule : action.schedule,
        logs: action.quiet ? state.logs : fileLogsToRows(action.extras.logs),
        // 開啟稿子不是匯入，不說「已匯入檔案」。
        toast: action.quiet ? state.toast : null,
      };
    }
    case 'set-cards':
      return applyProjectCards(state, action.projectId, () => action.cards);
    case 'update-card': {
      const currentCards = getProjectCards(state, action.projectId);
      const target = currentCards.find((c) => c.id === action.cardId);
      if (!target || isHiddenCategory(target.category)) return state;
      const updated = updateCardInList(currentCards, action.cardId, action.patch);
      return applyProjectCards(state, action.projectId, () => updated);
    }
    case 'set-card-categories': {
      const project = state.projects.find((item) => item.id === action.projectId);
      if (!project) return state;
      const currentCards = getProjectCards(state, action.projectId);
      const nextCards =
        action.cards !== undefined
          ? mergeCardsPreservingAiChat(currentCards, action.cards)
          : currentCards;
      const nextOrder =
        action.categoryOrder !== undefined
          ? action.categoryOrder
          : (project.categoryOrderRaw ?? null);
      const nextExpanded =
        action.expandedCategories !== undefined
          ? action.expandedCategories
          : (project.expandedCategoriesRaw ?? null);
      const nextMeta =
        action.categoriesMeta !== undefined
          ? action.categoriesMeta
          : (project.categoriesMetaRaw ?? '{}');

      const key = project.dbKey ?? project.id;
      const extra = state.fileExtras[key];
      let nextFileExtras = state.fileExtras;
      if (extra) {
        const nextInfo: FileProjectInfo = { ...extra.info };
        if (action.categoryOrder !== undefined) {
          nextInfo.categoryOrder = action.categoryOrder;
        }
        if (action.expandedCategories !== undefined) {
          nextInfo.expandedCategories = action.expandedCategories;
        }
        if (action.categoriesMeta !== undefined) {
          nextInfo.categoriesMeta = action.categoriesMeta;
        }
        nextFileExtras = {
          ...state.fileExtras,
          [key]: {
            ...extra,
            info: nextInfo,
            cards: nextCards,
          },
        };
      }

      return {
        ...state,
        projects: mapProject(state.projects, action.projectId, (current) => ({
          ...current,
          updatedLabel: '剛剛',
          cards: nextCards,
          ...(action.categoryOrder !== undefined ? { categoryOrderRaw: nextOrder } : {}),
          ...(action.expandedCategories !== undefined
            ? { expandedCategoriesRaw: nextExpanded }
            : {}),
          ...(action.categoriesMeta !== undefined ? { categoriesMetaRaw: nextMeta } : {}),
        })),
        fileExtras: nextFileExtras,
      };
    }
    case 'delete-card': {
      const currentCards = getProjectCards(state, action.projectId);
      const target = currentCards.find((c) => c.id === action.cardId);
      if (!target || isHiddenCategory(target.category)) return state;
      const remaining = deleteCardFromList(currentCards, action.cardId);
      return applyProjectCards(state, action.projectId, () => remaining);
    }
    case 'restore-deleted-card': {
      const currentCards = getProjectCards(state, action.projectId);
      if (action.placed && action.placed.basis === currentCards) {
        return applyProjectCards(state, action.projectId, () => action.placed!.cards);
      }
      const settings = getProjectCategorySettings(state, action.projectId);
      const visibleIds = resolveVisibleCategories({
        categoryOrder: settings.categoryOrder,
        categoriesMeta: settings.categoriesMeta,
        cards: currentCards,
      }).map((c) => c.id);
      const restored = placeRecoveredCard(currentCards, action.record, {
        atEnd: action.atEnd ?? false,
        validCategoryIds: visibleIds,
      });
      return applyProjectCards(state, action.projectId, () => restored);
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
  setCards: (projectId: string, cards: FileCard[]) => void;
  updateCard: (projectId: string, cardId: string, patch: UpdateCardPatch) => void;
  setCardCategories: (
    projectId: string,
    payload: {
      categoryOrder?: string | null;
      expandedCategories?: string | null;
      categoriesMeta?: string;
      cards?: FileCard[];
    },
  ) => void;
  deleteCard: (
    projectId: string,
    cardId: string,
    options?: {
      deletedAt?: number;
      recordId?: string;
      archive?: ArchiveClient;
    },
  ) => Promise<DeletedCardRecord | null>;
  restoreDeletedCard: (
    projectId: string,
    recordOrId: DeletedCardRecord | string,
    options?: {
      atEnd?: boolean;
      archive?: ArchiveClient;
    },
  ) => Promise<FileCard[] | null>;
  focusProject: (id: string) => void;
  attachImported: (payload: {
    project: DemoProject;
    schedule: GoalSchedule;
    extras: FileExtras;
  }) => void;
  importFile: (file: File, diskFile?: DiskFile | null) => Promise<{ id: string; chapterId: string | null }>;
  /** WO-99：匯入 TXT 開成新稿子。 */
  importTextFile: (file: File) => Promise<TextImportOutcome>;
  openWithPicker: () => Promise<{ id: string; chapterId: string | null } | null>;
  stashDraft: () => Promise<void>;
  renameBook: (projectId: string, rawTitle: string) => {
    ok: boolean;
    unchanged: boolean;
    askSaveAs: boolean;
    title: string;
  };
  deferTitleSave: (projectId: string) => void;
  discardPreparedShare: (projectId: string) => void;
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

/**
 * 交給外部（儲存、另存、分享／下載、預備分享）前的檢查。
 * WO-100：附加資料有破壞疑慮（損壞、衝突、不支援的修訂值）就不交出去，沿用既有存檔失敗提示。
 */
export async function verifyBytesForSave(bytes: Uint8Array): Promise<void> {
  await verifyExportedDatabase(bytes, async (payload) => {
    const db = await openMemoryDb(payload);
    try {
      assertTransferDataWritable(db.sql);
      return currentSchemaVersion(db.sql);
    } finally {
      db.close();
    }
  });
}

function browserSaveEnv(): SaveEnvironment {
  return {
    canPickFiles: canPickLocalFiles(),
    targets: createBrowserTargetStore(),
    verify: verifyBytesForSave,
    pickSaveLocation: (suggestedName, startIn) => pickSaveFile(suggestedName, startIn?.directoryHint),
    share: (filename, bytes) => shareDatabase(filename, bytes),
  };
}

/** WO-69：另存或暫存時要寫進檔案的內容。寫作紀錄只取這份稿子自己的。 */
export function manuscriptSnapshotParts(
  state: SampleState,
  project: DemoProject,
): { key: string; info: FileProjectInfo; cards: FileCard[]; logs: FileLog[]; importEvents: ProjectImportEvents } {
  const key = project.dbKey ?? project.id;
  const extra =
    (project.dbKey ? state.fileExtras[project.dbKey] : undefined) ?? state.fileExtras[key];
  const info = buildFileProjectInfo(state, project);
  // 還沒有檔案紀錄時，只寫這份稿子自己的紀錄，不借目前畫面上別份稿子的。
  const logs: FileLog[] = extra?.logs ?? toFileLogs(trackingOf(state, project, new Date()).logs);
  // WO-100：暫存、儲存、另存、分享預備都帶同一份事件集合寫進 .db。
  const importEvents = projectImportEventsOf(state, project.id);
  return { key, info, cards: extra?.cards ?? project.cards ?? [], logs, importEvents };
}

/** WO-100：在給定的底稿位元組上建出這份稿子的 .db（與 snapshotManuscript 同一套內容；測試也用）。 */
export async function manuscriptBytesOn(
  state: SampleState,
  project: DemoProject,
  base: Uint8Array | null,
): Promise<Uint8Array> {
  const { info, cards, logs, importEvents } = manuscriptSnapshotParts(state, project);
  return writeBookBytes(base, info, project.nodes, cards, logs, importEvents);
}

async function snapshotManuscript(
  state: SampleState,
  project: DemoProject,
  persist = true,
): Promise<{ key: string; bytes: Uint8Array }> {
  const { key, info, cards, logs, importEvents } = manuscriptSnapshotParts(state, project);
  const bytes = await saveBookBytes(
    key,
    projectSaveFilename(project.title, project.filename),
    project.title,
    info,
    project.nodes,
    cards,
    logs,
    bookkeepingOf(project),
    persist,
    importEvents,
  );
  return { key, bytes };
}

export function applySaveOutcome(
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

/**
 * 另存專案的主體（actions.saveProjectAs 呼叫）。
 * WO-98 返工 1：交出去之前只備好內容，不存本機副本、不升格稿子；
 * 取消或沒有成功交付時，稿子與本機儲存都維持點擊前原樣。
 * 成功（另存成功、分享／下載交付）才存本機副本並升格，結果與原本成功路徑相同。
 */
export async function runSaveProjectAs(input: {
  state: SampleState;
  project: DemoProject;
  dispatch: (action: Action) => void;
  env: SaveEnvironment;
  preparedBytes: Uint8Array | null;
  snapshot?: typeof snapshotManuscript;
}): Promise<{ snap: { key: string; bytes: Uint8Array }; bytes: Uint8Array; outcome: SaveOutcome }> {
  const { state, project, dispatch, env } = input;
  const snapshot = input.snapshot ?? snapshotManuscript;
  const snap = await snapshot(state, project, false);
  const bytes = shareBytesForSaveAs({ prepared: input.preparedBytes, latest: snap.bytes });
  const outcome = await saveProjectAsNew(env, snap.key, bytes, exportDbFilename(project.title));
  if (outcome.kind === 'saved-as' || outcome.kind === 'handed-off') {
    await snapshot(state, project, true);
    dispatch({
      type: 'promote-stored',
      projectId: project.id,
      key: snap.key,
      filename: projectSaveFilename(project.title, project.filename),
    });
  }
  applySaveOutcome(dispatch, project.id, outcome, 'save-as');
  return { snap, bytes, outcome };
}

export type TextImportOutcome =
  | { kind: 'imported'; id: string; chapterId: string }
  | { kind: 'unreadable' }
  | { kind: 'storage-failed' }
  | { kind: 'busy' };

let lastImportIdMs = 0;

/** WO-99：新稿子代號。沿用 p-（13 位毫秒）格式；同一毫秒或已有同代號時往後推，保證不撞。 */
function nextImportProjectId(state: SampleState, nowMs: number): { id: string; ms: number } {
  const taken = new Set([...state.projects.map((project) => project.id), ...state.recentIds]);
  let ms = Math.max(nowMs, lastImportIdMs + 1);
  while (taken.has(`p-${ms}`)) ms += 1;
  lastImportIdMs = ms;
  return { id: `p-${ms}`, ms };
}

/** WO-99：用分好的章建立完整新稿子（長篇形式，章都在最上層，跟開新稿子的第一章同一種節點）。 */
export function buildImportedProject(id: string, title: string, chapters: readonly SplitChapter[]): DemoProject {
  const firstId = newChapterId(id);
  const nodes: ChapterNode[] = chapters.map((chapter, index) => ({
    id: index === 0 ? firstId : `${firstId}-${index + 1}`,
    type: 'file',
    title: chapter.title,
    progress: 'Draft',
    content: chapter.content,
  }));
  return {
    id,
    title,
    updatedLabel: '剛剛',
    bookGoal: 100000,
    shape: 'novel',
    lastOpenedNodeId: firstId,
    lastCursor: 0,
    cards: [],
    categoryOrderRaw: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
    expandedCategoriesRaw: null,
    categoriesMetaRaw: '{}',
    nodes,
  };
}

function defaultYieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function defaultImportEventId(projectId: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `imp-${projectId}-${random}`;
}

/**
 * WO-99：匯入文字檔，開成新稿子。
 *
 * 讀位元組 → 解碼與檢查 → 統一換行 → 分批分章（期間讓出主執行緒）→ 建好完整新稿子 →
 * 先把匯入事件與稿子清單寫進本機（任一個寫不進去就把事件復原，不建稿、不計次）→ 一次 dispatch。
 * 處理中再按一次直接回 busy，不會重複建立。既有稿子一律不碰。
 */
export async function runTextImport(input: {
  filename: string;
  readBytes: () => Promise<Uint8Array>;
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  store: KeyValueStore | null;
  busy: { current: boolean };
  now?: () => Date;
  yieldToUi?: () => Promise<void>;
  decoder?: StrictDecoderFactory;
  newEventId?: (projectId: string) => string;
}): Promise<TextImportOutcome> {
  const { busy, store } = input;
  if (busy.current) return { kind: 'busy' };
  busy.current = true;
  const yieldToUi = input.yieldToUi ?? defaultYieldToUi;
  try {
    // 先讓「處理中」畫面有機會畫出來。
    await yieldToUi();
    let bytes: Uint8Array;
    try {
      bytes = await input.readBytes();
    } catch {
      return { kind: 'unreadable' };
    }
    const decoded = decodeTextBytes(bytes, input.decoder);
    if (!decoded.ok) return { kind: 'unreadable' };
    const text = normalizeNewlines(decoded.text);
    await yieldToUi();
    const chapters = await splitChaptersInBatches(
      text,
      { prefaceTitle: IMPORT_PREFACE_TITLE, defaultTitle: IMPORT_DEFAULT_CHAPTER_TITLE },
      yieldToUi,
    );
    if (!store) return { kind: 'storage-failed' };

    const state = input.getState();
    const at = (input.now ?? (() => new Date()))();
    const { id, ms } = nextImportProjectId(state, at.getTime());
    const project = buildImportedProject(id, importTitleFromFilename(input.filename), chapters);
    const dayKey = freshSchedule(state, at).open?.dayKey ?? writingDayKey(at, state.schedule.dayEndHour);
    const eventId = (input.newEventId ?? defaultImportEventId)(id);

    let record: ImportEventRecord;
    let previousRaw: string | null = null;
    let wroteEvents = false;
    try {
      previousRaw = store.getItem(IMPORT_EVENTS_KEY);
      record = withImportEvent(readImportEvents(store), id, eventId, { dayKey, atMs: ms });
      writeImportEvents(store, record);
      wroteEvents = true;
      saveProjects(store, [project, ...state.projects.filter((item) => item.origin !== 'file')]);
    } catch {
      if (wroteEvents) {
        try {
          store.setItem(IMPORT_EVENTS_KEY, previousRaw ?? JSON.stringify(emptyImportEvents()));
        } catch {
          // 連復原都寫不進去時，畫面上的次數仍以記憶體裡的舊紀錄為準。
        }
      }
      return { kind: 'storage-failed' };
    }

    input.dispatch({ type: 'import-text', project, dayKey, startedMs: ms, importEvents: record });
    return { kind: 'imported', id, chapterId: project.nodes[0]!.id };
  } finally {
    busy.current = false;
  }
}

export function SampleProvider({
  children,
  initialState,
}: {
  children?: ReactNode;
  /** WO-95：測試明確放入的起始狀態（例如範例書情境）；App 不傳，一律從本機儲存讀。 */
  initialState?: SampleState;
}) {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState ?? createState(new Date()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const importBusyRef = useRef(false);

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

  // WO-77：暫存／另存時間與新稿子的寫作紀錄跟著留在這台裝置，重新整理後還在。
  useEffect(() => {
    const store = deviceStore();
    if (!store) return;
    try {
      persistDeviceSaveRecord(store, state);
    } catch {
      // 私人瀏覽可能不准寫入，畫面仍可繼續用。
    }
  }, [state.saveMeta, state.startedById, state.logsById, state.goalById, state.projects]);

  // WO-98：沒有建立時間的稿子，能由新稿代號回推就回推，否則記下第一次遇到的時間；記下後不再重設。
  useEffect(() => {
    const nowMs = Date.now();
    const missing: Record<string, number> = {};
    for (const project of state.projects) {
      if (state.startedById[project.id] != null || isSampleBook(project)) continue;
      missing[project.id] = startedMsFromProjectId(project.id, nowMs) ?? nowMs;
    }
    if (Object.keys(missing).length > 0) dispatch({ type: 'note-started', startedById: missing });
  }, [state.projects, state.startedById]);

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
          dispatch(attachActionForBook(book, { updatedLabel: STORED_ON_PHONE_LABEL, nodes: tree, quiet: true }));
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
        // 沒有手機儲存空間時，其他稿子仍可寫。
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
        buildFileProjectInfo(state, project),
        project.nodes,
        extra.cards,
        extra.logs,
        bookkeepingOf(project),
        true,
        projectImportEventsOf(state, project.id),
      ).then(() => {
        dispatch({ type: 'record-auto-save', projectId: project.id, atMs: Date.now() });
      });
    const timer = window.setTimeout(() => void save(), 250);
    return () => {
      window.clearTimeout(timer);
      void save();
    };
  }, [state.projects, state.fileExtras, state.activeProjectId, state.importEvents]);

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
      // WO-77：離開前正文已寫進本機，今天字數也要同步留下，不等畫面更新（頁面可能馬上關掉）。
      const store = deviceStore();
      if (store) {
        try {
          const tracked = live
            ? reduce(current, { type: 'commit-text', projectId: live.projectId, nodeId: live.chapterId, text: live.text })
            : current;
          persistDeviceSaveRecord(store, tracked);
        } catch {
          // 寫不進去就照舊，正文已另外留下。
        }
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
        const startedMs = Date.now();
        const id = `p-${startedMs}`;
        dispatch({ type: 'add-project', id, title, shape, startedMs });
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
      setCards: (projectId, cards) => dispatch({ type: 'set-cards', projectId, cards }),
      updateCard: (projectId, cardId, patch) =>
        dispatch({ type: 'update-card', projectId, cardId, patch }),
      setCardCategories: (projectId, payload) =>
        dispatch({ type: 'set-card-categories', projectId, ...payload }),
      deleteCard: (projectId, cardId, options) =>
        deleteProjectCardWithArchive(stateRef.current, dispatch, projectId, cardId, options),
      restoreDeletedCard: (projectId, recordOrId, options) =>
        restoreProjectCardFromArchive(stateRef.current, dispatch, projectId, recordOrId, options),
      focusProject: (id) => dispatch({ type: 'focus-project', id }),
      attachImported: (payload) => dispatch({ type: 'attach-file', ...payload }),
      importFile: async (file: File, diskFile?: DiskFile | null) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const store = deviceStore();
        // WO-100：先對使用者選入的原始位元組算指紋（重新匯出後的位元組會不同，對不上本機舊對應）。
        const rawFingerprint = await fingerprintBytes(bytes).catch(() => null);
        const exportedAt = store ? await exportTimeOfBytes(store, bytes).catch(() => null) : null;
        const book = await importBook(file.name, bytes);
        // WO-99／WO-100：開回的檔若是這台裝置從匯入稿存出去的，接回同一批匯入事件（以事件代號去重，不再加一次）。
        const adopted = store ? (() => {
          try {
            return adoptImportEventsByFingerprint(store, rawFingerprint, book.key);
          } catch {
            return null;
          }
        })() : null;
        if (adopted) dispatch({ type: 'set-import-events', importEvents: adopted });
        await createBrowserTargetStore().save(book.key, { filename: book.filename, file: diskFile ?? null });
        rememberOpenFile(book.key, diskFile ?? null);
        dispatch(attachActionForBook(book, { updatedLabel: '剛剛' }));
        // WO-77：開回的正是這台裝置另存出去的那份檔，「上次另存」沿用當時時間。
        if (exportedAt != null) dispatch({ type: 'record-export', projectId: book.key, atMs: exportedAt });
        return { id: book.key, chapterId: findNode(book.tree, book.info.lastOpenedNodeId ?? '') ? book.info.lastOpenedNodeId : null };
      },
      openWithPicker: async () => {
        const picked = await pickExistingDatabase();
        if (!picked) return null;
        const copy = new Uint8Array(picked.bytes.byteLength);
        copy.set(picked.bytes);
        const store = deviceStore();
        const rawFingerprint = await fingerprintBytes(copy).catch(() => null);
        const exportedAt = store ? await exportTimeOfBytes(store, copy).catch(() => null) : null;
        const book = await importBook(picked.file.name, copy);
        const adopted = store ? (() => {
          try {
            return adoptImportEventsByFingerprint(store, rawFingerprint, book.key);
          } catch {
            return null;
          }
        })() : null;
        if (adopted) dispatch({ type: 'set-import-events', importEvents: adopted });
        await createBrowserTargetStore().save(book.key, { filename: book.filename, file: picked.file });
        rememberOpenFile(book.key, picked.file);
        dispatch(attachActionForBook(book, { updatedLabel: '剛剛' }));
        if (exportedAt != null) dispatch({ type: 'record-export', projectId: book.key, atMs: exportedAt });
        return {
          id: book.key,
          chapterId: findNode(book.tree, book.info.lastOpenedNodeId ?? '') ? book.info.lastOpenedNodeId : null,
        };
      },
      importTextFile: (file) =>
        runTextImport({
          filename: file.name,
          readBytes: async () => new Uint8Array(await file.arrayBuffer()),
          getState: () => stateRef.current,
          dispatch,
          store: deviceStore(),
          busy: importBusyRef,
        }),
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
      discardPreparedShare: (projectId) => {
        dismissRenameSavePrompt(projectId);
      },
      prepareShare: async (projectId, title) => {
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) return;
        const generation = currentShareGeneration(projectId);
        try {
          const snap = await snapshotManuscript(state, { ...project, title }, false);
          await browserSaveEnv().verify(snap.bytes);
          rememberPreparedShare(projectId, {
            key: snap.key,
            filename: exportDbFilename(title),
            bytes: snap.bytes,
          }, generation);
        } catch {
          // 準備失敗就不要留下半套檔。世代已經往前時，不要把別人的預備檔清掉。
          if (currentShareGeneration(projectId) === generation) dismissRenameSavePrompt(projectId);
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
        let builtBytes: Uint8Array | null = null;
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
              builtBytes = snap.bytes;
              return snap.bytes;
            },
          });
          applySaveOutcome(dispatch, project.id, outcome, 'save');
          const saved = outcome.kind === 'saved' || outcome.kind === 'saved-under-new-title';
          const store = deviceStore();
          if (saved && store && builtBytes) {
            // WO-99：寫出去的那份檔對上這份稿子的匯入事件，之後開回同一份檔次數不遺失、不重複。
            const linked = await linkImportEventsToBytes(store, project.id, builtBytes).catch(() => null);
            if (linked) dispatch({ type: 'set-import-events', importEvents: linked });
          }
          if (
            (outcome.kind === 'saved' || outcome.kind === 'saved-under-new-title')
            && recallOpenFile(key) == null
          ) {
            const target = await createBrowserTargetStore().load(key);
            if (target?.file) rememberOpenFile(key, target.file);
          }
          return outcome;
        } catch {
          dispatch({ type: 'toast', message: SAVE_FATAL_FAIL });
          return null;
        }
      },
      saveProjectAs: async () => {
        const project = state.projects.find((item) => item.id === state.activeProjectId);
        if (!project) return null;
        const prepared = peekPreparedShare(project.id);
        dismissRenameSavePrompt(project.id);
        try {
          const { snap, bytes, outcome } = await runSaveProjectAs({
            state,
            project,
            dispatch,
            env: browserSaveEnv(),
            preparedBytes: prepared?.bytes ?? null,
          });
          const store = deviceStore();
          if (store && (outcome.kind === 'saved-as' || outcome.kind === 'handed-off')) {
            await noteExportedBytes(store, bytes, Date.now()).catch(() => undefined);
            const linked = await linkImportEventsToBytes(store, project.id, bytes).catch(() => null);
            if (linked) dispatch({ type: 'set-import-events', importEvents: linked });
          }
          if (outcome.kind === 'saved-as') {
            const target = await createBrowserTargetStore().load(snap.key);
            if (target?.file) rememberOpenFile(snap.key, target.file);
          }
          return outcome;
        } catch {
          dispatch({ type: 'toast', message: SAVE_FATAL_FAIL });
          return null;
        }
      },
      toast: (message) => {
        if (message === stateRef.current.toast) return;
        dispatch({ type: 'toast', message });
      },
    }),
    [state],
  );

  const achievementCount = countAchievements(state.schedule.settled);
  const isGlowing = glowing(state.schedule);
  const stats = summarizeStats(
    state.schedule,
    state.logs,
    achievementCount,
    countImportEvents(projectImportEventsOf(state, state.activeProjectId)),
  );
  const bookWords = useCallback(
    (projectId: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return 0;
      return countBookWords(project.nodes);
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
