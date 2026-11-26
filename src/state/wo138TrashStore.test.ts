import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectoryAppSpace, createMemoryDirectory, type AppSpace } from '../db/appSpace';
import * as browserSpace from '../db/browserSpace';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import { loadStoredBooks, readBookBytes } from '../db/library';
import { readFileProject } from '../db/projectFile';
import type { SaveEnvironment } from '../db/saveProject';
import { tableNames, type Sql } from '../db/sql';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import {
  TRASH_ITEMS_TABLE,
  TRASH_META_TABLE,
  TRASH_TABLES,
  TrashDataError,
} from '../db/trashMeta';
import { openMemoryDb } from '../db/wasmDb';
import { loadProjects, type KeyValueStore } from '../domain/outline';
import { findNode } from '../data/demo';
import { createTrashItem, listWritableTargetNodes, type TrashItem } from '../domain/trash';
import {
  bindLeaveFlush,
  consumeLiveExcludedWordDelta,
  setLiveFlusher,
  setLiveReader,
} from '../editor/liveDraft';
import { writingDayKey } from '../domain/dailyGoal';
import { removeProjectFromDevice } from './removeFromDevice';
import {
  createState,
  executeBackgroundAutoSave,
  getProjectTrash,
  getProjectTrashRead,
  manuscriptBytesOn,
  openDatabaseManuscript,
  persistFileBookStash,
  persistLocalAutoStash,
  persistProjectNow,
  reduce,
  runManualSaveProject,
  runSaveProjectAs,
  verifyBytesForSave,
  type Action,
} from './sampleStore';

class FakeDisk implements DiskFile {
  bytes: Uint8Array;
  writes = 0;
  constructor(readonly name: string, initial: Uint8Array) {
    this.bytes = initial.slice();
  }
  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }
  async write(next: Uint8Array): Promise<void> {
    this.writes += 1;
    this.bytes = next.slice();
  }
  async queryPermission(): Promise<'granted'> {
    return 'granted';
  }
  async requestPermission(): Promise<'granted'> {
    return 'granted';
  }
}

function makeMemoryKeyValueStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function makeFakeEnv(options: {
  canPickFiles: boolean;
  pickSaveLocation?: SaveEnvironment['pickSaveLocation'];
  share?: SaveEnvironment['share'];
}): { env: SaveEnvironment; targets: ReturnType<typeof createMemoryTargetStore> } {
  const targets = createMemoryTargetStore();
  return {
    targets,
    env: {
      canPickFiles: options.canPickFiles,
      targets,
      verify: verifyBytesForSave,
      pickSaveLocation: options.pickSaveLocation ?? (async () => null),
      share: options.share ?? (async () => 'shared'),
    },
  };
}

function setupMemoryAppSpace(): { dir: ReturnType<typeof createMemoryDirectory>; space: AppSpace } {
  const dir = createMemoryDirectory();
  const space = createDirectoryAppSpace(dir);
  vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(space);
  return { dir, space };
}

