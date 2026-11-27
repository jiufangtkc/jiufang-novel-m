/**
 * WO-130／WO-131 甲段單元測試：
 * - 假 FileSystemFileHandle 與 FakeDisk：每 5 分鐘有變更才自動寫回、與手動儲存位元組一致、schema v14
 * - 單飛防重疊鎖、手動儲存等待背景寫入、寫入期間新編輯維持 dirty
 * - 改書名待新名另存暫停寫回舊檔、重開分頁不自動索權、點擊恢復權限與拒絕處理
 * - 寫入失敗還原原檔且防洗版（只在首次失敗跳一次 5 秒 Toast）
 * - 刪稿清理 file-targets 與記憶體把手
 * - 無法自動存檔的瀏覽器（canPickFiles 為 false）頁首角落標示與另存行為
 * - 0.4.1 版號與 whatsNew.ts 條目驗證（保留 0.4.0、0.3.0）
 * 只用記憶體假檔與範例內容，不讀寫真實書稿或 .db。
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveHeaderStatus } from '../components/SaveHeaderStatus';
import { runReminderSave } from '../components/StaleSaveReminder';
import { APP_VERSION } from '../copy/aboutCopy';
import {
  AUTOSAVE_FAILED_TOAST,
  AUTOSAVE_RESUMED_TOAST,
  SAVE_PERMISSION_DENIED,
} from '../copy/userFacing';
import { RELEASE_NOTES, findReleaseNote } from '../data/whatsNew';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import { currentSchemaVersion } from '../db/migrations';
import {
  forgetOpenFile,
  recallOpenFile,
  rememberOpenFile,
  rememberOpenFileFingerprint,
} from '../db/openFileMemory';
import {
  autoSaveProjectToPlace,
  saveProjectFromClick,
  type SaveEnvironment,
} from '../db/saveProject';
import { openMemoryDb } from '../db/wasmDb';
import {
  AUTOSAVE_HEARTBEAT_MS,
  AUTOSAVE_INTERVAL_MS,
  advanceAutoSaveDue,
  applyUncommittedDraftToProject,
  hasSavedExternalFile,
  lastExternalFileSaveMs,
  resolveAutoSaveStatus,
  resolveHeaderSaveDisplay,
  shouldClearDirtyAfterSave,
  shouldRunAutoSaveTick,
  startAutoSaveScheduler,
} from '../domain/autoSave';
import { shouldSaveUnderNewName } from '../domain/bookTitle';
import { setLiveReader } from '../editor/liveDraft';
import { loadDeviceSaveRecord } from './deviceSaveRecord';
import { removeProjectFromDevice } from './removeFromDevice';
import {
  applySaveOutcome,
  createState,
  executeBackgroundAutoSave,
  manuscriptBytesOn,
  persistDeviceSaveRecord,
  reduce,
  runManualSaveProject,
  runResumeAutoSave,
  toastDurationMs,
  verifyBytesForSave,
  type Action,
  type SampleState,
} from './sampleStore';
import { firstFileNode } from './testing/firstFile';

class FakeHandleDisk implements DiskFile {
  bytes = new Uint8Array();
  queryCalls = 0;
  requestCalls = 0;
  writeCalls = 0;
  permission: 'granted' | 'prompt' | 'denied' = 'granted';
  requestResult: 'granted' | 'denied' = 'granted';
  failWritesRemaining = 0;
  pendingWriteGate: { promise: Promise<void>; resolve: () => void } | null = null;
  onWriteEntered: (() => void) | null = null;

  constructor(readonly name: string) {}

  startWriteGate(): Promise<void> {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    this.pendingWriteGate = { promise, resolve };
    return new Promise<void>((entered) => {
      this.onWriteEntered = entered;
    });
  }

  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }

  async write(next: Uint8Array): Promise<void> {
    this.writeCalls += 1;
    if (this.onWriteEntered) {
      const notify = this.onWriteEntered;
      this.onWriteEntered = null;
      notify();
    }
    if (this.pendingWriteGate) {
      await this.pendingWriteGate.promise;
    }
    if (this.failWritesRemaining > 0) {
      this.failWritesRemaining -= 1;
      // 模擬寫入中途破壞到一半才失敗，測試 writeWithoutDestroying 是否安全還原。
      this.bytes = new Uint8Array([0, 1, 2]);
      throw new Error('模擬磁碟寫入失敗');
    }
    this.bytes = next.slice();
  }

  async queryPermission(): Promise<'granted' | 'prompt' | 'denied'> {
    this.queryCalls += 1;
    return this.permission;
  }

  async requestPermission(): Promise<'granted' | 'denied'> {
    this.requestCalls += 1;
    if (this.requestResult === 'granted') {
      this.permission = 'granted';
    }
    return this.requestResult;
  }
}

function createFakeEnv(options?: { canPickFiles?: boolean }) {
  const targets = createMemoryTargetStore();
  let pickedFile: DiskFile | null = null;
  const env: SaveEnvironment & { setPickedFile: (f: DiskFile | null) => void } = {
    canPickFiles: options?.canPickFiles ?? true,
    targets,
    verify: verifyBytesForSave,
    pickSaveLocation: async () => pickedFile,
    share: async () => 'cancelled',
    setPickedFile: (f) => {
      pickedFile = f;
    },
  };
  return env;
}

function makeBookState(nowMs: number, id = 'p-1763697600000', title = '【範例】自動存檔測試稿'): {
  state: SampleState;
  chapterId: string;
} {
  let state = createState(new Date(nowMs));
  state = reduce(state, { type: 'add-project', id, title, shape: 'novel', startedMs: nowMs });
  state = reduce(state, { type: 'focus-project', id });
  const project = state.projects.find((p) => p.id === id)!;
  const chapterId = firstFileNode(project.nodes)!.id;
  return { state, chapterId };
}

function createFakeKeyValueStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const NOW_MS = Date.parse('2026-11-21T04:50:00+08:00');
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

describe('WO-130 甲段：自動存檔管線、單飛鎖、權限與寫回安全', () => {
  it('支援瀏覽器存過一次後，有變更才在 5 分鐘寫回同一檔案且位元組與手動儲存一致、維持 schema v14', async () => {
    const env = createFakeEnv({ canPickFiles: true });
    const fakeHandle = new FakeHandleDisk('自動存檔測試稿.db');
    env.setPickedFile(fakeHandle);

    const { state: initState, chapterId } = makeBookState(NOW_MS);
    let state = reduce(initState, {
      type: 'commit-text',
      projectId: 'p-1763697600000',
      nodeId: chapterId,
      text: '【範例】第一段手動存檔前的正文。',
    });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const key = 'p-1763697600000';
    touchedKeys.push(key);

    // 1. 首次手動「儲存專案」取得把手
    const firstOutcome = await saveProjectFromClick({
      env,
      bookKey: key,
      plan: 'pick-first-save',
      writeBackName: '自動存檔測試稿.db',
      newTitleName: '自動存檔測試稿.db',
      startIn: null,
      onRemember: (file) => rememberOpenFile(key, file),
      buildBytes: async () => manuscriptBytesOn(state, state.projects[0]!, null),
    });
    expect(firstOutcome.kind).toBe('saved');
    applySaveOutcome(dispatch, key, firstOutcome, 'save');
    dispatch({ type: 'clear-dirty-after-file-save', projectId: key, clearDirty: true });
    expect(fakeHandle.writeCalls).toBe(1);

    const lastSavedRevById: Record<string, number> = {
      [key]: state.contentRevById?.[key] ?? 0,
    };
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };

    // 2. 沒改字：跑過 3 次 5 分鐘週期（15 分鐘），寫入次數仍為 1，完全不寫磁碟
    const snapshotSpy = vi.fn(async (s: SampleState, p: SampleState['projects'][number]) => ({
      key: p.dbKey ?? p.id,
      bytes: await manuscriptBytesOn(s, p, null),
    }));
    const timer = setInterval(() => {
      void executeBackgroundAutoSave({
        projectId: key,
        getState: () => state,
        dispatch,
        env,
        getStatus: () => 'active',
        lastSavedRevById,
        inflight,
        isPreviouslyFailed: () => false,
        onSaved: () => {},
        onNeedsPermission: () => {},
        onFailed: () => {},
        onNoHandle: () => {},
        snapshot: snapshotSpy,
        store: null,
      });
    }, AUTOSAVE_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 3);
    expect(fakeHandle.writeCalls).toBe(1);
    expect(snapshotSpy).not.toHaveBeenCalled();

    // 3. 改字後前進 5 分鐘：自動寫回同一檔案
    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】第一段手動存檔前的正文。補上五分鐘後的新增段落。',
    });
    expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    clearInterval(timer);

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(fakeHandle.writeCalls).toBe(2);
    expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(false);

    // 驗證寫出位元組與手動建檔一致、可開回、且 schema 維持 v14
    const expectedBytes = await manuscriptBytesOn(state, state.projects[0]!, null);
    expect(fakeHandle.bytes).toEqual(expectedBytes);
    const db = await openMemoryDb(fakeHandle.bytes);
    try {
      expect(currentSchemaVersion(db.sql)).toBe(14);
    } finally {
      db.close();
    }
  });

  it('單飛互斥鎖：寫入中不重疊；手動儲存會等自動存檔完成；寫入期間有新編輯保留 dirty', async () => {
    const env = createFakeEnv({ canPickFiles: true });
    const fakeHandle = new FakeHandleDisk('測試.db');
    const key = 'p-1763697600001';
    touchedKeys.push(key);
    await env.targets.save(key, { filename: '測試.db', file: fakeHandle });
    rememberOpenFile(key, fakeHandle);

    const { state: initState, chapterId } = makeBookState(NOW_MS, key);
    let state = reduce(initState, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】初始文字',
    });
    state = reduce(state, { type: 'record-project-save', projectId: key, atMs: NOW_MS });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const lastSavedRevById: Record<string, number> = {};
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };

    const writeEntered = fakeHandle.startWriteGate();
    const firstAuto = executeBackgroundAutoSave({
      projectId: key,
      getState: () => state,
      dispatch,
      env,
      getStatus: () => 'active',
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => false,
      onSaved: () => {},
      onNeedsPermission: () => {},
      onFailed: () => {},
      onNoHandle: () => {},
      snapshot: async (s, p) => ({ key: p.dbKey ?? p.id, bytes: await manuscriptBytesOn(s, p, null) }),
      store: null,
    });

    await writeEntered;
    expect(fakeHandle.writeCalls).toBe(1);
    expect(inflight.current?.kind).toBe('auto');

    // 寫入期間再次觸發自動存檔：必須直接略過，不排隊、不呼叫 write
    const overlappedAuto = await executeBackgroundAutoSave({
      projectId: key,
      getState: () => state,
      dispatch,
      env,
      getStatus: () => 'active',
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => false,
      onSaved: () => {},
      onNeedsPermission: () => {},
      onFailed: () => {},
      onNoHandle: () => {},
      snapshot: async (s, p) => ({ key: p.dbKey ?? p.id, bytes: await manuscriptBytesOn(s, p, null) }),
      store: null,
    });
    expect(overlappedAuto).toBe('skipped');
    expect(fakeHandle.writeCalls).toBe(1);

    // 寫入期間發生新編輯
    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】寫入期間又補打的文字',
    });

    // 模擬手動儲存等待 inflight 完成後才寫
    let manualDone = false;
    const manualPromise = (async () => {
      if (inflight.current) await inflight.current.promise;
      const out = await saveProjectFromClick({
        env,
        bookKey: key,
        plan: 'write-back',
        writeBackName: '測試.db',
        newTitleName: '測試.db',
        startIn: null,
        buildBytes: async () => manuscriptBytesOn(state, state.projects[0]!, null),
      });
      manualDone = true;
      return out;
    })();

    await Promise.resolve();
    expect(manualDone).toBe(false);
    expect(fakeHandle.writeCalls).toBe(1);

    // 解除閘門
    fakeHandle.pendingWriteGate!.resolve();
    fakeHandle.pendingWriteGate = null;

    const firstResult = await firstAuto;
    expect(firstResult).toEqual({ kind: 'saved', filename: '測試.db' });
    // 因寫入期間有新編輯，dirtySinceFileSave 必須維持 true
    expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(true);

    const manualResult = await manualPromise;
    expect(manualDone).toBe(true);
    expect(manualResult.kind).toBe('saved');
    expect(fakeHandle.writeCalls).toBe(2);
  });

  it('改書名待新名另存（paused-rename）時暫停自動寫回舊檔；未送出編輯框非組字時併入快照', () => {
    const status = resolveAutoSaveStatus({
      canPickFiles: true,
      isSample: false,
      removed: false,
      hasSavedFile: true,
      needsNewName: true,
      permission: 'granted',
      lastAutoSaveFailed: false,
    });
    expect(status).toBe('paused-rename');
    expect(
      shouldRunAutoSaveTick({
        status,
        dirtySinceFileSave: true,
        currentRev: 5,
        lastSavedRev: 1,
        hasUncommittedDiff: true,
        isInflight: false,
      }),
    ).toBe(false);

    const { state, chapterId } = makeBookState(NOW_MS, 'p-1763697600002');
    const project = state.projects[0]!;
    const mergedComposing = applyUncommittedDraftToProject(
      project,
      { projectId: project.id, chapterId, text: '組字中' },
      true,
    );
    expect(mergedComposing.hasDiff).toBe(false);

    const mergedIdle = applyUncommittedDraftToProject(
      project,
      { projectId: project.id, chapterId, text: '還沒停筆送出的文字' },
      false,
    );
    expect(mergedIdle.hasDiff).toBe(true);
    expect(firstFileNode(mergedIdle.project.nodes)?.content).toBe('還沒停筆送出的文字');
  });

  it('重開分頁權限為 prompt：背景不主動索權；點擊恢復才叫一次 requestPermission 並補存或提示', async () => {
    const env = createFakeEnv({ canPickFiles: true });
    const fakeHandle = new FakeHandleDisk('重開測試.db');
    fakeHandle.bytes = new Uint8Array([1, 2, 3]);
    fakeHandle.permission = 'prompt';
    const key = 'p-1763697600003';
    touchedKeys.push(key);
    await env.targets.save(key, { filename: '重開測試.db', file: fakeHandle });
    rememberOpenFile(key, fakeHandle);

    const { state: initState, chapterId } = makeBookState(NOW_MS, key);
    let state = reduce(initState, { type: 'record-project-save', projectId: key, atMs: NOW_MS });
    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】重開前還沒寫回的字',
    });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    // 背景檢查絕不呼叫 requestPermission
    const bgOutcome = await autoSaveProjectToPlace(
      env,
      key,
      await manuscriptBytesOn(state, state.projects[0]!, null),
      '重開測試.db',
    );
    expect(bgOutcome).toEqual({ kind: 'needs-permission', permission: 'prompt' });
    expect(fakeHandle.requestCalls).toBe(0);
    expect(fakeHandle.queryCalls).toBe(1);

    // 情境 A：使用者拒絕授權 → 跳 SAVE_PERMISSION_DENIED 且不寫檔
    fakeHandle.requestResult = 'denied';
    let currentPerm: 'none' | 'granted' | 'prompt' | 'denied' = 'prompt';
    const lastSavedRevById: Record<string, number> = {};
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };

    const deniedRes = await runResumeAutoSave({
      project: state.projects[0]!,
      state,
      env,
      lastSavedRevById,
      onPermissionChange: (_id, perm) => {
        currentPerm = perm;
      },
      dispatch,
      runAutoSave: async () => 'no-changes',
    });
    expect(deniedRes).toBe('denied');
    expect(fakeHandle.requestCalls).toBe(1);
    expect(currentPerm).toBe('denied');
    expect(state.toast).toBe(SAVE_PERMISSION_DENIED);
    expect(fakeHandle.writeCalls).toBe(0);

    // 情境 B：使用者同意授權且有 dirty → 立刻補存並清 dirty
    fakeHandle.requestResult = 'granted';
    const grantedRes = await runResumeAutoSave({
      project: state.projects[0]!,
      state,
      env,
      lastSavedRevById,
      onPermissionChange: (_id, perm) => {
        currentPerm = perm;
      },
      dispatch,
      runAutoSave: () =>
        executeBackgroundAutoSave({
          projectId: key,
          getState: () => state,
          dispatch,
          env,
          getStatus: () => 'active',
          lastSavedRevById,
          inflight,
          isPreviouslyFailed: () => false,
          onSaved: () => {},
          onNeedsPermission: () => {},
          onFailed: () => {},
          onNoHandle: () => {},
          snapshot: async (s, p) => ({ key: p.dbKey ?? p.id, bytes: await manuscriptBytesOn(s, p, null) }),
          store: null,
        }),
    });
    expect(grantedRes).toBe('granted');
    expect(fakeHandle.requestCalls).toBe(2);
    expect(currentPerm).toBe('granted');
    expect(fakeHandle.writeCalls).toBe(1);
    expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(false);

    // 情境 C：無 dirty 變更時恢復權限 → 顯示「已恢復自動存檔」短提示，不寫磁碟
    const cleanRes = await runResumeAutoSave({
      project: state.projects[0]!,
      state,
      env,
      lastSavedRevById,
      onPermissionChange: () => {},
      dispatch,
      runAutoSave: async () => 'no-changes',
    });
    expect(cleanRes).toBe('granted');
    expect(state.toast).toBe(AUTOSAVE_RESUMED_TOAST);
    expect(fakeHandle.writeCalls).toBe(1);
  });

  it('寫入失敗時安全還原原檔不損毀、轉 failed、只在首次失敗跳 5 秒 Toast（不重複洗版）', async () => {
    const env = createFakeEnv({ canPickFiles: true });
    const fakeHandle = new FakeHandleDisk('保護原檔.db');
    const originalBytes = new Uint8Array([83, 81, 76, 105, 116, 101]);
    fakeHandle.bytes = originalBytes.slice();
    fakeHandle.failWritesRemaining = 1;
    const key = 'p-1763697600004';
    touchedKeys.push(key);
    await env.targets.save(key, { filename: '保護原檔.db', file: fakeHandle });
    rememberOpenFile(key, fakeHandle);

    const { state: initState, chapterId } = makeBookState(NOW_MS, key);
    let state = reduce(initState, { type: 'record-project-save', projectId: key, atMs: NOW_MS });
    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】失敗寫入測試內容',
    });
    const toasts: string[] = [];
    const dispatch = (action: Action) => {
      if (action.type === 'toast' && action.message) toasts.push(action.message);
      state = reduce(state, action);
    };

    let failed = false;
    const lastSavedRevById: Record<string, number> = {};
    const inflight = { current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null };

    const out1 = await executeBackgroundAutoSave({
      projectId: key,
      getState: () => state,
      dispatch,
      env,
      getStatus: () => (failed ? 'failed' : 'active'),
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => failed,
      onSaved: () => {
        failed = false;
      },
      onNeedsPermission: () => {},
      onFailed: () => {
        failed = true;
      },
      onNoHandle: () => {},
      snapshot: async (s, p) => ({ key: p.dbKey ?? p.id, bytes: await manuscriptBytesOn(s, p, null) }),
      store: null,
    });
    expect(out1).toEqual({ kind: 'write-failed', restored: true });
    expect(fakeHandle.bytes).toEqual(originalBytes);
    expect(failed).toBe(true);
    expect(toasts).toEqual([AUTOSAVE_FAILED_TOAST]);
    expect(toastDurationMs(AUTOSAVE_FAILED_TOAST)).toBe(5000);
    expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(true);

    // 連續第二次失敗：不再重複跳 Toast
    fakeHandle.failWritesRemaining = 1;
    const out2 = await executeBackgroundAutoSave({
      projectId: key,
      getState: () => state,
      dispatch,
      env,
      getStatus: () => (failed ? 'failed' : 'active'),
      lastSavedRevById,
      inflight,
      isPreviouslyFailed: () => failed,
      onSaved: () => {
        failed = false;
      },
      onNeedsPermission: () => {},
      onFailed: () => {
        failed = true;
      },
      onNoHandle: () => {},
      snapshot: async (s, p) => ({ key: p.dbKey ?? p.id, bytes: await manuscriptBytesOn(s, p, null) }),
      store: null,
    });
    expect(out2).toEqual({ kind: 'write-failed', restored: true });
    expect(toasts).toEqual([AUTOSAVE_FAILED_TOAST]);
  });

  it('dirtySinceFileSave 跨分頁保留於 save-record.v1，且刪稿一併清理 file-targets 與記憶體把手', async () => {
    const store = createFakeKeyValueStore();
    const { state: initState, chapterId } = makeBookState(NOW_MS, 'p-1763697600005');
    const edited = reduce(initState, {
      type: 'commit-text',
      projectId: 'p-1763697600005',
      nodeId: chapterId,
      text: '【範例】還沒滿五分鐘就關分頁',
    });
    persistDeviceSaveRecord(store, edited);
    const reloaded = loadDeviceSaveRecord(store, new Date(NOW_MS));
    expect(reloaded.saveMeta['p-1763697600005']?.dirtySinceFileSave).toBe(true);

    // 刪稿清理 target store 與 openFileMemory
    const targetStore = createMemoryTargetStore();
    const handle = new FakeHandleDisk('待刪.db');
    await targetStore.save('p-1763697600005', { filename: '待刪.db', file: handle });
    rememberOpenFile('p-1763697600005', handle);
    expect(recallOpenFile('p-1763697600005')).toBe(handle);

    const ok = await removeProjectFromDevice({
      project: { id: 'p-1763697600005' },
      store,
      removeCopy: async () => {},
      removeTarget: (k) => targetStore.remove!(k),
    });
    expect(ok).toBe(true);
    expect(recallOpenFile('p-1763697600005')).toBeUndefined();
    expect(await targetStore.load('p-1763697600005')).toBeNull();
  });

  it('純邏輯輔助：hasSavedExternalFile、lastExternalFileSaveMs、shouldClearDirtyAfterSave 與頁首優先序', () => {
    expect(hasSavedExternalFile(null)).toBe(false);
    expect(hasSavedExternalFile({ lastProjectSaveMs: null, lastExportMs: null })).toBe(false);
    expect(hasSavedExternalFile({ lastProjectSaveMs: 100, lastExportMs: null })).toBe(true);
    expect(hasSavedExternalFile({ lastProjectSaveMs: null, lastExportMs: 200 })).toBe(true);
    expect(lastExternalFileSaveMs({ lastProjectSaveMs: 100, lastExportMs: 250 })).toBe(250);
    expect(shouldClearDirtyAfterSave(3, 3)).toBe(true);
    expect(shouldClearDirtyAfterSave(3, 4)).toBe(false);

    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: 'needs-permission',
        staleDays: 5,
        lastFileSaveMs: 100,
      }),
    ).toBe('needs-permission');
    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: 'failed',
        staleDays: 5,
        lastFileSaveMs: 100,
      }),
    ).toBe('failed');
    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: 'unsupported',
        staleDays: 3,
        lastFileSaveMs: null,
      }),
    ).toBe('stale');
    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: 'unsupported',
        staleDays: null,
        lastFileSaveMs: null,
      }),
    ).toBe('unsaved');
    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: 'active',
        staleDays: null,
        lastFileSaveMs: 100,
      }),
    ).toBe('time');
    expect(
      resolveHeaderSaveDisplay({
        isSample: true,
        autoSaveStatus: 'unsaved',
        staleDays: null,
        lastFileSaveMs: null,
      }),
    ).toBe('none');
  });

  it('返工 2：頁首點擊存檔成功 → 狀態變 active → 頁首改顯示時間 → 有變更 5 分鐘後寫回（含假把手無法結構化複製耐受）', async () => {
    for (const throwTargetSave of [false, true]) {
      vi.setSystemTime(NOW_MS);
      const key = throwTargetSave ? 'p-1763697600099' : 'p-1763697600098';
      touchedKeys.push(key);
      const env = createFakeEnv({ canPickFiles: true });
      if (throwTargetSave) {
        env.targets.save = async () => {
          throw new DOMException('async function could not be cloned', 'DataCloneError');
        };
      }
      const fakeHandle = new FakeHandleDisk('霧港旅館.db');
      env.setPickedFile(fakeHandle);

      const { state: initState, chapterId } = makeBookState(NOW_MS, key, '霧港旅館');
      let state = reduce(initState, {
        type: 'commit-text',
        projectId: key,
        nodeId: chapterId,
        text: '【範例】頁首點擊存檔前的八十字測試段落。',
      });
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };

      let handlePerm: 'none' | 'granted' | 'prompt' | 'denied' = 'none';
      let lastSaveWasAuto = false;
      let autoSaveFailed = false;
      const lastSavedRevById: Record<string, number> = {};
      const inflight = {
        current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null,
      };
      const computeAutoSaveStatus = () => {
        const project = state.projects.find((p) => p.id === key)!;
        return resolveAutoSaveStatus({
          canPickFiles: true,
          isSample: false,
          removed: false,
          hasSavedFile: hasSavedExternalFile(state.saveMeta[key]),
          needsNewName: shouldSaveUnderNewName({
            hasExternalFile: Boolean(project.hasExternalFile),
            titleInFile: project.titleInFile ?? null,
            title: project.title,
            filename: project.filename ?? null,
          }),
          permission: handlePerm,
          lastAutoSaveFailed: autoSaveFailed,
        });
      };
      const renderHeader = () => {
        const autoSaveStatus = computeAutoSaveStatus();
        const lastFileSaveMs = lastExternalFileSaveMs(state.saveMeta[key]);
        const kind = resolveHeaderSaveDisplay({
          isSample: false,
          autoSaveStatus,
          staleDays: null,
          lastFileSaveMs,
        });
        return renderToStaticMarkup(
          createElement(SaveHeaderStatus, {
            kind,
            canPickFiles: true,
            lastFileSaveMs,
            autoSaveActive: autoSaveStatus === 'active',
            lastSaveWasAuto,
            onResumeAutoSave: () => {},
            onSave: () => {},
            now: new Date(),
          }),
        );
      };

      // 1. 存檔前：unsaved，頁首顯示「還沒存成檔案」
      expect(computeAutoSaveStatus()).toBe('unsaved');
      expect(renderHeader()).toContain('還沒存成檔案');

      // 2. 點頁首「還沒存成檔案」走 runReminderSave → runManualSaveProject
      const snapshot = async (s: SampleState, p: SampleState['projects'][number]) => ({
        key: p.dbKey ?? p.id,
        bytes: await manuscriptBytesOn(s, p, null),
      });
      const outcome = await runReminderSave(true, {
        saveProject: () =>
          runManualSaveProject({
            getState: () => state,
            dispatch,
            env,
            inflight,
            lastSavedRevById,
            snapshot,
            store: null,
            onSaved: () => {
              autoSaveFailed = false;
              lastSaveWasAuto = false;
              handlePerm = 'granted';
            },
          }),
        saveProjectAs: async () => null,
      });

      expect(outcome).toEqual({ kind: 'saved', filename: '霧港旅館.db' });
      expect(fakeHandle.writeCalls).toBe(1);
      expect(state.saveMeta[key]?.lastProjectSaveMs).toBe(NOW_MS);
      expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(false);
      expect(handlePerm).toBe('granted');
      expect(computeAutoSaveStatus()).toBe('active');
      const afterManualHtml = renderHeader();
      expect(afterManualHtml).toContain('上次存檔');
      expect(afterManualHtml).not.toContain('還沒存成檔案');

      // 3. 進入 active 後啟動 5 分鐘計時器：沒變更時 5 分 5 秒不寫
      const timer = setInterval(() => {
        if (computeAutoSaveStatus() !== 'active' && computeAutoSaveStatus() !== 'failed') return;
        void executeBackgroundAutoSave({
          projectId: key,
          getState: () => state,
          dispatch,
          env,
          getStatus: computeAutoSaveStatus,
          lastSavedRevById,
          inflight,
          isPreviouslyFailed: () => autoSaveFailed,
          onSaved: () => {
            autoSaveFailed = false;
            lastSaveWasAuto = true;
          },
          onNeedsPermission: (_id, perm) => {
            handlePerm = perm;
          },
          onFailed: () => {
            autoSaveFailed = true;
          },
          onNoHandle: () => {
            handlePerm = 'none';
          },
          snapshot,
          store: null,
        });
      }, AUTOSAVE_INTERVAL_MS);

      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 5000);
      expect(fakeHandle.writeCalls).toBe(1);

      // 4. 修改 40 字後，時鐘再前進 5 分 5 秒：自動寫回同一把手，頁首顯示「已自動存檔 時間」
      state = reduce(state, {
        type: 'commit-text',
        projectId: key,
        nodeId: chapterId,
        text: '【範例】頁首點擊存檔前的八十字測試段落。補上四十字的後續變更內容。',
      });
      expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(true);

      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 5000);
      clearInterval(timer);

      expect(fakeHandle.writeCalls).toBe(2);
      expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(false);
      expect(lastSaveWasAuto).toBe(true);
      const afterAutoHtml = renderHeader();
      expect(afterAutoHtml).toContain('已自動存檔');
      expect(afterAutoHtml).not.toContain('還沒存成檔案');
    }
  });

  it('無法自動存檔的瀏覽器（canPickFiles 為 false）：未存過顯示「還沒存成檔案」、點按走另存、已存過顯示「上次存檔 時間」', async () => {
    const key = 'p-1763697600101';
    let { state } = makeBookState(NOW_MS, key, '跨瀏覽器測試稿');

    const unsupportedUnsaved = resolveAutoSaveStatus({
      canPickFiles: false,
      isSample: false,
      removed: false,
      hasSavedFile: false,
      needsNewName: false,
      permission: 'none',
      lastAutoSaveFailed: false,
    });
    expect(unsupportedUnsaved).toBe('unsupported');
    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: unsupportedUnsaved,
        staleDays: null,
        lastFileSaveMs: lastExternalFileSaveMs(state.saveMeta[key]),
      }),
    ).toBe('unsaved');

    const calls: string[] = [];
    await runReminderSave(false, {
      saveProject: async () => void calls.push('save'),
      saveProjectAs: async () => void calls.push('save-as'),
    });
    expect(calls).toEqual(['save-as']);

    state = reduce(state, { type: 'record-export', projectId: key, atMs: NOW_MS });
    const lastMs = lastExternalFileSaveMs(state.saveMeta[key]);
    expect(lastMs).toBe(NOW_MS);
    const kindAfterSave = resolveHeaderSaveDisplay({
      isSample: false,
      autoSaveStatus: unsupportedUnsaved,
      staleDays: null,
      lastFileSaveMs: lastMs,
    });
    expect(kindAfterSave).toBe('time');
    const html = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: kindAfterSave,
        canPickFiles: false,
        lastFileSaveMs: lastMs,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now: new Date(NOW_MS),
      }),
    );
    expect(html).toContain('上次存檔');
    expect(html).not.toContain('已自動存檔');

    expect(
      resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus: unsupportedUnsaved,
        staleDays: 3,
        lastFileSaveMs: lastMs,
      }),
    ).toBe('stale');
  });
});

describe('WO-137／WO-138／WO-139／WO-140／WO-141／WO-143／WO-142：0.10.0 版號與改版說明驗證', () => {
  it('package.json、package-lock.json、APP_VERSION 皆為 0.10.0，whatsNew 頂端為 0.10.0 且保留 0.9.1～0.3.0', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
      version: string;
      packages: { '': { version: string } };
    };
    const whatsNewSrc = readFileSync(new URL('../data/whatsNew.ts', import.meta.url), 'utf8');
    expect(pkg.version).toBe('0.10.0');
    expect(lock.version).toBe('0.10.0');
    expect(lock.packages[''].version).toBe('0.10.0');
    expect(APP_VERSION).toBe('0.10.0');
    expect(whatsNewSrc).toContain('WO-142（暫定，待九方審）');
    expect(whatsNewSrc).toContain('WO-143（暫定，待九方審）');
    expect(whatsNewSrc).toContain('WO-141（暫定，待九方審）');
    expect(whatsNewSrc).toContain('WO-140（暫定，待九方審）');
    expect(whatsNewSrc).toContain('WO-139（暫定，待九方審）');
    expect(whatsNewSrc).toContain('WO-138（暫定，待九方審）');
    expect(whatsNewSrc).toContain('WO-137（暫定，待九方審）');

    expect(RELEASE_NOTES[0]?.version).toBe('0.10.0');
    expect(RELEASE_NOTES[1]?.version).toBe('0.9.1');
    expect(RELEASE_NOTES[2]?.version).toBe('0.9.0');
    expect(findReleaseNote('0.9.0')?.items).toEqual([
      '版本清單新增「比較」：可逐字對照任一份舊版與現在這一章的差異，並自動統計增減字數與改動段數',
      '連續未改動的段落會先收起來，只留前後各一段方便對照，點一下即可展開原文',
    ]);
    expect(findReleaseNote('0.8.0')?.items).toEqual([
      '新增稿子版本：可以把這一章目前的樣子存下來，之後查看或回到舊版；版本會跟著稿子檔一起保存',
      '回到舊版之前，會先自動把現在的樣子存一份，回去後也可以復原',
    ]);
    expect(findReleaseNote('0.7.0')?.items).toEqual([
      '排版新增『統一標點』：一鍵把破折號、刪節號、引號和中文裡的半形標點，統一成臺灣出版常用的寫法',
    ]);
    expect(findReleaseNote('0.6.0')?.items).toEqual([
      '從刪稿暫存區放回去的字、以及收進暫存區的刪除，都不會算進今天的進度；只有新打的字才算',
      '新增刪稿暫存區：改稿時一次刪掉較長的段落會先留下來，可註記當時為什麼刪，也能放回原來的章節',
      '這些刪稿會跟著稿子檔一起保存；打錯字的小刪除不會進去，避免存檔無謂變大',
    ]);
    expect(findReleaseNote('0.5.0')?.items).toEqual([
      '替每份稿子建立固定識別紀錄，方便日後重複開檔或跨裝置時認出同一部稿子（打開舊稿不會主動改寫原檔，等你下次儲存時才寫入）',
      '統一稿子附加資料的相容規則：電腦版可照常開啟新存的稿子，遇到新版新增的附加資料也會原樣保留，不影響正文、目錄與卡片',
    ]);
    expect(findReleaseNote('0.4.4')?.items).toEqual([
      '刪掉章節後按復原，時間線上連到這章的事件會一起接回來',
    ]);
    expect(findReleaseNote('0.4.3')?.items).toEqual([
      '瀏覽器暫時記不住原檔位置時，正常的九方稿件仍可照常開啟',
      '開啟非九方稿件或較新版本的稿件檔時，會清楚說明原因，不再誤開空白稿',
      '從「最近刪除」或「復原」救回章節與卡片時，會先確認存妥再移除刪除紀錄',
      '修正另存檔案與畫面提示可能不一致的情況，並統一介面用字',
    ]);
    expect(findReleaseNote('0.4.2')?.items).toEqual([
      '寫作頁「還沒存成檔案」改成畫面一角的小標示，存檔狀態也改為只在一處顯示',
      '排版後一開始打字就會收起「排版好了」提示，按「復原」不會清掉新打的字',
      '誤刪章節後再復原，時間線事件會一起連回原本的章',
      '暫存或自動存檔沒成功時，畫面會清楚提醒',
      '修正在剛打完字立刻按存檔快速鍵、原檔已在別處更新，或瀏覽器暫存異常時可能漏字或覆蓋的問題',
    ]);
    expect(findReleaseNote('0.4.1')?.items).toEqual([
      '存檔提醒改成只在畫面角落顯示，不再跳出視窗',
    ]);
    expect(findReleaseNote('0.4.0')?.items).toEqual([
      '自動存檔：在電腦的 Chrome 或 Edge 存成檔案一次後，有改字就每 5 分鐘自動存回去',
      '還沒存成檔案時會提醒你',
    ]);
    expect(findReleaseNote('0.3.0')?.items).toEqual([
      '事件時間線：照故事順序或章節順序排事件，電腦寬螢幕還能雙線對照',
      '設定頁新增贊助按鈕',
    ]);
  });
});

function createPlaywrightLikeClock(startMs: number) {
  let nowMs = startMs;
  let nextId = 1;
  const intervals = new Map<number, { handler: () => void; intervalMs: number; nextAt: number }>();
  const yieldMacro = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const setTime = (ms: number) => {
    nowMs = ms;
    vi.setSystemTime(ms);
  };

  return {
    now: () => nowMs,
    setInterval(handler: () => void, ms: number) {
      const id = nextId++;
      const step = Math.max(1, ms);
      intervals.set(id, { handler, intervalMs: step, nextAt: nowMs + step });
      return id;
    },
    clearInterval(id: number) {
      intervals.delete(id);
    },
    async runFor(durationMs: number) {
      const target = nowMs + durationMs;
      while (true) {
        let earliestAt = Infinity;
        let chosenId = 0;
        for (const [id, entry] of intervals) {
          if (entry.nextAt <= target && entry.nextAt < earliestAt) {
            earliestAt = entry.nextAt;
            chosenId = id;
          }
        }
        if (chosenId === 0) break;
        setTime(earliestAt);
        const entry = intervals.get(chosenId);
        if (entry) {
          entry.nextAt += entry.intervalMs;
          entry.handler();
        }
        await yieldMacro();
      }
      setTime(target);
      await Promise.resolve();
    },
  };
}

describe('WO-131 返工 1：自動存檔排程心跳與記憶體把手優先', () => {
  it('WO-131 返工 1：手動存檔後沒變更 5 分鐘不寫，接著打字 40 字再過 5 分 5 秒，在無額外等待的非同步假時鐘下能完成自動寫回並顯示「已自動存檔」', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    const yieldMacro = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const clock = createPlaywrightLikeClock(NOW_MS);

    const key = 'p-1763697600201';
    touchedKeys.push(key);
    const env = createFakeEnv({ canPickFiles: true });
    const fakeHandle = new FakeHandleDisk('霧港旅館.db');
    const origWrite = fakeHandle.write.bind(fakeHandle);
    fakeHandle.write = async (bytes: Uint8Array) => {
      await yieldMacro();
      await yieldMacro();
      await origWrite(bytes);
    };
    env.setPickedFile(fakeHandle);

    const { state: initState, chapterId } = makeBookState(NOW_MS, key, '霧港旅館');
    let state = reduce(initState, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】霧港的夜裡，旅館的燈還亮著，櫃檯後面的老闆娘正在數著今天的帳本，窗外的雨一直沒有停。',
    });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    let handlePerm: 'none' | 'granted' | 'prompt' | 'denied' = 'none';
    let lastSaveWasAuto = false;
    let autoSaveFailed = false;
    const lastSavedRevById: Record<string, number> = {};
    const inflight = {
      current: null as { kind: 'auto' | 'manual'; projectId: string; promise: Promise<unknown> } | null,
    };
    const computeAutoSaveStatus = () => {
      const project = state.projects.find((p) => p.id === key)!;
      return resolveAutoSaveStatus({
        canPickFiles: true,
        isSample: false,
        removed: false,
        hasSavedFile: hasSavedExternalFile(state.saveMeta[key]),
        needsNewName: shouldSaveUnderNewName({
          hasExternalFile: Boolean(project.hasExternalFile),
          titleInFile: project.titleInFile ?? null,
          title: project.title,
          filename: project.filename ?? null,
        }),
        permission: handlePerm,
        lastAutoSaveFailed: autoSaveFailed,
      });
    };
    const renderHeader = () => {
      const autoSaveStatus = computeAutoSaveStatus();
      const lastFileSaveMs = lastExternalFileSaveMs(state.saveMeta[key]);
      const kind = resolveHeaderSaveDisplay({
        isSample: false,
        autoSaveStatus,
        staleDays: null,
        lastFileSaveMs,
      });
      return renderToStaticMarkup(
        createElement(SaveHeaderStatus, {
          kind,
          canPickFiles: true,
          lastFileSaveMs,
          autoSaveActive: autoSaveStatus === 'active',
          lastSaveWasAuto,
          onResumeAutoSave: () => {},
          onSave: () => {},
          now: new Date(),
        }),
      );
    };

    const manualSnapshot = async (s: SampleState, p: SampleState['projects'][number]) => ({
      key: p.dbKey ?? p.id,
      bytes: await manuscriptBytesOn(s, p, null),
    });

    const manualOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight,
      lastSavedRevById,
      snapshot: manualSnapshot,
      onSaved: () => {
        autoSaveFailed = false;
        lastSaveWasAuto = false;
        handlePerm = 'granted';
      },
      store: null,
    });
    expect(manualOutcome).toEqual({ kind: 'saved', filename: '霧港旅館.db' });
    expect(fakeHandle.writeCalls).toBe(1);
    expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(false);
    expect(renderHeader()).toContain('上次存檔');

    const revAfterManual = state.contentRevById?.[key] ?? 0;
    const persistCalls: boolean[] = [];
    const snapshot = async (s: SampleState, p: SampleState['projects'][number], persist = true) => {
      persistCalls.push(persist);
      await yieldMacro();
      await yieldMacro();
      return {
        key: p.dbKey ?? p.id,
        bytes: await manuscriptBytesOn(s, p, null),
      };
    };

    const stop = startAutoSaveScheduler({
      intervalMs: AUTOSAVE_INTERVAL_MS,
      onDue: () => {
        if (computeAutoSaveStatus() !== 'active' && computeAutoSaveStatus() !== 'failed') return;
        void executeBackgroundAutoSave({
          projectId: key,
          getState: () => state,
          dispatch,
          env,
          getStatus: computeAutoSaveStatus,
          lastSavedRevById,
          inflight,
          isPreviouslyFailed: () => autoSaveFailed,
          onSaved: () => {
            autoSaveFailed = false;
            lastSaveWasAuto = true;
          },
          onNeedsPermission: (_id, perm) => {
            handlePerm = perm;
          },
          onFailed: () => {
            autoSaveFailed = true;
          },
          onNoHandle: () => {
            handlePerm = 'none';
          },
          snapshot,
          store: null,
        });
      },
      host: clock,
    });

    try {
      await clock.runFor(9000);
      await clock.runFor(AUTOSAVE_INTERVAL_MS + 5000);
      expect(fakeHandle.writeCalls).toBe(1);
      expect(persistCalls).toEqual([]);

      state = reduce(state, {
        type: 'commit-text',
        projectId: key,
        nodeId: chapterId,
        text: '【範例】霧港的夜裡，旅館的燈還亮著，櫃檯後面的老闆娘正在數著今天的帳本，窗外的雨一直沒有停。接著補上四十字的新增內容段落。',
      });
      expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(true);
      expect(state.contentRevById?.[key] ?? 0).toBeGreaterThan(revAfterManual);

      await clock.runFor(4000);
      await clock.runFor(AUTOSAVE_INTERVAL_MS + 5000);

      expect(fakeHandle.writeCalls).toBe(2);
      expect(state.saveMeta[key]?.dirtySinceFileSave).toBe(false);
      expect(lastSaveWasAuto).toBe(true);
      expect(persistCalls).toEqual([false]);
      const headerHtml = renderHeader();
      expect(headerHtml).toContain('已自動存檔');
      expect(headerHtml).not.toContain('上次存檔');

      // 若編輯框仍有尚未送出至 state 的正文，寫前快照須維持 persist = true
      setLiveReader(
        () => ({
          projectId: key,
          chapterId,
          text: '【範例】霧港的夜裡，旅館的燈還亮著，櫃檯後面的老闆娘正在數著今天的帳本，窗外的雨一直沒有停。接著補上四十字的新增內容段落。還有未送出正文。',
        }),
        () => false,
      );
      await clock.runFor(AUTOSAVE_INTERVAL_MS + 5000);
      expect(fakeHandle.writeCalls).toBe(3);
      expect(persistCalls).toEqual([false, true]);
    } finally {
      stop();
      setLiveReader(null);
    }
  });

  it('WO-131 返工 1：advanceAutoSaveDue 週期對齊與休眠跳躍單次觸發，且 autoSaveProjectToPlace 優先使用記憶體把手', async () => {
    expect(AUTOSAVE_HEARTBEAT_MS).toBe(3000);
    expect(AUTOSAVE_INTERVAL_MS % AUTOSAVE_HEARTBEAT_MS).toBe(0);

    const base = 1_700_000_000_000;
    const dueAt = base + AUTOSAVE_INTERVAL_MS;
    expect(advanceAutoSaveDue(dueAt - 1, dueAt)).toEqual({ due: false, nextDueAtMs: dueAt });
    expect(advanceAutoSaveDue(dueAt, dueAt)).toEqual({
      due: true,
      nextDueAtMs: dueAt + AUTOSAVE_INTERVAL_MS,
    });
    expect(advanceAutoSaveDue(base + 17 * 60 * 1000, dueAt)).toEqual({
      due: true,
      nextDueAtMs: base + 20 * 60 * 1000,
    });

    const key = 'p-1763697600202';
    touchedKeys.push(key);
    const { state } = makeBookState(NOW_MS, key, '記憶體把手測試稿');
    const bytes = await manuscriptBytesOn(state, state.projects[0]!, null);

    const memHandle = new FakeHandleDisk('記憶體把手.db');
    // 記憶體把手已帶有本輪快取的指紋狀態（例如舊目標為 null）時，直接沿用而不重複讀 targets.load
    rememberOpenFileFingerprint(key, memHandle, null);
    const diskHandle = new FakeHandleDisk('磁碟備援把手.db');
    const loadSpy = vi.fn(async () => ({ filename: '磁碟備援把手.db', file: diskHandle }));
    const env: Pick<SaveEnvironment, 'targets' | 'verify'> = {
      targets: {
        load: loadSpy,
        save: async () => {},
      },
      verify: verifyBytesForSave,
    };

    // 1. 有活體記憶體把手且有權限：不呼叫 targets.load 直接寫回
    const memOutcome = await autoSaveProjectToPlace(env, key, bytes, 'fallback.db', memHandle);
    expect(memOutcome).toEqual({ kind: 'saved', filename: '記憶體把手.db' });
    expect(loadSpy).not.toHaveBeenCalled();
    expect(memHandle.writeCalls).toBe(1);

    // 2. 記憶體把手回 needs-permission 時，才備援讀取 targets.load 並改用不同磁碟把手
    memHandle.permission = 'prompt';
    const fallbackOutcome = await autoSaveProjectToPlace(env, key, bytes, 'fallback.db', memHandle);
    expect(fallbackOutcome).toEqual({ kind: 'saved', filename: '磁碟備援把手.db' });
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(diskHandle.writeCalls).toBe(1);

    // 3. 未傳入記憶體把手時，維持從 targets.load 取得把手寫回
    const diskOnlyOutcome = await autoSaveProjectToPlace(env, key, bytes, 'fallback.db', null);
    expect(diskOnlyOutcome).toEqual({ kind: 'saved', filename: '磁碟備援把手.db' });
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(diskHandle.writeCalls).toBe(2);
  });
});
