import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_AS_LOCAL_STASH_FAIL,
  SAVE_DOWNLOAD_LOCAL_STASH_FAIL,
  SAVE_FATAL_FAIL,
  SAVE_HANDED_OFF_DOWNLOAD_TOAST,
  SAVE_HANDED_OFF_SHARE_TOAST,
  SAVE_SHARE_LOCAL_STASH_FAIL,
  SAVE_USE_SAVE_AS_TOAST,
} from '../copy/userFacing';
import { DOWNLOAD_URL_REVOKE_DELAY_MS, type DeliveryEnv } from '../db/fileDelivery';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import { forgetOpenFile } from '../db/openFileMemory';
import { shareDatabase } from '../db/library';
import type { SaveEnvironment } from '../db/saveProject';
import {
  createState,
  reduce,
  runManualSaveProject,
  runSaveProjectAs,
  toastDurationMs,
  type Action,
  type SampleState,
} from './sampleStore';

afterEach(() => {
  vi.restoreAllMocks();
});

let seq = 0;

function makeNewDraftState(nowMs = Date.parse('2026-11-23T23:15:00+08:00')): {
  state: SampleState;
  projectId: string;
} {
  seq += 1;
  let state = createState(new Date(nowMs));
  const projectId = `p-176391090000${seq}`;
  forgetOpenFile(projectId);
  state = reduce(state, {
    type: 'add-project',
    id: projectId,
    title: '【範例】另存一致性測試',
    shape: 'novel',
    startedMs: nowMs,
  });
  state = reduce(state, { type: 'focus-project', id: projectId });
  state = reduce(state, { type: 'toast', message: null });
  return { state, projectId };
}

