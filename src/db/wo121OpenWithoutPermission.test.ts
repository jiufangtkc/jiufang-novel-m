import { afterEach, describe, expect, it, vi } from 'vitest';
import { diskFileFromHandle, pickExistingDatabase } from './browserDisk';

const BYTES = new Uint8Array([83, 81, 76, 105, 116, 101]);

interface Counters {
  getFile: number;
  arrayBuffer: number;
  query: number;
  request: number;
  createWritable: number;
}

function fakeHandle(options?: {
  request?: () => Promise<'granted' | 'prompt' | 'denied'>;
  getFileError?: Error;
}): { handle: FileSystemFileHandle; counters: Counters } {
  const counters: Counters = { getFile: 0, arrayBuffer: 0, query: 0, request: 0, createWritable: 0 };
  const handle = {
    name: '假稿.db',
    async getFile() {
      counters.getFile += 1;
      if (options?.getFileError) throw options.getFileError;
      return {
        async arrayBuffer() {
          counters.arrayBuffer += 1;
          return BYTES.slice().buffer;
        },
      };
    },
    async createWritable() {
      counters.createWritable += 1;
      return { write: async () => undefined, close: async () => undefined, abort: async () => undefined };
    },
    async queryPermission() {
      counters.query += 1;
      return 'prompt';
    },
    async requestPermission() {
      counters.request += 1;
      return options?.request ? options.request() : 'granted';
    },
  };
  return { handle: handle as unknown as FileSystemFileHandle, counters };
}

function stubPicker(pick: () => Promise<FileSystemFileHandle[]>) {
  vi.stubGlobal('window', { showOpenFilePicker: pick, showSaveFilePicker: async () => undefined });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WO-121：開檔只讀，不索取寫入權限', () => {
  it('選到把手後讀出 bytes，回傳可存回的 file，requestPermission 為 0', async () => {
    const { handle, counters } = fakeHandle();
    stubPicker(async () => [handle]);
    const picked = await pickExistingDatabase();
    expect(picked).not.toBeNull();
    expect(Array.from(picked!.bytes)).toEqual(Array.from(BYTES));
    expect(counters.getFile).toBeGreaterThan(0);
    expect(counters.arrayBuffer).toBeGreaterThan(0);
    expect(counters.request).toBe(0);
    expect(counters.query).toBe(0);
    expect(counters.createWritable).toBe(0);
    expect(picked!.file.name).toBe('假稿.db');
    // 保留把手：之後存檔可寫回，而且存檔時才會索權。
    expect((picked!.file as unknown as { sourceHandle: unknown }).sourceHandle).toBe(handle);
    expect(typeof picked!.file.queryPermission).toBe('function');
    expect(typeof picked!.file.requestPermission).toBe('function');
    await picked!.file.write(new Uint8Array([1]));
    expect(counters.createWritable).toBe(1);
  });

  it('requestPermission 設成永不 resolve 也不阻擋開檔（開檔根本不呼叫它）', async () => {
    const { handle, counters } = fakeHandle({ request: () => new Promise(() => undefined) });
    stubPicker(async () => [handle]);
    const picked = await pickExistingDatabase();
    expect(picked?.bytes.byteLength).toBe(BYTES.byteLength);
    expect(counters.request).toBe(0);
  });

  it('requestPermission 會拒絕也不影響開檔，且沒被呼叫', async () => {
    const { handle, counters } = fakeHandle({
      request: async () => {
        throw new Error('不該被呼叫');
      },
    });
    stubPicker(async () => [handle]);
    const picked = await pickExistingDatabase();
    expect(picked).not.toBeNull();
    expect(counters.request).toBe(0);
  });

  it('等一輪微任務之後（排除背景預先索權）仍然是 0', async () => {
    const { handle, counters } = fakeHandle();
    stubPicker(async () => [handle]);
    await pickExistingDatabase();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counters.request).toBe(0);
  });

  it('取消選檔回傳 null，不讀檔也不索權', async () => {
    const { handle, counters } = fakeHandle();
    stubPicker(async () => {
      throw new DOMException('使用者取消', 'AbortError');
    });
    expect(await pickExistingDatabase()).toBeNull();
    expect(counters.getFile).toBe(0);
    expect(counters.request).toBe(0);
    expect(handle).toBeDefined();
  });

  it('讀檔錯誤照既有流程丟出（由 hook 顯示 OPEN_DB_FAIL）', async () => {
    const { handle, counters } = fakeHandle({ getFileError: new Error('讀不到') });
    stubPicker(async () => [handle]);
    await expect(pickExistingDatabase()).rejects.toThrow('讀不到');
    expect(counters.request).toBe(0);
  });

  it('存檔用的 file 仍把權限交給 saveProject：query 與 request 各自轉給把手', async () => {
    const { handle, counters } = fakeHandle();
    const file = diskFileFromHandle(handle);
    expect(await file.queryPermission()).toBe('prompt');
    expect(await file.requestPermission()).toBe('granted');
    expect(counters.query).toBe(1);
    expect(counters.request).toBe(1);
  });
});
