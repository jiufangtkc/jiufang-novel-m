/**
 * WO-126：匯入先預覽再確定。node 環境：純函式、記憶體儲存與原始碼檢查；不依賴 jsdom／testing-library。
 * 全部是虛構假文字與程式產生的位元組。
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTLINE_STORAGE_KEY, type KeyValueStore } from '../domain/outline';
import { readImportEvents } from './importEvents';
import {
  commitTextImport,
  createState,
  prepareTextImport,
  previewTextImport,
  reduce,
  runConfirmedImport,
  wholeTextImportChapters,
  type Action,
  type SampleState,
  type TextImportOutcome,
} from './sampleStore';

const NOW = new Date('2026-11-19T07:40:00Z');
const utf8 = (text: string) => new TextEncoder().encode(text);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failKeys = new Set<string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failKeys.has(key)) throw new Error('QuotaExceededError（測試模擬）');
    this.data.set(key, value);
  }
}

let store: MemoryStore;

function harness() {
  let current: SampleState = createState(NOW);
  const dispatched: Action[] = [];
  return {
    dispatched,
    get state() {
      return current;
    },
    input: {
      getState: () => current,
      dispatch: (action: Action) => {
        dispatched.push(action);
        current = reduce(current, action);
      },
      store,
      now: () => new Date(NOW),
      busy: { current: false },
      yieldToUi: async () => undefined,
    },
  };
}

function importedId(outcome: TextImportOutcome): string {
  if (outcome.kind !== 'imported') throw new Error(`匯入沒成功：${outcome.kind}`);
  return outcome.id;
}

const MANUSCRIPT = '序幕前的話\n01章 相遇\n雨下了。\n02章 紙舟\n船走了。';

describe('WO-126 解碼、填寫、預覽都不建稿', () => {
  beforeEach(() => {
    store = new MemoryStore();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('解碼成功只回全文（統一換行），不寫任何東西', async () => {
    const before = new Map(store.data);
    const result = await prepareTextImport({ readBytes: async () => utf8('甲\r\n乙\r丙') });
    expect(result).toEqual({ kind: 'ready', text: '甲\n乙\n丙' });
    expect(store.data).toEqual(before);
  });

  it('讀取失敗、不支援的 BOM、二進位都回 unreadable', async () => {
    expect(await prepareTextImport({ readBytes: async () => { throw new Error('讀檔失敗'); } })).toEqual({ kind: 'unreadable' });
    expect(await prepareTextImport({ readBytes: async () => new Uint8Array([0xff, 0xfe, 0x41, 0x00]) })).toEqual({ kind: 'unreadable' });
    expect(await prepareTextImport({ readBytes: async () => new Uint8Array([0x41, 0x00, 0x42]) })).toEqual({ kind: 'unreadable' });
  });

  it('預覽、回去改例子再預覽：不寫本機、不寫匯入紀錄', async () => {
    const h = harness();
    const first = await previewTextImport(MANUSCRIPT, '01章', async () => undefined);
    expect(first.hits).toBe(2);
    expect(first.prefaceAdded).toBe(true);
    expect(first.chapters.map((chapter) => chapter.title)).toEqual(['前言', '01章 相遇', '02章 紙舟']);
    const second = await previewTextImport(MANUSCRIPT, '第一回', async () => undefined);
    expect(second.hits).toBe(0);
    expect(second.usedExample).toBe(true);
    expect(second.chapters).toEqual([{ title: '第一章　', content: MANUSCRIPT }]);
    expect(store.data.size).toBe(0);
    expect(h.dispatched).toHaveLength(0);
  });
});

describe('WO-126 確認後才建稿', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store = new MemoryStore();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('依預覽的章列確定：一稿、一筆匯入事件、一次 import-text', async () => {
    const h = harness();
    const preview = await previewTextImport(MANUSCRIPT, '01章');
    const outcome = await runConfirmedImport({ ...h.input, filename: '霧港.txt', chapters: preview.chapters });
    const id = importedId(outcome);
    expect(h.dispatched.filter((action) => action.type === 'import-text')).toHaveLength(1);
    expect(h.dispatched).toHaveLength(1);
    const project = h.state.projects.find((item) => item.id === id)!;
    expect(project.title).toBe('霧港');
    expect(project.nodes.map((node) => node.title)).toEqual(['前言', '01章 相遇', '02章 紙舟']);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(1);
    expect(outcome.kind === 'imported' && outcome.chapterId).toBe(project.nodes[0]!.id);
  });

  it('沒找到章名時確定：整份放在「第一章　」一章', async () => {
    const h = harness();
    const preview = await previewTextImport(MANUSCRIPT, '第一回');
    const outcome = await runConfirmedImport({ ...h.input, filename: '甲.txt', chapters: preview.chapters });
    const project = h.state.projects.find((item) => item.id === importedId(outcome))!;
    expect(project.nodes.map((node) => [node.title, node.content])).toEqual([['第一章　', MANUSCRIPT]]);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(1);
  });

  it('不分章：直接一稿一事件，保留章名行與前言', async () => {
    const h = harness();
    const outcome = await runConfirmedImport({ ...h.input, filename: '乙.txt', chapters: wholeTextImportChapters(MANUSCRIPT) });
    const project = h.state.projects.find((item) => item.id === importedId(outcome))!;
    expect(project.nodes).toHaveLength(1);
    expect(project.nodes[0]!.title).toBe('第一章　');
    expect(project.nodes[0]!.content).toBe(MANUSCRIPT);
    expect(h.dispatched).toHaveLength(1);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(1);
  });

  it('寫入期間重複確認只建一稿', async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chapters = wholeTextImportChapters('甲');
    const first = runConfirmedImport({ ...h.input, filename: '甲.txt', chapters, yieldToUi: () => gate });
    const second = await runConfirmedImport({ ...h.input, filename: '甲.txt', chapters });
    expect(second).toEqual({ kind: 'busy' });
    release();
    importedId(await first);
    expect(h.dispatched).toHaveLength(1);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(1);
  });

  it('儲存失敗：不建稿、不留匯入事件，回 storage-failed', async () => {
    const h = harness();
    store.failKeys.add(OUTLINE_STORAGE_KEY);
    const outcome = await runConfirmedImport({ ...h.input, filename: '丙.txt', chapters: wholeTextImportChapters('丙') });
    expect(outcome).toEqual({ kind: 'storage-failed' });
    expect(h.dispatched).toHaveLength(0);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(0);
    // 沒有本機儲存時同樣回 storage-failed
    expect(commitTextImport({ ...h.input, store: null, filename: '丁.txt', chapters: wholeTextImportChapters('丁') })).toEqual({
      kind: 'storage-failed',
    });
  });
});

describe('WO-126 原始碼：入口與流程', () => {
  const hook = read('../screens/useImportTextFile.tsx');

  it('選檔在點擊裡同步開啟，取消靜默，同一檔案可再選', () => {
    const pick = hook.slice(hook.indexOf('const pick = () => {'), hook.indexOf('const read = async'));
    expect(pick).toContain('inputRef.current?.click()');
    expect(pick).not.toContain('await');
    expect(pick).not.toContain('setTimeout');
    expect(hook).toContain("event.target.value = '';");
    expect(hook).toMatch(/if \(!file \|\| reading \|\| working !== null \|\| session\) return;/);
    expect(hook).toContain('accept=".txt,text/plain"');
  });

  it('解碼失敗只顯示 IMPORT_TEXT_UNREADABLE，不開視窗', () => {
    const readFn = hook.slice(hook.indexOf('const read = async'), hook.indexOf('const close = () =>'));
    expect(readFn).toContain("result.kind === 'unreadable'");
    expect(readFn.indexOf('IMPORT_TEXT_UNREADABLE')).toBeLessThan(readFn.indexOf('setSession('));
  });

  it('只有確定與不分章呼叫建稿；預覽與關閉都不建稿', () => {
    expect(hook.match(/actions\.confirmImportText\(/g)).toHaveLength(1);
    const preview = hook.slice(hook.indexOf('const preview = async'), hook.indexOf('const commit = async'));
    expect(preview).not.toContain('confirmImportText');
    const close = hook.slice(hook.indexOf('const close = () =>'), hook.indexOf('const preview = async'));
    expect(close).not.toContain('confirmImportText');
    expect(hook).toContain('navigate(writePath(result.id, result.chapterId))');
    expect(hook).toContain('IMPORT_TEXT_STORAGE_FAIL');
  });

  it('預覽中取消會丟棄遲到的結果；寫入中鎖定關閉', () => {
    expect(hook).toContain('if (token !== tokenRef.current) return;');
    expect(hook).toContain('if (lockRef.current) return;');
  });

  it('首頁掛載視窗；視窗新用字都在 userFacing', () => {
    const home = read('../screens/HomeScreen.tsx');
    expect(home).toContain('{importText.dialog}');
    expect(home).toContain('ref={importText.buttonRef}');
    const dialog = read('../screens/ImportTextDialog.tsx');
    expect(dialog).not.toContain('new RegExp');
    for (const literal of ['你的章名長什麼樣', '看分章預覽', '確定匯入', '回去改例子', '不分章']) {
      expect(dialog).not.toContain(literal);
    }
    const copy = read('../copy/userFacing.ts');
    for (const literal of ['你的章名長什麼樣？', '看分章預覽', '確定匯入', '回去改例子', '不分章（全部放成一章）', '找不到符合這個例子的章名']) {
      expect(copy).toContain(literal);
    }
  });
});
