import { describe, expect, it } from 'vitest';
import { catchEarlyRejection, requestDurableStorage } from './durableStorage';

interface NodeProcess {
  on(event: 'unhandledRejection', listener: (error: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (error: unknown) => void): void;
}

describe('App 空間持久化', () => {
  it('OPFS 失敗時拒絕會被接住', async () => {
    const nodeProcess = (globalThis as { process?: NodeProcess }).process;
    if (!nodeProcess) throw new Error('這項測試要在 Node 裡跑');
    const errors: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      errors.push(error);
    };
    nodeProcess.on('unhandledRejection', onUnhandled);
    const ready = Promise.reject(Object.assign(new Error('暫時失敗'), { name: 'UnknownError' }));
    const guarded = catchEarlyRejection(ready);
    await new Promise((resolve) => setTimeout(resolve, 20));
    nodeProcess.off('unhandledRejection', onUnhandled);
    expect(errors).toEqual([]);
    await expect(guarded).rejects.toThrow('暫時失敗');
  });

  it('有 persist 就呼叫，沒有時不拋錯', async () => {
    let called = false;
    await expect(
      requestDurableStorage({
        persist: async () => {
          called = true;
          return true;
        },
      }),
    ).resolves.toBe(true);
    expect(called).toBe(true);
    await expect(requestDurableStorage(undefined)).resolves.toBe(false);
    await expect(
      requestDurableStorage({
        persist: async () => {
          throw new Error('拒絕');
        },
      }),
    ).resolves.toBe(false);
  });
});