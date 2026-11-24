/**
 * WO-135 刪章復原時間線修正・自動化重現與驗收測試。
 * 僅使用【範例】假稿與記憶體假空間／假磁碟，絕不碰觸真實書稿或實體 .db。
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STASH_AUTO_FAILED_TOAST } from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import {
  createMemoryAppSpace,
  createMirroredSpace,
  type AppSpace,
  type StoredBook,
} from '../db/appSpace';
import * as browserSpace from '../db/browserSpace';
import { createArchiveClient } from '../db/chapterArchive';
import {
  createMemoryTargetStore,
  type DiskFile,
} from '../db/fileTarget';
import { loadStoredBooks, readBookBytes, saveBookBytes } from '../db/library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from '../db/migrations';
import { forgetOpenFile } from '../db/openFileMemory';
import { writeFileProject, type FileCard, type FileProjectInfo } from '../db/projectFile';
import type { SaveEnvironment } from '../db/saveProject';
import { readTimelineData } from '../db/timelineMeta';
import { openMemoryDb } from '../db/wasmDb';
import { CATEGORY_AI_CHAT, CATEGORY_CHARACTER, CATEGORY_TIMELINE } from '../domain/cardCategories';
import { expandToNode, placeRecovered, withoutNode } from '../domain/chapterOps';
import {
  archiveDeletion,
  deletedFromNode,
  emptyArchive,
  type BookArchive,
} from '../domain/chapterVersions';
import { loadProjects } from '../domain/outline';
import { buildTimelineModel } from '../domain/timeline';
import { nodesAfterDeleteUndo } from '../domain/undoDelete';
import {
  attachActionForBook,
  createFileBookAutoStashController,
  createFileBookStashCoordinator,
  createState,
  executeBackgroundAutoSave,
  getProjectCards,
  manuscriptBytesOn,
  persistFileBookStash,
  persistProjectNow,
  reduce,
  restoreDeletedChapterWithArchive,
  runManualSaveProject,
  runSaveProjectAs,
  verifyBytesForSave,
  type Action,
  type SampleState,
} from './sampleStore';

const NOW_MS = Date.parse('2026-11-24T15:10:00+08:00');
const touchedKeys: string[] = [];

class FakeDisk implements DiskFile {
  bytes: Uint8Array;
  permission: 'granted' | 'prompt' | 'denied' = 'granted';
  writeCalls = 0;

  constructor(readonly name: string, initial: Uint8Array = new Uint8Array()) {
    this.bytes = initial.slice();
  }

  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }

  async write(next: Uint8Array): Promise<void> {
    this.writeCalls += 1;
    this.bytes = next.slice();
  }

  async queryPermission(): Promise<'granted' | 'prompt' | 'denied'> {
    return this.permission;
  }

  async requestPermission(): Promise<'granted' | 'denied'> {
    this.permission = 'granted';
    return 'granted';
  }
}

function createMemoryArchiveClient() {
  const store = new Map<string, BookArchive>();
  return createArchiveClient({
    async read(bookId) {
      return store.get(bookId) ?? emptyArchive();
    },
    async write(bookId, archive) {
      store.set(bookId, archive);
    },
  });
}

function createMemoryKvStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function createFakeEnv(picked: DiskFile | null = null): {
  env: SaveEnvironment;
  setPicked: (file: DiskFile | null) => void;
} {
  const targets = createMemoryTargetStore();
  let nextPick = picked;
  return {
    env: {
      canPickFiles: true,
      targets,
      verify: verifyBytesForSave,
      pickSaveLocation: async () => nextPick,
      share: async () => 'cancelled',
    },
    setPicked: (file) => {
      nextPick = file;
    },
  };
}

function makeFileInfo(title = '【範例】刪章復原測試書'): FileProjectInfo {
  return {
    title,
    logline: '',
    currentTheme: '',
    globalFontFamily: '',
    globalFontSize: 12,
    editorFontFamily: '',
    editorFontSize: 16,
    targetWordCount: 50000,
    dailyTargetWordCount: 1000,
    categoryOrder: null,
    expandedCategories: null,
    categoriesMeta: '{}',
    lastOpenedNodeId: 'ch-1',
    lastCursorPosition: 0,
  };
}

function makeSampleTree(): ChapterNode[] {
  return [
    {
      id: 'vol-1',
      type: 'folder',
      title: '第一卷　起風',
      expanded: true,
      children: [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　霧港來客',
          progress: 'Draft',
          content: '【範例】第一章霧港來客正文。',
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　鐘樓回聲',
          progress: 'Draft',
          content: '【範例】第二章鐘樓回聲正文。',
        },
      ],
    },
    {
      id: 'vol-2',
      type: 'folder',
      title: '第二卷　暗潮',
      expanded: true,
      children: [
        {
          id: 'ch-3',
          type: 'file',
          title: '第三章　舊信封',
          progress: 'Draft',
          content: '【範例】第三章舊信封正文。',
        },
      ],
    },
  ];
}

function makeSampleCards(): FileCard[] {
  return [
    {
      id: 'evt-1',
      parent_id: null,
      category: CATEGORY_TIMELINE,
      title: '【範例】事件甲：碼頭遇襲',
      content: '【範例】事件甲描述',
      color: '#61AFEF',
      is_collapsed: 0,
      sort_order: 0,
      storyTime: '第一年春',
      timelineOrder: 0,
      chapterId: 'ch-1',
    },
    {
      id: 'evt-2',
      parent_id: null,
      category: CATEGORY_TIMELINE,
      title: '【範例】事件乙：發現密信',
      content: '【範例】事件乙描述',
      color: '#61AFEF',
      is_collapsed: 0,
      sort_order: 1,
      storyTime: '第一年夏',
      timelineOrder: 1,
      chapterId: 'ch-1',
    },
    {
      id: 'evt-3',
      parent_id: null,
      category: CATEGORY_TIMELINE,
      title: '【範例】事件丙：鐘樓對質',
      content: '【範例】事件丙描述',
      color: '#98C379',
      is_collapsed: 0,
      sort_order: 2,
      storyTime: '第一年秋',
      timelineOrder: 2,
      chapterId: 'ch-2',
    },
    {
      id: 'evt-4',
      parent_id: null,
      category: CATEGORY_TIMELINE,
      title: '【範例】事件丁：火燒檔案室',
      content: '【範例】事件丁描述',
      color: '#E5C07B',
      is_collapsed: 0,
      sort_order: 3,
      storyTime: '第二年冬',
      timelineOrder: 3,
      chapterId: 'ch-3',
    },
    {
      id: 'char-1',
      parent_id: null,
      category: CATEGORY_CHARACTER,
      title: '【範例】主角沈霧',
      content: '【範例】角色卡片內容',
      color: '#61AFEF',
      is_collapsed: 0,
      sort_order: 0,
    },
    {
      id: 'ai-1',
      parent_id: null,
      category: CATEGORY_AI_CHAT,
      title: '【範例】AI 對話紀錄',
      content: '【範例】不應被改動的 AI 對話內容',
      color: '#61AFEF',
      is_collapsed: 0,
      sort_order: 0,
    },
  ];
}

async function createSampleDbBytes(tree = makeSampleTree(), cards = makeSampleCards()): Promise<Uint8Array> {
  const db = await openMemoryDb(new Uint8Array());
  try {
    writeFileProject(db.sql, makeFileInfo(), tree, cards, []);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

function createControlledMirroredSpace(options?: {
  onPut?: (book: StoredBook, target: 'primary' | 'backup') => Promise<void>;
}) {
  const rawPrimary = createMemoryAppSpace();
  const rawBackup = createMemoryAppSpace();
  const wrap = (inner: AppSpace, target: 'primary' | 'backup'): AppSpace => ({
    async put(book) {
      if (options?.onPut) {
        await options.onPut(book, target);
      }
      await inner.put(book);
    },
    get: (key) => inner.get(key),
    list: () => inner.list(),
    remove: (key) => inner.remove(key),
  });
  return createMirroredSpace(wrap(rawPrimary, 'primary'), wrap(rawBackup, 'backup'));
}

async function setupFileBook(space: AppSpace, key = 'file-wo135-test'): Promise<{
  state: SampleState;
  projectId: string;
}> {
  touchedKeys.push(key);
  const bytes = await createSampleDbBytes();
  await space.put({
    key,
    filename: 'wo135-sample.db',
    title: '【範例】刪章復原測試書',
    bytes,
    hasExternalFile: true,
    titleInFile: '【範例】刪章復原測試書',
    titleSavePending: null,
  });
  vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(space);
  const books = await loadStoredBooks(new Date(NOW_MS));
  let state = createState(new Date(NOW_MS));
  state = reduce(state, attachActionForBook(books[0]!, { updatedLabel: '剛剛' }));
  state = reduce(state, { type: 'focus-project', id: key });
  return { state, projectId: key };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  for (const key of touchedKeys.splice(0)) {
    forgetOpenFile(key);
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WO-135 第 1 段：檔案稿刪章即時復原競態重現與驗收骨架', () => {
  it('重現並驗證：檔案稿刪章後按即時復原，過期 S_del cleanup 暫存寫入絕不可蓋回 S_restored', async () => {
    // 模擬真實瀏覽器 OPFS／IndexedDB 非同步完成順序：
    // 先開始的 S_restored 寫入在主空間慢一點結束，而後觸發的過期 S_del cleanup 也打進同一本稿。
    let releaseRestoredPut!: () => void;
    const restoredPutGate = new Promise<void>((resolve) => {
      releaseRestoredPut = resolve;
    });
    let restoredWriteEntered!: () => void;
    const restoredWriteStarted = new Promise<void>((resolve) => {
      restoredWriteEntered = resolve;
    });
    let putCount = 0;

    const space = createControlledMirroredSpace({
      onPut: async (_book, target) => {
        if (target !== 'primary') return;
        putCount += 1;
        // 第一次跳過 setupFileBook 的種子寫入
        if (putCount === 2) {
          restoredWriteEntered();
          await restoredPutGate;
        }
      },
    });

    let { state, projectId } = await setupFileBook(space, 'file-wo135-race');
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const archive = createMemoryArchiveClient();

    // 1) 刪除第一章 -> S_del（事件甲、乙的 chapterId 變為 null）
    const projectBefore = state.projects.find((p) => p.id === projectId)!;
    const record = deletedFromNode(projectBefore.nodes, 'ch-1', NOW_MS + 100, 'del-ch-1', getProjectCards(state, projectId))!;
    expect(record.unlinkedTimelineEvents).toEqual([
      { cardId: 'evt-1', chapterId: 'ch-1' },
      { cardId: 'evt-2', chapterId: 'ch-1' },
    ]);
    await archive.update(projectId, (curr) => archiveDeletion(curr, record, []), 'delete');
    const nodesAfterDelete = withoutNode(projectBefore.nodes, 'ch-1')!;
    dispatch({ type: 'set-nodes', projectId, nodes: nodesAfterDelete });

    const staleDeletedState = state;
    const staleDeletedProject = staleDeletedState.projects.find((p) => p.id === projectId)!;
    const staleDeletedExtra = staleDeletedState.fileExtras[staleDeletedProject.dbKey!]!;
    expect(getProjectCards(staleDeletedState, projectId).find((c) => c.id === 'evt-1')?.chapterId).toBeNull();

    // 2) 即時復原（S_restored）立即寫入 App 空間；期間 React cleanup 拿著過期 S_del 反寫同一本稿
    const restoredNodes = expandToNode(
      nodesAfterDeleteUndo(nodesAfterDelete, { snapshot: [], deleted: record }),
      'ch-1',
    );
    const restorePromise = restoreDeletedChapterWithArchive({
      state: staleDeletedState,
      dispatch,
      projectId,
      record,
      nodes: restoredNodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId,
          dispatch,
          onStashResult: () => undefined,
        }),
    });

    await restoredWriteStarted;
    // 模擬 SampleProvider 舊版 cleanup 在 S_restored 寫入進行中以過期 closure S_del 呼叫 persistFileBookStash
    const staleCleanupPromise = persistFileBookStash({
      state: staleDeletedState,
      project: staleDeletedProject,
      extra: staleDeletedExtra,
      dispatch,
      onStashResult: () => undefined,
    });
    releaseRestoredPut();

    const [restoreOutcome] = await Promise.all([restorePromise, staleCleanupPromise]);
    expect(restoreOutcome.persisted).toBe(true);
    expect((await archive.read(projectId)).deleted).toEqual([]);

    // 3) 立即重載 App 空間：第一章必須還在，且事件甲、乙的 chapterId 必須仍為 ch-1
    const reloaded = await loadStoredBooks(new Date(NOW_MS + 200));
    expect(reloaded).toHaveLength(1);
    const vol1 = reloaded[0]!.tree.find((n) => n.id === 'vol-1');
    expect(vol1?.children?.some((n) => n.id === 'ch-1')).toBe(true);
    expect(reloaded[0]!.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
    expect(reloaded[0]!.cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    expect(reloaded[0]!.cards.find((c) => c.id === 'evt-3')?.chapterId).toBe('ch-2');
  });

  it('單章刪除後按即時復原：不重整、立即重整、自動存檔、手動儲存與另存重開皆保留連章且 schema 維持 v14', async () => {
    const space = createControlledMirroredSpace();
    let { state, projectId } = await setupFileBook(space, 'file-wo135-single');
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const archive = createMemoryArchiveClient();

    const projectBefore = state.projects.find((p) => p.id === projectId)!;
    const record = deletedFromNode(projectBefore.nodes, 'ch-1', NOW_MS + 100, 'del-single', getProjectCards(state, projectId))!;
    await archive.update(projectId, (curr) => archiveDeletion(curr, record, []), 'delete');
    const nodesAfterDelete = withoutNode(projectBefore.nodes, 'ch-1')!;
    dispatch({ type: 'set-nodes', projectId, nodes: nodesAfterDelete });

    const restoredNodes = expandToNode(
      nodesAfterDeleteUndo(nodesAfterDelete, { snapshot: [], deleted: record }),
      'ch-1',
    );
    await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId,
      record,
      nodes: restoredNodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId,
          dispatch,
          onStashResult: () => undefined,
        }),
    });

    // 1) 不重整畫面：buildTimelineModel 顯示連回 ch-1，標題、內容、故事時間、排序不變
    const projAfterUndo = state.projects.find((p) => p.id === projectId)!;
    const cardsAfterUndo = getProjectCards(state, projectId);
    const model = buildTimelineModel(cardsAfterUndo, projAfterUndo.nodes);
    const evt1 = model.storyEvents.find((e) => e.id === 'evt-1');
    const evt2 = model.storyEvents.find((e) => e.id === 'evt-2');
    expect(evt1?.chapter?.id).toBe('ch-1');
    expect(evt1?.card.chapterId).toBe('ch-1');
    expect(evt1?.storyTime).toBe('第一年春');
    expect(evt1?.card.content).toBe('【範例】事件甲描述');
    expect(evt2?.chapter?.id).toBe('ch-1');
    expect(evt2?.card.chapterId).toBe('ch-1');
    expect(model.storyEvents.map((e) => e.id)).toEqual(['evt-1', 'evt-2', 'evt-3', 'evt-4']);

    // 2) 立刻重整畫面：loadStoredBooks 連章一致
    const reloaded = await loadStoredBooks(new Date(NOW_MS + 200));
    expect(reloaded[0]?.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
    expect(reloaded[0]?.cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');

    // 3) 觸發 5 分鐘自動存檔與手動儲存專案：寫出 .db schema_version 維持 14，事件 chapter_id 為 ch-1
    const disk = new FakeDisk('wo135-sample.db', await manuscriptBytesOn(state, projAfterUndo, null));
    const { env } = createFakeEnv(disk);
    await env.targets.save(projectId, { filename: 'wo135-sample.db', file: disk });
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
    const lastSavedRevById: Record<string, number> = {};

    // 再微調一段文字或直接以 dirty 狀態觸發自動存檔
    const autoOutcome = await executeBackgroundAutoSave({
      projectId,
      getState: () => state,
      dispatch,
      env,
      getStatus: () => 'active',
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => false,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      store: null,
    });
    expect(autoOutcome).toMatchObject({ kind: 'saved' });

    const autoDb = await openMemoryDb(disk.bytes);
    try {
      expect(currentSchemaVersion(autoDb.sql)).toBe(CURRENT_SCHEMA_VERSION);
      expect(CURRENT_SCHEMA_VERSION).toBe(14);
      const timeline = readTimelineData(autoDb.sql);
      expect(timeline.kind).toBe('ok');
      if (timeline.kind === 'ok') {
        expect(timeline.entries['evt-1']?.chapterId).toBe('ch-1');
        expect(timeline.entries['evt-2']?.chapterId).toBe('ch-1');
      }
    } finally {
      autoDb.close();
    }

    // 4) 手動儲存專案 & 另存專案再重開
    const manualOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight,
      lastSavedRevById,
      onSaved: () => undefined,
      store: null,
    });
    expect(manualOutcome).toMatchObject({ kind: 'saved' });

    const saveAsDisk = new FakeDisk('wo135-save-as.db');
    const saveAsEnv = createFakeEnv(saveAsDisk).env;
    const saveAsResult = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === projectId)!,
      dispatch,
      env: saveAsEnv,
      preparedBytes: null,
    });
    expect(saveAsResult.outcome).toMatchObject({ kind: 'saved-as' });

    const reopened = await readBookBytes('wo135-save-as.db', saveAsDisk.bytes, 'reopened-wo135');
    expect(reopened.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
    expect(reopened.cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    expect(reopened.cards.find((c) => c.id === 'ai-1')?.content).toBe('【範例】不應被改動的 AI 對話內容');
    expect(reopened.cards.find((c) => c.id === 'char-1')?.content).toBe('【範例】角色卡片內容');
  });

  it('整卷刪除後按即時復原：未改連的事件接回各自原章，期間已改連他章的事件保持不動', async () => {
    const space = createControlledMirroredSpace();
    let { state, projectId } = await setupFileBook(space, 'file-wo135-vol');
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const archive = createMemoryArchiveClient();

    const projectBefore = state.projects.find((p) => p.id === projectId)!;
    const record = deletedFromNode(projectBefore.nodes, 'vol-1', NOW_MS + 100, 'del-vol-1', getProjectCards(state, projectId))!;
    await archive.update(projectId, (curr) => archiveDeletion(curr, record, []), 'delete');
    const nodesAfterDelete = withoutNode(projectBefore.nodes, 'vol-1')!;
    dispatch({ type: 'set-nodes', projectId, nodes: nodesAfterDelete });

    // 期間作家把原本屬於 ch-1 的事件甲手動改連到第三章 ch-3
    dispatch({ type: 'update-card', projectId, cardId: 'evt-1', patch: { chapterId: 'ch-3' } });

    const restoredNodes = expandToNode(
      nodesAfterDeleteUndo(nodesAfterDelete, { snapshot: [], deleted: record }),
      'vol-1',
    );
    await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId,
      record,
      nodes: restoredNodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId,
          dispatch,
          onStashResult: () => undefined,
        }),
    });

    const cards = getProjectCards(state, projectId);
    expect(cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-3');
    expect(cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    expect(cards.find((c) => c.id === 'evt-3')?.chapterId).toBe('ch-2');
    expect(cards.find((c) => c.id === 'evt-4')?.chapterId).toBe('ch-3');

    const reloaded = await loadStoredBooks(new Date(NOW_MS + 200));
    expect(reloaded[0]?.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-3');
    expect(reloaded[0]?.cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    expect(reloaded[0]?.cards.find((c) => c.id === 'evt-3')?.chapterId).toBe('ch-2');
  });

  it('WriteScreen 復原列保留外層 tree-undo 並為內層復原按鈕加上 data-testid="tree-undo-btn"，且空白區不可點擊復原', () => {
    const writeSrc = readFileSync(new URL('../screens/WriteScreen.tsx', import.meta.url), 'utf8');
    expect(writeSrc).toContain('data-testid="tree-undo"');
    expect(writeSrc).toContain('data-testid="tree-undo-btn"');
    const undoBarStart = writeSrc.indexOf('<div className="undo-bar"');
    const undoBarEnd = writeSrc.indexOf('className="undo-meter"');
    const undoBarSnippet = writeSrc.slice(undoBarStart, undoBarEnd);
    expect(undoBarSnippet).toContain('data-testid="tree-undo-btn"');
    const firstBtnIdx = undoBarSnippet.indexOf('<button');
    expect(undoBarSnippet.slice(0, firstBtnIdx)).not.toContain('onClick');
    expect(writeSrc).toContain('actions.restoreDeletedChapter');
  });

  it('新稿即時復原與「最近刪除」救回：時間線連章保留、不重整／重整／手動儲存／另存重開皆一致且 ai_chat 與角色卡零異動', async () => {
    vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(createControlledMirroredSpace());
    const kv = createMemoryKvStore();
    let state = createState(new Date(NOW_MS));
    state = reduce(state, {
      type: 'add-project',
      id: 'p-wo135-local',
      title: '【範例】新稿時間線復原',
      shape: 'novel',
      startedMs: NOW_MS,
    });
    state = reduce(state, { type: 'focus-project', id: 'p-wo135-local' });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    dispatch({ type: 'set-nodes', projectId: 'p-wo135-local', nodes: makeSampleTree() });
    dispatch({ type: 'set-cards', projectId: 'p-wo135-local', cards: makeSampleCards() });

    const archive = createMemoryArchiveClient();
    const projectBefore = state.projects.find((p) => p.id === 'p-wo135-local')!;
    const record = deletedFromNode(projectBefore.nodes, 'ch-1', NOW_MS + 100, 'del-local-1', getProjectCards(state, 'p-wo135-local'))!;
    await archive.update('p-wo135-local', (curr) => archiveDeletion(curr, record, []), 'delete');
    const nodesAfterDelete = withoutNode(projectBefore.nodes, 'ch-1')!;
    dispatch({ type: 'set-nodes', projectId: 'p-wo135-local', nodes: nodesAfterDelete });
    expect(getProjectCards(state, 'p-wo135-local').find((c) => c.id === 'evt-1')?.chapterId).toBeNull();

    const restoredNodes = expandToNode(
      nodesAfterDeleteUndo(nodesAfterDelete, { snapshot: [], deleted: record }),
      'ch-1',
    );
    const res = await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId: 'p-wo135-local',
      record,
      nodes: restoredNodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId: 'p-wo135-local',
          dispatch,
          onStashResult: () => undefined,
          store: kv,
        }),
    });
    expect(res.persisted).toBe(true);
    expect((await archive.read('p-wo135-local')).deleted).toEqual([]);

    // 1) 不重整
    const cards = getProjectCards(state, 'p-wo135-local');
    expect(cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
    expect(cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    expect(cards.find((c) => c.id === 'ai-1')?.content).toBe('【範例】不應被改動的 AI 對話內容');

    // 2) 立即重整（persistProjectNow 已直接寫入 kv）
    const loaded = loadProjects(kv);
    const reloadedProj = loaded?.find((p) => p.id === 'p-wo135-local');
    expect(reloadedProj?.nodes[0]?.children?.map((n) => n.id)).toEqual(['ch-1', 'ch-2']);
    expect(reloadedProj?.cards?.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');

    // 3) 另存專案再重開
    const saveAsDisk = new FakeDisk('wo135-local-save-as.db');
    const saveAsRes = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === 'p-wo135-local')!,
      dispatch,
      env: createFakeEnv(saveAsDisk).env,
      preparedBytes: null,
    });
    expect(saveAsRes.outcome).toMatchObject({ kind: 'saved-as' });
    const reopened = await readBookBytes('wo135-local-save-as.db', saveAsDisk.bytes, 'reopened-local');
    expect(reopened.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
    expect(reopened.cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    expect(reopened.cards.find((c) => c.id === 'ai-1')?.content).toBe('【範例】不應被改動的 AI 對話內容');
  });

  it('WO-135 第 3 段：檔案稿「最近刪除」放回原位與放到最後面回歸保護，及無 unlinkedTimelineEvents 舊紀錄相容', async () => {
    for (const atEnd of [false, true]) {
      const space = createControlledMirroredSpace();
      let { state, projectId } = await setupFileBook(space, `file-wo135-recover-${atEnd}`);
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };
      const archive = createMemoryArchiveClient();
      const projectBefore = state.projects.find((p) => p.id === projectId)!;
      const record = deletedFromNode(projectBefore.nodes, 'ch-1', NOW_MS + 100, `del-rec-${atEnd}`, getProjectCards(state, projectId))!;
      await archive.update(projectId, (curr) => archiveDeletion(curr, record, []), 'delete');
      const nodesAfterDelete = withoutNode(projectBefore.nodes, 'ch-1')!;
      dispatch({ type: 'set-nodes', projectId, nodes: nodesAfterDelete });

      // 若寫入失敗，紀錄保留不清除
      const failed = await restoreDeletedChapterWithArchive({
        state,
        dispatch,
        projectId,
        record,
        nodes: expandToNode(placeRecovered(nodesAfterDelete, record, atEnd), 'ch-1'),
        archive,
        persistBook: async () => false,
      });
      expect(failed.persisted).toBe(false);
      expect((await archive.read(projectId)).deleted).toHaveLength(1);

      const ok = await restoreDeletedChapterWithArchive({
        state,
        dispatch,
        projectId,
        record,
        nodes: expandToNode(placeRecovered(nodesAfterDelete, record, atEnd), 'ch-1'),
        archive,
        persistBook: (nextState) =>
          persistProjectNow({
            state: nextState,
            projectId,
            dispatch,
            onStashResult: () => undefined,
          }),
      });
      expect(ok.persisted).toBe(true);
      expect((await archive.read(projectId)).deleted).toEqual([]);

      const reloaded = await loadStoredBooks(new Date(NOW_MS + 200));
      const vol1 = reloaded[0]!.tree.find((n) => n.id === 'vol-1')!;
      if (atEnd) {
        expect(reloaded[0]!.tree.at(-1)?.id).toBe('ch-1');
      } else {
        expect(vol1.children?.map((n) => n.id)).toEqual(['ch-1', 'ch-2']);
      }
      expect(reloaded[0]!.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
      expect(reloaded[0]!.cards.find((c) => c.id === 'evt-2')?.chapterId).toBe('ch-1');
    }

    // 舊刪除紀錄（缺少 unlinkedTimelineEvents 欄位）相容性檢查
    const space = createControlledMirroredSpace();
    let { state, projectId } = await setupFileBook(space, 'file-wo135-legacy-rec');
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const archive = createMemoryArchiveClient();
    const projectBefore = state.projects.find((p) => p.id === projectId)!;
    const rawRecord = deletedFromNode(projectBefore.nodes, 'ch-1', NOW_MS + 100, 'del-legacy', [])!;
    const legacyRecord = { ...rawRecord, unlinkedTimelineEvents: undefined };
    await archive.update(projectId, (curr) => archiveDeletion(curr, legacyRecord, []), 'delete');
    const nodesAfterDelete = withoutNode(projectBefore.nodes, 'ch-1')!;
    dispatch({ type: 'set-nodes', projectId, nodes: nodesAfterDelete });

    const res = await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId,
      record: legacyRecord,
      nodes: expandToNode(placeRecovered(nodesAfterDelete, legacyRecord, false), 'ch-1'),
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId,
          dispatch,
          onStashResult: () => undefined,
        }),
    });
    expect(res.persisted).toBe(true);
    expect(getProjectCards(state, projectId).find((c) => c.id === 'evt-3')?.chapterId).toBe('ch-2');
    expect(getProjectCards(state, projectId).find((c) => c.id === 'ai-1')?.content).toBe('【範例】不應被改動的 AI 對話內容');
  });

  it('WO-135 第 3 段：autoStashController 同稿更新不拿舊狀態反寫、切稿／卸載以最新狀態刷寫、過期世代略過且失敗不鎖死佇列', async () => {
    const space = createControlledMirroredSpace();
    const bookA = await setupFileBook(space, 'file-ctrl-a');
    // 再準備第二份檔案稿 B，測試切稿刷寫
    const bytesB = await createSampleDbBytes([
      { id: 'ch-b1', type: 'file', title: 'B 第一章', progress: 'Draft', content: '【範例】B 正文' },
    ], []);
    await space.put({
      key: 'file-ctrl-b',
      filename: 'ctrl-b.db',
      title: '【範例】第二本書',
      bytes: bytesB,
      hasExternalFile: true,
      titleInFile: '【範例】第二本書',
      titleSavePending: null,
    });
    touchedKeys.push('file-ctrl-b');
    const loadedAll = await loadStoredBooks(new Date(NOW_MS));
    const bookBData = loadedAll.find((b) => b.key === 'file-ctrl-b')!;

    let state = reduce(bookA.state, attachActionForBook(bookBData, { updatedLabel: '剛剛' }));
    state = reduce(state, { type: 'focus-project', id: 'file-ctrl-a' });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const coordinator = createFileBookStashCoordinator({ trackPersistedAfterDrain: true });
    const persistedRevs: { projectId: string; hasCh1: boolean; rev: number }[] = [];
    const controller = createFileBookAutoStashController({
      getLatestState: () => state,
      dispatch,
      onStashResult: () => undefined,
      coordinator,
      persist: async (input) => {
        const proj = input.state.projects.find((p) => p.id === input.project.id)!;
        const hasCh1 = Boolean(proj.nodes.some((n) => n.children?.some((c) => c.id === 'ch-1')));
        persistedRevs.push({
          projectId: input.project.id,
          hasCh1,
          rev: input.state.contentRevById?.[input.project.id] ?? 0,
        });
        return persistFileBookStash(input);
      },
    });

    // 1) 同稿更新：先刪第一章（S_del），再立即復原（S_restored），250ms 內絕不可用 S_del 寫回
    const projA = state.projects.find((p) => p.id === 'file-ctrl-a')!;
    const delRec = deletedFromNode(projA.nodes, 'ch-1', NOW_MS + 50, 'del-ctrl', getProjectCards(state, 'file-ctrl-a'))!;
    dispatch({ type: 'set-nodes', projectId: 'file-ctrl-a', nodes: withoutNode(projA.nodes, 'ch-1')! });
    controller.sync(state);
    const staleDelState = state;
    const staleDelProj = staleDelState.projects.find((p) => p.id === 'file-ctrl-a')!;
    const staleDelExtra = staleDelState.fileExtras['file-ctrl-a']!;

    await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId: 'file-ctrl-a',
      record: delRec,
      nodes: expandToNode(
        nodesAfterDeleteUndo(withoutNode(projA.nodes, 'ch-1')!, { snapshot: [], deleted: delRec }),
        'ch-1',
      ),
      archive: createMemoryArchiveClient(),
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId: 'file-ctrl-a',
          dispatch,
          onStashResult: () => undefined,
          coordinator,
        }),
    });
    controller.sync(state);

    // 即使之前某處殘留了過期 generation=1 / rev=1 的呼叫，coordinator 也會直接略過，不會覆蓋已落盤的 S_restored
    await persistFileBookStash({
      state: staleDelState,
      project: staleDelProj,
      extra: staleDelExtra,
      dispatch,
      onStashResult: () => undefined,
      coordinator,
      generation: 1,
    });

    expect(persistedRevs).toEqual([]);
    const afterRestore = await loadStoredBooks(new Date(NOW_MS + 100));
    const reloadedA = afterRestore.find((b) => b.key === 'file-ctrl-a')!;
    expect(reloadedA.tree.find((n) => n.id === 'vol-1')?.children?.some((c) => c.id === 'ch-1')).toBe(true);
    expect(reloadedA.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');

    // 2) 切換稿件前編輯 A，立即切到 B（在 250ms 內）：A 的最新編輯會被立刻刷寫，不漏存
    dispatch({ type: 'commit-text', projectId: 'file-ctrl-a', nodeId: 'ch-1', text: '【範例】切稿前最後一句' });
    controller.sync(state);
    dispatch({ type: 'focus-project', id: 'file-ctrl-b' });
    controller.sync(state);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);

    const afterSwitch = await loadStoredBooks(new Date(NOW_MS + 400));
    const switchedA = afterSwitch.find((b) => b.key === 'file-ctrl-a')!;
    expect(switchedA.tree.find((n) => n.id === 'vol-1')?.children?.find((c) => c.id === 'ch-1')?.content).toBe('【範例】切稿前最後一句');

    // 3) 元件卸載（dispose）時也會以最新狀態刷寫 B
    dispatch({ type: 'commit-text', projectId: 'file-ctrl-b', nodeId: 'ch-b1', text: '【範例】卸載前 B 正文' });
    controller.sync(state);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(0);
    const afterDispose = await loadStoredBooks(new Date(NOW_MS + 500));
    expect(afterDispose.find((b) => b.key === 'file-ctrl-b')?.tree[0]?.content).toBe('【範例】卸載前 B 正文');

    // 4) 寫入錯誤時 try / finally 保護：前一次失敗照實回傳 false，絕不鎖死後續同一本稿寫入
    const failCoordinator = createFileBookStashCoordinator({ trackPersistedAfterDrain: true });
    const toasts: boolean[] = [];
    const curProjA = state.projects.find((p) => p.id === 'file-ctrl-a')!;
    const curExtraA = state.fileExtras['file-ctrl-a']!;
    const failOk = await persistFileBookStash({
      state,
      project: curProjA,
      extra: curExtraA,
      dispatch,
      onStashResult: (_id, ok) => toasts.push(ok),
      coordinator: failCoordinator,
      saveBytes: async () => {
        throw new Error('模擬磁碟滿載');
      },
    });
    expect(failOk).toBe(false);
    expect(toasts).toEqual([false]);

    const recoverOk = await persistFileBookStash({
      state,
      project: curProjA,
      extra: curExtraA,
      dispatch,
      onStashResult: (_id, ok) => toasts.push(ok),
      coordinator: failCoordinator,
    });
    expect(recoverOk).toBe(true);
    expect(toasts).toEqual([false, true]);
    expect(STASH_AUTO_FAILED_TOAST.length).toBeGreaterThan(0);

    // 5) library.ts 的 saveBookBytes 佇列在失敗後也不會鎖死後續寫入
    await expect(
      saveBookBytes('file-ctrl-a', 'a.db', '壞寫入', makeFileInfo(), [], [], [], undefined, true),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
