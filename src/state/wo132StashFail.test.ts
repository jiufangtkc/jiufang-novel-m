/**
 * WO-132 第 5 段（嚴-4＋IMPORT_TEXT_STORAGE_FAIL）測試（僅用【範例】假稿與記憶體模擬）。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SaveHeaderStatus } from '../components/SaveHeaderStatus';
import {
  AUTOSAVE_FAILED_ARIA,
  AUTOSAVE_FAILED_TOAST,
  IMPORT_TEXT_STORAGE_FAIL,
  SAVE_AND_STASH_FAIL,
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  STASH_AUTO_FAILED_TOAST,
  STASH_FAILED_BADGE,
  stashFailedAria,
} from '../copy/userFacing';
import { createMemoryTargetStore } from '../db/fileTarget';
import type { SaveEnvironment } from '../db/saveProject';
import { resolveHeaderSaveDisplay } from '../domain/autoSave';
import { appSpaceStatusLine } from '../screens/filesStatus';
import {
  attachActionForBook,
  createState,
  persistFileBookStash,
  persistLocalAutoStash,
  reduce,
  runManualSaveProject,
  toastDurationMs,
  verifyBytesForSave,
  type Action,
  type SampleState,
} from './sampleStore';
import { firstFileNode } from './testing/firstFile';

const NOW_MS = Date.parse('2026-11-23T17:10:00+08:00');

describe('WO-132 嚴-4：暫存失敗提示、自動存檔失敗文案與 IMPORT_TEXT_STORAGE_FAIL', () => {
  it('用字逐字與臺灣繁體檢查，且不動已定案之 SAVE_FATAL_FAIL／SAVE_PARTIAL_FAIL', () => {
    expect(AUTOSAVE_FAILED_TOAST).toBe('自動存檔沒成功，稿件仍在 APP 暫存空間。請按「儲存專案」');
    expect(AUTOSAVE_FAILED_ARIA).toBe('自動存檔沒成功，按了會儲存專案');
    expect(IMPORT_TEXT_STORAGE_FAIL).toBe('這個裝置存不下這份稿子，這次沒有匯入。');
    expect(IMPORT_TEXT_STORAGE_FAIL).not.toContain('這台裝置');
    expect(STASH_FAILED_BADGE).toBe('暫存沒成功');
    expect(stashFailedAria(true)).toBe('暫存沒成功，點一下儲存專案');
    expect(stashFailedAria(false)).toBe('暫存沒成功，點一下另存專案');
    expect(STASH_AUTO_FAILED_TOAST).toBe('剛剛沒能暫存在這個裝置，請按「儲存專案」或「另存專案」保住稿件');
    expect(SAVE_AND_STASH_FAIL).toBe('存檔沒成功，也還沒存進這個裝置的暫存空間，請不要關掉頁面並再試一次');
    expect(SAVE_FATAL_FAIL).toBe('存檔失敗。稿件目前仍在 APP 暫存空間。');
    expect(SAVE_PARTIAL_FAIL).toBe(SAVE_FATAL_FAIL);
    expect(toastDurationMs(STASH_AUTO_FAILED_TOAST)).toBe(5000);
    expect(toastDurationMs(SAVE_AND_STASH_FAIL)).toBe(5000);
    expect(toastDurationMs(AUTOSAVE_FAILED_TOAST)).toBe(5000);
  });

  it('localStorage 拋出 QuotaExceededError 時不更新 lastAutoSaveMs、標記 stashFailed、首次跳一次 5 秒提示且恢復後清除', () => {
    const id = 'p-1763889000001';
    let state = createState(new Date(NOW_MS));
    state = reduce(state, { type: 'add-project', id, title: '【範例】新稿暫存失敗測試', shape: 'novel', startedMs: NOW_MS });
    state = reduce(state, { type: 'focus-project', id });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const stashFailed: Record<string, boolean> = {};
    const toasts: string[] = [];
    const onStashResult = (projectId: string, ok: boolean, showToastOnFirstFail: boolean) => {
      if (ok) {
        stashFailed[projectId] = false;
        return;
      }
      const wasFailed = Boolean(stashFailed[projectId]);
      stashFailed[projectId] = true;
      if (showToastOnFirstFail && !wasFailed) toasts.push(STASH_AUTO_FAILED_TOAST);
    };

    let shouldFail = true;
    const store = {
      getItem: () => null,
      setItem: () => {
        if (shouldFail) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
      },
    };

    // 首次失敗：不更新 lastAutoSaveMs、標記 stashFailed、跳一次提示
    expect(
      persistLocalAutoStash({
        store,
        projects: state.projects,
        activeProjectId: state.activeProjectId,
        dispatch,
        onStashResult,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
    expect(state.saveMeta[id]?.lastAutoSaveMs ?? null).toBeNull();
    expect(stashFailed[id]).toBe(true);
    expect(toasts).toEqual([STASH_AUTO_FAILED_TOAST]);

    // 連續編輯仍失敗：不重複洗版
    const chapterId = firstFileNode(state.projects.find((p) => p.id === id)!.nodes)!.id;
    state = reduce(state, { type: 'commit-text', projectId: id, nodeId: chapterId, text: '【範例】繼續打字' });
    expect(
      persistLocalAutoStash({
        store,
        projects: state.projects,
        activeProjectId: state.activeProjectId,
        dispatch,
        onStashResult,
        nowMs: NOW_MS + 1000,
      }),
    ).toBe(false);
    expect(toasts).toEqual([STASH_AUTO_FAILED_TOAST]);

    // 恢復可寫：更新 lastAutoSaveMs 並清除 stashFailed
    shouldFail = false;
    expect(
      persistLocalAutoStash({
        store,
        projects: state.projects,
        activeProjectId: state.activeProjectId,
        dispatch,
        onStashResult,
        nowMs: NOW_MS + 2000,
      }),
    ).toBe(true);
    expect(state.saveMeta[id]?.lastAutoSaveMs).toBe(NOW_MS + 2000);
    expect(stashFailed[id]).toBe(false);
  });

  it('檔案稿 saveBookBytes 拒絕時無未捕捉異常、標記 stashFailed、跳一次提示，恢復後清除', async () => {
    const key = 'file-1763889000002';
    let state: SampleState = createState(new Date(NOW_MS));
    state = reduce(
      state,
      attachActionForBook(
        {
          key,
          filename: '【範例】檔案稿.db',
          title: '【範例】檔案稿',
          info: {
            title: '【範例】檔案稿',
            logline: '',
            currentTheme: '',
            globalFontFamily: '',
            globalFontSize: 12,
            editorFontFamily: '',
            editorFontSize: 16,
            targetWordCount: 100000,
            dailyTargetWordCount: 1000,
            categoryOrder: null,
            expandedCategories: null,
            categoriesMeta: '{}',
            lastOpenedNodeId: 'ch-1',
            lastCursorPosition: 0,
          },
          tree: [{ id: 'ch-1', type: 'file', title: '第一章', progress: 'Draft', content: '【範例】正文' }],
          cards: [],
          logs: [],
          wordCount: 7,
          schedule: state.schedule,
          bytes: new Uint8Array(),
          hasExternalFile: true,
          titleInFile: '【範例】檔案稿',
          titleSavePending: null,
          transfer: { kind: 'absent' },
          timeline: { kind: 'absent' },
        },
        { updatedLabel: '剛剛' },
      ),
    );
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const project = state.projects.find((p) => p.id === key)!;
    const extra = state.fileExtras[key]!;

    const stashFailed: Record<string, boolean> = {};
    const toasts: string[] = [];
    const onStashResult = (projectId: string, ok: boolean, showToastOnFirstFail: boolean) => {
      if (ok) {
        stashFailed[projectId] = false;
        return;
      }
      const wasFailed = Boolean(stashFailed[projectId]);
      stashFailed[projectId] = true;
      if (showToastOnFirstFail && !wasFailed) toasts.push(STASH_AUTO_FAILED_TOAST);
    };

    let failWrite = true;
    const mockSaveBytes = async () => {
      if (failWrite) throw new Error('IndexedDB 寫入失敗');
      return new Uint8Array([1]);
    };

    await expect(
      persistFileBookStash({ state, project, extra, dispatch, onStashResult, saveBytes: mockSaveBytes, nowMs: NOW_MS }),
    ).resolves.toBe(false);
    expect(stashFailed[key]).toBe(true);
    expect(toasts).toEqual([STASH_AUTO_FAILED_TOAST]);
    expect(state.saveMeta[key]?.lastAutoSaveMs ?? null).toBeNull();

    failWrite = false;
    await expect(
      persistFileBookStash({
        state,
        project,
        extra,
        dispatch,
        onStashResult,
        saveBytes: mockSaveBytes,
        nowMs: NOW_MS + 3000,
      }),
    ).resolves.toBe(true);
    expect(stashFailed[key]).toBe(false);
    expect(state.saveMeta[key]?.lastAutoSaveMs).toBe(NOW_MS + 3000);
  });

  it('手動存檔於建立本機暫存副本失敗時顯示 SAVE_AND_STASH_FAIL，頁首與檔案頁狀態正確露出暫存失敗', async () => {
    const id = 'p-1763889000003';
    let state = createState(new Date(NOW_MS));
    state = reduce(state, { type: 'add-project', id, title: '【範例】雙敗提示測試', shape: 'novel', startedMs: NOW_MS });
    state = reduce(state, { type: 'focus-project', id });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const env: SaveEnvironment = {
      canPickFiles: true,
      targets: createMemoryTargetStore(),
      verify: verifyBytesForSave,
      pickSaveLocation: async () => ({
        name: 'test.db',
        read: async () => new Uint8Array(),
        write: async () => {},
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
      }),
      share: async () => 'cancelled',
    };
    const inflight = { current: null };
    let markedStashFail = false;

    const out = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight,
      lastSavedRevById: {},
      onSaved: () => {},
      onStashFailed: () => {
        markedStashFail = true;
      },
      snapshot: async () => {
        throw new Error('App 空間寫入失敗');
      },
      store: null,
    });
    expect(out).toEqual({ kind: 'invalid-database' });
    expect(markedStashFail).toBe(true);
    expect(state.toast).toBe(SAVE_AND_STASH_FAIL);

    const headerKind = resolveHeaderSaveDisplay({
      isSample: false,
      autoSaveStatus: 'unsaved',
      staleDays: null,
      lastFileSaveMs: null,
      stashFailed: true,
    });
    expect(headerKind).toBe('stash-failed');
    const html = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: headerKind,
        canPickFiles: true,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
      }),
    );
    expect(html).toContain('data-save-header-kind="stash-failed"');
    expect(html).toContain(STASH_FAILED_BADGE);
    expect(html).toContain(`aria-label="${stashFailedAria(true)}"`);

    expect(
      appSpaceStatusLine({ stored: true, computer: true, lastSaveMs: NOW_MS, stashFailed: true }),
    ).toContain('最近一次暫存沒成功');
    expect(
      appSpaceStatusLine({ stored: false, computer: false, lastSaveMs: null, stashFailed: true }),
    ).toContain('最近一次暫存沒成功');
  });
});
