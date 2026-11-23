/**
 * WO-132 階段一：嚴-1、嚴-2 自動化實測重現測試（僅用【範例】假稿與記憶體假磁碟）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_CONFLICT_TOAST } from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { createMemoryTargetStore, restoreTarget, targetRow, type DiskFile, type StoredTargetRow, type TargetStore } from '../db/fileTarget';
import { fingerprintBytes } from '../db/fingerprint';
import { forgetOpenFile, rememberOpenFile, rememberOpenFileFingerprint } from '../db/openFileMemory';
import { readBookBytes } from '../db/library';
import { readFileProject } from '../db/projectFile';
import { saveProjectToPlace, type SaveEnvironment } from '../db/saveProject';
import { openMemoryDb } from '../db/wasmDb';
import { resolveAutoSaveStatus, shouldRunAutoSaveTick } from '../domain/autoSave';
import { writingDayKey } from '../domain/dailyGoal';
import { countWords } from '../domain/wordCount';
import { setLiveReader } from '../editor/liveDraft';
import { createSaveShortcutHandler } from '../screens/saveShortcuts';
import {
  attachActionForBook,
  createState,
  executeBackgroundAutoSave,
  manuscriptBytesOn,
  reduce,
  runManualSaveProject,
  runResumeAutoSave,
  runSaveProjectAs,
  verifyBytesForSave,
  withLiveDraftCommitted,
  type Action,
  type SampleState,
} from './sampleStore';
import { firstFileNode } from './testing/firstFile';

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

interface WrappedDiskFile extends DiskFile {
  backingDisk: FakeDisk;
}

function wrapFakeDisk(disk: FakeDisk): WrappedDiskFile {
  return {
    name: disk.name,
    backingDisk: disk,
    read: () => disk.read(),
    write: (next) => disk.write(next),
    queryPermission: () => disk.queryPermission(),
    requestPermission: () => disk.requestPermission(),
  };
}

/** 模擬真實瀏覽器 browserTargetStore.ts：每次 load() 皆建立全新 DiskFile 包裝物件。 */
function createWrappingTargetStore(): TargetStore {
  const rows = new Map<string, StoredTargetRow>();
  return {
    async load(bookKey) {
      return restoreTarget(rows.get(bookKey) ?? null, (handle) => wrapFakeDisk(handle as FakeDisk));
    },
    async save(bookKey, target) {
      const carrier = target.file as (Partial<WrappedDiskFile> | null);
      const handle = carrier?.backingDisk ?? (target.file instanceof FakeDisk ? target.file : null);
      rows.set(bookKey, targetRow(target, handle));
    },
    async remove(bookKey) {
      rows.delete(bookKey);
    },
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

function makeBook(nowMs: number, id: string, title: string, firstText: string): {
  state: SampleState;
  chapterId: string;
} {
  let state = createState(new Date(nowMs));
  state = reduce(state, { type: 'add-project', id, title, shape: 'novel', startedMs: nowMs });
  state = reduce(state, { type: 'focus-project', id });
  const project = state.projects.find((p) => p.id === id)!;
  const chapterId = firstFileNode(project.nodes)!.id;
  state = reduce(state, { type: 'commit-text', projectId: id, nodeId: chapterId, text: firstText });
  return { state, chapterId };
}

async function inspectDb(bytes: Uint8Array) {
  const db = await openMemoryDb(bytes);
  try {
    return readFileProject(db.sql);
  } finally {
    db.close();
  }
}

const NOW_MS = Date.parse('2026-11-23T16:50:00+08:00');
const TODAY = writingDayKey(new Date(NOW_MS), 0);
const touchedKeys: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  setLiveReader(null);
  for (const key of touchedKeys.splice(0)) {
    forgetOpenFile(key);
  }
  vi.useRealTimers();
});

