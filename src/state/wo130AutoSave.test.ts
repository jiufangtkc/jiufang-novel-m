/**
 * WO-130 甲段單元測試：
 * - 假 FileSystemFileHandle 與 FakeDisk：每 5 分鐘有變更才自動寫回、與手動儲存位元組一致、schema v14
 * - 單飛防重疊鎖、手動儲存等待背景寫入、寫入期間新編輯維持 dirty
 * - 改書名待新名另存暫停寫回舊檔、重開分頁不自動索權、點擊恢復權限與拒絕處理
 * - 寫入失敗還原原檔且防洗版（只在首次失敗跳一次 5 秒 Toast）
 * - 刪稿清理 file-targets 與記憶體把手
 * - 溫和存檔提醒狀態機（500 字／30 分鐘、改多 1,000 字／60 分鐘、上限 3 次、冷卻、場景門檻）
 * - 0.4.0 版號與 whatsNew.ts 條目驗證
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
import { forgetOpenFile, recallOpenFile, rememberOpenFile } from '../db/openFileMemory';
import {
  autoSaveProjectToPlace,
  saveProjectFromClick,
  type SaveEnvironment,
} from '../db/saveProject';
import { openMemoryDb } from '../db/wasmDb';
import {
  AUTOSAVE_INTERVAL_MS,
  applyUncommittedDraftToProject,
  hasSavedExternalFile,
  lastExternalFileSaveMs,
  resolveAutoSaveStatus,
  resolveHeaderSaveDisplay,
  shouldClearDirtyAfterSave,
  shouldRunAutoSaveTick,
} from '../domain/autoSave';
import {
  CHANGED_REMINDER_MS,
  CHANGED_REMINDER_WORDS,
  MAX_SAVE_REMINDERS_PER_SESSION,
  SNOOZE_REMINDER_MS,
  UNSAVED_REMINDER_MS,
  UNSAVED_REMINDER_WORDS,
  canShowSaveReminderOverlay,
  emptyReminderSession,
  evaluateSaveReminder,
  isSaveOutcomeCompleted,
  nextSaveReminderOpenReason,
  recordReminderNonTextEdit,
  recordReminderTextEdit,
  resetReminderAfterSave,
  snoozeReminderSession,
} from '../domain/saveReminder';
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
});

describe('WO-130 甲段：溫和存檔提醒狀態機與場景保護', () => {
  it('未存過檔：499 字不跳、500 字跳；29 分鐘不跳、30 分鐘跳；空白稿 60 分鐘不跳', () => {
    let s = emptyReminderSession();
    s = recordReminderTextEdit(s, 499, NOW_MS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 499,
        session: s,
        nowMs: NOW_MS + 1000,
      }),
    ).toBeNull();

    // 29 分鐘不跳
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 499,
        session: s,
        nowMs: NOW_MS + UNSAVED_REMINDER_MS - 1,
      }),
    ).toBeNull();

    // 滿 30 分鐘跳
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 499,
        session: s,
        nowMs: NOW_MS + UNSAVED_REMINDER_MS,
      }),
    ).toBe('unsaved');

    // 滿 500 字立即達標
    const s500 = recordReminderTextEdit(s, 1, NOW_MS + 1000);
    expect(s500.wordChurn).toBe(UNSAVED_REMINDER_WORDS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 500,
        session: s500,
        nowMs: NOW_MS + 2000,
      }),
    ).toBe('unsaved');

    // 空白稿（hasBody = false）就算 60 分鐘也不跳
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: false,
        bodyWords: 0,
        session: recordReminderNonTextEdit(emptyReminderSession(), NOW_MS),
        nowMs: NOW_MS + 60 * 60 * 1000,
      }),
    ).toBeNull();
  });

  it('存過檔後又改很多：999 字不跳、刪 500 重寫 500（淨字數 0）跳；10 字放 60 分不跳、100 字滿 60 分跳', () => {
    let s = emptyReminderSession();
    s = recordReminderTextEdit(s, 500, NOW_MS); // 刪 500 字（abs）
    s = recordReminderTextEdit(s, 499, NOW_MS + 1000); // 重寫 499 字
    expect(s.wordChurn).toBe(999);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 1200,
        session: s,
        nowMs: NOW_MS + 5000,
      }),
    ).toBeNull();

    // 再多 1 字達 1,000 字
    s = recordReminderTextEdit(s, 1, NOW_MS + 6000);
    expect(s.wordChurn).toBe(CHANGED_REMINDER_WORDS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 1200,
        session: s,
        nowMs: NOW_MS + 7000,
      }),
    ).toBe('changed');

    // 小改 10 字放 60 分鐘不跳
    const minor = recordReminderTextEdit(emptyReminderSession(), 10, NOW_MS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 1200,
        session: minor,
        nowMs: NOW_MS + CHANGED_REMINDER_MS,
      }),
    ).toBeNull();

    // 改 100 字滿 60 分鐘跳
    const medium = recordReminderTextEdit(emptyReminderSession(), 100, NOW_MS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 1200,
        session: medium,
        nowMs: NOW_MS + CHANGED_REMINDER_MS,
      }),
    ).toBe('changed');
  });

  it('冷卻、單次上限 3 次、存檔清零，且運作中自動存檔永不跳出', () => {
    let s = recordReminderTextEdit(emptyReminderSession(), 500, NOW_MS);
    // 運作中自動存檔絕不跳
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'active',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 500,
        session: recordReminderTextEdit(s, 600, NOW_MS),
        nowMs: NOW_MS + 1000,
      }),
    ).toBeNull();

    // 第 1 次按「晚點再說」進入冷卻
    s = snoozeReminderSession(s, NOW_MS + 10_000);
    expect(s.reminderCount).toBe(1);

    // 返工 2：冷卻未滿 30 分鐘即使立刻再寫 600 字仍不跳
    s = recordReminderTextEdit(s, 600, NOW_MS + 20_000);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 1100,
        session: s,
        nowMs: NOW_MS + 10_000 + SNOOZE_REMINDER_MS - 1,
      }),
    ).toBeNull();

    // 滿 30 分鐘且冷卻期間有新編輯 → 跳第 2 次
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 1100,
        session: s,
        nowMs: NOW_MS + 10_000 + SNOOZE_REMINDER_MS,
      }),
    ).toBe('unsaved');

    // 第 2 次按「晚點再說」：滿 30 分鐘但沒有新編輯仍不跳；有了新編輯後才跳第 3 次
    const secondSnoozeAt = NOW_MS + 10_000 + SNOOZE_REMINDER_MS;
    s = snoozeReminderSession(s, secondSnoozeAt);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 1100,
        session: s,
        nowMs: secondSnoozeAt + SNOOZE_REMINDER_MS,
      }),
    ).toBeNull();

    s = recordReminderTextEdit(s, 10, secondSnoozeAt + SNOOZE_REMINDER_MS + 1000);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 1110,
        session: s,
        nowMs: secondSnoozeAt + SNOOZE_REMINDER_MS + 1000,
      }),
    ).toBe('unsaved');

    s = snoozeReminderSession(s, secondSnoozeAt + SNOOZE_REMINDER_MS + 5000);
    expect(s.reminderCount).toBe(MAX_SAVE_REMINDERS_PER_SESSION);

    // 達上限 3 次後，再怎麼寫都不主動跳
    s = recordReminderTextEdit(s, 2000, NOW_MS + 30_000 + SNOOZE_REMINDER_MS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: false,
        hasBody: true,
        bodyWords: 3499,
        session: s,
        nowMs: NOW_MS + 10 * 60 * 60 * 1000,
      }),
    ).toBeNull();

    // 存檔成功清零變動量與冷卻
    const afterSave = resetReminderAfterSave(s, true);
    expect(afterSave.wordChurn).toBe(0);
    expect(afterSave.firstEditAtMs).toBeNull();
    expect(afterSave.snoozedAtMs).toBeNull();
  });

  it('場景保護：檔案頁、專注模式、組字中、鍵盤開啟、停筆未滿 3 秒、已有對話框或改版說明皆不彈出', () => {
    const okBase = {
      deviceLoaded: true,
      pathname: '/p/p-1/write/ch-1',
      focusMode: false,
      isComposing: false,
      keyboardOpen: false,
      lastInputAtMs: NOW_MS - 4000,
      nowMs: NOW_MS,
      dialogOpen: false,
      welcomeActive: false,
      whatsNewPending: false,
    };
    expect(canShowSaveReminderOverlay(okBase)).toBe(true);
    expect(canShowSaveReminderOverlay({ ...okBase, deviceLoaded: false })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, pathname: '/p/p-1/files' })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, focusMode: true })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, isComposing: true })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, keyboardOpen: true })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, dialogOpen: true })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, welcomeActive: true })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, whatsNewPending: true })).toBe(false);
    expect(canShowSaveReminderOverlay({ ...okBase, lastInputAtMs: NOW_MS - 2999 })).toBe(false);
  });

  it('返工 1：點「現在存」非同步存檔期間不重跳；unsupported 存檔成功／取消後關閉不卡住', () => {
    const key = 'p-1763697600002';
    const { state: initState, chapterId } = makeBookState(NOW_MS, key);
    let state = reduce(initState, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】' + '字'.repeat(520),
    });

    const overlayGate = {
      deviceLoaded: true,
      pathname: `/p/${key}/write/${chapterId}`,
      focusMode: false,
      isComposing: false,
      keyboardOpen: false,
      lastInputAtMs: NOW_MS - 4000,
      nowMs: NOW_MS,
      dialogOpen: false,
      welcomeActive: false,
      whatsNewPending: false,
    };
    const makeEvalInput = (s: SampleState) => ({
      autoSaveStatus: 'unsupported' as const,
      isSample: false,
      hasExternalFileSaved: s.saveMeta[key]?.lastExportMs != null,
      hasBody: true,
      bodyWords: 520,
      session: s.reminderSessions?.[key] ?? emptyReminderSession(),
      nowMs: NOW_MS,
    });

    // 1. 達 500 字後跳出提醒
    expect(
      nextSaveReminderOpenReason({
        hasProject: true,
        focusMode: false,
        savingFromReminder: false,
        currentOpenReason: null,
        evalInput: makeEvalInput(state),
        overlayGate,
      }),
    ).toBe('unsaved');

    // 2. 按「現在存」後同步關閉，非同步 saveProjectAs 尚未結束（savingFromReminder: true）時不可重跳
    expect(
      nextSaveReminderOpenReason({
        hasProject: true,
        focusMode: false,
        savingFromReminder: true,
        currentOpenReason: null,
        evalInput: makeEvalInput(state),
        overlayGate,
      }),
    ).toBeNull();

    // 3. unsupported 瀏覽器另存／下載成功後清零並解除鎖 → 即使原本誤開著也立刻回 null 關閉、不再出現
    expect(isSaveOutcomeCompleted({ kind: 'handed-off', via: 'download', filename: 'a.db' })).toBe(true);
    expect(isSaveOutcomeCompleted({ kind: 'saved-as', filename: 'a.db' })).toBe(true);
    expect(isSaveOutcomeCompleted({ kind: 'saved', filename: 'a.db' })).toBe(true);
    expect(isSaveOutcomeCompleted({ kind: 'saved-under-new-title', filename: 'a.db' })).toBe(true);
    let afterSave = reduce(state, { type: 'record-export', projectId: key, atMs: NOW_MS });
    afterSave = reduce(afterSave, {
      type: 'clear-dirty-after-file-save',
      projectId: key,
      clearDirty: true,
      fromReminder: true,
    });
    expect(
      nextSaveReminderOpenReason({
        hasProject: true,
        focusMode: false,
        savingFromReminder: false,
        currentOpenReason: 'unsaved',
        evalInput: makeEvalInput(afterSave),
        overlayGate,
      }),
    ).toBeNull();
    expect(
      nextSaveReminderOpenReason({
        hasProject: true,
        focusMode: false,
        savingFromReminder: false,
        currentOpenReason: null,
        evalInput: makeEvalInput(afterSave),
        overlayGate,
      }),
    ).toBeNull();

    // 4. 若在選檔／分享視窗取消或寫入失敗，進入冷卻並解除鎖 → 關閉且不重跳，只扣 1 次次數
    expect(isSaveOutcomeCompleted({ kind: 'cancelled' })).toBe(false);
    expect(isSaveOutcomeCompleted({ kind: 'picker-aborted' })).toBe(false);
    expect(isSaveOutcomeCompleted({ kind: 'write-failed', restored: true })).toBe(false);
    expect(isSaveOutcomeCompleted(null)).toBe(false);
    const afterCancel = reduce(state, {
      type: 'snooze-save-reminder',
      projectId: key,
      nowMs: NOW_MS,
    });
    expect(afterCancel.reminderSessions?.[key]?.reminderCount).toBe(1);
    expect(
      nextSaveReminderOpenReason({
        hasProject: true,
        focusMode: false,
        savingFromReminder: false,
        currentOpenReason: 'unsaved',
        evalInput: makeEvalInput(afterCancel),
        overlayGate,
      }),
    ).toBeNull();
    expect(
      nextSaveReminderOpenReason({
        hasProject: true,
        focusMode: false,
        savingFromReminder: false,
        currentOpenReason: null,
        evalInput: makeEvalInput(afterCancel),
        overlayGate,
      }),
    ).toBeNull();
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

  it('返工 2：「晚點再說」後至少 30 分鐘內不再跳（即使再寫 600 字），滿 30 分鐘且有新編輯才跳', () => {
    const key = 'p-1763697600100';
    const { state: initState, chapterId } = makeBookState(NOW_MS, key);
    let state = reduce(initState, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】' + '字'.repeat(520),
    });

    const evalAt = (s: SampleState, nowMs: number, hasExternalFileSaved = false) =>
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved,
        hasBody: true,
        bodyWords: 1200,
        session: s.reminderSessions?.[key] ?? emptyReminderSession(),
        nowMs,
      });

    // 初次達 500 字跳出提醒
    expect(evalAt(state, NOW_MS + 4000)).toBe('unsaved');

    // 按「晚點再說」進入冷卻
    const snoozedAt = NOW_MS + 5000;
    state = reduce(state, { type: 'snooze-save-reminder', projectId: key, nowMs: snoozedAt });
    expect(evalAt(state, snoozedAt + 100)).toBeNull();

    // 馬上再寫 600 字並在 30 分鐘內多次檢查：一律不跳
    state = reduce(state, {
      type: 'commit-text',
      projectId: key,
      nodeId: chapterId,
      text: '【範例】' + '字'.repeat(1120),
    });
    expect(evalAt(state, snoozedAt + 5000)).toBeNull();
    expect(evalAt(state, snoozedAt + 15 * 60 * 1000)).toBeNull();
    expect(evalAt(state, snoozedAt + SNOOZE_REMINDER_MS - 1)).toBeNull();

    // 滿 30 分鐘（因冷卻期間已有新編輯）才再次提醒
    expect(evalAt(state, snoozedAt + SNOOZE_REMINDER_MS)).toBe('unsaved');

    // 已存過檔後改多達 1000 字：按「晚點再說」後若 30 分鐘內完全沒再編輯，滿 30 分鐘仍不跳；有新編輯才跳
    let savedSession = recordReminderTextEdit(emptyReminderSession(), 1000, NOW_MS);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 2000,
        session: savedSession,
        nowMs: NOW_MS + 1000,
      }),
    ).toBe('changed');

    savedSession = snoozeReminderSession(savedSession, NOW_MS + 2000);
    // 滿 30 分鐘但無新編輯 → 不跳
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 2000,
        session: savedSession,
        nowMs: NOW_MS + 2000 + SNOOZE_REMINDER_MS + 60_000,
      }),
    ).toBeNull();

    // 30 分鐘後出現一次新編輯（即使非正文異動或少量字數）→ 才再提醒
    savedSession = recordReminderNonTextEdit(savedSession, NOW_MS + 2000 + SNOOZE_REMINDER_MS + 70_000);
    expect(
      evaluateSaveReminder({
        autoSaveStatus: 'unsupported',
        isSample: false,
        hasExternalFileSaved: true,
        hasBody: true,
        bodyWords: 2000,
        session: savedSession,
        nowMs: NOW_MS + 2000 + SNOOZE_REMINDER_MS + 70_000,
      }),
    ).toBe('changed');
  });
});

describe('WO-130 甲段：0.4.0 版號與改版說明驗證', () => {
  it('package.json、package-lock.json、APP_VERSION 皆為 0.4.0，whatsNew 頂端為 0.4.0 且保留 0.3.0', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
      version: string;
      packages: { '': { version: string } };
    };
    expect(pkg.version).toBe('0.4.0');
    expect(lock.version).toBe('0.4.0');
    expect(lock.packages[''].version).toBe('0.4.0');
    expect(APP_VERSION).toBe('0.4.0');

    expect(RELEASE_NOTES[0]?.version).toBe('0.4.0');
    expect(RELEASE_NOTES[0]?.items).toEqual([
      '自動存檔：用電腦的 Chrome 或 Edge 存過一次後，每 5 分鐘自動存回檔案',
      '還沒存成檔案時會提醒你',
    ]);
    expect(findReleaseNote('0.3.0')?.items).toEqual([
      '事件時間線：照故事順序或章節順序排事件，電腦寬螢幕還能雙線對照',
      '設定頁新增贊助按鈕',
    ]);
  });
});
