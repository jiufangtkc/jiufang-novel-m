import { describe, expect, it } from 'vitest';
import {
  createSaveShortcutHandler,
  matchSaveShortcut,
  type SaveShortcutEvent,
} from './saveShortcuts';

function key(init: Partial<SaveShortcutEvent> = {}) {
  let prevented = 0;
  const e: SaveShortcutEvent = {
    key: 's',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => {
      prevented += 1;
    },
    ...init,
  };
  return { e, prevented: () => prevented };
}

function setup(dialogOpen = false) {
  const calls: string[] = [];
  const resolvers: Array<() => void> = [];
  let open = dialogOpen;
  const pending = (name: string) =>
    new Promise<null>((resolve) => {
      calls.push(name);
      resolvers.push(() => resolve(null));
    });
  const handler = createSaveShortcutHandler({
    getActions: () => ({
      saveProject: () => pending('save'),
      saveProjectAs: () => pending('saveAs'),
    }),
    isDialogOpen: () => open,
  });
  const finish = async () => {
    resolvers.splice(0).forEach((r) => r());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { calls, handler, finish, setOpen: (v: boolean) => (open = v) };
}

describe('儲存快速鍵（WO-114）', () => {
  it('Ctrl+S、Cmd+S 儲存；Ctrl+Shift+S、Cmd+Shift+S（含大寫）另存', () => {
    expect(matchSaveShortcut(key({ ctrlKey: true }).e)).toBe('save');
    expect(matchSaveShortcut(key({ metaKey: true }).e)).toBe('save');
    expect(matchSaveShortcut(key({ ctrlKey: true, shiftKey: true, key: 'S' }).e)).toBe('saveAs');
    expect(matchSaveShortcut(key({ metaKey: true, shiftKey: true, key: 'S' }).e)).toBe('saveAs');
  });

  it('不攔其他組合：單按 S、Ctrl+A、複製貼上、復原、Alt 組合', () => {
    expect(matchSaveShortcut(key().e)).toBeNull();
    for (const k of ['a', 'c', 'v', 'x', 'z']) {
      expect(matchSaveShortcut(key({ ctrlKey: true, key: k }).e)).toBeNull();
      expect(matchSaveShortcut(key({ metaKey: true, key: k }).e)).toBeNull();
    }
    expect(matchSaveShortcut(key({ ctrlKey: true, altKey: true }).e)).toBeNull();
  });

  it('Ctrl+S 恰呼叫儲存一次並取消瀏覽器預設', () => {
    const t = setup();
    const k = key({ ctrlKey: true });
    t.handler(k.e);
    expect(t.calls).toEqual(['save']);
    expect(k.prevented()).toBe(1);
  });

  it('Cmd+Shift+S 恰呼叫另存一次並取消預設', () => {
    const t = setup();
    const k = key({ metaKey: true, shiftKey: true, key: 'S' });
    t.handler(k.e);
    expect(t.calls).toEqual(['saveAs']);
    expect(k.prevented()).toBe(1);
  });

  it('組字中（isComposing 或 229）不呼叫也不攔', () => {
    const t = setup();
    const a = key({ ctrlKey: true, isComposing: true });
    const b = key({ ctrlKey: true, keyCode: 229 });
    t.handler(a.e);
    t.handler(b.e);
    expect(t.calls).toEqual([]);
    expect(a.prevented()).toBe(0);
    expect(b.prevented()).toBe(0);
  });

  it('對話框已開：零呼叫但仍取消預設；關閉後恢復', () => {
    const t = setup(true);
    const k = key({ ctrlKey: true });
    t.handler(k.e);
    expect(t.calls).toEqual([]);
    expect(k.prevented()).toBe(1);
    t.setOpen(false);
    t.handler(key({ ctrlKey: true }).e);
    expect(t.calls).toEqual(['save']);
  });

  it('按住（repeat）不重複觸發，仍取消預設', async () => {
    const t = setup();
    t.handler(key({ ctrlKey: true }).e);
    const r = key({ ctrlKey: true, repeat: true });
    await t.finish();
    t.handler(r.e);
    expect(t.calls).toEqual(['save']);
    expect(r.prevented()).toBe(1);
  });

  it('處理中不重入（含交替按兩組鍵），完成後可再操作', async () => {
    const t = setup();
    t.handler(key({ ctrlKey: true }).e);
    t.handler(key({ ctrlKey: true }).e);
    t.handler(key({ ctrlKey: true, shiftKey: true, key: 'S' }).e);
    expect(t.calls).toEqual(['save']);
    await t.finish();
    t.handler(key({ ctrlKey: true, shiftKey: true, key: 'S' }).e);
    expect(t.calls).toEqual(['save', 'saveAs']);
  });

  it('動作失敗後旗標釋放，可再操作', async () => {
    const calls: string[] = [];
    const handler = createSaveShortcutHandler({
      getActions: () => ({
        saveProject: () => {
          calls.push('save');
          return Promise.reject(new Error('fail'));
        },
        saveProjectAs: () => Promise.resolve(null),
      }),
      isDialogOpen: () => false,
    });
    handler(key({ ctrlKey: true }).e);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    handler(key({ ctrlKey: true }).e);
    expect(calls).toEqual(['save', 'save']);
  });
});