describe('WO-132 階段一實測：嚴-1（打完字立刻按存檔快速鍵）', () => {
  it('Ctrl+S 在 600ms 停筆視窗內立即觸發，輸出 .db 應包含最後一段與對應當日字數', async () => {
    const key = 'p-1763887800001';
    touchedKeys.push(key);
    const { state: initState, chapterId } = makeBook(
      NOW_MS,
      key,
      '【範例】嚴1手動存檔測試',
      '【範例】原有第一段。',
    );
    let state = initState;
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const fakeDisk = new FakeDisk('嚴1手動存檔測試.db');
    const { env } = createFakeEnv(fakeDisk);
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
    const lastSavedRevById: Record<string, number> = {};
    const snapFn = async (s: SampleState, p: SampleState['projects'][number]) => ({
      key: p.dbKey ?? p.id,
      bytes: await manuscriptBytesOn(s, p, null),
    });

    const firstOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight,
      lastSavedRevById,
      onSaved: () => {},
      snapshot: snapFn,
      store: null,
    });
    expect(firstOutcome).toEqual({ kind: 'saved', filename: '嚴1手動存檔測試.db' });

    const newText = '【範例】原有第一段。\n【範例】剛打完不到半秒的最後一段。';
    setLiveReader(
      () => ({ projectId: key, chapterId, text: newText }),
      () => false,
    );

    let shortcutSavePromise: Promise<unknown> | null = null;
    const handler = createSaveShortcutHandler({
      getActions: () => ({
        saveProject: () => {
          shortcutSavePromise = runManualSaveProject({
            getState: () => state,
            dispatch,
            env,
            inflight,
            lastSavedRevById,
            onSaved: () => {},
            snapshot: snapFn,
            store: null,
          });
          return shortcutSavePromise;
        },
        saveProjectAs: async () => null,
      }),
      isDialogOpen: () => false,
    });

    handler({
      key: 's',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {},
    });
    expect(shortcutSavePromise).not.toBeNull();
    const outcome = await shortcutSavePromise!;
    expect(outcome).toEqual({ kind: 'saved', filename: '嚴1手動存檔測試.db' });

    const reopened = await inspectDb(fakeDisk.bytes);
    const ch1 = firstFileNode(reopened.tree)!;
    const todayLog = reopened.logs.find((log) => log.date === TODAY);
    expect(ch1.content).toBe(newText);
    expect(todayLog?.word_count).toBe(countWords(newText));
  });

  it('Ctrl+Shift+S 在 600ms 停筆視窗內立即觸發，另存輸出 .db 應包含最後一段與對應當日字數', async () => {
    const key = 'p-1763887800002';
    touchedKeys.push(key);
    const { state: initState, chapterId } = makeBook(
      NOW_MS,
      key,
      '【範例】嚴1另存測試',
      '【範例】原有第一段。',
    );
    let state = initState;
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const saveAsDisk = new FakeDisk('嚴1另存測試_新.db');
    const { env } = createFakeEnv(saveAsDisk);
    const snapFn = async (s: SampleState, p: SampleState['projects'][number]) => ({
      key: p.dbKey ?? p.id,
      bytes: await manuscriptBytesOn(s, p, null),
    });

    const newText = '【範例】原有第一段。\n【範例】剛打完不到半秒的最後一段。';
    setLiveReader(
      () => ({ projectId: key, chapterId, text: newText }),
      () => false,
    );

    let shortcutSaveAsPromise: Promise<unknown> | null = null;
    const handler = createSaveShortcutHandler({
      getActions: () => ({
        saveProject: async () => null,
        saveProjectAs: () => {
          const project = state.projects.find((item) => item.id === state.activeProjectId)!;
          shortcutSaveAsPromise = runSaveProjectAs({
            state,
            project,
            dispatch,
            env,
            preparedBytes: null,
            snapshot: snapFn,
          });
          return shortcutSaveAsPromise;
        },
      }),
      isDialogOpen: () => false,
    });

    handler({
      key: 'S',
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
      preventDefault: () => {},
    });
    expect(shortcutSaveAsPromise).not.toBeNull();
    const res = (await shortcutSaveAsPromise!) as Awaited<ReturnType<typeof runSaveProjectAs>>;
    expect(res.outcome).toEqual({ kind: 'saved-as', filename: '嚴1另存測試_新.db' });

    const reopened = await inspectDb(saveAsDisk.bytes);
    const ch1 = firstFileNode(reopened.tree)!;
    const todayLog = reopened.logs.find((log) => log.date === TODAY);
    expect(ch1.content).toBe(newText);
    expect(todayLog?.word_count).toBe(countWords(newText));
  });

  it('組字中（isComposing: true）不切斷組字也不提前併入 liveDraft；不同稿件的 liveDraft 不誤混入', () => {
    const keyA = 'p-1763887800003';
    const keyB = 'p-1763887800004';
    const { state: stateA, chapterId: chA } = makeBook(
      NOW_MS,
      keyA,
      '【範例】甲稿',
      '【範例】甲稿原文',
    );
    const composingRes = withLiveDraftCommitted(
      stateA,
      keyA,
      { projectId: keyA, chapterId: chA, text: '【範例】甲稿原文ㄗㄨˇ' },
      true,
    );
    expect(composingRes.action).toBeNull();
    expect(firstFileNode(composingRes.project.nodes)?.content).toBe('【範例】甲稿原文');

    const crossProjectRes = withLiveDraftCommitted(
      stateA,
      keyA,
      { projectId: keyB, chapterId: chA, text: '【範例】乙稿誤入內容' },
      false,
    );
    expect(crossProjectRes.action).toBeNull();
    expect(firstFileNode(crossProjectRes.project.nodes)?.content).toBe('【範例】甲稿原文');

    let shortcutCalled = false;
    const handler = createSaveShortcutHandler({
      getActions: () => ({
        saveProject: async () => {
          shortcutCalled = true;
        },
        saveProjectAs: async () => null,
      }),
      isDialogOpen: () => false,
    });
    handler({
      key: 's',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: true,
      preventDefault: () => {},
    });
    expect(shortcutCalled).toBe(false);
  });
});

