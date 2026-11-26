import { describe, expect, it } from 'vitest';
import type { DemoProject } from '../data/demo';
import { findNode } from '../data/demo';
import { loadProjects, type KeyValueStore } from '../domain/outline';
import {
  applyLiveDraft,
  bindLeaveFlush,
  consumeLiveExcludedWordDelta,
  flushLiveDraftNow,
  flushOpenDraft,
  loadLiveDraft,
  readLiveExcludedWordDelta,
  setLiveFlusher,
  setLiveReader,
} from './liveDraft';

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function demoProject(content: string): DemoProject {
  return {
    id: 'fog',
    title: '【範例】霧港',
    updatedLabel: '剛剛',
    bookGoal: 1000,
    origin: 'demo',
    nodes: [
      {
        id: 'ch-1',
        type: 'file',
        title: '第一章　章',
        content,
      },
    ],
  };
}

describe('離開時立刻暫存', () => {
  it('打字後 0.3 秒內重新整理，字還在', async () => {
    const store = memoryStore();
    const projects = [demoProject('【範例】原文')];
    let text = '【範例】原文';
    const started = Date.now();
    text = '【範例】原文加上新句';
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(Date.now() - started).toBeLessThan(600);
    flushOpenDraft({
      store,
      projects,
      read: () => ({ projectId: 'fog', chapterId: 'ch-1', text }),
    });
    const restored = loadProjects(store);
    expect(findNode(restored?.[0]?.nodes ?? [], 'ch-1')?.content).toBe('【範例】原文加上新句');
  });

  it('檔案專案重新整理時，用離開當下的暫存蓋過尚未寫完的檔', () => {
    const store = memoryStore();
    const projects: DemoProject[] = [
      {
        ...demoProject('【範例】舊句'),
        id: 'file-1',
        origin: 'file',
        dbKey: 'file-1',
      },
    ];
    flushOpenDraft({
      store,
      projects,
      read: () => ({ projectId: 'file-1', chapterId: 'ch-1', text: '【範例】剛打的' }),
    });
    expect(loadProjects(store)).toBeNull();
    const draft = loadLiveDraft(store);
    const restored = applyLiveDraft(projects, draft);
    expect(findNode(restored[0]?.nodes ?? [], 'ch-1')?.content).toBe('【範例】剛打的');
  });

  it('隱藏、換頁與關閉分頁都會立刻交出正文', () => {
    const calls: string[] = [];
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    let hidden = false;
    const doc = {
      get visibilityState() {
        return hidden ? 'hidden' : 'visible';
      },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    bindLeaveFlush(target, doc, () => calls.push('flush'));
    hidden = true;
    listeners.get('visibilitychange')?.();
    listeners.get('pagehide')?.();
    listeners.get('beforeunload')?.();
    expect(calls).toEqual(['flush', 'flush', 'flush']);
  });

  it('consumeLiveExcludedWordDelta 只消費一次並歸零，flushLiveDraftNow 回報是否實際送出', () => {
    let pending = -120;
    let composing = false;
    try {
      setLiveReader(
        () => ({ projectId: 'p1', chapterId: 'ch-1', text: '' }),
        () => composing,
        () => pending,
        () => {
          const val = pending;
          pending = 0;
          return val;
        },
      );
      expect(readLiveExcludedWordDelta()).toBe(-120);
      expect(consumeLiveExcludedWordDelta()).toBe(-120);
      expect(readLiveExcludedWordDelta()).toBe(0);
      expect(consumeLiveExcludedWordDelta()).toBe(0);

      setLiveFlusher(() => !composing);
      composing = true;
      expect(flushLiveDraftNow()).toBe(false);
      composing = false;
      expect(flushLiveDraftNow()).toBe(true);
    } finally {
      setLiveFlusher(null);
      setLiveReader(null);
    }
  });
});
