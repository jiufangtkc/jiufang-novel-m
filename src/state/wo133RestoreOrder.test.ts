import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as browserSpace from '../db/browserSpace';
import type { StoredBook } from '../db/appSpace';
import { createArchiveClient } from '../db/chapterArchive';
import { loadStoredBooks } from '../db/library';
import { writeFileProject, type FileProjectInfo } from '../db/projectFile';
import { openMemoryDb } from '../db/wasmDb';
import { CATEGORY_TIMELINE } from '../domain/cardCategories';
import { archiveDeletion, deletedFromNode, emptyArchive, type BookArchive } from '../domain/chapterVersions';
import { loadProjects } from '../domain/outline';
import { placeRecovered } from '../domain/chapterOps';
import { nodesAfterDeleteUndo } from '../domain/undoDelete';
import {
  attachActionForBook,
  createState,
  deleteProjectCardWithArchive,
  getProjectCards,
  persistProjectNow,
  reduce,
  restoreDeletedChapterWithArchive,
  restoreProjectCardFromArchive,
  type Action,
  type SampleState,
} from './sampleStore';

afterEach(() => {
  vi.restoreAllMocks();
});

function createMemoryArchiveClient() {
  const store = new Map<string, BookArchive>();
  return createArchiveClient({
    async read(bookId) {
      return store.get(bookId) ?? emptyArchive();
    },
    async write(bookId, archive) {
      store.set(bookId, archive);
    },
  });
}

function makeFileInfo(title = '【範例】還原順序書'): FileProjectInfo {
  return {
    title,
    logline: '',
    currentTheme: '',
    globalFontFamily: '',
    globalFontSize: 12,
    editorFontFamily: '',
    editorFontSize: 16,
    targetWordCount: 10000,
    dailyTargetWordCount: 500,
    categoryOrder: null,
    expandedCategories: null,
    categoriesMeta: '{}',
    lastOpenedNodeId: null,
    lastCursorPosition: 0,
  };
}

async function makeFileProjectState(options?: { withTimelineEvent?: boolean }): Promise<{
  state: SampleState;
  projectId: string;
  stored: Map<string, StoredBook>;
}> {
  const db = await openMemoryDb(new Uint8Array());
  let bytes: Uint8Array;
  const projectId = 'file-restore-test';
  const cards = options?.withTimelineEvent
    ? [
        {
          id: 'evt-1',
          parent_id: null,
          category: CATEGORY_TIMELINE,
          title: '【範例】事件一',
          content: '【範例】事件內容',
          color: '#61AFEF',
          is_collapsed: 0,
          sort_order: 0,
          storyTime: '第一年',
          timelineOrder: 0,
          chapterId: 'ch-1',
        },
        {
          id: 'card-1',
          parent_id: null,
          category: 'character',
          title: '【範例】主角卡',
          content: '【範例】角色設定',
          color: '#61AFEF',
          is_collapsed: 0,
          sort_order: 0,
        },
      ]
    : [
        {
          id: 'card-1',
          parent_id: null,
          category: 'character',
          title: '【範例】主角卡',
          content: '【範例】角色設定',
          color: '#61AFEF',
          is_collapsed: 0,
          sort_order: 0,
        },
      ];
  try {
    writeFileProject(
      db.sql,
      makeFileInfo(),
      [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　霧港',
          progress: 'Draft',
          content: '【範例】一定要救回來的正文。',
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　燈塔',
          progress: 'Draft',
          content: '【範例】第二章正文。',
        },
      ],
      cards,
      [],
    );
    bytes = db.exportBytes();
  } finally {
    db.close();
  }

  const stored = new Map<string, StoredBook>();
  stored.set(projectId, {
    key: projectId,
    filename: 'restore-test.db',
    title: '【範例】還原順序書',
    bytes,
    hasExternalFile: true,
    titleInFile: '【範例】還原順序書',
    titleSavePending: null,
  });

  vi.spyOn(browserSpace, 'appSpace').mockResolvedValue({
    put: async (book) => {
      stored.set(book.key, book);
    },
    get: async (key) => stored.get(key) ?? null,
    list: async () => [...stored.values()],
    remove: async (key) => {
      stored.delete(key);
    },
  });

  const loadedBooks = await loadStoredBooks(new Date('2026-11-23T23:12:00+08:00'));
  let state = createState(new Date('2026-11-23T23:12:00+08:00'));
  state = reduce(state, attachActionForBook(loadedBooks[0]!, { updatedLabel: '剛剛' }));
  state = reduce(state, { type: 'focus-project', id: projectId });
  return { state, projectId, stored };
}