describe('WO-132 階段一實測：嚴-2（原檔已被別處更新後寫回）', () => {
  async function setupExternalConflictScenario(bookKey: string) {
    touchedKeys.push(bookKey);
    const { state: tabBInit, chapterId: ch1Id } = makeBook(
      NOW_MS,
      bookKey,
      '【範例】嚴2衝突測試',
      '【範例】原有第一章內容。',
    );
    const initialBytes = await manuscriptBytesOn(tabBInit, tabBInit.projects[0]!, null);
    const sharedDisk = new FakeDisk('嚴2衝突測試.db', initialBytes);

    // 分頁 A 開啟同一個 FakeDisk 檔案（記錄基準指紋）
    const rawFingerprint = await fingerprintBytes(sharedDisk.bytes);
    const importedA = await readBookBytes(sharedDisk.name, sharedDisk.bytes, bookKey, new Date(NOW_MS));
    let stateA = createState(new Date(NOW_MS));
    stateA = reduce(stateA, attachActionForBook(importedA, { updatedLabel: '剛剛' }));
    const { env } = createFakeEnv(sharedDisk);
    await env.targets.save(bookKey, {
      filename: sharedDisk.name,
      file: sharedDisk,
      lastKnownFingerprint: rawFingerprint,
    });
    rememberOpenFile(bookKey, sharedDisk);
    rememberOpenFileFingerprint(bookKey, sharedDisk, rawFingerprint);

    // 分頁 B 直接把同一份 FakeDisk 更新成新版（加入第二章）
    const extraChapter: ChapterNode = {
      id: `${bookKey}-ch2`,
      type: 'file',
      title: '第二章',
      progress: 'Draft',
      content: '【範例】別處新寫的第二章',
    };
    const tabBUpdated = reduce(tabBInit, {
      type: 'set-nodes',
      projectId: bookKey,
      nodes: [...tabBInit.projects[0]!.nodes, extraChapter],
    });
    sharedDisk.bytes = await manuscriptBytesOn(tabBUpdated, tabBUpdated.projects[0]!, initialBytes);

    // 回到分頁 A 修改第一章
    stateA = reduce(stateA, {
      type: 'commit-text',
      projectId: bookKey,
      nodeId: ch1Id,
      text: '【範例】分頁A改過的第一章。',
    });

    return { stateA, sharedDisk, env };
  }

  it('手動儲存時原檔已被別處更新，不應直接回傳 saved 並蓋掉第二章', async () => {
    const key = 'file-1763887800010';
    const setup = await setupExternalConflictScenario(key);
    let stateA = setup.stateA;
    const dispatch = (action: Action) => {
      stateA = reduce(stateA, action);
    };
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
    const lastSavedRevById: Record<string, number> = {};

    let conflictMarked = false;
    const outcome = await runManualSaveProject({
      getState: () => stateA,
      dispatch,
      env: setup.env,
      inflight,
      lastSavedRevById,
      onSaved: () => {},
      onConflict: () => {
        conflictMarked = true;
      },
      snapshot: async (s, p) => ({
        key: p.dbKey ?? p.id,
        bytes: await manuscriptBytesOn(s, p, null),
      }),
      store: null,
    });

    expect(outcome).toEqual({ kind: 'external-conflict', filename: '嚴2衝突測試.db' });
    expect(conflictMarked).toBe(true);
    expect(stateA.toast).toBe(SAVE_CONFLICT_TOAST);
    expect(firstFileNode(stateA.projects[0]!.nodes)?.content).toBe('【範例】分頁A改過的第一章。');
    const reopened = await inspectDb(setup.sharedDisk.bytes);
    const hasSecondChapter = reopened.tree.some((node) => node.content?.includes('別處新寫的第二章'));
    expect(hasSecondChapter).toBe(true);
  });

  it('背景自動存檔時原檔已被別處更新，回傳 external-conflict、暫停後續自動存檔且不蓋掉第二章', async () => {
    const key = 'file-1763887800011';
    const setup = await setupExternalConflictScenario(key);
    let stateA = setup.stateA;
    const dispatch = (action: Action) => {
      stateA = reduce(stateA, action);
    };
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
    const lastSavedRevById: Record<string, number> = {};
    let hasConflict = false;

    const outcome = await executeBackgroundAutoSave({
      projectId: key,
      getState: () => stateA,
      dispatch,
      env: setup.env,
      getStatus: () =>
        resolveAutoSaveStatus({
          canPickFiles: true,
          isSample: false,
          removed: false,
          hasSavedFile: true,
          needsNewName: false,
          permission: 'granted',
          lastAutoSaveFailed: false,
          hasExternalConflict: hasConflict,
        }),
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => false,
      onSaved: () => {},
      onNeedsPermission: () => {},
      onFailed: () => {},
      onConflict: () => {
        hasConflict = true;
      },
      onNoHandle: () => {},
      snapshot: async (s, p) => ({
        key: p.dbKey ?? p.id,
        bytes: await manuscriptBytesOn(s, p, null),
      }),
      store: null,
    });

    expect(outcome).toEqual({ kind: 'external-conflict', filename: '嚴2衝突測試.db' });
    expect(hasConflict).toBe(true);
    expect(stateA.toast).toBe(SAVE_CONFLICT_TOAST);
    expect(
      shouldRunAutoSaveTick({
        status: resolveAutoSaveStatus({
          canPickFiles: true,
          isSample: false,
          removed: false,
          hasSavedFile: true,
          needsNewName: false,
          permission: 'granted',
          lastAutoSaveFailed: false,
          hasExternalConflict: hasConflict,
        }),
        dirtySinceFileSave: true,
        currentRev: 1,
        lastSavedRev: 0,
        hasUncommittedDiff: false,
        isInflight: false,
      }),
    ).toBe(false);
    const reopened = await inspectDb(setup.sharedDisk.bytes);
    const hasSecondChapter = reopened.tree.some((node) => node.content?.includes('別處新寫的第二章'));
    expect(hasSecondChapter).toBe(true);
  });

  it('原檔未被外部改動時連續多次存檔推進指紋；無 lastKnownFingerprint 舊目標首次存檔不被誤擋', async () => {
    const key = 'file-1763887800012';
    touchedKeys.push(key);
    const { state: initState, chapterId } = makeBook(
      NOW_MS,
      key,
      '【範例】嚴2正常連續存檔',
      '【範例】第一版內容',
    );
    const disk = new FakeDisk('嚴2正常連續存檔.db', await manuscriptBytesOn(initState, initState.projects[0]!, null));
    const { env } = createFakeEnv(disk);
    // 模擬 0.4.1 升級上來的舊目標：沒有 lastKnownFingerprint 欄位
    await env.targets.save(key, { filename: disk.name, file: disk });

    let state = reduce(initState, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】第二版內容',
    });
    const bytes2 = await manuscriptBytesOn(state, state.projects[0]!, null);
    const first = await saveProjectToPlace(env, key, bytes2, disk.name);
    expect(first).toEqual({ kind: 'saved', filename: disk.name });
    const targetAfterFirst = await env.targets.load(key);
    expect(targetAfterFirst?.lastKnownFingerprint).toBe(await fingerprintBytes(bytes2));

    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】第三版內容',
    });
    const bytes3 = await manuscriptBytesOn(state, state.projects[0]!, null);
    const second = await saveProjectToPlace(env, key, bytes3, disk.name);
    expect(second).toEqual({ kind: 'saved', filename: disk.name });
    const targetAfterSecond = await env.targets.load(key);
    expect(targetAfterSecond?.lastKnownFingerprint).toBe(await fingerprintBytes(bytes3));
  });

  it('瀏覽器包裝 TargetStore：重開分頁清空記憶體並經 runResumeAutoSave 補寫時，外部已改檔應回傳 external-conflict 且不覆蓋原檔', async () => {
    const key = 'file-1763887800013';
    touchedKeys.push(key);
    const { state: tabBInit, chapterId: ch1Id } = makeBook(
      NOW_MS,
      key,
      '【範例】嚴2重開恢復測試',
      '【範例】原有第一章內容。',
    );
    const initialBytes = await manuscriptBytesOn(tabBInit, tabBInit.projects[0]!, null);
    const sharedDisk = new FakeDisk('嚴2重開恢復測試.db', initialBytes);
    const rawFingerprint = await fingerprintBytes(sharedDisk.bytes);

    const targets = createWrappingTargetStore();
    const env: SaveEnvironment = {
      canPickFiles: true,
      targets,
      verify: verifyBytesForSave,
      pickSaveLocation: async () => wrapFakeDisk(sharedDisk),
      share: async () => 'cancelled',
    };
    await env.targets.save(key, {
      filename: sharedDisk.name,
      file: wrapFakeDisk(sharedDisk),
      lastKnownFingerprint: rawFingerprint,
    });

    // 模擬重開分頁：清空 openFileMemory，且檔案把手權限回到 prompt、本機有尚未寫回的修改
    forgetOpenFile(key);
    sharedDisk.permission = 'prompt';
    const importedA = await readBookBytes(sharedDisk.name, initialBytes, key, new Date(NOW_MS));
    let stateA = createState(new Date(NOW_MS));
    stateA = reduce(stateA, attachActionForBook(importedA, { updatedLabel: '剛剛' }));
    stateA = reduce(stateA, {
      type: 'commit-text',
      projectId: key,
      nodeId: ch1Id,
      text: '【範例】重開分頁後改過的第一章。',
    });

    // 外部（例如另一裝置或電腦版）已改寫磁碟原檔
    const extraChapter: ChapterNode = {
      id: `${key}-ch2`,
      type: 'file',
      title: '第二章',
      progress: 'Draft',
      content: '【範例】別處更新的第二章',
    };
    const tabBUpdated = reduce(tabBInit, {
      type: 'set-nodes',
      projectId: key,
      nodes: [...tabBInit.projects[0]!.nodes, extraChapter],
    });
    sharedDisk.bytes = await manuscriptBytesOn(tabBUpdated, tabBUpdated.projects[0]!, initialBytes);

    const dispatch = (action: Action) => {
      stateA = reduce(stateA, action);
    };
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
    const lastSavedRevById: Record<string, number> = {};
    let hasConflict = false;
    let resumeOutcome: Awaited<ReturnType<typeof executeBackgroundAutoSave>> | null = null;

    const resumeRes = await runResumeAutoSave({
      project: stateA.projects.find((item) => item.id === key)!,
      state: stateA,
      env,
      lastSavedRevById,
      onPermissionChange: () => {},
      dispatch,
      runAutoSave: async () => {
        resumeOutcome = await executeBackgroundAutoSave({
          projectId: key,
          getState: () => stateA,
          dispatch,
          env,
          getStatus: () =>
            resolveAutoSaveStatus({
              canPickFiles: true,
              isSample: false,
              removed: false,
              hasSavedFile: true,
              needsNewName: false,
              permission: sharedDisk.permission,
              lastAutoSaveFailed: false,
              hasExternalConflict: hasConflict,
            }),
          lastSavedRevById,
          inflight,
          isPreviouslyFailed: () => false,
          onSaved: () => {},
          onNeedsPermission: () => {},
          onFailed: () => {},
          onConflict: () => {
            hasConflict = true;
          },
          onNoHandle: () => {},
          snapshot: async (s, p) => ({
            key: p.dbKey ?? p.id,
            bytes: await manuscriptBytesOn(s, p, null),
          }),
          store: null,
        });
        return resumeOutcome;
      },
    });

    expect(resumeRes).toBe('granted');
    expect(resumeOutcome).toEqual({ kind: 'external-conflict', filename: '嚴2重開恢復測試.db' });
    expect(hasConflict).toBe(true);
    expect(stateA.toast).toBe(SAVE_CONFLICT_TOAST);
    expect(sharedDisk.writeCalls).toBe(0);
    const reopened = await inspectDb(sharedDisk.bytes);
    expect(reopened.tree.some((node) => node.content?.includes('別處更新的第二章'))).toBe(true);
  });

  it('瀏覽器包裝 TargetStore：saveProjectAs 成功後原檔於外部被改動，後續 executeBackgroundAutoSave 應回傳 external-conflict 且不覆蓋原檔', async () => {
    const key = 'p-1763887800014';
    touchedKeys.push(key);
    const { state: initState, chapterId } = makeBook(
      NOW_MS,
      key,
      '【範例】嚴2另存衝突測試',
      '【範例】另存時的第一章。',
    );
    let state = initState;
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const saveAsDisk = new FakeDisk('嚴2另存衝突測試.db');
    const targets = createWrappingTargetStore();
    const env: SaveEnvironment = {
      canPickFiles: true,
      targets,
      verify: verifyBytesForSave,
      pickSaveLocation: async () => wrapFakeDisk(saveAsDisk),
      share: async () => 'cancelled',
    };

    const saveAsRes = await runSaveProjectAs({
      state,
      project: state.projects.find((item) => item.id === key)!,
      dispatch,
      env,
      preparedBytes: null,
      snapshot: async (s, p) => ({
        key: p.dbKey ?? p.id,
        bytes: await manuscriptBytesOn(s, p, null),
      }),
    });
    expect(saveAsRes.outcome).toEqual({ kind: 'saved-as', filename: '嚴2另存衝突測試.db' });
    expect(saveAsDisk.writeCalls).toBe(1);

    const lastSavedRevById: Record<string, number> = { [key]: saveAsRes.revAtStart };
    state = reduce(state, {
      type: 'clear-dirty-after-file-save',
      projectId: key,
      clearDirty: true,
    });

    // 外部程式改寫剛剛另存出去的新檔
    const externalChapter: ChapterNode = {
      id: `${key}-ext-ch2`,
      type: 'file',
      title: '第二章',
      progress: 'Draft',
      content: '【範例】另存後被別處寫入的第二章',
    };
    const externalBook = await readBookBytes(saveAsDisk.name, saveAsDisk.bytes, key, new Date(NOW_MS));
    let externalState = createState(new Date(NOW_MS));
    externalState = reduce(externalState, attachActionForBook(externalBook, { updatedLabel: '剛剛' }));
    externalState = reduce(externalState, {
      type: 'set-nodes',
      projectId: key,
      nodes: [...externalState.projects[0]!.nodes, externalChapter],
    });
    saveAsDisk.bytes = await manuscriptBytesOn(externalState, externalState.projects[0]!, saveAsDisk.bytes);

    // 作家繼續編輯第一章，觸發後續背景自動存檔
    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】另存後又改過的第一章。',
    });

    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };
    let hasConflict = false;
    const outcome = await executeBackgroundAutoSave({
      projectId: key,
      getState: () => state,
      dispatch,
      env,
      getStatus: () =>
        resolveAutoSaveStatus({
          canPickFiles: true,
          isSample: false,
          removed: false,
          hasSavedFile: true,
          needsNewName: false,
          permission: 'granted',
          lastAutoSaveFailed: false,
          hasExternalConflict: hasConflict,
        }),
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => false,
      onSaved: () => {},
      onNeedsPermission: () => {},
      onFailed: () => {},
      onConflict: () => {
        hasConflict = true;
      },
      onNoHandle: () => {},
      snapshot: async (s, p) => ({
        key: p.dbKey ?? p.id,
        bytes: await manuscriptBytesOn(s, p, null),
      }),
      store: null,
    });

    expect(outcome).toEqual({ kind: 'external-conflict', filename: '嚴2另存衝突測試.db' });
    expect(hasConflict).toBe(true);
    expect(state.toast).toBe(SAVE_CONFLICT_TOAST);
    expect(saveAsDisk.writeCalls).toBe(1);
    const reopened = await inspectDb(saveAsDisk.bytes);
    expect(reopened.tree.some((node) => node.content?.includes('另存後被別處寫入的第二章'))).toBe(true);
  });
});