async function mutateBytes(bytes: Uint8Array, run: (sql: Sql) => void): Promise<Uint8Array> {
  const db = await openMemoryDb(bytes);
  try {
    run(db.sql);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

function sampleTrash(overrides?: Partial<TrashItem>): TrashItem {
  return createTrashItem({
    itemId: overrides?.itemId ?? '11111111-2222-4333-8444-555555555501',
    chapterId: overrides?.chapterId !== undefined ? overrides.chapterId : 'ch-sample-doc-1',
    chapterTitleSnapshot: overrides?.chapterTitleSnapshot ?? '第一章　霧中燈號',
    content: overrides?.content ?? '【範例】' + '霧'.repeat(105),
    beforeAnchor: overrides?.beforeAnchor ?? '港口響起鐘聲，',
    afterAnchor: overrides?.afterAnchor ?? '她收起信紙往外走。',
    charOffset: overrides?.charOffset ?? 8,
    reason: overrides?.reason ?? '',
    deletedAtMs: overrides?.deletedAtMs ?? 1_700_000_005_000,
    sortOrder: overrides?.sortOrder ?? 0,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WO-138 第 3 段：sampleStore 最小接線', () => {
  it('開舊稿零寫入：無 jiufangm_trash_* 時不設 dirty、不增 contentRev、250ms 暫存與 5 分鐘自動存檔零寫入', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】舊稿.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-25T10:00:00+08:00'),
    });

    expect(disk.writes).toBe(0);
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBeFalsy();
    expect(state.contentRevById?.[opened.id] ?? 0).toBe(0);
    expect(getProjectTrashRead(state, opened.id)).toEqual({ kind: 'absent' });
    expect(getProjectTrash(state, opened.id)).toEqual([]);

    const project = state.projects.find((p) => p.id === opened.id)!;
    const extra = state.fileExtras[project.dbKey!]!;
    await persistFileBookStash({
      state,
      project,
      extra,
      dispatch,
      onStashResult: () => undefined,
    });

    const storedAfterStash = await loadStoredBooks();
    expect(storedAfterStash).toHaveLength(1);
    const dbAfterStash = await openMemoryDb(storedAfterStash[0]!.bytes);
    try {
      for (const table of TRASH_TABLES) {
        expect(tableNames(dbAfterStash.sql).has(table)).toBe(false);
      }
    } finally {
      dbAfterStash.close();
    }

    const autoOutcome = await executeBackgroundAutoSave({
      projectId: opened.id,
      getState: () => state,
      getStatus: () => 'active',
      lastSavedRevById: { [opened.id]: 0 },
      inflight: { current: null },
      env,
      dispatch,
      store: kv,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      isPreviouslyFailed: () => false,
    });
    expect(autoOutcome).toBe('no-changes');
    expect(disk.writes).toBe(0);
  });

  it('新開稿子：未存檔前重整自 localStorage 讀回不丟，升格成檔案後寫進 .db', async () => {
    const kv = makeMemoryKeyValueStore();
    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    state = reduce(state, {
      type: 'add-project',
      id: 'new-trash-book',
      title: '【範例】新稿測試',
      shape: 'novel',
    });
    const revBefore = state.contentRevById?.['new-trash-book'] ?? 0;
    const item = sampleTrash({ chapterId: 'new-trash-book-ch-1', chapterTitleSnapshot: '第一章' });

    state = reduce(state, { type: 'trash-add', projectId: 'new-trash-book', item });
    expect(state.saveMeta['new-trash-book']?.dirtySinceFileSave).toBe(true);
    expect(state.contentRevById?.['new-trash-book']).toBe(revBefore + 1);

    const stashOk = persistLocalAutoStash({
      store: kv,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      dispatch: (a) => {
        state = reduce(state, a);
      },
      onStashResult: () => undefined,
    });
    expect(stashOk).toBe(true);

    // 模擬重整後自 localStorage 讀回
    const reloadedProjects = loadProjects(kv);
    const reloadedBook = reloadedProjects?.find((p) => p.id === 'new-trash-book');
    expect(reloadedBook?.trashItems).toEqual([item]);

    // 升格成檔案並寫進 .db
    state = reduce(state, {
      type: 'promote-stored',
      projectId: 'new-trash-book',
      key: 'new-trash-key',
      filename: '【範例】新稿測試.db',
    });
    const promoted = state.projects.find((p) => p.id === 'new-trash-book')!;
    const bytes = await manuscriptBytesOn(state, promoted, null);
    const reopened = await readBookBytes('【範例】新稿測試.db', bytes, 'reopen-promoted');
    expect(reopened.trash).toEqual({ kind: 'ok', revision: 1, items: [item] });
  });

  it('檔案稿：設 dirty 與 contentRev、App 空間暫存重整不丟、自動存檔／另存帶走、改原因、放回、丟掉復原與刪稿清理', async () => {
    const { space } = setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】原檔.db', originalBytes);
    const saveAsDisk = new FakeDisk('【範例】另存.db', new Uint8Array());
    const { env } = makeFakeEnv({
      canPickFiles: true,
      pickSaveLocation: async () => saveAsDisk,
    });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-25T10:00:00+08:00'),
    });

    const item = sampleTrash();
    state = reduce(state, { type: 'trash-add', projectId: opened.id, item });
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBe(true);
    expect(state.contentRevById?.[opened.id]).toBe(1);

    // 立即寫進 App 空間（模擬操作後立刻重整）
    const persisted = await persistProjectNow({
      state,
      projectId: opened.id,
      dispatch,
      onStashResult: () => undefined,
      store: kv,
    });
    expect(persisted).toBe(true);
    const storedBeforeAuto = await loadStoredBooks();
    expect(storedBeforeAuto[0]?.trash).toEqual({ kind: 'ok', revision: 1, items: [item] });

    // 修改原因 → 立即落盤與標 dirty
    state = reduce(state, {
      type: 'trash-update-reason',
      projectId: opened.id,
      itemId: item.itemId,
      reason: '先留著看看要不要放到第三章',
    });
    expect(state.contentRevById?.[opened.id]).toBe(2);

    // 自動存檔帶走刪稿與原因
    const lastSavedRevById: Record<string, number> = { [opened.id]: 0 };
    const autoOutcome = await executeBackgroundAutoSave({
      projectId: opened.id,
      getState: () => state,
      getStatus: () => 'active',
      lastSavedRevById,
      inflight: { current: null },
      env,
      dispatch,
      store: kv,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      isPreviouslyFailed: () => false,
    });
    expect(autoOutcome).toMatchObject({ kind: 'saved' });
    expect(disk.writes).toBe(1);

    const reopenedDisk = await readBookBytes(disk.name, disk.bytes, 'verify-auto');
    expect(reopenedDisk.trash).toEqual({
      kind: 'ok',
      revision: 1,
      items: [{ ...item, reason: '先留著看看要不要放到第三章' }],
    });

    // 另存專案也把刪稿帶走
    const projectAfterAuto = state.projects.find((p) => p.id === opened.id)!;
    const saveAsRes = await runSaveProjectAs({
      state,
      project: projectAfterAuto,
      dispatch,
      env,
      preparedBytes: null,
    });
    expect(saveAsRes.outcome.kind).toBe('saved-as');
    const reopenedSaveAs = await readBookBytes(saveAsDisk.name, saveAsDisk.bytes, 'verify-save-as');
    expect(reopenedSaveAs.trash).toEqual({
      kind: 'ok',
      revision: 1,
      items: [{ ...item, reason: '先留著看看要不要放到第三章' }],
    });

    // 丟掉與 10 秒內復原
    state = reduce(state, { type: 'trash-remove', projectId: opened.id, itemId: item.itemId });
    expect(getProjectTrash(state, opened.id)).toEqual([]);
    state = reduce(state, {
      type: 'trash-restore-deleted',
      projectId: opened.id,
      item: { ...item, reason: '先留著看看要不要放到第三章' },
    });
    expect(getProjectTrash(state, opened.id)).toHaveLength(1);

    // 放回原章：寫回正文、更新字數且不增 paste_large_count、移除該則刪稿
    const pasteCountBefore = state.logs.reduce((sum, l) => sum + l.paste_large_count, 0);
    state = reduce(state, {
      type: 'trash-put-back',
      projectId: opened.id,
      itemId: item.itemId,
      targetNodeId: 'ch-sample-doc-1',
      nextBody: `放回內容：${item.content}`,
    });
    expect(getProjectTrash(state, opened.id)).toEqual([]);
    expect(state.logs.reduce((sum, l) => sum + l.paste_large_count, 0)).toBe(pasteCountBefore);

    // 手動儲存也寫進 .db（此時為空陣列）
    const manualRes = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById,
      onSaved: () => undefined,
    });
    expect(manualRes?.kind).toBe('saved');

    // 從裝置刪除稿子：不留孤兒資料
    const currentProject = state.projects.find((p) => p.id === opened.id)!;
    const removedOk = await removeProjectFromDevice({
      project: currentProject,
      store: kv,
      removeCopy: async (key) => space.remove(key),
      removeTarget: async () => undefined,
    });
    expect(removedOk).toBe(true);
    state = reduce(state, { type: 'remove-project', id: currentProject.id });
    expect(await loadStoredBooks()).toEqual([]);
  });

  it('newer-revision 與 corrupt 保護：store 拒絕修改且 verifyBytesForSave 僅擋 corrupt', async () => {
    setupMemoryAppSpace();
    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('暫存', raw, 'file-guard');
    const withTrash = await writeBookBytesWithHelper(raw, book, [sampleTrash()]);

    const newerBytes = await mutateBytes(withTrash, (sql) => {
      sql.exec(`UPDATE ${TRASH_META_TABLE} SET format_revision = 2`);
    });
    await expect(verifyBytesForSave(newerBytes)).resolves.toBeUndefined();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const { env } = makeFakeEnv({ canPickFiles: false });
    const openedNewer = await openDatabaseManuscript({
      filename: 'newer.db',
      bytes: newerBytes,
      diskFile: null,
      dispatch: (a) => {
        state = reduce(state, a);
      },
      env,
      store: makeMemoryKeyValueStore(),
    });
    expect(getProjectTrashRead(state, openedNewer.id)).toEqual({ kind: 'newer-revision', revision: 2 });
    const stateBeforeMutate = state;
    state = reduce(state, {
      type: 'trash-add',
      projectId: openedNewer.id,
      item: sampleTrash({ itemId: 'should-not-add' }),
    });
    expect(state).toBe(stateBeforeMutate);

    const corruptBytes = await mutateBytes(withTrash, (sql) => {
      sql.exec(`UPDATE ${TRASH_ITEMS_TABLE} SET word_count = -5`);
    });
    await expect(verifyBytesForSave(corruptBytes)).rejects.toThrow(TrashDataError);
    const corruptDb = await openMemoryDb(corruptBytes);
    try {
      expect(readFileProject(corruptDb.sql).trash.kind).toBe('corrupt');
    } finally {
      corruptDb.close();
    }
  });

  it('返工 1 問題 1：刪稿暫存區放回、收進暫存區刪除、復原撤回與丟掉復原皆不扭曲今日字數，小刪除維持扣字', () => {
    const now = new Date('2026-11-26T10:00:00+08:00');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      let state = reduce(createState(now), {
        type: 'add-project',
        id: 'p-wc',
        title: '【範例】今日字數與暫存區',
        shape: 'single',
      });
      state = reduce(state, { type: 'focus-project', id: 'p-wc' });
      const chId = state.projects.find((p) => p.id === 'p-wc')!.nodes[0]!.id;

      // 預置原本就有的 150 字舊文（模擬前一天寫的，今天進度從 0 開始）
      const oldBody = '【範例】' + '霧'.repeat(146);
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: oldBody,
        countForToday: false,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      // 1. 今日字數為 0 時，刪掉 100 字以上（收進暫存區）再放回（同章與跨章皆不增減）
      const deleted120 = '霧'.repeat(120);
      const afterAutoDel = oldBody.slice(0, oldBody.length - 120);
      const trashItem1 = createTrashItem({
        itemId: 'wc-trash-1',
        chapterId: chId,
        chapterTitleSnapshot: '正文',
        content: deleted120,
        wordCount: 120,
        beforeAnchor: '【範例】',
        afterAnchor: '',
        charOffset: afterAutoDel.length,
        deletedAtMs: now.getTime(),
      });
      state = reduce(state, { type: 'trash-add', projectId: 'p-wc', item: trashItem1 });
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: afterAutoDel,
        excludedWordDelta: -120,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      state = reduce(state, {
        type: 'trash-put-back',
        projectId: 'p-wc',
        itemId: trashItem1.itemId,
        targetNodeId: chId,
        nextBody: oldBody,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      // 2. 今日已有若干字（打入 40 字）時，收進暫存區不扣、放回不加
      const withNew40 = oldBody + '新'.repeat(40);
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: withNew40,
      });
      expect(state.schedule.open?.wordCount).toBe(40);

      // 收進暫存區 120 字（含未沖掉新打 5 字與刪掉 120 字並存情境：淨增 5 字）
      const typed5AndDeleted120 = withNew40.slice(0, withNew40.length - 120) + '加'.repeat(5);
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: typed5AndDeleted120,
        excludedWordDelta: -120,
      });
      expect(state.schedule.open?.wordCount).toBe(45);

      // 手動「移到刪稿暫存區」（countForToday: false）同樣不扣
      const afterManualMove = typed5AndDeleted120.slice(0, typed5AndDeleted120.length - 15);
      const manualItem = createTrashItem({
        itemId: 'wc-trash-manual',
        chapterId: chId,
        chapterTitleSnapshot: '正文',
        content: '字'.repeat(15),
        wordCount: 15,
        beforeAnchor: '',
        afterAnchor: '',
        charOffset: afterManualMove.length,
        deletedAtMs: now.getTime() + 1000,
      });
      state = reduce(state, { type: 'trash-add', projectId: 'p-wc', item: manualItem });
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: afterManualMove,
        countForToday: false,
      });
      expect(state.schedule.open?.wordCount).toBe(45);

      // 丟掉後 10 秒復原只改清單、不動今日字數
      state = reduce(state, { type: 'trash-remove', projectId: 'p-wc', itemId: manualItem.itemId });
      expect(state.schedule.open?.wordCount).toBe(45);
      state = reduce(state, { type: 'trash-restore-deleted', projectId: 'p-wc', item: manualItem });
      expect(state.schedule.open?.wordCount).toBe(45);

      // 放回（trash-put-back 與同章 countForToday: false）不加字數
      state = reduce(state, {
        type: 'trash-put-back',
        projectId: 'p-wc',
        itemId: manualItem.itemId,
        targetNodeId: chId,
        nextBody: typed5AndDeleted120,
      });
      expect(state.schedule.open?.wordCount).toBe(45);

      // 3. 自動收進後立刻系統復原撤回（excludedWordDelta: +120）不暴增
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: withNew40,
        excludedWordDelta: 120,
      });
      // 上面範例把 '加'.repeat(5) 一起換掉恢復成 withNew40，淨差為 -5（還原後應為 40）
      expect(state.schedule.open?.wordCount).toBe(40);

      // 4. 不到 100 字、沒有進暫存區的小刪除維持既有算法（從今日字數扣）
      const afterSmallDelete = withNew40.slice(0, withNew40.length - 12);
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-wc',
        nodeId: chId,
        text: afterSmallDelete,
      });
      expect(state.schedule.open?.wordCount).toBe(28);
    } finally {
      vi.useRealTimers();
    }
  });

  it('返工 1 修正輪 2 必修 1：600ms 停筆緩衝內刪 ≥ 100 字或系統復原後立刻存檔／另存，快照與 .db 今日字數皆不變', async () => {
    const now = new Date('2026-11-26T10:00:00+08:00');
    const todayKey = writingDayKey(now, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    setupMemoryAppSpace();
    try {
      const originalBytes = await generateDesktopSampleBytes();
      const disk = new FakeDisk('【範例】存檔今日字數.db', originalBytes);
      const saveAsDisk = new FakeDisk('【範例】另存今日字數.db', new Uint8Array());
      const { env } = makeFakeEnv({
        canPickFiles: true,
        pickSaveLocation: async () => saveAsDisk,
      });
      const kv = makeMemoryKeyValueStore();

      let state = createState(now);
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };

      const opened = await openDatabaseManuscript({
        filename: disk.name,
        bytes: originalBytes,
        diskFile: disk,
        dispatch,
        env,
        store: kv,
        now,
      });
      state = reduce(state, { type: 'focus-project', id: opened.id });
      const openedProject = state.projects.find((p) => p.id === opened.id)!;
      const chId = listWritableTargetNodes(openedProject.nodes)[0]!.node.id;
      const baseBody = '【範例】' + '霧'.repeat(146);
      state = reduce(state, {
        type: 'commit-text',
        projectId: opened.id,
        nodeId: chId,
        text: baseBody,
        countForToday: false,
      });
      // 今日先新打 30 字並先存檔一次，讓今日字數基準為 30
      const withToday30 = baseBody + '新'.repeat(30);
      state = reduce(state, {
        type: 'commit-text',
        projectId: opened.id,
        nodeId: chId,
        text: withToday30,
      });
      expect(state.schedule.open?.wordCount).toBe(30);

      const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
      const lastSavedRevById: Record<string, number> = { [opened.id]: 0 };
      const firstSave = await runManualSaveProject({
        getState: () => state,
        dispatch,
        env,
        inflight,
        lastSavedRevById,
        onSaved: () => undefined,
        store: kv,
      });
      expect(firstSave?.kind).toBe('saved');

      // 模擬 useWritingSurface：刪掉 120 字後仍在 600ms 停筆緩衝內
      let liveText = withToday30.slice(0, withToday30.length - 120);
      let pendingUncountedDelta = -120;
      const consumeDelta = () => {
        const val = pendingUncountedDelta;
        pendingUncountedDelta = 0;
        return val;
      };
      setLiveReader(
        () => ({ projectId: opened.id, chapterId: chId, text: liveText }),
        () => false,
        () => pendingUncountedDelta,
        consumeDelta,
      );
      setLiveFlusher(() => {
        const excludedWordDelta = consumeDelta();
        dispatch({
          type: 'commit-text',
          projectId: opened.id,
          nodeId: chId,
          text: liveText,
          ...(excludedWordDelta !== 0 ? { excludedWordDelta } : {}),
        });
        return true;
      });

      // 刪 ≥ 100 字後 600ms 內立刻手動存檔：不應多扣 120 字
      const saveAfterDelete = await runManualSaveProject({
        getState: () => state,
        dispatch,
        env,
        inflight,
        lastSavedRevById,
        onSaved: () => undefined,
        store: kv,
      });
      expect(saveAfterDelete?.kind).toBe('saved');
      expect(state.schedule.open?.wordCount).toBe(30);
      const dbAfterDelete = await readBookBytes(disk.name, disk.bytes, 'after-delete-save');
      expect(dbAfterDelete.logs.find((l) => l.date === todayKey)?.word_count).toBe(30);
      expect(findNode(dbAfterDelete.tree, chId)?.content).toBe(liveText);

      // 系統復原（+120）後 600ms 內立刻另存專案（即使外部呼叫端只傳進舊 state 快照）：不應暴增 120 字
      const stateBeforeUndoFlush = state;
      liveText = withToday30;
      pendingUncountedDelta = 120;
      const saveAsAfterUndo = await runSaveProjectAs({
        state: stateBeforeUndoFlush,
        project: stateBeforeUndoFlush.projects.find((p) => p.id === opened.id)!,
        dispatch,
        env,
        preparedBytes: null,
      });
      expect(saveAsAfterUndo.outcome.kind).toBe('saved-as');
      expect(state.schedule.open?.wordCount).toBe(30);
      const dbAfterUndoSaveAs = await readBookBytes(saveAsDisk.name, saveAsDisk.bytes, 'after-undo-save-as');
      expect(dbAfterUndoSaveAs.logs.find((l) => l.date === todayKey)?.word_count).toBe(30);
      expect(findNode(dbAfterUndoSaveAs.tree, chId)?.content).toBe(withToday30);
    } finally {
      setLiveFlusher(null);
      setLiveReader(null);
      vi.useRealTimers();
    }
  });

  it('返工 1 修正輪 2 必修 2：600ms 內切分頁／離頁（bindLeaveFlush）已消費並取消計時器，回來再打字不重複扣抵 excludedWordDelta', () => {
    const now = new Date('2026-11-26T10:00:00+08:00');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      let state = reduce(createState(now), {
        type: 'add-project',
        id: 'p-leave-flush',
        title: '【範例】離頁消費字數',
        shape: 'single',
      });
      state = reduce(state, { type: 'focus-project', id: 'p-leave-flush' });
      const chId = state.projects.find((p) => p.id === 'p-leave-flush')!.nodes[0]!.id;
      const baseBody = '【範例】' + '霧'.repeat(146);
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'p-leave-flush',
        nodeId: chId,
        text: baseBody,
        countForToday: false,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      let liveText = baseBody.slice(0, baseBody.length - 120);
      let pendingUncountedDelta = -120;
      let idleCancelled = false;

      const consumeWithCancel = () => {
        const val = pendingUncountedDelta;
        pendingUncountedDelta = 0;
        idleCancelled = true;
        return val;
      };
      setLiveReader(
        () => ({ projectId: 'p-leave-flush', chapterId: chId, text: liveText }),
        () => false,
        () => pendingUncountedDelta,
        consumeWithCancel,
      );

      const listeners = new Map<string, () => void>();
      const target = {
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      };
      let hidden = false;
      const doc = {
        get visibilityState() {
          return hidden ? 'hidden' : 'visible';
        },
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      };
      const leaveFlush = () => {
        const excludedWordDelta = consumeLiveExcludedWordDelta();
        state = reduce(state, {
          type: 'commit-text',
          projectId: 'p-leave-flush',
          nodeId: chId,
          text: liveText,
          ...(excludedWordDelta !== 0 ? { excludedWordDelta } : {}),
        });
      };
      const unbind = bindLeaveFlush(target, doc, leaveFlush);

      // 1. 刪 ≥ 100 字後 600ms 內切分頁（visibilitychange hidden + pagehide）
      hidden = true;
      listeners.get('visibilitychange')?.();
      listeners.get('pagehide')?.();
      expect(idleCancelled).toBe(true);
      expect(pendingUncountedDelta).toBe(0);
      expect(state.schedule.open?.wordCount).toBe(0);

      // 切回畫面後新打 1 字，後續 flush 送出 commit-text 不應再帶 -120 導致暴增成 121
      hidden = false;
      liveText += '新';
      const flushAfterReturn = () => {
        const excludedWordDelta = consumeLiveExcludedWordDelta();
        state = reduce(state, {
          type: 'commit-text',
          projectId: 'p-leave-flush',
          nodeId: chId,
          text: liveText,
          ...(excludedWordDelta !== 0 ? { excludedWordDelta } : {}),
        });
      };
      flushAfterReturn();
      expect(state.schedule.open?.wordCount).toBe(1);

      // 2. 系統復原（+120）後 600ms 內切分頁，回來再打 1 字不應倒扣成 -118
      idleCancelled = false;
      liveText = baseBody + '新';
      pendingUncountedDelta = 120;
      hidden = true;
      listeners.get('visibilitychange')?.();
      expect(idleCancelled).toBe(true);
      expect(pendingUncountedDelta).toBe(0);
      expect(state.schedule.open?.wordCount).toBe(1);

      hidden = false;
      liveText += '字';
      flushAfterReturn();
      expect(state.schedule.open?.wordCount).toBe(2);

      unbind();
    } finally {
      setLiveReader(null);
      vi.useRealTimers();
    }
  });
});

async function writeBookBytesWithHelper(
  base: Uint8Array,
  book: Awaited<ReturnType<typeof readBookBytes>>,
  items: TrashItem[],
): Promise<Uint8Array> {
  const { writeBookBytes } = await import('../db/library');
  return writeBookBytes(base, book.info, book.tree, book.cards, book.logs, undefined, undefined, undefined, items);
}