describe('WO-133 第 3 段：還原章節與卡片必須先暫存成功、再移除刪除紀錄', () => {
  it('卡片還原（立即復原與最近刪除放回）：persistBook 必先於 archive.update 完成；暫存失敗保留紀錄且重試不重複建卡', async () => {
    for (const atEnd of [false, true]) {
      let { state, projectId } = await makeFileProjectState();
      const archive = createMemoryArchiveClient();
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };

      const record = await deleteProjectCardWithArchive(state, dispatch, projectId, 'card-1', {
        archive,
        deletedAt: 1000,
        recordId: `del-card-${atEnd}`,
      });
      expect(record).not.toBeNull();
      expect(getProjectCards(state, projectId)).toHaveLength(0);

      // 1) 本機暫存失敗：刪除紀錄必須保留在 bookArchive 中
      let persistedFlag: boolean | undefined;
      await restoreProjectCardFromArchive(state, dispatch, projectId, record!, {
        archive,
        atEnd,
        persistBook: async () => false,
        onPersistResult: (ok) => {
          persistedFlag = ok;
        },
      });
      expect(persistedFlag).toBe(false);
      expect((await archive.read(projectId)).deletedCards).toHaveLength(1);

      // 2) 再次嘗試還原並成功暫存：不重複建立兩張卡片，且嚴格先 persistBook 再移除 archive 紀錄
      const order: string[] = [];
      const origUpdate = archive.update.bind(archive);
      archive.update = async (bookId, recipe, kind) => {
        order.push('archive-update-start');
        const res = await origUpdate(bookId, recipe, kind);
        order.push('archive-update-done');
        return res;
      };

      await restoreProjectCardFromArchive(state, dispatch, projectId, record!.id, {
        archive,
        atEnd,
        persistBook: async (nextState) => {
          order.push('persist-start');
          const ok = await persistProjectNow({
            state: nextState,
            projectId,
            dispatch,
            onStashResult: () => undefined,
          });
          order.push('persist-done');
          return ok;
        },
      });

      expect(order).toEqual([
        'persist-start',
        'persist-done',
        'archive-update-start',
        'archive-update-done',
      ]);
      expect((await archive.read(projectId)).deletedCards).toEqual([]);
      const cardsAfter = getProjectCards(state, projectId);
      expect(cardsAfter.filter((c) => c.id === 'card-1')).toHaveLength(1);

      // 3) 立即重載（不經過 250ms debounce）：本機暫存裡已包含救回的卡片
      const reloaded = await loadStoredBooks();
      expect(reloaded[0]?.cards.some((c) => c.id === 'card-1')).toBe(true);
    }
  });

  it('章節還原（立即復原與最近刪除放回）：先寫入本機暫存再移除 archive.deleted；失敗保留紀錄，成功立即重載保留章節與時間線關聯', async () => {
    for (const mode of ['undo', 'recover'] as const) {
      let { state, projectId } = await makeFileProjectState({ withTimelineEvent: true });
      const archive = createMemoryArchiveClient();
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };

      const projectBefore = state.projects.find((p) => p.id === projectId)!;
      const cardsBefore = getProjectCards(state, projectId);
      const record = deletedFromNode(projectBefore.nodes, 'ch-1', 2000, `del-ch-${mode}`, cardsBefore)!;
      expect(record.unlinkedTimelineEvents).toEqual([{ cardId: 'evt-1', chapterId: 'ch-1' }]);

      await archive.update(projectId, (curr) => archiveDeletion(curr, record, []), 'delete');
      const remainingNodes = projectBefore.nodes.filter((n) => n.id !== 'ch-1');
      dispatch({ type: 'set-nodes', projectId, nodes: remainingNodes });
      expect(getProjectCards(state, projectId).find((c) => c.id === 'evt-1')?.chapterId).toBeNull();

      const restoredNodes =
        mode === 'undo'
          ? nodesAfterDeleteUndo(remainingNodes, { snapshot: [], deleted: record })
          : placeRecovered(remainingNodes, record, false);

      // 1) 本機暫存拋錯／回 false：不清除 archive.deleted
      const failedResult = await restoreDeletedChapterWithArchive({
        state,
        dispatch,
        projectId,
        record,
        nodes: restoredNodes,
        archive,
        persistBook: async () => {
          throw new Error('storage down');
        },
      });
      expect(failedResult.persisted).toBe(false);
      expect((await archive.read(projectId)).deleted).toHaveLength(1);

      // 2) 成功暫存：嚴格先 persistBook 再 forgetDeleted，且立即重載後章節與時間線關聯皆存在
      const order: string[] = [];
      const origUpdate = archive.update.bind(archive);
      archive.update = async (bookId, recipe, kind) => {
        order.push('archive-update');
        return origUpdate(bookId, recipe, kind);
      };

      const okResult = await restoreDeletedChapterWithArchive({
        state,
        dispatch,
        projectId,
        record,
        nodes: restoredNodes,
        archive,
        persistBook: async (nextState) => {
          order.push('persist-start');
          const ok = await persistProjectNow({
            state: nextState,
            projectId,
            dispatch,
            onStashResult: () => undefined,
          });
          order.push('persist-done');
          return ok;
        },
      });
      expect(okResult.persisted).toBe(true);
      expect(order).toEqual(['persist-start', 'persist-done', 'archive-update']);
      expect((await archive.read(projectId)).deleted).toEqual([]);

      const reloaded = await loadStoredBooks();
      expect(reloaded[0]?.tree.some((n) => n.id === 'ch-1')).toBe(true);
      expect(reloaded[0]?.cards.find((c) => c.id === 'evt-1')?.chapterId).toBe('ch-1');
    }
  });

  it('新稿（非檔案稿）還原時，persistProjectNow 立即寫入 localStorage，立即重載可讀回', async () => {
    const kv = new Map<string, string>();
    const memoryStore = {
      getItem: (k: string) => kv.get(k) ?? null,
      setItem: (k: string, v: string) => {
        kv.set(k, v);
      },
    };
    let state = createState(new Date('2026-11-23T23:13:00+08:00'));
    state = reduce(state, {
      type: 'add-project',
      id: 'p-local-restore',
      title: '【範例】新稿立即暫存',
      shape: 'novel',
      startedMs: Date.now(),
    });
    state = reduce(state, { type: 'focus-project', id: 'p-local-restore' });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const project = state.projects.find((p) => p.id === 'p-local-restore')!;
    const record = deletedFromNode(project.nodes, project.nodes[0]!.id, 3000, 'del-local', [])!;
    const archive = createMemoryArchiveClient();
    await archive.update('p-local-restore', (curr) => archiveDeletion(curr, record, []), 'delete');
    dispatch({ type: 'set-nodes', projectId: 'p-local-restore', nodes: [] });

    await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId: 'p-local-restore',
      record,
      nodes: [record.node],
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId: 'p-local-restore',
          dispatch,
          onStashResult: () => undefined,
          store: memoryStore,
        }),
    });

    const reloadedProjects = loadProjects(memoryStore);
    expect(reloadedProjects?.find((p) => p.id === 'p-local-restore')?.nodes).toHaveLength(1);
    expect((await archive.read('p-local-restore')).deleted).toEqual([]);
  });

  it('畫面元件原始碼守衛：CardsScreen、TimelineScreen、WriteScreen 皆先等還原與暫存完成才更新刪除清單或提示', () => {
    const cardsSrc = readFileSync('src/screens/CardsScreen.tsx', 'utf8');
    const timelineSrc = readFileSync('src/screens/TimelineScreen.tsx', 'utf8');
    const writeSrc = readFileSync('src/screens/WriteScreen.tsx', 'utf8');

    expect(writeSrc).toContain('actions.restoreDeletedChapter');
    expect(writeSrc).not.toContain('forgetDeleted');

    // CardsScreen 的 handleUndo 與 handleRestoreFromList 必須在 await actions.restoreDeletedCard 之後才 filter deletedCards 與 toast
    const cardsUndo = cardsSrc.slice(cardsSrc.indexOf('const handleUndo'), cardsSrc.indexOf('const handleRestoreFromList'));
    expect(cardsUndo.indexOf('await actions.restoreDeletedCard')).toBeLessThan(cardsUndo.indexOf('setDeletedCards'));
    expect(cardsUndo.indexOf('await actions.restoreDeletedCard')).toBeLessThan(cardsUndo.indexOf('restoredCardToast'));

    const cardsList = cardsSrc.slice(cardsSrc.indexOf('const handleRestoreFromList'), cardsSrc.indexOf('const previewNode'));
    expect(cardsList.indexOf('await actions.restoreDeletedCard')).toBeLessThan(cardsList.indexOf('setDeletedCards'));
    expect(cardsList.indexOf('await actions.restoreDeletedCard')).toBeLessThan(cardsList.indexOf('restoredCardToast'));

    const timelineUndo = timelineSrc.slice(timelineSrc.indexOf('const handleUndo'), timelineSrc.indexOf('const renderCardDetail'));
    expect(timelineUndo.indexOf('await actions.restoreDeletedCard')).toBeLessThan(timelineUndo.indexOf('restoredCardToast'));
  });
});
