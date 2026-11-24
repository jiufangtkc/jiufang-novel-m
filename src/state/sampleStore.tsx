import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyWordDelta,
  changeDayEndHour,
  changeGoal,
  countAchievements,
  createSchedule,
  glowing,
  MIN_DAILY_GOAL,
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
import { validateJiufangDatabase } from '../db/projectFile';
import {
  recallOpenFile,
  rememberOpenFile,
  rememberOpenFileFingerprint,
} from '../db/openFileMemory';
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
  autoSaveProjectToPlace,
  saveProjectAsNew,
  saveProjectFromClick,
  shouldPickBeforeBuild,
  type AutoSaveOutcome,
  type SaveEnvironment,
  type SaveOutcome,
} from '../db/saveProject';
import { verifyExportedDatabase } from '../db/verifyDatabase';
import {
  AUTOSAVE_FAILED_TOAST,
  AUTOSAVE_RESUMED_TOAST,
  BOOK_RENAME_FAIL,
  BOOK_RENAMED_TOAST,
  IMPORT_DEFAULT_CHAPTER_TITLE,
  IMPORT_PREFACE_TITLE,
  NEW_NOVEL_CHAPTER_TITLE,
  NEW_NOVEL_SCENE_TITLE,
  NEW_NOVEL_VOLUME_TITLE,
  EDITOR_PASTE_BLOCKED_TOAST,
  OPEN_DB_FAIL,
  OPEN_DB_NEWER_VERSION,
  OPEN_DB_NOT_JIUFANG,
  OPEN_DB_STORAGE_FAIL,
  SAVE_AND_STASH_FAIL,
  SAVE_AS_LOCAL_STASH_FAIL,
  SAVE_CONFLICT_TOAST,
  SAVE_DOWNLOAD_LOCAL_STASH_FAIL,
  SAVE_FATAL_FAIL,
  SAVE_PERMISSION_DENIED,
  SAVE_PICKER_ABORTED_TOAST,
  SAVE_SHARE_LOCAL_STASH_FAIL,
  SAVE_USE_SAVE_AS_TOAST,
  STASH_AUTO_FAILED_TOAST,
  STASH_FAIL,
  STORED_ON_PHONE_LABEL,
  TOAST_NEW_BOOK,
} from '../copy/userFacing';
import {
  decodeTextBytes,
  importTitleFromFilename,
  normalizeNewlines,
  splitChaptersByExampleInBatches,
  wholeTextAsOneChapter,
  type SplitChapter,
  type StrictDecoderFactory,
} from '../domain/textImport';
import {
  IMPORT_EVENTS_KEY,
  countImportEvents,
  emptyImportEvents,
  importCountOf,
  importOnlyDays,
  mergeEventRecords,
  projectImportEvents,
  readExportEvents,
  readImportEvents,
  updateExportEvents,
  updateImportEvents,
  withAdoptedFile,
  withFileLink,
  withImportEvent,
  withoutProject,
  writeExportEvents,
  writeImportEvents,
  type ImportEventRecord,
  type ProjectImportEvents,
  type TransferEventRecord,
} from './importEvents';
import type { docxBytes } from '../domain/docxExport';
import {
  fullTextExportFilename,
  planExport,
  txtBytes,
  type ExportFormat,
  type ExportScope,
} from '../domain/fullTextExport';
import { DOCX_MIME, TXT_MIME, deliverFile, makeExportFile, type DeliveryMode, type DeliveryResult } from '../db/fileDelivery';
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
import { isBookRemoved, removedBookIds } from '../db/removedBooks';
import { deviceKeysOf, removeProjectFromDevice } from './removeFromDevice';
import type { FormatChange, FormatSnapshot, FormatSnapshotEntry } from '../editor/formatScope';
import { assertTimelineDataWritable, type TimelineRead } from '../db/timelineMeta';
import { assertTransferDataWritable, TransferDataError, type TransferRead } from '../db/transferMeta';
import {
  bindLeaveFlush,
  clearLiveDraft,
  flushLiveDraftNow,
  flushOpenDraft,
  isLiveDraftComposing,
  loadLiveDraft,
  notePersistedDraft,
  readLiveDraftFromEditor,
  type LiveDraft,
} from '../editor/liveDraft';
import {
  AUTOSAVE_INTERVAL_MS,
  applyUncommittedDraftToProject,
  hasSavedExternalFile,
  resolveAutoSaveStatus,
  shouldClearDirtyAfterSave,
  shouldRunAutoSaveTick,
  startAutoSaveScheduler,
  type AutoSaveStatus,
  type HandlePermissionState,
} from '../domain/autoSave';
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
  forgetDeleted,
  type DeletedRecord,
  type TimelineChapterLink,
} from '../domain/chapterVersions';
import {
  archiveCardDeletion,
  archiveCardRestore,
  deletedFromCard,
  placeRecoveredCard,
  type DeletedCardRecord,
} from '../domain/cardArchive';
import { isHiddenCategory, CATEGORY_TIMELINE, resolveVisibleCategories } from '../domain/cardCategories';
import {
  addCard as addCardToList,
  deleteCard as deleteCardFromList,
  updateCard as updateCardInList,
  type AddCardInput,
  type UpdateCardPatch,
} from '../domain/cardOps';
import {
  collectAliveChapterIds,
  moveTimelineCardByDelta,
  moveTimelineCardByDrop,
  moveTimelineCardToIndex,
  nextTimelineOrderForNewEvent,
  reorderTimelineByOrderedIds,
  type TimelineDropTarget,
} from '../domain/timeline';
import {
  newChapterId,
  newManuscriptFirstNodeId,
  newSceneId,
  newVolumeId,
  shapeAfterEdit,
} from '../domain/openManuscript';
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
  saveHomeDailyGoal,
  saveTourFileGoal,
  recallTourFileGoal,
  type SaveMetaEntry,
} from './deviceSaveRecord';
import { isValidBookGoal, NEW_BOOK_GOAL_DEFAULT, readNewBookGoal } from './newBookGoal';

/** WO-113：短提示停留時間。被擋的貼上提示句較長，停留約 5 秒；其他維持約 2.4 秒。 */
export const TOAST_DEFAULT_MS = 2400;
export const TOAST_PASTE_BLOCKED_MS = 5000;

/** WO-121：開檔失敗句深色背景容易漏看，也停留約 5 秒。 */
export const TOAST_OPEN_FAIL_MS = 5000;

export function toastDurationMs(message: string): number {
  if (message === EDITOR_PASTE_BLOCKED_TOAST) return TOAST_PASTE_BLOCKED_MS;
  if (message === OPEN_DB_FAIL) return TOAST_OPEN_FAIL_MS;
  if (message === OPEN_DB_NOT_JIUFANG) return TOAST_OPEN_FAIL_MS;
  if (message === OPEN_DB_NEWER_VERSION) return TOAST_OPEN_FAIL_MS;
  if (message === OPEN_DB_STORAGE_FAIL) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_PICKER_ABORTED_TOAST) return TOAST_OPEN_FAIL_MS;
  if (message === AUTOSAVE_FAILED_TOAST) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_CONFLICT_TOAST) return TOAST_OPEN_FAIL_MS;
  if (message === STASH_AUTO_FAILED_TOAST) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_AND_STASH_FAIL) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_AS_LOCAL_STASH_FAIL) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_SHARE_LOCAL_STASH_FAIL) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_DOWNLOAD_LOCAL_STASH_FAIL) return TOAST_OPEN_FAIL_MS;
  if (message === SAVE_USE_SAVE_AS_TOAST) return TOAST_OPEN_FAIL_MS;
  return TOAST_DEFAULT_MS;
}

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
  saveMeta: Record<string, SaveMetaEntry>;
  /** WO-130：各稿在本次開啟期間的實質內容修訂序號（只隨真正改動 .db 內容的操作遞增）。 */
  contentRevById?: Record<string, number>;
  /** WO-98：各稿在這個裝置的建立（或第一次遇到）時間，只存本機，不寫進 .db。 */
  startedById: Record<string, number>;
  /**
   * WO-99：TXT 匯入事件的本機紀錄（與瀏覽器本機儲存同步）。
   * WO-100：只是新匯入稿存檔前的暫存與舊檔遷移來源；檔內事件放在 fileExtras[...].transfer，
   * 畫面次數一律用 projectImportEventsOf（兩者以事件代號取聯集）。
   */
  importEvents: ImportEventRecord;
  /**
   * WO-103：匯出全文（Word／TXT）事件的本機紀錄。角色與 importEvents 相同（新稿存檔前的暫存、.db 寫不進去時的保留）；
   * 檔內事件在 fileExtras[...].transfer.exportEvents，畫面次數一律用 projectExportEventsOf（以事件代號取聯集）。
   */
  exportEvents: TransferEventRecord;
  /** WO-122：最近一次排版前的快照（只在記憶體，不寫入任何儲存、不進 .db）。沒有時為 null 或不存在。 */
  formatUndo?: FormatSnapshot | null;
}

/** 開檔帶進來、存檔時原樣帶出的檔案額外資訊。 */
export interface FileExtras {
  info: FileProjectInfo;
  cards: FileCard[];
  logs: FileLog[];
  /** WO-100：開檔時讀到的檔內附加資料（匯入事件）。沒有代表不是從檔案讀來的（例如剛升格的新稿）。 */
  transfer?: TransferRead;
  /** WO-128：開檔時讀到的時間線附加資料狀態（absent / ok / invalid）。 */
  timeline?: TimelineRead;
}

export type Action =
  | { type: 'dismiss-recent'; id: string }
  /** WO-116：這份稿子已從這個裝置刪掉（儲存層已清完），把記憶體裡所有屬於它的資料拿掉。 */
  | { type: 'remove-project'; id: string }
  | {
      type: 'add-project';
      id: string;
      title: string;
      shape: 'novel' | 'single';
      startedMs?: number;
      /** WO-109：新稿子的全書目標（由本機設定 new-book-goal 帶入）；沒給或不合法用 100,000。 */
      bookGoal?: number;
    }
  | { type: 'note-started'; startedById: Record<string, number> }
  | { type: 'import-text'; project: DemoProject; dayKey: string; startedMs: number; importEvents: ImportEventRecord }
  | { type: 'set-import-events'; importEvents: ImportEventRecord }
  | { type: 'set-export-events'; exportEvents: TransferEventRecord }
  | { type: 'remember-place'; projectId: string; nodeId: string; cursor: number }
  | { type: 'toggle'; projectId: string; nodeId: string }
  | { type: 'set-progress'; projectId: string; nodeId: string; progress: ProgressCode }
  | { type: 'commit-text'; projectId: string; nodeId: string; text: string }
  | { type: 'note-large'; delta: TextDelta }
  /** WO-122：排版。changes 是要由 store 寫入的章幕（目前開著的章幕已由寫作框同步寫入，不必再列）；snapshot 是整次排版前的快照。 */
  | { type: 'format-apply'; projectId: string; changes: FormatChange[]; snapshot: FormatSnapshot }
  /** WO-122：復原。entries 是要由 store 還原的章幕；成功後清空快照。 */
  | { type: 'format-undo'; projectId: string; entries: FormatSnapshotEntry[] }
  | { type: 'format-clear' }
  | { type: 'add-duration'; seconds: number }
  | { type: 'set-goal'; goal: number }
  /** WO-111：歡迎導覽第 1 關寫每日目標。和 set-goal 同一個目標與規則，但不改檔案欄位、不跳提示；值沒變不動。 */
  | { type: 'set-tour-goal'; goal: number }
  | { type: 'set-hour'; hour: number }
  | { type: 'set-book-goal'; projectId: string; bookGoal: number }
  | { type: 'add-scene'; projectId: string; chapterId: string; sceneId: string }
  | {
      type: 'set-nodes';
      projectId: string;
      nodes: DemoProject['nodes'];
      restoreTimelineLinks?: ReadonlyArray<TimelineChapterLink>;
    }
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
  | { type: 'clear-dirty-after-file-save'; projectId: string; clearDirty: boolean }
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
    }
  /** WO-128：新增時間線事件（頂層時間軸卡，依 nextTimelineOrderForNewEvent 排在最後）。 */
  | {
      type: 'add-timeline-event';
      projectId: string;
      input?: Omit<AddCardInput, 'category' | 'parentId'>;
    }
  /** WO-128：依指定頂層事件 id 順序重排時間線故事順序（0..M-1）。 */
  | {
      type: 'reorder-timeline';
      projectId: string;
      orderedIds: readonly string[];
    }
  /** WO-128：移動單一時間線事件（上移／下移 delta、目標索引 targetIndex、或拖曳落點 drop）。 */
  | {
      type: 'move-timeline-event';
      projectId: string;
      cardId: string;
      delta?: -1 | 1;
      targetIndex?: number;
      drop?: TimelineDropTarget;
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

/** WO-77：這個裝置的瀏覽器本機儲存；私人瀏覽或測試環境沒有時回傳 null。 */
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

/**
 * WO-95：沒有任何稿子時的寫作狀態。每日目標與一天結束時刻沿用原本的預設值，字數、結算、紀錄都從 0 開始。
 * WO-111：沒有稿子時在歡迎導覽選過每日目標（裝置紀錄的 homeGoal），重開後用它；沒有就照舊 1,000。
 */
function blankSchedule(now: Date, homeGoal?: number): GoalSchedule {
  return withClock(createSchedule({ dayEndHour: 0, defaultGoal: homeGoal ?? 1000 }), now);
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
  const store = deviceStore();
  // WO-77：讀回這個裝置留下的存檔時間，以及新稿子自己的今天字數與寫作紀錄。
  const record = loadDeviceSaveRecord(store, now);
  const schedule = blankSchedule(now, record.homeGoal);
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
    exportEvents: readExportEvents(store),
  };
}