function makeFakeDisk(name: string): { file: DiskFile; written: () => Uint8Array[] } {
  let bytes = new Uint8Array();
  const writes: Uint8Array[] = [];
  const file: DiskFile = {
    name,
    async read() {
      return bytes.slice();
    },
    async write(next) {
      bytes = next.slice();
      writes.push(next.slice());
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
  };
  return { file, written: () => writes };
}

describe('WO-133 第 4 段：另存交付與畫面結果一致（中-4c）', () => {
  it('桌機另存外部寫入成功但本機暫存失敗：結果仍為 saved-as、不升格為 file、不報存檔失敗、顯示暫存沒更新提示且停留 5 秒', async () => {
    let { state, projectId } = makeNewDraftState();
    const actions: Action[] = [];
    const dispatch = (action: Action) => {
      actions.push(action);
      state = reduce(state, action);
    };

    const { file: pickedFile, written } = makeFakeDisk('【範例】另存測試.db');
    const targets = createMemoryTargetStore();
    const env: SaveEnvironment = {
      canPickFiles: true,
      targets,
      verify: async () => undefined,
      pickSaveLocation: async () => pickedFile,
      share: async () => 'cancelled',
    };

    const sampleBytes = new TextEncoder().encode('SQLite format 3\0mock');
    const result = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === projectId)!,
      dispatch,
      env,
      preparedBytes: null,
      snapshot: async (_s, _p, persist) => {
        if (persist) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return { key: projectId, bytes: sampleBytes };
      },
    });

    expect(result.outcome).toEqual({ kind: 'saved-as', filename: '【範例】另存測試.db' });
    expect(result.localStashOk).toBe(false);
    expect(written()).toHaveLength(1);

    const updatedProject = state.projects.find((p) => p.id === projectId)!;
    // 不可在暫存失敗時誤 promote-stored 成 origin: 'file'（否則草稿會從 localStorage 消失）
    expect(updatedProject.origin).not.toBe('file');
    expect(updatedProject.filename).toBe('【範例】另存測試.db');
    expect(state.saveMeta[projectId]?.lastExportMs).toBeTypeOf('number');
    expect(actions.some((a) => a.type === 'promote-stored')).toBe(false);
    expect(actions.some((a) => a.type === 'note-title-in-file')).toBe(true);
    expect(actions.some((a) => a.type === 'toast' && a.message === SAVE_FATAL_FAIL)).toBe(false);
    expect(state.toast).toBe(SAVE_AS_LOCAL_STASH_FAIL);
    expect(toastDurationMs(SAVE_AS_LOCAL_STASH_FAIL)).toBe(5000);
  });

  it('手機分享或下載成功但本機暫存失敗：同樣不誤報存檔失敗，分別顯示對應的 5 秒提醒並保留 origin', async () => {
    for (const via of ['shared', 'downloaded'] as const) {
      let { state, projectId } = makeNewDraftState();
      const actions: Action[] = [];
      const dispatch = (action: Action) => {
        actions.push(action);
        state = reduce(state, action);
      };

      const env: SaveEnvironment = {
        canPickFiles: false,
        targets: createMemoryTargetStore(),
        verify: async () => undefined,
        pickSaveLocation: async () => null,
        share: async () => via,
      };

      const result = await runSaveProjectAs({
        state,
        project: state.projects.find((p) => p.id === projectId)!,
        dispatch,
        env,
        preparedBytes: null,
        snapshot: async (_s, _p, persist) => {
          if (persist) throw new Error('IDB failed');
          return { key: projectId, bytes: new Uint8Array([1, 2, 3]) };
        },
      });

      const expectedVia = via === 'shared' ? 'share' : 'download';
      const expectedToast =
        via === 'shared' ? SAVE_SHARE_LOCAL_STASH_FAIL : SAVE_DOWNLOAD_LOCAL_STASH_FAIL;
      expect(result.outcome.kind).toBe('handed-off');
      if (result.outcome.kind === 'handed-off') {
        expect(result.outcome.via).toBe(expectedVia);
      }
      expect(result.localStashOk).toBe(false);
      expect(state.projects.find((p) => p.id === projectId)?.origin).not.toBe('file');
      expect(state.saveMeta[projectId]?.lastExportMs).toBeTypeOf('number');
      expect(actions.some((a) => a.type === 'toast' && a.message === SAVE_FATAL_FAIL)).toBe(false);
      expect(state.toast).toBe(expectedToast);
      expect(toastDurationMs(expectedToast)).toBe(5000);
    }
  });

  it('手機分享取消（AbortError）時回 cancelled、不顯示成功提示、不更新 lastExportMs 與本機狀態', async () => {
    let { state, projectId } = makeNewDraftState();
    const beforeState = state;
    const actions: Action[] = [];
    const dispatch = (action: Action) => {
      actions.push(action);
      state = reduce(state, action);
    };

    const env: SaveEnvironment = {
      canPickFiles: false,
      targets: createMemoryTargetStore(),
      verify: async () => undefined,
      pickSaveLocation: async () => null,
      share: async () =>
        shareDatabase('範例.db', new Uint8Array([1, 2, 3]), {
          share: async () => {
            throw new DOMException('cancelled', 'AbortError');
          },
          canShare: () => true,
          createObjectURL: () => 'blob:unused',
          revokeObjectURL: () => undefined,
          createLink: () => {
            throw new Error('should not download');
          },
          schedule: () => undefined,
          pointerFine: () => false,
          pointerCoarse: () => true,
          maxTouchPoints: () => 5,
        }),
    };

    const result = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === projectId)!,
      dispatch,
      env,
      preparedBytes: null,
      snapshot: async (_s, _p, persist) => {
        if (persist) throw new Error('should not persist on cancel');
        return { key: projectId, bytes: new Uint8Array([1, 2, 3]) };
      },
    });

    expect(result.outcome).toEqual({ kind: 'cancelled' });
    expect(state.toast).toBeNull();
    expect(state.saveMeta[projectId]?.lastExportMs).toBeUndefined();
    expect(state.projects).toEqual(beforeState.projects);
    expect(actions.some((a) => a.type === 'record-export' || a.type === 'promote-stored')).toBe(false);
  });

  it('shareDatabase 下載流程：連結掛入再移除、點擊當下不立即 revokeObjectURL（延後 60 秒釋放）；分享拋非取消錯時降級走下載', async () => {
    const events: string[] = [];
    const timers: Array<{ delayMs: number; run: () => void }> = [];
    const fakeEnv = (opts?: {
      touch?: boolean;
      shareError?: unknown;
    }): DeliveryEnv => ({
      share: opts?.shareError
        ? async () => {
            events.push('share-attempt');
            throw opts.shareError;
          }
        : undefined,
      canShare: () => Boolean(opts?.shareError),
      createObjectURL: () => {
        events.push('create-url');
        return 'blob:wo133-db';
      },
      revokeObjectURL: (url) => {
        events.push(`revoke:${url}`);
      },
      createLink: () => {
        events.push('attach-link');
        const anchor = {
          href: '',
          download: '',
          click: () => events.push(`click:${anchor.download}:${anchor.href}`),
        } as unknown as HTMLAnchorElement;
        return {
          anchor,
          remove: () => events.push('remove-link'),
        };
      },
      schedule: (run, delayMs) => {
        events.push(`schedule:${delayMs}`);
        timers.push({ delayMs, run });
      },
      pointerFine: () => !opts?.touch,
      pointerCoarse: () => Boolean(opts?.touch),
      maxTouchPoints: () => (opts?.touch ? 5 : 0),
    });

    // 1) 純下載
    const outcome1 = await shareDatabase('我的小說', new Uint8Array([9, 8]), fakeEnv());
    expect(outcome1).toBe('downloaded');
    expect(events).toEqual([
      'create-url',
      'attach-link',
      'click:我的小說.db:blob:wo133-db',
      'remove-link',
      `schedule:${DOWNLOAD_URL_REVOKE_DELAY_MS}`,
    ]);
    // 點擊當下還沒釋放，計時器跑了才釋放
    timers[0]!.run();
    expect(events.at(-1)).toBe('revoke:blob:wo133-db');

    // 2) 觸控粗指標分享遇 NotAllowedError / 假支援錯誤時，降級改走下載
    events.length = 0;
    timers.length = 0;
    const outcome2 = await shareDatabase(
      '降級測試.db',
      new Uint8Array([4, 5]),
      fakeEnv({ touch: true, shareError: new DOMException('blocked', 'NotAllowedError') }),
    );
    expect(outcome2).toBe('downloaded');
    expect(events).toEqual([
      'share-attempt',
      'create-url',
      'attach-link',
      'click:降級測試.db:blob:wo133-db',
      'remove-link',
      `schedule:${DOWNLOAD_URL_REVOKE_DELAY_MS}`,
    ]);
  });

  it('不支援選檔寫回瀏覽器按 Ctrl/Cmd+S（runManualSaveProject）：回傳 use-save-as 並顯示 5 秒引導提示，且區分分享與下載提示字', async () => {
    expect(SAVE_HANDED_OFF_SHARE_TOAST).toBe('已交給分享選單，請確認已存到想放的位置');
    expect(SAVE_HANDED_OFF_DOWNLOAD_TOAST).toBe('已開始下載，請自行放到想放的位置');
    expect(toastDurationMs(SAVE_USE_SAVE_AS_TOAST)).toBe(5000);

    let { state, projectId } = makeNewDraftState();
    const env: SaveEnvironment = {
      canPickFiles: false,
      targets: createMemoryTargetStore(),
      verify: async () => undefined,
      pickSaveLocation: async () => null,
      share: async () => 'downloaded',
    };

    const outcome = await runManualSaveProject({
      getState: () => state,
      dispatch: (action) => {
        state = reduce(state, action);
      },
      env,
      inflight: { current: null },
      lastSavedRevById: {},
      onSaved: () => undefined,
      snapshot: async () => ({ key: projectId, bytes: new Uint8Array([1, 2, 3]) }),
      store: null,
    });

    expect(outcome).toEqual({ kind: 'use-save-as' });
    expect(state.toast).toBe(SAVE_USE_SAVE_AS_TOAST);
  });
});
