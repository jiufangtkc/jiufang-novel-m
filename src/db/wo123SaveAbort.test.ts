/**
 * WO-123：存檔 picker 的 AbortError 要保留來源並跳提示；其他取消、錯誤與時長不被誤改。
 * 也驗證無把手（input 開進來）的稿子：第一次 pick-first-save、成功才記住、第二次 write-back。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_PICKER_ABORTED_TOAST, SAVE_PERMISSION_DENIED } from '../copy/userFacing';
import { applySaveOutcome, toastDurationMs, type Action } from '../state/sampleStore';
import { pickSaveFile } from './browserDisk';
import { createMemoryTargetStore, type DiskFile } from './fileTarget';
import { SavePickerAbortedError } from './savePickerAbort';
import {
  saveNotice,
  saveProjectAsNew,
  saveProjectFromClick,
  saveProjectToPlace,
  shouldPickBeforeBuild,
  type SaveEnvironment,
} from './saveProject';

const NEXT = new Uint8Array([9, 9, 9, 9]);

class FakeDisk implements DiskFile {
  bytes = new Uint8Array();
  writes = 0;
  constructor(readonly name: string) {}
  async read() {
    return this.bytes.slice();
  }
  async write(next: Uint8Array) {
    this.writes += 1;
    this.bytes = next.slice();
  }
  async queryPermission() {
    return 'granted' as const;
  }
  async requestPermission() {
    return 'granted' as const;
  }
}

function abortEnv(options?: { canPickFiles?: boolean; share?: SaveEnvironment['share'] }) {
  const store = createMemoryTargetStore();
  let picks = 0;
  const env: SaveEnvironment = {
    canPickFiles: options?.canPickFiles ?? true,
    targets: store,
    verify: async () => undefined,
    pickSaveLocation: async () => {
      picks += 1;
      throw new SavePickerAbortedError();
    },
    share: options?.share ?? (async () => 'cancelled'),
  };
  return { env, store, picks: () => picks };
}

describe('browserDisk.pickSaveFile：AbortError 保留來源', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSave(sequence: Array<() => unknown>) {
    let calls = 0;
    const configs: unknown[] = [];
    vi.stubGlobal('window', {
      showOpenFilePicker: async () => [],
      showSaveFilePicker: async (config: unknown) => {
        configs.push(config);
        const step = sequence[calls];
        calls += 1;
        return step();
      },
    });
    return { calls: () => calls, configs };
  }

  const abort = () => {
    throw new DOMException('被中止', 'AbortError');
  };
  const handle = () => ({
    name: '新位置.db',
    requestPermission: async () => 'granted',
    queryPermission: async () => 'granted',
  });

  it('第一次呼叫（無 hint）AbortError：丟 SavePickerAbortedError，只呼叫一次、不重試', async () => {
    const stub = stubSave([abort]);
    await expect(pickSaveFile('書.db')).rejects.toBeInstanceOf(SavePickerAbortedError);
    expect(stub.calls()).toBe(1);
  });

  it('有 hint 的第一次 AbortError：直接丟出，不再不帶 hint 重試', async () => {
    const stub = stubSave([abort, handle]);
    await expect(pickSaveFile('書.db', { fake: 'hint' })).rejects.toBeInstanceOf(SavePickerAbortedError);
    expect(stub.calls()).toBe(1);
  });

  it('有 hint 第一次是其他錯誤、不帶 hint 重試時 AbortError：丟 SavePickerAbortedError', async () => {
    const stub = stubSave([
      () => {
        throw new Error('hint 不能用');
      },
      abort,
    ]);
    await expect(pickSaveFile('書.db', { fake: 'hint' })).rejects.toBeInstanceOf(SavePickerAbortedError);
    expect(stub.calls()).toBe(2);
    expect((stub.configs[0] as { startIn?: unknown }).startIn).toEqual({ fake: 'hint' });
    expect((stub.configs[1] as { startIn?: unknown }).startIn).toBeUndefined();
  });

  it('有 hint 第一次是其他錯誤、重試成功：照舊回 file', async () => {
    const stub = stubSave([
      () => {
        throw new Error('hint 不能用');
      },
      handle,
    ]);
    const file = await pickSaveFile('書.db', { fake: 'hint' });
    expect(file?.name).toBe('新位置.db');
    expect(stub.calls()).toBe(2);
  });

  it('無 hint 的其他錯誤照舊丟出（不是 AbortError 類）', async () => {
    stubSave([
      () => {
        throw new Error('寫入器壞了');
      },
    ]);
    const error = await pickSaveFile('書.db').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SavePickerAbortedError);
    expect((error as Error).message).toBe('寫入器壞了');
  });

  it('沒有 showSaveFilePicker：回 null（不是 abort）', async () => {
    vi.stubGlobal('window', {});
    expect(await pickSaveFile('書.db')).toBeNull();
  });

  it('選成功時回 file', async () => {
    stubSave([handle]);
    expect((await pickSaveFile('書.db'))?.name).toBe('新位置.db');
  });
});

describe('saveProject：picker-aborted 結果', () => {
  it('saveProjectFromClick 首次儲存（pick-first-save）：不整理、不寫入、不記住，結果 picker-aborted', async () => {
    const box = abortEnv();
    let built = 0;
    let remembered = 0;
    const outcome = await saveProjectFromClick({
      env: box.env,
      bookKey: 'b',
      plan: 'pick-first-save',
      writeBackName: '書.db',
      newTitleName: '新.db',
      startIn: null,
      buildBytes: async () => {
        built += 1;
        return NEXT;
      },
      onRemember: () => {
        remembered += 1;
      },
    });
    expect(outcome).toEqual({ kind: 'picker-aborted' });
    expect(saveNotice(outcome)).toBe(SAVE_PICKER_ABORTED_TOAST);
    expect(built).toBe(0);
    expect(remembered).toBe(0);
    expect(await box.store.load('b')).toBeNull();
    expect(box.picks()).toBe(1);
  });

  it('pick-new-name（改書名另存）AbortError 也是 picker-aborted，不寫舊檔', async () => {
    const box = abortEnv();
    const old = new FakeDisk('舊.db');
    const outcome = await saveProjectFromClick({
      env: box.env,
      bookKey: 'b',
      plan: 'pick-new-name',
      writeBackName: old.name,
      newTitleName: '新.db',
      startIn: old,
      buildBytes: async () => NEXT,
    });
    expect(outcome.kind).toBe('picker-aborted');
    expect(old.writes).toBe(0);
  });

  it('saveProjectAsNew（另存專案）在支援 picker 時 AbortError → picker-aborted，沒有走分享／下載', async () => {
    let shared = 0;
    const box = abortEnv({
      share: async () => {
        shared += 1;
        return 'downloaded';
      },
    });
    const outcome = await saveProjectAsNew(box.env, 'b', NEXT, '書.db');
    expect(outcome).toEqual({ kind: 'picker-aborted' });
    expect(shared).toBe(0);
    expect(await box.store.load('b')).toBeNull();
  });

  it('saveProjectToPlace 無把手、可選檔時 AbortError → picker-aborted', async () => {
    const box = abortEnv();
    const outcome = await saveProjectToPlace(box.env, 'b', NEXT, '書.db');
    expect(outcome).toEqual({ kind: 'picker-aborted' });
    expect(await box.store.load('b')).toBeNull();
  });

  it('其他錯誤照舊丟出，不被吞成 picker-aborted', async () => {
    const box = abortEnv();
    box.env.pickSaveLocation = async () => {
      throw new Error('別種錯誤');
    };
    await expect(
      saveProjectFromClick({
        env: box.env,
        bookKey: 'b',
        plan: 'pick-first-save',
        writeBackName: '書.db',
        newTitleName: '新.db',
        startIn: null,
        buildBytes: async () => NEXT,
      }),
    ).rejects.toThrow('別種錯誤');
  });

  it('一般取消（null）與手機分享取消仍是 cancelled，沒有提示', async () => {
    const box = abortEnv();
    box.env.pickSaveLocation = async () => null;
    const click = await saveProjectFromClick({
      env: box.env,
      bookKey: 'b',
      plan: 'pick-first-save',
      writeBackName: '書.db',
      newTitleName: '新.db',
      startIn: null,
      buildBytes: async () => NEXT,
    });
    expect(click).toEqual({ kind: 'cancelled' });
    expect(saveNotice(click)).toBeNull();

    // iPhone／Android：不可選檔，走分享，取消 → cancelled，不跳縮小視窗提示。
    const phone = abortEnv({ canPickFiles: false, share: async () => 'cancelled' });
    const as = await saveProjectAsNew(phone.env, 'b', NEXT, '書.db');
    expect(as).toEqual({ kind: 'cancelled' });
    expect(saveNotice(as)).toBeNull();
    const place = await saveProjectToPlace(phone.env, 'b', NEXT, '書.db');
    expect(place).toEqual({ kind: 'cancelled' });
    expect(saveNotice(place)).toBeNull();
  });

  it('其他提示與時長沒被改：權限被拒仍 2.4 秒、已儲存／已另存文字不變', () => {
    expect(saveNotice({ kind: 'saved', filename: 'a.db' })).toBe('已儲存');
    expect(saveNotice({ kind: 'saved-as', filename: 'a.db' })).toBe('已另存');
    expect(saveNotice({ kind: 'permission-denied' })).toBe(SAVE_PERMISSION_DENIED);
    expect(toastDurationMs(SAVE_PERMISSION_DENIED)).toBe(2400);
    expect(toastDurationMs('已儲存')).toBe(2400);
    expect(toastDurationMs(SAVE_PICKER_ABORTED_TOAST)).toBe(5000);
  });
});

describe('applySaveOutcome：picker-aborted 只跳一次提示，不記成已儲存', () => {
  it('save 與 save-as 都只 dispatch 一次 toast，沒有 record／set-filename', () => {
    for (const mode of ['save', 'save-as'] as const) {
      const actions: Action[] = [];
      applySaveOutcome((action) => actions.push(action), 'p1', { kind: 'picker-aborted' }, mode);
      expect(actions).toEqual([{ type: 'toast', message: SAVE_PICKER_ABORTED_TOAST }]);
    }
  });
});

describe('input 開進來（無把手）的稿子：第一次問位置、成功後記住、之後 write-back', () => {
  /** 模擬 sampleStore.saveProject 的決策：remembered 由 onRemember 更新（相當於 rememberOpenFile）。 */
  function session() {
    const store = createMemoryTargetStore();
    const target = new FakeDisk('新位置.db');
    let remembered: DiskFile | null = null;
    let picks = 0;
    let failPick: 'abort' | 'null' | null = null;
    const env: SaveEnvironment = {
      canPickFiles: true,
      targets: store,
      verify: async () => undefined,
      pickSaveLocation: async () => {
        picks += 1;
        if (failPick === 'abort') throw new SavePickerAbortedError();
        if (failPick === 'null') return null;
        return target;
      },
      share: async () => 'cancelled',
    };
    const press = async (bytes: Uint8Array) => {
      // 與按鈕、Ctrl+S 共用的決策（saveProject action 內）：input 開檔沒有 external file 把手。
      const pickFirst = shouldPickBeforeBuild({
        canPick: true,
        needsNewName: false,
        remembered,
        hasExternalFile: false,
      });
      const plan = pickFirst ? 'pick-first-save' : 'write-back';
      const outcome = await saveProjectFromClick({
        env,
        bookKey: 'book',
        plan,
        writeBackName: '書.db',
        newTitleName: '書.db',
        startIn: null,
        buildBytes: async () => bytes,
        onRemember: (file) => {
          remembered = file;
        },
      });
      return { plan, outcome };
    };
    return {
      press,
      target,
      picks: () => picks,
      remembered: () => remembered,
      setFail: (mode: 'abort' | 'null' | null) => {
        failPick = mode;
      },
    };
  }

  it('第一次 pick-first-save → 成功才記住；第二次 write-back 不再選位置', async () => {
    const s = session();
    const first = await s.press(new Uint8Array([1]));
    expect(first.plan).toBe('pick-first-save');
    expect(first.outcome).toEqual({ kind: 'saved', filename: '新位置.db' });
    expect(s.picks()).toBe(1);
    expect(s.remembered()).toBe(s.target);
    const second = await s.press(new Uint8Array([2]));
    expect(second.plan).toBe('write-back');
    expect(second.outcome.kind).toBe('saved');
    expect(s.picks()).toBe(1);
    expect(Array.from(s.target.bytes)).toEqual([2]);
  });

  it('取消或 AbortError：不寫入、不記住，下一次仍是 pick-first-save', async () => {
    const s = session();
    s.setFail('null');
    const cancelled = await s.press(new Uint8Array([1]));
    expect(cancelled.outcome.kind).toBe('cancelled');
    s.setFail('abort');
    const aborted = await s.press(new Uint8Array([1]));
    expect(aborted.outcome.kind).toBe('picker-aborted');
    expect(s.target.writes).toBe(0);
    expect(s.remembered()).toBeNull();
    s.setFail(null);
    const retry = await s.press(new Uint8Array([3]));
    expect(retry.plan).toBe('pick-first-save');
    expect(retry.outcome.kind).toBe('saved');
    expect(s.picks()).toBe(3);
  });

  it('寫入被拒（權限）時不記住位置', async () => {
    const s = session();
    s.target.queryPermission = async () => 'denied' as never;
    s.target.requestPermission = async () => 'denied' as never;
    const result = await s.press(new Uint8Array([1]));
    expect(result.outcome.kind).toBe('permission-denied');
    expect(s.remembered()).toBeNull();
    expect(s.target.writes).toBe(0);
  });
});