/**
 * WO-77：把存檔時間與新稿子的寫作紀錄留在這個裝置（不寫進 .db）。
 * 寫作紀錄只留還沒升格成檔案、也不是內建範例書的稿子。
 */
export function persistDeviceSaveRecord(store: KeyValueStore, state: SampleState): void {
  // WO-116：已從這個裝置刪掉的稿子，即使拿到的是刪除前的舊狀態，也不能把它的資料寫回裝置紀錄。
  const excludeIds = removedBookIds();
  saveDeviceSaveRecord(store, {
    saveMeta: state.saveMeta,
    startedById: state.startedById,
    logsById: state.logsById,
    goalById: state.goalById,
    draftIds: state.projects
      .filter((project) => project.origin !== 'file' && !isSampleBook(project))
      .map((project) => project.id),
    excludeIds,
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

/** WO-103：存成 .db 成功後，把這份稿子的匯出事件也對應到那份檔的內容指紋（沒有匯出事件就不記）。 */
export async function linkExportEventsToBytes(
  store: KeyValueStore,
  projectId: string,
  bytes: Uint8Array,
): Promise<TransferEventRecord | null> {
  if (importCountOf(readExportEvents(store), projectId) === 0) return null;
  const fingerprint = await fingerprintBytes(bytes);
  if (!fingerprint) return null;
  return updateExportEvents(store, (record) => withFileLink(record, projectId, fingerprint));
}

/** WO-103：開回 .db 時，原始位元組指紋對得上就把同一批匯出事件接到新開的稿子。 */
export function adoptExportEventsByFingerprint(
  store: KeyValueStore,
  fingerprint: string | null,
  projectId: string,
): TransferEventRecord | null {
  if (!fingerprint || !readExportEvents(store).byFile[fingerprint]) return null;
  return updateExportEvents(store, (record) => withAdoptedFile(record, fingerprint, projectId));
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

/** WO-77：開回的檔若正是這個裝置另存出去的那一份，取回當時的另存時間；內容不同就沒有。 */
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
 * WO-103：這份稿子的匯出全文事件集合（統計頁全書、寫作過程紀錄卡、存檔快照共用同一份）。
 * = 檔內附加表的 export 事件 ∪ 本機可靠對應的匯出事件，以事件代號去重；規則與匯入完全相同。
 * 檔內 export_count 欄不加進來（NULL＝沒有歷史基數；非 NULL 無法證明是否已含這些事件，見交接）。
 */
export function projectExportEventsOf(state: SampleState, projectId: string | null | undefined): ProjectImportEvents {
  if (!projectId) return {};
  const project = state.projects.find((item) => item.id === projectId);
  const key = project?.dbKey ?? projectId;
  const transfer = state.fileExtras[key]?.transfer;
  return projectImportEvents(state.exportEvents, projectId, transfer?.kind === 'ok' ? transfer.exportEvents : null);
}

/**
 * WO-100：寫作過程紀錄卡要顯示的列（新到舊）。有匯入事件、卻沒有紀錄列的寫作日補一張只供顯示的空白卡，
 * 事件不會因為檔案裡沒有那天的紀錄列就消失；補的卡不寫回檔案、不改既有紀錄列。
 * WO-103：只有匯出事件的日子也補卡（不加字數、不加寫作時間）。
 */
export function displayLogRows(state: SampleState, projectId: string): WritingLogRow[] {
  const events = { ...projectImportEventsOf(state, projectId), ...prefixed(projectExportEventsOf(state, projectId)) };
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

/** 只用來把匯入、匯出事件放進同一個集合找日子：加前綴避免兩邊代號剛好相同時互相蓋掉。 */
function prefixed(events: ProjectImportEvents): ProjectImportEvents {
  return Object.fromEntries(Object.entries(events).map(([id, event]) => [`export:${id}`, event]));
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
    extras: {
      info: book.info,
      cards: book.cards,
      logs: book.logs,
      transfer: book.transfer,
      timeline: book.timeline,
    },
  };
}

function patchSaveMeta(
  state: SampleState,
  projectId: string,
  patch: Partial<SaveMetaEntry>,
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

function withContentRevision(state: SampleState, projectId: string): SampleState {
  const withDirty = patchSaveMeta(state, projectId, { dirtySinceFileSave: true });
  const prevRev = withDirty.contentRevById?.[projectId] ?? 0;
  return {
    ...withDirty,
    contentRevById: { ...(withDirty.contentRevById ?? {}), [projectId]: prevRev + 1 },
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
    persistBook?: (nextState: SampleState) => Promise<boolean>;
    onPersistResult?: (ok: boolean) => void;
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
  const alreadyInMemory = basis.some((c) => c.id === record.rootCardId);
  let nextState = state;
  let nextCards = basis;
  if (!alreadyInMemory) {
    const placedState = reduce(state, { type: 'restore-deleted-card', projectId, record, atEnd });
    nextCards = getProjectCards(placedState, projectId);
    dispatch({
      type: 'restore-deleted-card',
      projectId,
      record,
      atEnd,
      placed: { basis, cards: nextCards },
    });
    nextState = placedState;
  }

  let persisted = true;
  if (options?.persistBook) {
    try {
      persisted = await options.persistBook(nextState);
    } catch {
      persisted = false;
    }
  }
  options?.onPersistResult?.(persisted);
  if (persisted) {
    await archive.update(projectId, (current) => archiveCardRestore(current, record.id), 'restore');
  }
  return nextCards;
}

/**
 * WO-133 中-4(a)：還原章節或卷時，先立即寫入本機暫存，確認成功後才移除歸檔刪除紀錄。
 */
export async function restoreDeletedChapterWithArchive(input: {
  state: SampleState;
  dispatch: (action: Action) => void;
  projectId: string;
  record: DeletedRecord;
  nodes: ChapterNode[];
  archive?: ArchiveClient;
  persistBook?: (nextState: SampleState) => Promise<boolean>;
}): Promise<{ persisted: boolean }> {
  const archive = input.archive ?? bookArchive;
  const action: Action = {
    type: 'set-nodes',
    projectId: input.projectId,
    nodes: input.nodes,
    restoreTimelineLinks: input.record.unlinkedTimelineEvents,
  };
  const nextState = reduce(input.state, action);
  input.dispatch(action);

  let persisted = true;
  if (input.persistBook) {
    try {
      persisted = await input.persistBook(nextState);
    } catch {
      persisted = false;
    }
  }
  if (persisted) {
    await archive.update(
      input.projectId,
      (curr) => ({ ...curr, deleted: forgetDeleted(curr.deleted, input.record.id) }),
      'restore',
    );
  }
  return { persisted };
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

/**
 * WO-122：排版復原快照只屬於目前開著的稿子；稿子換了（或被刪掉）就清掉，不跨稿保留。
 */
const NON_TEXT_CONTENT_ACTIONS = new Set<Action['type']>([
  'set-nodes',
  'add-scene',
  'set-progress',
  'rename-book',
  'set-book-goal',
  'set-cards',
  'update-card',
  'set-card-categories',
  'delete-card',
  'restore-deleted-card',
  'add-timeline-event',
  'reorder-timeline',
  'move-timeline-event',
]);

export function reduce(state: SampleState, action: Action): SampleState {
  let next = reduceBase(state, action);
  if (next !== state) {
    if (NON_TEXT_CONTENT_ACTIONS.has(action.type) && 'projectId' in action) {
      next = withContentRevision(next, action.projectId);
    } else if (action.type === 'set-goal' && next.activeProjectId) {
      next = withContentRevision(next, next.activeProjectId);
    } else if ((action.type === 'note-large' || action.type === 'add-duration') && next.activeProjectId) {
      next = withContentRevision(next, next.activeProjectId);
    }
  }
  if (next.formatUndo && next.activeProjectId !== next.formatUndo.projectId) {
    return { ...next, formatUndo: null };
  }
  return next;
}

/**
 * WO-122：整批正文更新。先確認每個章幕都還在才動手（不做一半）；
 * 每一章幕走既有 commit-text，所以字數、稿子自己的紀錄同步與自動暫存路徑都和一般輸入送出相同。
 * 這裡不碰 note-large，排版與復原都不會增加大量貼上／刪除次數。
 */
function commitMany(state: SampleState, projectId: string, items: readonly { nodeId: string; text: string }[]): SampleState | null {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return null;
  for (const item of items) {
    const node = findNode(project.nodes, item.nodeId);
    if (!node || (node.type !== 'file' && node.type !== 'scene')) return null;
  }
  let next = state;
  for (const item of items) {
    next = reduceBase(next, { type: 'commit-text', projectId, nodeId: item.nodeId, text: item.text });
  }
  return next;
}

function reduceBase(state: SampleState, action: Action): SampleState {
  const now = new Date();
  switch (action.type) {
    case 'format-apply': {
      const done = commitMany(
        state,
        action.projectId,
        action.changes.map((change) => ({ nodeId: change.nodeId, text: change.after })),
      );
      if (!done) return state;
      return { ...done, formatUndo: action.snapshot };
    }
    case 'format-undo': {
      const done = commitMany(
        state,
        action.projectId,
        action.entries.map((entry) => ({ nodeId: entry.nodeId, text: entry.before })),
      );
      if (!done) return state;
      return { ...done, formatUndo: null };
    }
    case 'format-clear':
      return state.formatUndo ? { ...state, formatUndo: null } : state;
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
    case 'clear-dirty-after-file-save':
      return action.clearDirty
        ? patchSaveMeta(state, action.projectId, { dirtySinceFileSave: false })
        : state;
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
    case 'set-export-events':
      return action.exportEvents === state.exportEvents ? state : { ...state, exportEvents: action.exportEvents };
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
    case 'remove-project': {
      const target = state.projects.find((item) => item.id === action.id);
      if (!target) return state;
      const ids = new Set(deviceKeysOf(target));
      const without = <T,>(source: Record<string, T>): Record<string, T> =>
        Object.fromEntries(Object.entries(source).filter(([key]) => !ids.has(key)));
      const projectIds = state.projects.filter((item) => ids.has(item.id)).map((item) => item.id);
      const dropEvents = (record: ImportEventRecord) =>
        projectIds.reduce((current, id) => withoutProject(current, id), record);
      return {
        ...state,
        projects: state.projects.filter((item) => !ids.has(item.id)),
        recentIds: state.recentIds.filter((id) => !ids.has(id)),
        goalById: without(state.goalById),
        logsById: without(state.logsById),
        saveMeta: without(state.saveMeta),
        startedById: without(state.startedById),
        fileExtras: without(state.fileExtras),
        contentRevById: without(state.contentRevById ?? {}),
        importEvents: dropEvents(state.importEvents),
        exportEvents: dropEvents(state.exportEvents),
        activeProjectId: state.activeProjectId && ids.has(state.activeProjectId) ? null : state.activeProjectId,
      };
    }
    case 'add-project': {
      const title = action.title.trim() || '未命名稿子';
      const chapterId = newChapterId(action.id);
      const single = action.shape === 'single';
      const project: DemoProject = {
        id: action.id,
        title,
        updatedLabel: '剛剛',
        bookGoal: isValidBookGoal(action.bookGoal) ? action.bookGoal : NEW_BOOK_GOAL_DEFAULT,
        shape: action.shape,
        lastOpenedNodeId: newManuscriptFirstNodeId(action.id, action.shape),
        lastCursor: 0,
        cards: [],
        categoryOrderRaw: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
        expandedCategoriesRaw: null,
        categoriesMetaRaw: '{}',
        nodes: single
          ? [{ id: chapterId, type: 'file', title, progress: 'Draft', content: '' }]
          : [
              {
                id: newVolumeId(action.id),
                type: 'folder',
                title: NEW_NOVEL_VOLUME_TITLE,
                expanded: true,
                children: [
                  {
                    id: chapterId,
                    type: 'file',
                    title: NEW_NOVEL_CHAPTER_TITLE,
                    progress: 'Draft',
                    expanded: true,
                    content: '',
                    children: [
                      {
                        id: newSceneId(action.id),
                        type: 'scene',
                        title: NEW_NOVEL_SCENE_TITLE,
                        progress: 'Draft',
                        content: '',
                      },
                    ],
                  },
                ],
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
      const withCommit = {
        ...next,
        projects,
        fileExtras: extras,
        formatUndo: state.formatUndo?.projectId === action.projectId ? null : state.formatUndo,
      };
      return withContentRevision(withCommit, action.projectId);
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
    case 'set-tour-goal': {
      // WO-111：和設定頁同一個每日目標（changeGoal：更新預設並追加當天一筆，當天以最後一次為準）。
      // 不像 set-goal 那樣去改開著檔案的 fileExtras（不會因此觸發寫回檔案），也不跳「已更新今日目標」。
      const current = withClock(state.schedule, now);
      const goalNow = current.open?.goals.at(-1)?.goal ?? current.defaultGoal;
      if (goalNow === action.goal) return state;
      return keepSchedule(state, changeGoal(state.schedule, action.goal, now));
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
      // WO-116：已從這個裝置刪掉的稿子，不論 quiet 與否都不能被加回清單。
      if (isBookRemoved(action.project.id) || isBookRemoved(action.project.dbKey)) return state;
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
    case 'add-timeline-event': {
      const currentCards = getProjectCards(state, action.projectId);
      const nextOrder =
        action.input?.timelineOrder !== undefined
          ? action.input.timelineOrder
          : nextTimelineOrderForNewEvent(currentCards);
      const nextCards = addCardToList(currentCards, {
        ...action.input,
        category: CATEGORY_TIMELINE,
        parentId: null,
        ...(nextOrder !== null ? { timelineOrder: nextOrder } : {}),
      });
      return applyProjectCards(state, action.projectId, () => nextCards);
    }
    case 'reorder-timeline': {
      const currentCards = getProjectCards(state, action.projectId);
      const reordered = reorderTimelineByOrderedIds(currentCards, action.orderedIds);
      const changed = reordered.some((card, idx) => card !== currentCards[idx]);
      if (!changed) return state;
      return applyProjectCards(state, action.projectId, () => reordered);
    }
    case 'move-timeline-event': {
      const currentCards = getProjectCards(state, action.projectId);
      let moved: FileCard[] = [...currentCards];
      if (action.drop !== undefined) {
        moved = moveTimelineCardByDrop(currentCards, action.cardId, action.drop);
      } else if (action.delta !== undefined) {
        moved = moveTimelineCardByDelta(currentCards, action.cardId, action.delta);
      } else if (action.targetIndex !== undefined) {
        moved = moveTimelineCardToIndex(currentCards, action.cardId, action.targetIndex);
      }
      const changed = moved.some((card, idx) => card !== currentCards[idx]);
      if (!changed) return state;
      return applyProjectCards(state, action.projectId, () => moved);
    }
    case 'set-nodes': {
      const nextWithNodes: SampleState = {
        ...state,
        projects: mapProject(state.projects, action.projectId, (project) => ({
          ...project,
          updatedLabel: '剛剛',
          shape: shapeAfterEdit(project.shape, action.nodes),
          nodes: action.nodes,
        })),
      };
      // WO-128：刪章或刪卷（連帶刪掉卷下所有子章）時，把連到已不存在章節的事件 chapterId 改為 null（事件本身不刪）。
      // WO-132 嚴-5：復原被刪章節／卷時，若事件目前尚未改連他章（chapterId 為空）且目標章節已存在，自動連回原章。
      const aliveChapterIds = collectAliveChapterIds(action.nodes);
      const restoreByCardId = new Map<string, string>();
      if (action.restoreTimelineLinks) {
        for (const link of action.restoreTimelineLinks) {
          if (aliveChapterIds.has(link.chapterId)) {
            restoreByCardId.set(link.cardId, link.chapterId);
          }
        }
      }
      const currentCards = getProjectCards(nextWithNodes, action.projectId);
      let cardsChanged = false;
      const updatedCards = currentCards.map((card) => {
        if (
          card.chapterId !== undefined &&
          card.chapterId !== null &&
          card.chapterId !== '' &&
          !aliveChapterIds.has(card.chapterId)
        ) {
          cardsChanged = true;
          return {
            ...card,
            chapterId: null,
          };
        }
        if (
          card.category === CATEGORY_TIMELINE &&
          (card.chapterId === undefined || card.chapterId === null || card.chapterId === '') &&
          restoreByCardId.has(card.id)
        ) {
          cardsChanged = true;
          return {
            ...card,
            chapterId: restoreByCardId.get(card.id)!,
          };
        }
        return card;
      });
      if (!cardsChanged) return nextWithNodes;
      return applyProjectCards(nextWithNodes, action.projectId, () => updatedCards);
    }
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
  /** WO-116：從這個裝置刪掉這份稿子的暫存與寫作資料。回傳 true 才是真的刪完；失敗回 false 並跳提示，稿子照舊。 */
  removeFromDevice: (id: string) => Promise<boolean>;
  addProject: (title: string, shape?: 'novel' | 'single') => string;
  rememberPlace: (projectId: string, nodeId: string, cursor: number) => void;
  toggleNode: (projectId: string, nodeId: string) => void;
  setProgress: (projectId: string, nodeId: string, progress: ProgressCode) => void;
  commitText: (projectId: string, nodeId: string, text: string) => void;
  noteLarge: (delta: TextDelta) => void;
  /** WO-122：排版整批寫入（其他章幕）與快照；走 format-apply，不經 noteLarge。 */
  applyFormat: (projectId: string, changes: FormatChange[], snapshot: FormatSnapshot) => void;
  /** WO-122：復原整批（其他章幕），成功後清空快照。 */
  undoFormat: (projectId: string, entries: FormatSnapshotEntry[]) => void;
  /** WO-122：清掉排版復原快照（關閉提示、失效、離開稿子）。 */
  clearFormatUndo: () => void;
  addDuration: (seconds: number) => void;
  setGoal: (goal: number) => void;
  /**
   * WO-111：歡迎導覽第 1 關按「下一關」時寫每日目標（和設定頁同一個值）。
   * 不合法（不是 300 以上的整數）不寫、回 false。沒有開著的稿子時另外記在這個裝置的紀錄裡，重開後還在；
   * 記不進本機儲存時這次使用照樣有效。不改檔案欄位、不寫 .db。
   */
  setTourDailyGoal: (goal: number) => boolean;
  setHour: (hour: number) => void;
  setBookGoal: (projectId: string, bookGoal: number) => void;
  addScene: (projectId: string, chapterId: string) => void;
  setNodes: (
    projectId: string,
    nodes: DemoProject['nodes'],
    options?: { restoreTimelineLinks?: ReadonlyArray<TimelineChapterLink> },
  ) => void;
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
      onPersistResult?: (ok: boolean) => void;
    },
  ) => Promise<FileCard[] | null>;
  restoreDeletedChapter: (
    projectId: string,
    record: DeletedRecord,
    nodes: ChapterNode[],
    options?: {
      archive?: ArchiveClient;
    },
  ) => Promise<{ persisted: boolean }>;
  /** WO-128：新增時間線事件（頂層時間軸卡，依 nextTimelineOrderForNewEvent 排在最後）。 */
  addTimelineEvent: (
    projectId: string,
    input?: Omit<AddCardInput, 'category' | 'parentId'>,
  ) => FileCard | null;
  /** WO-128：依指定頂層事件 id 順序重排時間線故事順序（0..M-1）。 */
  reorderTimeline: (projectId: string, orderedIds: readonly string[]) => void;
  /** WO-128：移動單一時間線事件（上移／下移 delta、目標索引 targetIndex、或拖曳落點 drop）。 */
  moveTimelineEvent: (
    projectId: string,
    cardId: string,
    move: { delta?: -1 | 1; targetIndex?: number; drop?: TimelineDropTarget },
  ) => void;
  focusProject: (id: string) => void;
  attachImported: (payload: {
    project: DemoProject;
    schedule: GoalSchedule;
    extras: FileExtras;
  }) => void;
  importFile: (file: File, diskFile?: DiskFile | null) => Promise<{ id: string; chapterId: string | null }>;
  /** WO-99：匯入 TXT 開成新稿子。 */
  importTextFile: (file: File) => Promise<TextImportOutcome>;
  /** WO-126：選到檔後只讀取與解碼（統一換行），不建稿。 */
  readImportText: (file: File) => Promise<{ kind: 'ready'; text: string } | { kind: 'unreadable' }>;
  /** WO-126：依例子（可留白）預覽分章，不建稿、不寫紀錄。 */
  previewImportText: (text: string, example: string) => Promise<TextImportPreview>;
  /** WO-126：確定匯入／不分章：用給定章列建稿，成功後寫 .db（WO-102）。 */
  confirmImportText: (input: { filename: string; chapters: readonly SplitChapter[] }) => Promise<TextImportOutcome>;
  /** WO-103：匯出全文（Word／TXT、全文／自選章節）。prepared 給手勢失效後再點「儲存檔案」用。 */
  exportFullText: (
    request: FullTextExportRequest,
    options?: { prepared?: PreparedExport; isCancelled?: () => boolean },
  ) => Promise<FullTextExportOutcome>;
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
  resumeAutoSave: () => Promise<'granted' | 'denied' | 'no-handle'>;
  toast: (message: string | null) => void;
}

interface SampleContextValue {
  state: SampleState;
  actions: SampleActions;
  achievementCount: number;
  isGlowing: boolean;
  stats: StatsSummary;
  bookWords: (projectId: string) => number;
  autoSaveStatusOf: (projectId: string) => AutoSaveStatus;
  lastSaveWasAutoOf: (projectId: string) => boolean;
  stashFailedOf?: (projectId: string) => boolean;
  /**
   * WO-110：這個裝置的資料（含非同步回復的手機暫存稿）是否已經載入完成。
   * 首次歡迎導覽要等它為 true 才判斷是不是全新裝置，不可趁還沒載完就當作全新。
   */
  deviceLoaded: boolean;
}

const SampleContext = createContext<SampleContextValue | null>(null);

/**
 * 交給外部（儲存、另存、分享／下載、預備分享）前的檢查。
 * WO-100：附加資料有破壞疑慮（損壞、衝突、不支援的修訂值）就不交出去，沿用既有存檔失敗提示。
 * WO-128：時間線附加資料有破壞疑慮同樣擋下外部存檔。
 */
export async function verifyBytesForSave(bytes: Uint8Array): Promise<void> {
  await verifyExportedDatabase(bytes, async (payload) => {
    const db = await openMemoryDb(payload);
    try {
      validateJiufangDatabase(db.sql);
      db.sql.select('SELECT id FROM project_info LIMIT 1');
      db.sql.select('SELECT id FROM chapters LIMIT 1');
      assertTransferDataWritable(db.sql);
      assertTimelineDataWritable(db.sql);
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
): {
  key: string;
  info: FileProjectInfo;
  cards: FileCard[];
  logs: FileLog[];
  importEvents: ProjectImportEvents;
  exportEvents: ProjectImportEvents;
} {
  const key = project.dbKey ?? project.id;
  const extra =
    (project.dbKey ? state.fileExtras[project.dbKey] : undefined) ?? state.fileExtras[key];
  const info = buildFileProjectInfo(state, project);
  // 還沒有檔案紀錄時，只寫這份稿子自己的紀錄，不借目前畫面上別份稿子的。
  const logs: FileLog[] = extra?.logs ?? toFileLogs(trackingOf(state, project, new Date()).logs);
  // WO-100：暫存、儲存、另存、分享預備都帶同一份事件集合寫進 .db。
  const importEvents = projectImportEventsOf(state, project.id);
  // WO-103：匯出事件同一份快照、同一筆交易寫進 .db。
  const exportEvents = projectExportEventsOf(state, project.id);
  return { key, info, cards: extra?.cards ?? project.cards ?? [], logs, importEvents, exportEvents };
}

/** WO-100：在給定的底稿位元組上建出這份稿子的 .db（與 snapshotManuscript 同一套內容；測試也用）。 */
export async function manuscriptBytesOn(
  state: SampleState,
  project: DemoProject,
  base: Uint8Array | null,
): Promise<Uint8Array> {
  const { info, cards, logs, importEvents, exportEvents } = manuscriptSnapshotParts(state, project);
  return writeBookBytes(base, info, project.nodes, cards, logs, importEvents, exportEvents);
}

async function snapshotManuscript(
  state: SampleState,
  project: DemoProject,
  persist = true,
): Promise<{ key: string; bytes: Uint8Array }> {
  const { key, info, cards, logs, importEvents, exportEvents } = manuscriptSnapshotParts(state, project);
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
    exportEvents,
  );
  return { key, bytes };
}

function localStashFailedSaveAsNotice(outcome: SaveOutcome): string | null {
  if (outcome.kind === 'saved-as') return SAVE_AS_LOCAL_STASH_FAIL;
  if (outcome.kind === 'handed-off') {
    return outcome.via === 'share'
      ? SAVE_SHARE_LOCAL_STASH_FAIL
      : SAVE_DOWNLOAD_LOCAL_STASH_FAIL;
  }
  return null;
}

export function applySaveOutcome(
  dispatch: (action: Action) => void,
  projectId: string,
  outcome: SaveOutcome,
  mode: 'save' | 'save-as',
  options?: { localStashOk?: boolean },
) {
  const stashFailedNotice =
    options?.localStashOk === false ? localStashFailedSaveAsNotice(outcome) : null;
  const text = stashFailedNotice ?? saveNotice(outcome);
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
 * WO-132 嚴-1：存檔或暫存前，若編輯框有非組字中且尚未送出的正文變更，
 * 同步透過 reducer 送出 commit-text，確保快照與當日字數紀錄皆包含最後一段。
 */
export function withLiveDraftCommitted(
  state: SampleState,
  projectId: string,
  live: Omit<LiveDraft, 'at'> | null,
  isComposing: boolean,
): { state: SampleState; project: DemoProject; action: Extract<Action, { type: 'commit-text' }> | null } {
  const project = state.projects.find((item) => item.id === projectId)!;
  if (isComposing || !live || live.projectId !== projectId || !project) {
    return { state, project, action: null };
  }
  const node = findNode(project.nodes, live.chapterId);
  if (!node || (node.content ?? '') === live.text) {
    return { state, project, action: null };
  }
  const action: Extract<Action, { type: 'commit-text' }> = {
    type: 'commit-text',
    projectId,
    nodeId: live.chapterId,
    text: live.text,
  };
  const nextState = reduce(state, action);
  if (nextState === state) return { state, project, action: null };
  const nextProject = nextState.projects.find((item) => item.id === projectId) ?? project;
  return { state: nextState, project: nextProject, action };
}

function commitLiveDraft(
  state: SampleState,
  projectId: string,
  dispatch: (action: Action) => void,
): { state: SampleState; project: DemoProject; committed: boolean } {
  flushLiveDraftNow();
  const result = withLiveDraftCommitted(state, projectId, readLiveDraftFromEditor(), isLiveDraftComposing());
  if (result.action) dispatch(result.action);
  return { state: result.state, project: result.project, committed: Boolean(result.action) };
}

function rememberLoadedTarget(
  bookKey: string,
  target: { file: DiskFile | null; lastKnownFingerprint?: string | null } | null | undefined,
): DiskFile | null {
  const file = target?.file ?? null;
  rememberOpenFile(bookKey, file);
  if (file && target?.lastKnownFingerprint !== undefined) {
    rememberOpenFileFingerprint(bookKey, file, target.lastKnownFingerprint);
  }
  return file;
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
}): Promise<{
  snap: { key: string; bytes: Uint8Array };
  bytes: Uint8Array;
  outcome: SaveOutcome;
  revAtStart: number;
  rememberedFile: DiskFile | null;
  localStashOk: boolean;
}> {
  const { state, project, dispatch, env } = input;
  const snapshot = input.snapshot ?? snapshotManuscript;
  const { state: committedState, project: committedProject, committed } = commitLiveDraft(state, project.id, dispatch);
  const revAtStart = committedState.contentRevById?.[project.id] ?? 0;
  const snap = await snapshot(committedState, committedProject, false);
  const bytes = shareBytesForSaveAs({ prepared: committed ? null : input.preparedBytes, latest: snap.bytes });
  const outcome = await saveProjectAsNew(env, snap.key, bytes, exportDbFilename(committedProject.title));
  let localStashOk = true;
  if (outcome.kind === 'saved-as' || outcome.kind === 'handed-off') {
    try {
      await snapshot(committedState, committedProject, true);
    } catch {
      localStashOk = false;
    }
    if (localStashOk) {
      dispatch({
        type: 'promote-stored',
        projectId: project.id,
        key: snap.key,
        filename: projectSaveFilename(committedProject.title, committedProject.filename),
      });
    }
  }
  let rememberedFile: DiskFile | null = null;
  if (outcome.kind === 'saved-as') {
    const target = await env.targets.load(snap.key).catch(() => null);
    if (target?.file) {
      rememberedFile = rememberLoadedTarget(snap.key, target);
    }
  }
  applySaveOutcome(dispatch, project.id, outcome, 'save-as', { localStashOk });
  return { snap, bytes, outcome, revAtStart, rememberedFile, localStashOk };
}

export type TextImportOutcome =
  | { kind: 'imported'; id: string; chapterId: string; afterState: SampleState }
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

/**
 * WO-99：用分好的章建立完整新稿子（長篇形式，章都在最上層，跟開新稿子的第一章同一種節點）。
 * WO-109：全書目標用新稿子的全書目標預設；沒給或不合法用 100,000。
 */
export function buildImportedProject(
  id: string,
  title: string,
  chapters: readonly SplitChapter[],
  bookGoal: number = NEW_BOOK_GOAL_DEFAULT,
): DemoProject {
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
    bookGoal: isValidBookGoal(bookGoal) ? bookGoal : NEW_BOOK_GOAL_DEFAULT,
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

/**
 * WO-109：一般開新稿子（長篇／單篇）的建立事件。
 * 全書目標帶入這個裝置的新稿子全書目標預設（沒設過、不合法、讀不到＝100,000）。
 */
/**
 * WO-111：歡迎導覽第 1 關按「下一關」寫每日目標。和設定頁同一個每日目標（set-tour-goal → changeGoal）。
 * - 不是 300 以上的整數：不寫，回 false。
 * - 值沒變：不寫，回 true。
 * - 沒有開著的稿子：另外記在這個裝置既有紀錄（save-record.v1）的 homeGoal，重開後預選；不新增每日目標的鍵。
 *   本機儲存不能用或寫丟錯時照樣回 true，這次使用的值已在記憶體裡。
 * - WO-111 返工1：開著 .db 檔案稿：當下記在同一把裝置紀錄的 tourGoalById（以稿子代號對應），
 *   重新載入時由 applyTourFileGoal 套回；不寫 .db、不改檔案欄位。寫丟錯時同上，照樣回 true。
 * - 不改開著檔案的欄位、不寫 .db、不改其他稿子。
 */
export function commitTourDailyGoal(input: {
  state: SampleState;
  goal: number;
  now: Date;
  store: KeyValueStore | null;
  dispatch: (action: Action) => void;
}): boolean {
  const { state, goal, now, store, dispatch } = input;
  if (!Number.isSafeInteger(goal) || goal < MIN_DAILY_GOAL) return false;
  const current = withClock(state.schedule, now);
  if ((current.open?.goals.at(-1)?.goal ?? current.defaultGoal) === goal) return true;
  dispatch({ type: 'set-tour-goal', goal });
  if (state.activeProjectId === null && store) {
    try {
      saveHomeDailyGoal(store, goal);
    } catch {
      // 私人瀏覽可能不准寫入；這次使用的每日目標已經改好。
    }
  }
  const active = state.projects.find((project) => project.id === state.activeProjectId);
  if (active?.origin === 'file' && store) {
    try {
      saveTourFileGoal(store, active.id, goal);
    } catch {
      // 同上：寫不進去時這次使用的值仍在記憶體裡。
    }
  }
  return true;
}

/**
 * WO-111 返工1：從手機暫存回復檔案稿時，套回導覽記下的每日目標（和設定頁同一個 changeGoal：
 * 更新預設並追加當天一筆，當天以最後一次為準）。沒有記、讀不到或已和檔案相同時原樣回傳。
 */
export function applyTourFileGoal(book: ImportedBook, store: KeyValueStore | null, now: Date): ImportedBook {
  const goal = recallTourFileGoal(store, book.key);
  if (goal === null) return book;
  const current = withClock(book.schedule, now);
  if ((current.open?.goals.at(-1)?.goal ?? current.defaultGoal) === goal) return book;
  try {
    return { ...book, schedule: changeGoal(book.schedule, goal, now) };
  } catch {
    return book;
  }
}

export function addProjectAction(
  id: string,
  title: string,
  shape: 'novel' | 'single',
  startedMs?: number,
  store?: KeyValueStore | null,
): Extract<Action, { type: 'add-project' }> {
  return { type: 'add-project', id, title, shape, startedMs, bookGoal: readNewBookGoal(store) };
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
  /** WO-109：新稿子的全書目標；沒給就讀這個裝置的本機設定 new-book-goal（沒設過＝100,000）。 */
  newBookGoal?: number;
}): Promise<TextImportOutcome> {
  const { busy } = input;
  if (busy.current) return { kind: 'busy' };
  busy.current = true;
  const yieldToUi = input.yieldToUi ?? defaultYieldToUi;
  try {
    // 先讓「處理中」畫面有機會畫出來。
    await yieldToUi();
    const prepared = await prepareTextImport({ readBytes: input.readBytes, decoder: input.decoder });
    if (prepared.kind === 'unreadable') return { kind: 'unreadable' };
    await yieldToUi();
    // 一口氣匯入＝例子留白（WO-125 自動規則）。
    const preview = await previewTextImport(prepared.text, '', yieldToUi);
    return commitTextImport({ ...input, chapters: preview.chapters });
  } finally {
    busy.current = false;
  }
}

/** WO-126：選到檔後的準備工作。只讀位元組、解碼、統一換行；不建稿、不寫任何紀錄。 */
export async function prepareTextImport(input: {
  readBytes: () => Promise<Uint8Array>;
  decoder?: StrictDecoderFactory;
}): Promise<{ kind: 'ready'; text: string } | { kind: 'unreadable' }> {
  let bytes: Uint8Array;
  try {
    bytes = await input.readBytes();
  } catch {
    return { kind: 'unreadable' };
  }
  const decoded = decodeTextBytes(bytes, input.decoder);
  if (!decoded.ok) return { kind: 'unreadable' };
  return { kind: 'ready', text: normalizeNewlines(decoded.text) };
}

/** WO-126：匯入預覽。例子留白＝WO-125 自動規則。純計算，不建稿、不寫紀錄。 */
export interface TextImportPreview {
  chapters: SplitChapter[];
  /** 實際命中的章名行數；0 代表沒找到，全文放進預設的一章。 */
  hits: number;
  prefaceAdded: boolean;
  /** 作家有填非空白例子。 */
  usedExample: boolean;
}

export async function previewTextImport(
  text: string,
  example: string,
  yieldToUi: () => Promise<void> = defaultYieldToUi,
): Promise<TextImportPreview> {
  const result = await splitChaptersByExampleInBatches(
    text,
    example,
    { prefaceTitle: IMPORT_PREFACE_TITLE, defaultTitle: IMPORT_DEFAULT_CHAPTER_TITLE },
    yieldToUi,
  );
  return { ...result, usedExample: example.trim() !== '' };
}

/** WO-126：不分章時的章列（整份文字一章）。 */
export function wholeTextImportChapters(text: string): SplitChapter[] {
  return wholeTextAsOneChapter(text, { prefaceTitle: IMPORT_PREFACE_TITLE, defaultTitle: IMPORT_DEFAULT_CHAPTER_TITLE });
}

/**
 * WO-126：確認後才真的建稿（同步）。以呼叫當下的狀態取新稿代號、全書目標與寫作日，
 * 先寫本機匯入事件與稿子清單（任一失敗就復原事件），再一次 dispatch。
 */
export function commitTextImport(input: {
  filename: string;
  chapters: readonly SplitChapter[];
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  store: KeyValueStore | null;
  now?: () => Date;
  newEventId?: (projectId: string) => string;
  newBookGoal?: number;
}): TextImportOutcome {
  const { store, chapters } = input;
  {
    if (!store) return { kind: 'storage-failed' };

    const state = input.getState();
    const at = (input.now ?? (() => new Date()))();
    const { id, ms } = nextImportProjectId(state, at.getTime());
    const project = buildImportedProject(
      id,
      importTitleFromFilename(input.filename),
      chapters,
      input.newBookGoal ?? readNewBookGoal(store),
    );
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

    const importAction: Action = { type: 'import-text', project, dayKey, startedMs: ms, importEvents: record };
    input.dispatch(importAction);
    // WO-102：afterState 給匯入後立刻寫 .db 用（畫面 state 這一刻還沒更新）。
    return { kind: 'imported', id, chapterId: project.nodes[0]!.id, afterState: reduce(state, importAction) };
  }
}

/** WO-126：作家按「確定匯入」或「不分章」後的寫入。處理中再來一次直接回 busy，不會重複建稿。 */
export async function runConfirmedImport(input: {
  filename: string;
  chapters: readonly SplitChapter[];
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  store: KeyValueStore | null;
  busy: { current: boolean };
  now?: () => Date;
  yieldToUi?: () => Promise<void>;
  newEventId?: (projectId: string) => string;
  newBookGoal?: number;
}): Promise<TextImportOutcome> {
  const { busy } = input;
  if (busy.current) return { kind: 'busy' };
  busy.current = true;
  try {
    // 先讓「處理中」畫面有機會畫出來。
    await (input.yieldToUi ?? defaultYieldToUi)();
    return commitTextImport(input);
  } finally {
    busy.current = false;
  }
}

/**
 * WO-102：匯入成功後，立刻把新稿子連同匯入紀錄寫進 .db。
 * - 成功：升格為檔案稿子（與暫存相同），不出提示。
 * - 匯入紀錄寫入或核對失敗（TransferDataError，交易已整筆回復）：不升格、不顯示任何提示，
 *   稿子仍在本機、正文都在，回傳 'record-failed'（九方 2026-11-16 22:18 定案）。
 * - 其他儲存失敗是一般存檔問題，沿用既有存檔流程的處理。
 * 不吞錯誤硬回成功；回傳實際結果給呼叫端與測試。
 */
export async function persistImportedRecord(input: {
  state: SampleState;
  projectId: string;
  dispatch: (action: Action) => void;
  snapshot?: typeof snapshotManuscript;
}): Promise<'saved' | 'record-failed' | 'save-failed'> {
  const { state, projectId, dispatch } = input;
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return 'save-failed';
  const snapshot = input.snapshot ?? snapshotManuscript;
  try {
    const { key } = await snapshot(state, project);
    dispatch({
      type: 'promote-stored',
      projectId: project.id,
      key,
      filename: projectSaveFilename(project.title, project.filename),
    });
    return 'saved';
  } catch (error) {
    if (error instanceof TransferDataError) {
      // WO-102（九方 2026-11-16 22:18 定案）：匯入次數寫不進 .db 時不顯示任何提示；稿子照常開啟
      return 'record-failed';
    }
    return 'save-failed';
  }
}

/** WO-103：開檔時接回本機匯出事件；本機讀寫不了就當作沒有（檔內事件仍照常讀）。 */
function adoptExportsQuietly(store: KeyValueStore, fingerprint: string | null, projectId: string): TransferEventRecord | null {
  try {
    return adoptExportEventsByFingerprint(store, fingerprint, projectId);
  } catch {
    return null;
  }
}

/** WO-103：一次匯出全文的要求。selected 只在 scope = 'selected' 時使用。 */
export interface FullTextExportRequest {
  projectId: string;
  format: ExportFormat;
  scope: ExportScope;
  selected?: ReadonlySet<string>;
}

/** WO-103：已產生好、等待交付的檔案（手勢失效時讓使用者再點一次「儲存檔案」用的也是這一份）。 */
export interface PreparedExport {
  projectId: string;
  format: ExportFormat;
  scope: ExportScope;
  file: File;
}

/** WO-103：匯出結果。.db 附加表寫入狀態與檔案交付結果分開回報，不混在一起。 */
export type FullTextExportOutcome =
  | {
      kind: 'delivered';
      via: 'shared' | 'downloaded';
      eventId: string;
      /** 本機匯出紀錄有沒有寫進去。 */
      local: 'saved' | 'not-saved';
      /** 稿子 .db（App 內的那一份）有沒有寫進這次事件；新稿還沒存成 .db 時是 'not-stored'。 */
      file: 'saved' | 'record-failed' | 'save-failed' | 'not-stored';
    }
  | { kind: 'cancelled' }
  | { kind: 'needs-gesture'; prepared: PreparedExport }
  | { kind: 'empty' }
  | { kind: 'failed' }
  | { kind: 'busy' };

function defaultExportEventId(projectId: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `exp-${projectId}-${random}`;
}

/**
 * WO-103：按下匯出那一刻的稿子完整快照（暫定第 14 條）：記憶體裡的最新正文，
 * 編輯器若還有沒交給 store 的字也一起帶上；不回頭讀磁碟上的舊稿。
 */
export function exportSnapshotNodes(
  state: SampleState,
  projectId: string,
  liveDraft: { projectId: string; chapterId: string; text: string } | null = readLiveDraftFromEditor(),
): ChapterNode[] | null {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const nodes = structuredClone(project.nodes);
  if (liveDraft && liveDraft.projectId === projectId && findNode(nodes, liveDraft.chapterId)) {
    return updateNode(nodes, liveDraft.chapterId, (node) => ({ ...node, content: liveDraft.text }));
  }
  return nodes;
}

/**
 * WO-103：產生要交付的檔案。沒有可輸出的章回 'empty'（不交付空檔、不計次）；產生失敗回 'failed'。
 */
export async function prepareFullTextExport(input: {
  state: SampleState;
  request: FullTextExportRequest;
  now?: Date;
  liveDraft?: { projectId: string; chapterId: string; text: string } | null;
  buildDocx?: typeof docxBytes;
}): Promise<PreparedExport | 'empty' | 'failed'> {
  const { state, request } = input;
  const project = state.projects.find((item) => item.id === request.projectId);
  if (!project) return 'failed';
  const nodes = exportSnapshotNodes(state, request.projectId, input.liveDraft === undefined ? readLiveDraftFromEditor() : input.liveDraft);
  if (!nodes) return 'failed';
  const plan = planExport(nodes, request.scope, request.selected ?? new Set());
  if (plan.chapterCount === 0) return 'empty';
  const filename = fullTextExportFilename(project.title, request.format, request.scope, input.now ?? new Date());
  try {
    // Word 產生器（docx 套件）只在真的要匯出 Word 時才載入，不拖慢 App 開啟；離線時由 PWA 預先快取的分塊提供。
    const bytes =
      request.format === 'docx'
        ? await (input.buildDocx ?? (await import('../domain/docxExport')).docxBytes)(plan)
        : txtBytes(plan);
    const file = makeExportFile(bytes, filename, request.format === 'docx' ? DOCX_MIME : TXT_MIME);
    return { projectId: request.projectId, format: request.format, scope: request.scope, file };
  } catch {
    return 'failed';
  }
}

/**
 * WO-103：成功交付後記一筆匯出事件（暫定第 8、13 條）。
 * - 事件掛在「按下匯出時」的那份稿子代號上，不看現在開著哪一份。
 * - 寫作日照現行規則（那份稿子的一天結束時刻）在事件發生當下記下。
 * - 先寫本機紀錄；寫不進去時事件仍留在記憶體並回報 local: 'not-saved'（不假稱已保存），下次成功寫入時一起補寫。
 * - 已存成 .db 的稿子立刻把事件寫進 App 內那份 .db；附加表寫不進去（TransferDataError）回 'record-failed'，
 *   一律不跳提示（沿用九方 2026-11-16 22:18 對匯入的定案），也不假增檔內計數。
 */
export async function recordFullTextExport(input: {
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  store: KeyValueStore | null;
  projectId: string;
  at: Date;
  eventId: string;
  snapshot?: typeof snapshotManuscript;
}): Promise<{ local: 'saved' | 'not-saved'; file: 'saved' | 'record-failed' | 'save-failed' | 'not-stored' }> {
  const { store, projectId, at, eventId } = input;
  const state = input.getState();
  const project = state.projects.find((item) => item.id === projectId);
  const dayEndHour = project ? trackingOf(state, project, at).schedule.dayEndHour : state.schedule.dayEndHour;
  const event = { dayKey: writingDayKey(at, dayEndHour), atMs: at.getTime() };

  let local: 'saved' | 'not-saved' = 'not-saved';
  let base = state.exportEvents;
  if (store) {
    try {
      base = mergeEventRecords(readExportEvents(store), state.exportEvents);
    } catch {
      base = state.exportEvents;
    }
  }
  const next = withImportEvent(base, projectId, eventId, event);
  if (store) {
    try {
      writeExportEvents(store, next);
      local = 'saved';
    } catch {
      local = 'not-saved';
    }
  }
  const action: Action = { type: 'set-export-events', exportEvents: next };
  input.dispatch(action);
  const afterState = reduce(state, action);

  if (!project || project.origin !== 'file' || !project.dbKey) return { local, file: 'not-stored' };
  try {
    await (input.snapshot ?? snapshotManuscript)(afterState, project);
    return { local, file: 'saved' };
  } catch (error) {
    return { local, file: error instanceof TransferDataError ? 'record-failed' : 'save-failed' };
  }
}

/** 已成功交付並計次的 prepared；同一份檔案不重複處理。 */
const deliveredPrepared = new WeakSet<PreparedExport>();

/** WO-103：交付已備妥的檔案，成功才記一次。分享取消、手勢失效、交付拋錯都不計次。 */
export async function deliverAndRecordExport(input: {
  prepared: PreparedExport;
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  store: KeyValueStore | null;
  deliver?: (file: File, mode?: DeliveryMode) => Promise<DeliveryResult>;
  /** download：已備妥重試，一律下載。預設 auto。 */
  mode?: DeliveryMode;
  now?: () => Date;
  newEventId?: (projectId: string) => string;
  snapshot?: typeof snapshotManuscript;
}): Promise<FullTextExportOutcome> {
  const { prepared } = input;
  const mode = input.mode ?? 'auto';
  if (deliveredPrepared.has(prepared)) return { kind: 'busy' };
  let result: DeliveryResult;
  try {
    result = await (input.deliver ?? ((file: File, m?: DeliveryMode) => deliverFile(file, undefined, m)))(prepared.file, mode);
  } catch {
    return { kind: 'failed' };
  }
  if (result === 'cancelled') return { kind: 'cancelled' };
  if (result === 'needs-gesture') return { kind: 'needs-gesture', prepared };
  if (deliveredPrepared.has(prepared)) return { kind: 'busy' };
  deliveredPrepared.add(prepared);
  const eventId = (input.newEventId ?? defaultExportEventId)(prepared.projectId);
  const recorded = await recordFullTextExport({
    getState: input.getState,
    dispatch: input.dispatch,
    store: input.store,
    projectId: prepared.projectId,
    at: (input.now ?? (() => new Date()))(),
    eventId,
    snapshot: input.snapshot,
  });
  return { kind: 'delivered', via: result, eventId, ...recorded };
}

/**
 * WO-103：匯出全文主流程。產生期間與交付期間鎖住，重複點擊回 'busy'，單次成功只記一筆。
 * isCancelled：畫面已關閉或使用者按了取消時，不再交付（也不計次）。
 */
export async function runFullTextExport(input: {
  request: FullTextExportRequest;
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  store: KeyValueStore | null;
  busy: { current: boolean };
  deliver?: (file: File, mode?: DeliveryMode) => Promise<DeliveryResult>;
  now?: () => Date;
  newEventId?: (projectId: string) => string;
  liveDraft?: { projectId: string; chapterId: string; text: string } | null;
  buildDocx?: typeof docxBytes;
  isCancelled?: () => boolean;
  snapshot?: typeof snapshotManuscript;
  /** 已備妥（手勢失效後再點「儲存檔案」）時直接交付這一份，不重新產生。 */
  prepared?: PreparedExport;
}): Promise<FullTextExportOutcome> {
  const { busy } = input;
  if (busy.current) return { kind: 'busy' };
  busy.current = true;
  try {
    const now = input.now ?? (() => new Date());
    const prepared =
      input.prepared ??
      (await prepareFullTextExport({
        state: input.getState(),
        request: input.request,
        now: now(),
        liveDraft: input.liveDraft,
        buildDocx: input.buildDocx,
      }));
    if (prepared === 'empty') return { kind: 'empty' };
    if (prepared === 'failed') return { kind: 'failed' };
    if (input.isCancelled?.()) return { kind: 'cancelled' };
    return await deliverAndRecordExport({
      prepared,
      getState: input.getState,
      dispatch: input.dispatch,
      store: input.store,
      deliver: input.deliver,
      mode: input.prepared ? 'download' : 'auto',
      now,
      newEventId: input.newEventId,
      snapshot: input.snapshot,
    });
  } finally {
    busy.current = false;
  }
}

export interface BackgroundAutoSaveDeps {
  projectId: string;
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  env: Pick<SaveEnvironment, 'targets' | 'verify'>;
  getStatus: (projectId: string) => AutoSaveStatus;
  lastSavedRevById: Record<string, number>;
  inflight: { current: { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
  isPreviouslyFailed: () => boolean;
  onSaved: (projectId: string) => void;
  onNeedsPermission: (projectId: string, permission: 'prompt' | 'denied') => void;
  onFailed: (projectId: string, showToast: boolean) => void;
  onConflict?: (projectId: string) => void;
  onNoHandle: (projectId: string) => void;
  snapshot?: typeof snapshotManuscript;
  store?: KeyValueStore | null;
}

/**
 * WO-130：背景自動存檔主流程（由 SampleProvider 5 分鐘計時器與恢復自動存檔共用）。
 * 沿用與手動「儲存專案」相同的 snapshotManuscript → autoSaveProjectToPlace（verify + writeWithoutDestroying）。
 */
export async function executeBackgroundAutoSave(
  deps: BackgroundAutoSaveDeps,
): Promise<AutoSaveOutcome | 'skipped' | 'no-changes'> {
  const { projectId } = deps;
  if (deps.inflight.current) return 'skipped';
  const latest = deps.getState();
  const project = latest.projects.find((item) => item.id === projectId);
  if (!project || isSampleBook(project) || isBookRemoved(project.id) || isBookRemoved(project.dbKey)) {
    return 'skipped';
  }
  const status = deps.getStatus(projectId);
  const live = applyUncommittedDraftToProject(project, readLiveDraftFromEditor(), isLiveDraftComposing());
  const dirtySinceFileSave = Boolean(latest.saveMeta[projectId]?.dirtySinceFileSave);
  const currentRev = latest.contentRevById?.[projectId] ?? 0;
  const lastSavedRev = deps.lastSavedRevById[projectId] ?? 0;
  if (
    !shouldRunAutoSaveTick({
      status,
      dirtySinceFileSave,
      currentRev,
      lastSavedRev,
      hasUncommittedDiff: live.hasDiff,
      isInflight: false,
    })
  ) {
    return 'no-changes';
  }
  const revAtStart = currentRev;
  const snapFn = deps.snapshot ?? snapshotManuscript;
  const runPromise = (async (): Promise<AutoSaveOutcome | 'skipped'> => {
    try {
      const snap = await snapFn(latest, live.project, live.hasDiff);
      const outcome = await autoSaveProjectToPlace(
        deps.env,
        snap.key,
        snap.bytes,
        projectSaveFilename(live.project.title, live.project.filename),
        recallOpenFile(snap.key) ?? null,
      );
      if (isBookRemoved(projectId) || isBookRemoved(live.project.dbKey)) return 'skipped';
      if (outcome.kind === 'saved') {
        const latestRevAfter = deps.getState().contentRevById?.[projectId] ?? 0;
        const clearDirty = shouldClearDirtyAfterSave(revAtStart, latestRevAfter);
        deps.lastSavedRevById[projectId] = revAtStart;
        const atMs = Date.now();
        deps.dispatch({ type: 'record-project-save', projectId, atMs });
        deps.dispatch({ type: 'set-filename', projectId, filename: outcome.filename });
        deps.dispatch({ type: 'note-title-in-file', projectId });
        deps.dispatch({ type: 'clear-dirty-after-file-save', projectId, clearDirty });
        deps.onSaved(projectId);
        const store = deps.store === undefined ? deviceStore() : deps.store;
        if (store) {
          const linked = await linkImportEventsToBytes(store, projectId, snap.bytes).catch(() => null);
          if (linked) deps.dispatch({ type: 'set-import-events', importEvents: linked });
          const linkedExports = await linkExportEventsToBytes(store, projectId, snap.bytes).catch(() => null);
          if (linkedExports) deps.dispatch({ type: 'set-export-events', exportEvents: linkedExports });
        }
      } else if (outcome.kind === 'external-conflict') {
        deps.onConflict?.(projectId);
        deps.dispatch({ type: 'toast', message: SAVE_CONFLICT_TOAST });
      } else if (outcome.kind === 'needs-permission') {
        deps.onNeedsPermission(projectId, outcome.permission);
      } else if (outcome.kind === 'write-failed' || outcome.kind === 'invalid-database') {
        const showToast = !deps.isPreviouslyFailed();
        deps.onFailed(projectId, showToast);
        if (showToast) {
          deps.dispatch({ type: 'toast', message: AUTOSAVE_FAILED_TOAST });
        }
      } else if (outcome.kind === 'no-handle') {
        deps.onNoHandle(projectId);
      }
      return outcome;
    } catch {
      if (!isBookRemoved(projectId)) {
        const showToast = !deps.isPreviouslyFailed();
        deps.onFailed(projectId, showToast);
        if (showToast) {
          deps.dispatch({ type: 'toast', message: AUTOSAVE_FAILED_TOAST });
        }
      }
      return { kind: 'write-failed', restored: false };
    }
  })();
  const entry = { kind: 'auto' as const, projectId, promise: runPromise };
  deps.inflight.current = entry;
  try {
    return await runPromise;
  } finally {
    if (deps.inflight.current === entry) {
      deps.inflight.current = null;
    }
  }
}

/**
 * WO-130：點擊頁首「點一下恢復自動存檔」時的權限請求與補存。
 * 只在使用者明確點擊時呼叫 requestPermission()；未定案變更會立刻補寫，無變更則顯示簡短提示。
 */
export async function runResumeAutoSave(input: {
  project: DemoProject;
  state: SampleState;
  env: Pick<SaveEnvironment, 'targets' | 'verify'>;
  lastSavedRevById: Record<string, number>;
  onPermissionChange: (projectId: string, perm: HandlePermissionState) => void;
  dispatch: (action: Action) => void;
  runAutoSave: () => Promise<AutoSaveOutcome | 'skipped' | 'no-changes'>;
}): Promise<'granted' | 'denied' | 'no-handle'> {
  const { project, state, env } = input;
  const key = project.dbKey ?? project.id;
  let file = recallOpenFile(key);
  if (file === undefined) {
    const target = await env.targets.load(key).catch(() => null);
    file = rememberLoadedTarget(key, target);
  }
  if (!file) {
    input.onPermissionChange(project.id, 'none');
    return 'no-handle';
  }
  let perm: 'granted' | 'denied';
  try {
    perm = await file.requestPermission();
  } catch {
    perm = 'denied';
  }
  input.onPermissionChange(project.id, perm);
  if (perm !== 'granted') {
    input.dispatch({ type: 'toast', message: SAVE_PERMISSION_DENIED });
    return 'denied';
  }
  const live = applyUncommittedDraftToProject(project, readLiveDraftFromEditor(), isLiveDraftComposing());
  const hasDirty =
    Boolean(state.saveMeta[project.id]?.dirtySinceFileSave) ||
    (state.contentRevById?.[project.id] ?? 0) !== (input.lastSavedRevById[project.id] ?? 0) ||
    live.hasDiff;
  if (hasDirty) {
    await input.runAutoSave();
  } else {
    input.dispatch({ type: 'toast', message: AUTOSAVE_RESUMED_TOAST });
  }
  return 'granted';
}

/**
 * WO-133 中-1：importFile 與 openWithPicker 共用的開檔流程。
 * 讀入並寫好本機副本後，若寫入原檔位置把手（targets.save）失敗，不阻斷開檔，
 * 仍保留記憶體把手供當次寫回；重開分頁無把手時自然退回既有的「還沒存成檔案」與選存檔位置流程。
 */
export async function openDatabaseManuscript(input: {
  filename: string;
  bytes: Uint8Array;
  diskFile: DiskFile | null;
  dispatch: (action: Action) => void;
  env: Pick<SaveEnvironment, 'targets'>;
  store: KeyValueStore | null;
  onClearConflict?: (bookKey: string) => void;
  importBookFn?: typeof importBook;
  now?: Date;
}): Promise<{ id: string; chapterId: string | null }> {
  const rawFingerprint = await fingerprintBytes(input.bytes).catch(() => null);
  const exportedAt = input.store
    ? await exportTimeOfBytes(input.store, input.bytes).catch(() => null)
    : null;
  const book = await (input.importBookFn ?? importBook)(input.filename, input.bytes, input.now);
  // WO-99／WO-100：開回的檔若是這個裝置從匯入稿存出去的，接回同一批匯入事件（以事件代號去重，不再加一次）。
  const adopted = input.store
    ? (() => {
        try {
          return adoptImportEventsByFingerprint(input.store, rawFingerprint, book.key);
        } catch {
          return null;
        }
      })()
    : null;
  if (adopted) input.dispatch({ type: 'set-import-events', importEvents: adopted });
  const adoptedExports = input.store
    ? adoptExportsQuietly(input.store, rawFingerprint, book.key)
    : null;
  if (adoptedExports) input.dispatch({ type: 'set-export-events', exportEvents: adoptedExports });
  try {
    await input.env.targets.save(book.key, {
      filename: book.filename,
      file: input.diskFile,
      lastKnownFingerprint: rawFingerprint,
    });
  } catch {
    // 瀏覽器記不住原檔位置（IndexedDB 不可寫）時不阻斷開檔，也不報 OPEN_DB_FAIL。
  }
  rememberOpenFile(book.key, input.diskFile);
  rememberOpenFileFingerprint(book.key, input.diskFile, rawFingerprint);
  input.onClearConflict?.(book.key);
  input.dispatch(attachActionForBook(book, { updatedLabel: '剛剛' }));
  // WO-77：開回的正是這個裝置另存出去的那份檔，「上次另存」沿用當時時間。
  if (exportedAt != null) input.dispatch({ type: 'record-export', projectId: book.key, atMs: exportedAt });
  return {
    id: book.key,
    chapterId: findNode(book.tree, book.info.lastOpenedNodeId ?? '')
      ? book.info.lastOpenedNodeId
      : null,
  };
}

/**
 * WO-130：手動「儲存專案」（含頁首點擊「還沒存成檔案」、檔案頁按鈕與 Ctrl/Cmd+S）主流程。
 * 與背景自動存檔共用同一條 snapshotManuscript → saveProjectFromClick → applySaveOutcome 管線與單飛鎖。
 */
export async function runManualSaveProject(input: {
  getState: () => SampleState;
  dispatch: (action: Action) => void;
  env: SaveEnvironment;
  inflight: { current: { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
  lastSavedRevById: Record<string, number>;
  onSaved: (projectId: string) => void;
  onConflict?: (projectId: string) => void;
  onStashFailed?: (projectId: string) => void;
  isStashFailed?: (projectId: string) => boolean;
  snapshot?: typeof snapshotManuscript;
  store?: KeyValueStore | null;
}): Promise<SaveOutcome | null> {
  if (input.inflight.current) {
    await input.inflight.current.promise.catch(() => undefined);
  }
  const latestState = input.getState();
  const project = latestState.projects.find((item) => item.id === latestState.activeProjectId);
  if (!project) return null;
  const { env, dispatch } = input;
  const key = project.dbKey ?? project.id;
  const remembered = recallOpenFile(key);
  const needsNewName = shouldSaveUnderNewName({
    hasExternalFile: Boolean(project.hasExternalFile),
    titleInFile: project.titleInFile ?? null,
    title: project.title,
    filename: project.filename ?? null,
  });
  const pickFirst = shouldPickBeforeBuild({
    canPick: env.canPickFiles,
    needsNewName,
    remembered,
    hasExternalFile: Boolean(project.hasExternalFile),
  });
  const plan = needsNewName ? 'pick-new-name' : pickFirst ? 'pick-first-save' : 'write-back';
  let revAtStart = latestState.contentRevById?.[project.id] ?? 0;
  const snapFn = input.snapshot ?? snapshotManuscript;
  let builtBytes: Uint8Array | null = null;
  let stashStepFailed = false;
  const runManual = async (): Promise<SaveOutcome | null> => {
    try {
      const outcome = await saveProjectFromClick({
        env,
        bookKey: key,
        plan,
        writeBackName: projectSaveFilename(project.title, project.filename),
        newTitleName: `${sanitizeDbBasename(project.title)}.db`,
        startIn: needsNewName && remembered ? remembered : null,
        fallbackFile: remembered ?? null,
        onRemember: (file) => rememberOpenFile(key, file),
        buildBytes: async () => {
          const snapState = input.getState();
          const { state: committedState, project: snapProject } = commitLiveDraft(snapState, project.id, dispatch);
          revAtStart = committedState.contentRevById?.[project.id] ?? revAtStart;
          let snap: { key: string; bytes: Uint8Array };
          try {
            snap = await snapFn(committedState, snapProject, true);
          } catch (error) {
            stashStepFailed = true;
            input.onStashFailed?.(project.id);
            throw error;
          }
          dispatch({
            type: 'promote-stored',
            projectId: project.id,
            key: snap.key,
            filename: snapProject.filename || projectSaveFilename(snapProject.title, snapProject.filename),
          });
          builtBytes = snap.bytes;
          return snap.bytes;
        },
      });
      const localStashBroken = stashStepFailed || Boolean(input.isStashFailed?.(project.id));
      if (
        localStashBroken &&
        (outcome.kind === 'invalid-database' || outcome.kind === 'write-failed')
      ) {
        dispatch({ type: 'toast', message: SAVE_AND_STASH_FAIL });
      } else {
        applySaveOutcome(dispatch, project.id, outcome, 'save');
      }
      if (outcome.kind === 'external-conflict') {
        input.onConflict?.(project.id);
      }
      const saved = outcome.kind === 'saved' || outcome.kind === 'saved-under-new-title';
      const store = input.store === undefined ? deviceStore() : input.store;
      if (saved && store && builtBytes) {
        // WO-99：寫出去的那份檔對上這份稿子的匯入事件，之後開回同一份檔次數不遺失、不重複。
        const linked = await linkImportEventsToBytes(store, project.id, builtBytes).catch(() => null);
        if (linked) dispatch({ type: 'set-import-events', importEvents: linked });
        const linkedExports = await linkExportEventsToBytes(store, project.id, builtBytes).catch(() => null);
        if (linkedExports) dispatch({ type: 'set-export-events', exportEvents: linkedExports });
      }
      if (saved && recallOpenFile(key) == null) {
        const target = await env.targets.load(key).catch(() => null);
        if (target?.file) rememberLoadedTarget(key, target);
      }
      if (saved) {
        const latestRev = input.getState().contentRevById?.[project.id] ?? 0;
        const clearDirty = shouldClearDirtyAfterSave(revAtStart, latestRev);
        input.lastSavedRevById[project.id] = revAtStart;
        dispatch({
          type: 'clear-dirty-after-file-save',
          projectId: project.id,
          clearDirty,
        });
        input.onSaved(project.id);
      }
      return outcome;
    } catch {
      dispatch({ type: 'toast', message: stashStepFailed ? SAVE_AND_STASH_FAIL : SAVE_FATAL_FAIL });
      return null;
    }
  };
  const promise = runManual();
  const entry = { kind: 'manual' as const, projectId: project.id, promise };
  input.inflight.current = entry;
  try {
    return await promise;
  } finally {
    if (input.inflight.current === entry) {
      input.inflight.current = null;
    }
  }
}

async function refreshLoadedTargetPerm(
  bookKey: string,
  target: { file: DiskFile | null; lastKnownFingerprint?: string | null } | null,
  canPick: boolean,
): Promise<HandlePermissionState> {
  if (recallOpenFile(bookKey) === undefined) {
    rememberLoadedTarget(bookKey, target);
  }
  const file = recallOpenFile(bookKey) ?? target?.file ?? null;
  if (!file || !canPick) return 'none';
  try {
    return await file.queryPermission();
  } catch {
    return 'none';
  }
}

export function persistLocalAutoStash(input: {
  store: KeyValueStore;
  projects: readonly DemoProject[];
  activeProjectId: string | null;
  dispatch: (action: Action) => void;
  onStashResult: (projectId: string, ok: boolean, showToastOnFirstFail: boolean) => void;
  nowMs?: number;
}): boolean {
  const active = input.projects.find((project) => project.id === input.activeProjectId);
  try {
    saveProjects(
      input.store,
      input.projects.filter((project) => project.origin !== 'file' && !isBookRemoved(project.id)),
    );
    if (active && active.origin !== 'file') {
      input.dispatch({ type: 'record-auto-save', projectId: active.id, atMs: input.nowMs ?? Date.now() });
      input.onStashResult(active.id, true, false);
    }
    return true;
  } catch {
    if (active && active.origin !== 'file') {
      input.onStashResult(active.id, false, true);
    }
    return false;
  }
}

export async function persistFileBookStash(input: {
  state: SampleState;
  project: DemoProject;
  extra: FileExtras;
  dispatch: (action: Action) => void;
  onStashResult: (projectId: string, ok: boolean, showToastOnFirstFail: boolean) => void;
  saveBytes?: typeof saveBookBytes;
  nowMs?: number;
}): Promise<boolean> {
  const { state, project, extra } = input;
  if (!project.dbKey) return false;
  const save = input.saveBytes ?? saveBookBytes;
  try {
    await save(
      project.dbKey,
      localDbFilename(project.title, project.filename),
      project.title,
      buildFileProjectInfo(state, project),
      project.nodes,
      extra.cards,
      extra.logs,
      bookkeepingOf(project),
      true,
      projectImportEventsOf(state, project.id),
      projectExportEventsOf(state, project.id),
    );
    input.dispatch({ type: 'record-auto-save', projectId: project.id, atMs: input.nowMs ?? Date.now() });
    input.onStashResult(project.id, true, false);
    return true;
  } catch {
    input.onStashResult(project.id, false, true);
    return false;
  }
}

/**
 * WO-133 中-4(a)：立即把指定稿件的目前狀態寫進本機暫存（檔案稿直接寫入 App 空間，不等 250ms debounce；
 * 非檔案稿直接寫入 localStorage），回傳是否寫入成功。
 */
export async function persistProjectNow(input: {
  state: SampleState;
  projectId: string;
  dispatch: (action: Action) => void;
  onStashResult: (projectId: string, ok: boolean, showToastOnFirstFail: boolean) => void;
  store?: KeyValueStore | null;
  saveBytes?: typeof saveBookBytes;
}): Promise<boolean> {
  const project = input.state.projects.find((item) => item.id === input.projectId);
  if (!project || isBookRemoved(project.id)) return false;
  if (project.origin === 'file' && project.dbKey) {
    const extra = input.state.fileExtras[project.dbKey];
    if (!extra) return false;
    return persistFileBookStash({
      state: input.state,
      project,
      extra,
      dispatch: input.dispatch,
      onStashResult: input.onStashResult,
      saveBytes: input.saveBytes,
    });
  }
  const store =
    input.store === undefined
      ? typeof localStorage === 'undefined'
        ? null
        : localStorage
      : input.store;
  if (!store) return false;
  return persistLocalAutoStash({
    store,
    projects: input.state.projects,
    activeProjectId: project.id,
    dispatch: input.dispatch,
    onStashResult: input.onStashResult,
  });
}

export function SampleProvider({
  children,
  initialState,
  saveEnv,
  autoSaveIntervalMs = AUTOSAVE_INTERVAL_MS,
}: {
  children?: ReactNode;
  /** WO-95：測試明確放入的起始狀態（例如範例書情境）；App 不傳，一律從本機儲存讀。 */
  initialState?: SampleState;
  /** WO-130：測試用存檔環境注入（不傳時沿用瀏覽器既有環境）。 */
  saveEnv?: SaveEnvironment;
  /** WO-130：測試用自動存檔週期（預設 5 分鐘）。 */
  autoSaveIntervalMs?: number;
}) {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState ?? createState(new Date()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const importBusyRef = useRef(false);
  const exportBusyRef = useRef(false);
  // WO-110：手機暫存稿（loadStoredBooks）回復完成或確定讀不到後才是 true。
  const [deviceLoaded, setDeviceLoaded] = useState(false);

  const saveEnvRef = useRef(saveEnv);
  saveEnvRef.current = saveEnv;
  const getSaveEnv = useCallback((): SaveEnvironment => saveEnvRef.current ?? browserSaveEnv(), []);
  const canPickFiles = saveEnv ? saveEnv.canPickFiles : canPickLocalFiles();

  const [handlePermById, setHandlePermById] = useState<Record<string, HandlePermissionState>>({});
  const handlePermRef = useRef(handlePermById);
  handlePermRef.current = handlePermById;
  const [autoSaveFailedById, setAutoSaveFailedById] = useState<Record<string, boolean>>({});
  const autoSaveFailedRef = useRef(autoSaveFailedById);
  autoSaveFailedRef.current = autoSaveFailedById;
  const [autoSaveConflictById, setAutoSaveConflictById] = useState<Record<string, boolean>>({});
  const autoSaveConflictRef = useRef(autoSaveConflictById);
  autoSaveConflictRef.current = autoSaveConflictById;
  const [stashFailedById, setStashFailedById] = useState<Record<string, boolean>>({});
  const stashFailedRef = useRef(stashFailedById);
  stashFailedRef.current = stashFailedById;

  const markStashResult = useCallback((projectId: string, ok: boolean, showToastOnFirstFail: boolean) => {
    if (ok) {
      if (stashFailedRef.current[projectId]) {
        stashFailedRef.current = { ...stashFailedRef.current, [projectId]: false };
        setStashFailedById((prev) => (prev[projectId] ? { ...prev, [projectId]: false } : prev));
      }
      return;
    }
    const wasFailed = Boolean(stashFailedRef.current[projectId]);
    stashFailedRef.current = { ...stashFailedRef.current, [projectId]: true };
    setStashFailedById((prev) => (prev[projectId] ? prev : { ...prev, [projectId]: true }));
    if (showToastOnFirstFail && !wasFailed) {
      dispatch({ type: 'toast', message: STASH_AUTO_FAILED_TOAST });
    }
  }, []);
  const [lastSaveWasAutoById, setLastSaveWasAutoById] = useState<Record<string, boolean>>({});
  const lastSavedRevByIdRef = useRef<Record<string, number>>({});
  const fileSaveInflightRef = useRef<{ kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null>(null);
  const restoringArchiveIdsRef = useRef(new Set<string>());

  const refreshHandlePermission = useCallback(
    async (project: DemoProject | null | undefined): Promise<HandlePermissionState> => {
      if (!project || isSampleBook(project) || isBookRemoved(project.id) || isBookRemoved(project.dbKey)) {
        return 'none';
      }
      const env = getSaveEnv();
      if (!env.canPickFiles) return 'none';
      const key = project.dbKey ?? project.id;
      let file = recallOpenFile(key);
      if (file === undefined) {
        try {
          const target = await env.targets.load(key);
          file = rememberLoadedTarget(key, target);
        } catch {
          file = null;
        }
      }
      if (!file) {
        setHandlePermById((prev) => (prev[project.id] === 'none' ? prev : { ...prev, [project.id]: 'none' }));
        return 'none';
      }
      let perm: HandlePermissionState = 'prompt';
      try {
        perm = await file.queryPermission();
      } catch {
        perm = 'none';
      }
      setHandlePermById((prev) => (prev[project.id] === perm ? prev : { ...prev, [project.id]: perm }));
      return perm;
    },
    [getSaveEnv],
  );

  const autoSaveStatusOf = useCallback(
    (projectId: string, overridePerm?: HandlePermissionState): AutoSaveStatus => {
      const current = stateRef.current;
      const project = current.projects.find((item) => item.id === projectId);
      const envCanPick = saveEnvRef.current ? saveEnvRef.current.canPickFiles : canPickLocalFiles();
      if (!project) return envCanPick ? 'unsaved' : 'unsupported';
      const meta = current.saveMeta[projectId];
      const needsNewName = shouldSaveUnderNewName({
        hasExternalFile: Boolean(project.hasExternalFile),
        titleInFile: project.titleInFile ?? null,
        title: project.title,
        filename: project.filename ?? null,
      });
      return resolveAutoSaveStatus({
        canPickFiles: envCanPick,
        isSample: isSampleBook(project),
        removed: isBookRemoved(project.id) || isBookRemoved(project.dbKey),
        hasSavedFile: hasSavedExternalFile(meta),
        needsNewName,
        permission: overridePerm ?? handlePermRef.current[project.id] ?? 'none',
        lastAutoSaveFailed: Boolean(autoSaveFailedRef.current[project.id]),
        hasExternalConflict: Boolean(autoSaveConflictRef.current[project.id]),
      });
    },
    [],
  );

  const performBackgroundAutoSave = useCallback(
    async (projectId: string, options?: { forceGranted?: boolean }): Promise<AutoSaveOutcome | 'skipped' | 'no-changes'> =>
      executeBackgroundAutoSave({
        projectId,
        getState: () => stateRef.current,
        dispatch,
        env: getSaveEnv(),
        getStatus: (id) => autoSaveStatusOf(id, options?.forceGranted ? 'granted' : undefined),
        lastSavedRevById: lastSavedRevByIdRef.current,
        inflight: fileSaveInflightRef,
        isPreviouslyFailed: () => Boolean(autoSaveFailedRef.current[projectId]),
        onSaved: (id) => {
          autoSaveFailedRef.current = { ...autoSaveFailedRef.current, [id]: false };
          setAutoSaveFailedById((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
          autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [id]: false };
          setAutoSaveConflictById((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
          setLastSaveWasAutoById((prev) => ({ ...prev, [id]: true }));
        },
        onNeedsPermission: (id, permission) => {
          setHandlePermById((prev) => ({ ...prev, [id]: permission }));
        },
        onFailed: (id) => {
          setAutoSaveFailedById((prev) => ({ ...prev, [id]: true }));
        },
        onConflict: (id) => {
          autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [id]: true };
          setAutoSaveConflictById((prev) => ({ ...prev, [id]: true }));
        },
        onNoHandle: (id) => {
          setHandlePermById((prev) => ({ ...prev, [id]: 'none' }));
        },
      }),
    [autoSaveStatusOf, getSaveEnv],
  );

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    persistLocalAutoStash({
      store: localStorage,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      dispatch,
      onStashResult: markStashResult,
    });
  }, [state.projects, state.activeProjectId, markStashResult]);

  // WO-77：暫存／另存時間與新稿子的寫作紀錄跟著留在這個裝置，重新整理後還在。
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
          // WO-116：刪除前就已開始的讀取，讀到已刪稿子也不掛回。
          if (isBookRemoved(book.key)) continue;
          let tree = book.tree;
          if (draft && draft.projectId === book.key && findNode(book.tree, draft.chapterId)) {
            tree = updateNode(book.tree, draft.chapterId, (node) => ({ ...node, content: draft.text }));
            appliedDraft = true;
          }
          // WO-111 返工1：導覽在這份檔案稿選過每日目標，就用裝置記下的值。
          const restored = applyTourFileGoal(book, deviceStore(), new Date());
          dispatch(attachActionForBook(restored, { updatedLabel: STORED_ON_PHONE_LABEL, nodes: tree, quiet: true }));
        }
        if (appliedDraft && typeof localStorage !== 'undefined') clearLiveDraft(localStorage);
        setDeviceLoaded(true);
        for (const book of books.filter((item) => !isBookRemoved(item.key))) {
          void getSaveEnv()
            .targets.load(book.key)
            .then((target) => refreshLoadedTargetPerm(book.key, target, getSaveEnv().canPickFiles))
            .then((perm) => {
              if (!cancelled) {
                setHandlePermById((prev) => (prev[book.key] === perm ? prev : { ...prev, [book.key]: perm }));
              }
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        // 沒有手機儲存空間時，其他稿子仍可寫。
        if (!cancelled) setDeviceLoaded(true);
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
      persistFileBookStash({
        state,
        project,
        extra,
        dispatch,
        onStashResult: markStashResult,
      });
    const timer = window.setTimeout(() => void save(), 250);
    return () => {
      window.clearTimeout(timer);
      void save();
    };
  }, [state.projects, state.fileExtras, state.activeProjectId, state.importEvents, state.exportEvents, markStashResult]);

  useEffect(() => {
    const flush = () => {
      // WO-116：離頁寫回也不能把已刪稿子寫回（舊狀態、編輯框殘留的草稿都要擋）。
      const latest = stateRef.current;
      const current = latest.projects.some((item) => isBookRemoved(item.id))
        ? { ...latest, projects: latest.projects.filter((item) => !isBookRemoved(item.id)) }
        : latest;
      let projects = current.projects;
      const editorLive = readLiveDraftFromEditor();
      const live = editorLive && !isBookRemoved(editorLive.projectId) ? editorLive : null;
      try {
        if (typeof localStorage !== 'undefined') {
          projects = flushOpenDraft({ store: localStorage, projects: current.projects, read: () => live });
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
    const active = state.projects.find((item) => item.id === state.activeProjectId);
    if (!active) return;
    void refreshHandlePermission(active);
  }, [state.activeProjectId, state.projects.length, refreshHandlePermission]);

  useEffect(() => {
    const onCheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const current = stateRef.current;
      const active = current.projects.find((item) => item.id === current.activeProjectId);
      if (active) void refreshHandlePermission(active);
    };
    window.addEventListener('focus', onCheck);
    document.addEventListener('visibilitychange', onCheck);
    return () => {
      window.removeEventListener('focus', onCheck);
      document.removeEventListener('visibilitychange', onCheck);
    };
  }, [refreshHandlePermission]);

  const activeAutoSaveStatus = state.activeProjectId ? autoSaveStatusOf(state.activeProjectId) : 'unsupported';
  useEffect(() => {
    const activeId = state.activeProjectId;
    if (!activeId || (activeAutoSaveStatus !== 'active' && activeAutoSaveStatus !== 'failed')) return;
    return startAutoSaveScheduler({
      intervalMs: autoSaveIntervalMs,
      onDue: () => {
        void performBackgroundAutoSave(activeId);
      },
      host: {
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (handle) => window.clearInterval(handle),
        now: () => Date.now(),
      },
    });
  }, [state.activeProjectId, activeAutoSaveStatus, autoSaveIntervalMs, performBackgroundAutoSave]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'toast', message: null }),
      toastDurationMs(state.toast),
    );
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  const actions = useMemo<SampleActions>(
    () => ({
      dismissRecent: (id) => dispatch({ type: 'dismiss-recent', id }),
      removeFromDevice: async (id) => {
        const project = stateRef.current.projects.find((item) => item.id === id);
        if (!project) return false;
        const done = await removeProjectFromDevice({ project, store: deviceStore() });
        if (!done) {
          dispatch({ type: 'toast', message: '沒能刪掉這個裝置上的稿子，稿子還在，請再試一次。' });
          return false;
        }
        dispatch({ type: 'remove-project', id });
        return true;
      },
      addProject: (title, shape = 'novel') => {
        const startedMs = Date.now();
        const id = `p-${startedMs}`;
        dispatch(addProjectAction(id, title, shape, startedMs));
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
      applyFormat: (projectId, changes, snapshot) =>
        dispatch({ type: 'format-apply', projectId, changes, snapshot }),
      undoFormat: (projectId, entries) => dispatch({ type: 'format-undo', projectId, entries }),
      clearFormatUndo: () => dispatch({ type: 'format-clear' }),
      addDuration: (seconds) => dispatch({ type: 'add-duration', seconds }),
      setGoal: (goal) => dispatch({ type: 'set-goal', goal }),
      setTourDailyGoal: (goal) =>
        commitTourDailyGoal({ state: stateRef.current, goal, now: new Date(), store: deviceStore(), dispatch }),
      setHour: (hour) => dispatch({ type: 'set-hour', hour }),
      setBookGoal: (projectId, bookGoal) => dispatch({ type: 'set-book-goal', projectId, bookGoal }),
      addScene: (projectId, chapterId) =>
        dispatch({ type: 'add-scene', projectId, chapterId, sceneId: `sc-${Date.now()}` }),
      setNodes: (projectId, nodes, options) =>
        dispatch({
          type: 'set-nodes',
          projectId,
          nodes,
          restoreTimelineLinks: options?.restoreTimelineLinks,
        }),
      setCards: (projectId, cards) => dispatch({ type: 'set-cards', projectId, cards }),
      updateCard: (projectId, cardId, patch) =>
        dispatch({ type: 'update-card', projectId, cardId, patch }),
      setCardCategories: (projectId, payload) =>
        dispatch({ type: 'set-card-categories', projectId, ...payload }),
      deleteCard: (projectId, cardId, options) =>
        deleteProjectCardWithArchive(stateRef.current, dispatch, projectId, cardId, options),
      restoreDeletedCard: async (projectId, recordOrId, options) => {
        const keySuffix = typeof recordOrId === 'string' ? recordOrId : recordOrId.id;
        const guardKey = `${projectId}:card:${keySuffix}`;
        if (restoringArchiveIdsRef.current.has(guardKey)) return null;
        restoringArchiveIdsRef.current.add(guardKey);
        try {
          return await restoreProjectCardFromArchive(
            stateRef.current,
            dispatch,
            projectId,
            recordOrId,
            {
              ...options,
              persistBook: (nextState) =>
                persistProjectNow({
                  state: nextState,
                  projectId,
                  dispatch,
                  onStashResult: markStashResult,
                }),
            },
          );
        } finally {
          restoringArchiveIdsRef.current.delete(guardKey);
        }
      },
      restoreDeletedChapter: async (projectId, record, nodes, options) => {
        const guardKey = `${projectId}:chapter:${record.id}`;
        if (restoringArchiveIdsRef.current.has(guardKey)) return { persisted: false };
        restoringArchiveIdsRef.current.add(guardKey);
        try {
          return await restoreDeletedChapterWithArchive({
            state: stateRef.current,
            dispatch,
            projectId,
            record,
            nodes,
            archive: options?.archive,
            persistBook: (nextState) =>
              persistProjectNow({
                state: nextState,
                projectId,
                dispatch,
                onStashResult: markStashResult,
              }),
          });
        } finally {
          restoringArchiveIdsRef.current.delete(guardKey);
        }
      },
      addTimelineEvent: (projectId, input) => {
        const currentCards = getProjectCards(stateRef.current, projectId);
        const nextOrder =
          input?.timelineOrder !== undefined
            ? input.timelineOrder
            : nextTimelineOrderForNewEvent(currentCards);
        const nextCards = addCardToList(currentCards, {
          ...input,
          category: CATEGORY_TIMELINE,
          parentId: null,
          ...(nextOrder !== null ? { timelineOrder: nextOrder } : {}),
        });
        const created = nextCards[nextCards.length - 1] ?? null;
        if (!created || nextCards.length === currentCards.length) return null;
        dispatch({ type: 'set-cards', projectId, cards: nextCards });
        return created;
      },
      reorderTimeline: (projectId, orderedIds) =>
        dispatch({ type: 'reorder-timeline', projectId, orderedIds }),
      moveTimelineEvent: (projectId, cardId, move) =>
        dispatch({ type: 'move-timeline-event', projectId, cardId, ...move }),
      focusProject: (id) => dispatch({ type: 'focus-project', id }),
      attachImported: (payload) => dispatch({ type: 'attach-file', ...payload }),
      importFile: async (file: File, diskFile?: DiskFile | null) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return openDatabaseManuscript({
          filename: file.name,
          bytes,
          diskFile: diskFile ?? null,
          dispatch,
          env: getSaveEnv(),
          store: deviceStore(),
          onClearConflict: (bookKey) => {
            autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [bookKey]: false };
            setAutoSaveConflictById((prev) => (prev[bookKey] ? { ...prev, [bookKey]: false } : prev));
          },
        });
      },
      openWithPicker: async () => {
        const picked = await pickExistingDatabase();
        if (!picked) return null;
        const copy = new Uint8Array(picked.bytes.byteLength);
        copy.set(picked.bytes);
        return openDatabaseManuscript({
          filename: picked.file.name,
          bytes: copy,
          diskFile: picked.file,
          dispatch,
          env: getSaveEnv(),
          store: deviceStore(),
          onClearConflict: (bookKey) => {
            autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [bookKey]: false };
            setAutoSaveConflictById((prev) => (prev[bookKey] ? { ...prev, [bookKey]: false } : prev));
          },
        });
      },
      importTextFile: async (file) => {
        const outcome = await runTextImport({
          filename: file.name,
          readBytes: async () => new Uint8Array(await file.arrayBuffer()),
          getState: () => stateRef.current,
          dispatch,
          store: deviceStore(),
          busy: importBusyRef,
        });
        if (outcome.kind === 'imported') {
          await persistImportedRecord({ state: outcome.afterState, projectId: outcome.id, dispatch });
        }
        return outcome;
      },
      readImportText: (file) =>
        prepareTextImport({ readBytes: async () => new Uint8Array(await file.arrayBuffer()) }),
      previewImportText: (text, example) => previewTextImport(text, example),
      confirmImportText: async ({ filename, chapters }) => {
        const outcome = await runConfirmedImport({
          filename,
          chapters,
          getState: () => stateRef.current,
          dispatch,
          store: deviceStore(),
          busy: importBusyRef,
        });
        if (outcome.kind === 'imported') {
          await persistImportedRecord({ state: outcome.afterState, projectId: outcome.id, dispatch });
        }
        return outcome;
      },
      exportFullText: (request, options) =>
        runFullTextExport({
          request,
          getState: () => stateRef.current,
          dispatch,
          store: deviceStore(),
          busy: exportBusyRef,
          prepared: options?.prepared,
          isCancelled: options?.isCancelled,
        }),
      stashDraft: async () => {
        const latestState = stateRef.current;
        const project = latestState.projects.find((item) => item.id === latestState.activeProjectId);
        if (!project) return;
        try {
          const { state: committedState, project: committedProject } = commitLiveDraft(latestState, project.id, dispatch);
          const { key } = await snapshotManuscript(committedState, committedProject);
          dispatch({
            type: 'promote-stored',
            projectId: project.id,
            key,
            filename: projectSaveFilename(committedProject.title, committedProject.filename),
          });
          dispatch({ type: 'record-manual-save', projectId: project.id, atMs: Date.now() });
          markStashResult(project.id, true, false);
          dispatch({ type: 'toast', message: '已暫存' });
        } catch {
          markStashResult(project.id, false, false);
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
      saveProject: () =>
        runManualSaveProject({
          getState: () => stateRef.current,
          dispatch,
          env: getSaveEnv(),
          inflight: fileSaveInflightRef,
          lastSavedRevById: lastSavedRevByIdRef.current,
          onSaved: (projectId) => {
            autoSaveFailedRef.current = { ...autoSaveFailedRef.current, [projectId]: false };
            setAutoSaveFailedById((prev) => (prev[projectId] ? { ...prev, [projectId]: false } : prev));
            autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [projectId]: false };
            setAutoSaveConflictById((prev) => (prev[projectId] ? { ...prev, [projectId]: false } : prev));
            markStashResult(projectId, true, false);
            setLastSaveWasAutoById((prev) => ({ ...prev, [projectId]: false }));
            handlePermRef.current = { ...handlePermRef.current, [projectId]: 'granted' };
            setHandlePermById((prev) => ({ ...prev, [projectId]: 'granted' }));
          },
          onConflict: (projectId) => {
            autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [projectId]: true };
            setAutoSaveConflictById((prev) => ({ ...prev, [projectId]: true }));
          },
          onStashFailed: (projectId) => {
            markStashResult(projectId, false, false);
          },
          isStashFailed: (projectId) => Boolean(stashFailedRef.current[projectId]),
        }),
      saveProjectAs: async () => {
        if (fileSaveInflightRef.current) {
          await fileSaveInflightRef.current.promise.catch(() => undefined);
        }
        const latestState = stateRef.current;
        const project = latestState.projects.find((item) => item.id === latestState.activeProjectId);
        if (!project) return null;
        const env = getSaveEnv();
        const prepared = peekPreparedShare(project.id);
        dismissRenameSavePrompt(project.id);
        const runManualAs = async (): Promise<SaveOutcome | null> => {
          try {
            const { bytes, outcome, revAtStart, rememberedFile, localStashOk } = await runSaveProjectAs({
              state: latestState,
              project,
              dispatch,
              env,
              preparedBytes: prepared?.bytes ?? null,
            });
            const store = deviceStore();
            if (store && (outcome.kind === 'saved-as' || outcome.kind === 'handed-off')) {
              await noteExportedBytes(store, bytes, Date.now()).catch(() => undefined);
              const linked = await linkImportEventsToBytes(store, project.id, bytes).catch(() => null);
              if (linked) dispatch({ type: 'set-import-events', importEvents: linked });
              const linkedExports = await linkExportEventsToBytes(store, project.id, bytes).catch(() => null);
              if (linkedExports) dispatch({ type: 'set-export-events', exportEvents: linkedExports });
            }
            if (outcome.kind === 'saved-as' && rememberedFile) {
              handlePermRef.current = { ...handlePermRef.current, [project.id]: 'granted' };
              setHandlePermById((prev) => ({ ...prev, [project.id]: 'granted' }));
            }
            if (outcome.kind === 'saved-as' || outcome.kind === 'handed-off') {
              const latestRev = stateRef.current.contentRevById?.[project.id] ?? 0;
              const clearDirty = shouldClearDirtyAfterSave(revAtStart, latestRev);
              lastSavedRevByIdRef.current[project.id] = revAtStart;
              dispatch({
                type: 'clear-dirty-after-file-save',
                projectId: project.id,
                clearDirty,
              });
              autoSaveFailedRef.current = { ...autoSaveFailedRef.current, [project.id]: false };
              setAutoSaveFailedById((prev) => (prev[project.id] ? { ...prev, [project.id]: false } : prev));
              autoSaveConflictRef.current = { ...autoSaveConflictRef.current, [project.id]: false };
              setAutoSaveConflictById((prev) => (prev[project.id] ? { ...prev, [project.id]: false } : prev));
              markStashResult(project.id, localStashOk, false);
              setLastSaveWasAutoById((prev) => ({ ...prev, [project.id]: false }));
            }
            return outcome;
          } catch {
            dispatch({
              type: 'toast',
              message: stashFailedRef.current[project.id] ? SAVE_AND_STASH_FAIL : SAVE_FATAL_FAIL,
            });
            return null;
          }
        };
        const promise = runManualAs();
        const entry = { kind: 'manual' as const, projectId: project.id, promise };
        fileSaveInflightRef.current = entry;
        try {
          return await promise;
        } finally {
          if (fileSaveInflightRef.current === entry) {
            fileSaveInflightRef.current = null;
          }
        }
      },
      resumeAutoSave: async () => {
        const currentState = stateRef.current;
        const project = currentState.projects.find((item) => item.id === currentState.activeProjectId);
        if (!project) return 'no-handle';
        return runResumeAutoSave({
          project,
          state: currentState,
          env: getSaveEnv(),
          lastSavedRevById: lastSavedRevByIdRef.current,
          onPermissionChange: (id, perm) => {
            handlePermRef.current = { ...handlePermRef.current, [id]: perm };
            setHandlePermById((prev) => ({ ...prev, [id]: perm }));
          },
          dispatch,
          runAutoSave: () => performBackgroundAutoSave(project.id, { forceGranted: true }),
        });
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
    countImportEvents(projectExportEventsOf(state, state.activeProjectId)),
  );
  const bookWords = useCallback(
    (projectId: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return 0;
      return countBookWords(project.nodes);
    },
    [state.projects],
  );

  const lastSaveWasAutoOf = useCallback(
    (projectId: string) => Boolean(lastSaveWasAutoById[projectId]),
    [lastSaveWasAutoById],
  );

  const autoSaveStatusForContext = useCallback(
    (projectId: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return canPickFiles ? 'unsaved' : 'unsupported';
      const meta = state.saveMeta[projectId];
      const needsNewName = shouldSaveUnderNewName({
        hasExternalFile: Boolean(project.hasExternalFile),
        titleInFile: project.titleInFile ?? null,
        title: project.title,
        filename: project.filename ?? null,
      });
      return resolveAutoSaveStatus({
        canPickFiles,
        isSample: isSampleBook(project),
        removed: isBookRemoved(project.id) || isBookRemoved(project.dbKey),
        hasSavedFile: hasSavedExternalFile(meta),
        needsNewName,
        permission: handlePermById[project.id] ?? 'none',
        lastAutoSaveFailed: Boolean(autoSaveFailedById[project.id]),
        hasExternalConflict: Boolean(autoSaveConflictById[project.id]),
      });
    },
    [state.projects, state.saveMeta, canPickFiles, handlePermById, autoSaveFailedById, autoSaveConflictById],
  );

  const stashFailedOf = useCallback(
    (projectId: string) => Boolean(stashFailedById[projectId]),
    [stashFailedById],
  );

  const value = useMemo(
    () => ({
      state,
      actions,
      achievementCount,
      isGlowing,
      stats,
      bookWords,
      autoSaveStatusOf: autoSaveStatusForContext,
      lastSaveWasAutoOf,
      stashFailedOf,
      deviceLoaded,
    }),
    [
      state,
      actions,
      achievementCount,
      isGlowing,
      stats,
      bookWords,
      autoSaveStatusForContext,
      lastSaveWasAutoOf,
      stashFailedOf,
      deviceLoaded,
    ],
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
