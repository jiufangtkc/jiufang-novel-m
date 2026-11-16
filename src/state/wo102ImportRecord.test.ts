import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTLINE_STORAGE_KEY, type KeyValueStore } from '../domain/outline';
import { readFileProject } from '../db/projectFile';
import { openMemoryDb } from '../db/wasmDb';
import { TransferDataError } from '../db/transferMeta';
import {
  manuscriptBytesOn,
  persistImportedRecord,
  reduce,
  runTextImport,
  type Action,
  type SampleState,
  type TextImportOutcome,
} from './sampleStore';
import { demoFixtureState } from './testing/sampleFixture';

/** WO-102 五：匯入成功但匯入紀錄寫不進 .db。全用程式產生的假文字與記憶體資料庫。 */

const utf8 = (text: string) => new TextEncoder().encode(text);

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  vi.stubGlobal('localStorage', store);
});
afterEach(() => vi.unstubAllGlobals());

async function importAt(state: SampleState, at: string, text: string) {
  let current = state;
  const outcome: TextImportOutcome = await runTextImport({
    filename: '假稿.txt',
    readBytes: async () => utf8(text),
    getState: () => current,
    dispatch: (action) => void (current = reduce(current, action)),
    store,
    busy: { current: false },
    now: () => new Date(at),
    yieldToUi: async () => undefined,
    newEventId: () => 'evt-fixed',
  });
  if (outcome.kind !== 'imported') throw new Error(`匯入沒成功：${outcome.kind}`);
  return { state: current, outcome };
}

describe('WO-102 五：匯入紀錄寫不進 .db 的提示', () => {
  it('全 App 原始碼不再有那句暫定提示或其常數', () => {
    const files = ['../copy/userFacing.ts', './sampleStore.tsx', '../screens/Workspace.tsx'];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toContain('IMPORT_RECORD_NOT_SAVED_NOTICE');
      expect(src).not.toContain('匯入次數沒有記下來');
    }
  });

  it('成功：寫進 .db、升格、不出提示；.db 讀回有匯入事件與正文', async () => {
    const { state, outcome } = await importAt(demoFixtureState(), '2026-11-16T07:40:00Z', '第一章 開始\n假內容');
    const dispatched: Action[] = [];
    const result = await persistImportedRecord({
      state: outcome.afterState,
      projectId: outcome.id,
      dispatch: (a) => void dispatched.push(a),
      snapshot: async (s, p) => {
        const bytes = await manuscriptBytesOn(s, p, null);
        const db = await openMemoryDb(bytes);
        try {
          expect(readFileProject(db.sql).tree.length).toBeGreaterThan(0);
        } finally {
          db.close();
        }
        return { key: p.id, bytes };
      },
    });
    expect(result).toBe('saved');
    expect(dispatched.map((a) => a.type)).toEqual(['promote-stored']);
    expect(dispatched.some((a) => a.type === 'toast')).toBe(false);
    expect(state.projects[0]!.id).toBe(outcome.id);
  });

  it('事件衝突（交易整筆回復）：不顯示任何提示；正文與稿子仍在本機；不回報成功', async () => {
    const first = await importAt(demoFixtureState(), '2026-11-16T07:40:00Z', '第一章 甲\n假內容甲');
    const baseBytes = await manuscriptBytesOn(first.outcome.afterState, first.state.projects[0]!, null);
    // 另一次匯入用相同事件代號、不同時間，寫在含舊事件的底稿上 → 同代號不同內容，丟出 TransferDataError
    const second = await importAt(first.state, '2026-11-17T07:41:00Z', '第一章 乙\n假內容乙');
    const project = second.state.projects.find((p) => p.id === second.outcome.id)!;
    const dispatched: Action[] = [];
    const result = await persistImportedRecord({
      state: second.outcome.afterState,
      projectId: second.outcome.id,
      dispatch: (a) => void dispatched.push(a),
      snapshot: async (s, p) => ({ key: p.id, bytes: await manuscriptBytesOn(s, p, baseBytes) }),
    });
    expect(result).toBe('record-failed');
    // 不顯示任何提示（沒有 toast，也沒有改用其他動作）
    expect(dispatched).toEqual([]);
    // 沒有升格（不假裝已存進 .db），但稿子與正文都還在
    expect(dispatched.some((a) => a.type === 'promote-stored')).toBe(false);
    expect(project.origin).not.toBe('file');
    expect(project.nodes.length).toBeGreaterThan(0);
    expect(store.getItem(OUTLINE_STORAGE_KEY) ?? '').not.toBe('');
    // 底稿位元組沒被弄壞，仍可讀
    const db = await openMemoryDb(baseBytes);
    try {
      expect(readFileProject(db.sql).tree.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('寫入／核對失敗（TransferDataError）不顯示任何提示；一般儲存失敗同樣不出提示', async () => {
    const { outcome } = await importAt(demoFixtureState(), '2026-11-16T07:40:00Z', '第一章 假\n內容');
    const run = async (error: unknown) => {
      const dispatched: Action[] = [];
      const result = await persistImportedRecord({
        state: outcome.afterState,
        projectId: outcome.id,
        dispatch: (a) => void dispatched.push(a),
        snapshot: async () => {
          throw error;
        },
      });
      return { result, dispatched };
    };
    const transfer = await run(new TransferDataError('附加事件寫入後核對不符'));
    expect(transfer.result).toBe('record-failed');
    expect(transfer.dispatched).toEqual([]);
    const general = await run(new Error('QuotaExceededError（測試模擬）'));
    expect(general.result).toBe('save-failed');
    expect(general.dispatched).toEqual([]);
  });

  it('本機寫入失敗仍是 storage-failed，不呼叫 .db 流程、不建稿', async () => {
    store.setItem = () => {
      throw new Error('QuotaExceededError（測試模擬）');
    };
    const state = demoFixtureState();
    const outcome = await runTextImport({
      filename: '假稿.txt',
      readBytes: async () => utf8('第一章 假\n內容'),
      getState: () => state,
      dispatch: () => undefined,
      store,
      busy: { current: false },
      yieldToUi: async () => undefined,
    });
    expect(outcome.kind).toBe('storage-failed');
  });

  it('接線：匯入成功才寫 .db；失敗時不派發 toast；Workspace 換頁照常清提示；一次匯入只嘗試一次（不重試洗版）', () => {
    const storeSource = readFileSync(new URL('./sampleStore.tsx', import.meta.url), 'utf8');
    expect(storeSource).toContain("if (outcome.kind === 'imported') {");
    expect(storeSource.match(/persistImportedRecord\(/g)).toHaveLength(2); // 定義＋唯一呼叫
    const workspace = readFileSync(new URL('../screens/Workspace.tsx', import.meta.url), 'utf8');
    expect(workspace).toContain('actions.toast(null)');
    expect(storeSource).not.toMatch(/record-failed[\s\S]{0,200}type: 'toast'/);
  });
});
