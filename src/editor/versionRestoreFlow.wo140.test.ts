import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirectoryAppSpace, createMemoryDirectory } from '../db/appSpace';
import * as browserSpace from '../db/browserSpace';
import { generateUuidV4 } from '../db/extensionMeta';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import { loadStoredBooks } from '../db/library';
import type { SaveEnvironment } from '../db/saveProject';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import { findNode, type ChapterNode } from '../data/demo';
import { writingDayKey } from '../domain/dailyGoal';
import {
  MANUSCRIPT_VERSION_AUTO_NOTE,
  MANUSCRIPT_VERSION_CHAPTER_LIMIT,
  createManuscriptVersion,
  saveAutoVersionBeforeRestore,
  versionsForChapter,
  type CreateManuscriptVersionInput,
  type ManuscriptVersion,
} from '../domain/manuscriptVersions';
import { listWritableTargetNodes } from '../domain/trash';
import { countBookWords, countWords } from '../domain/wordCount';
import { classifyTextDelta } from '../domain/writingLog';
import {
  createState,
  displayLogRows,
  getProjectChapterVersions,
  isProjectChapterVersionsReadOnly,
  openDatabaseManuscript,
  persistProjectNow,
  reduce,
  verifyBytesForSave,
  type Action,
  type SampleState,
} from '../state/sampleStore';
import { executeFormat, type FormatFlowDeps } from './formatFlow';
import { createTrashCaptureTracker } from './trashCapture';
import {
  VERSION_EVICTED_HINT,
  VERSION_RESTORE_OVER_LIMIT_TOAST,
} from '../copy/manuscriptVersionCopy';
import { resolveVersionRestoreToast } from '../screens/EditorPane';
import {
  executeVersionRestore,
  executeVersionRestoreUndo,
  type VersionRestoreFlowDeps,
  type VersionRestoreRequest,
} from './versionRestoreFlow';

const NOON = new Date('2026-11-26T04:00:00Z');
const PID = 'p-wo140-flow';
const OTHER = 'p-wo140-flow-other';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sampleTree(): ChapterNode[] {
  return [
    {
      id: 'v1',
      type: 'folder',
      title: '【範例】第一卷',
      content: '【範例】卷的正文不該被改',
      children: [
        {
          id: 'c1',
          type: 'file',
          title: '【範例】第一章　霧港夜泊',
          content: '【範例】海霧沿著石階緩緩爬上碼頭，遠處傳來低沉的鐘聲。',
          children: [
            {
              id: 's1',
              type: 'scene',
              title: '【範例】第一幕　岸邊',
              content: '【範例】潮水拍打著木樁，燈影在水面碎成一片。',
            },
          ],
        },
        {
          id: 'c2',
          type: 'file',
          title: '【範例】第二章　空白測試',
          content: '',
        },
      ],
    },
    {
      id: 'c3',
      type: 'file',
      title: '【範例】第三章　別章不受影響',
      content: '【範例】這一章的內容與字數都不該被其他章還原波及。',
    },
  ];
}

function baseState(): SampleState {
  let s = reduce(createState(NOON), {
    type: 'add-project',
    id: PID,
    title: '【範例】WO-140 第 4 段還原驗收',
    shape: 'novel',
  });
  s = reduce(s, {
    type: 'add-project',
    id: OTHER,
    title: '【範例】另一本稿子',
    shape: 'single',
  });
  s = reduce(s, { type: 'set-nodes', projectId: PID, nodes: sampleTree() });
  s = reduce(s, {
    type: 'set-cards',
    projectId: PID,
    cards: [
      {
        id: 'card-1',
        parent_id: null,
        title: '【範例】主角卡',
        category: 'character',
        content: '【範例】主角備註內容不應被版本還原改動',
        color: '#ffffff',
        is_collapsed: 0,
        sort_order: 0,
      },
    ],
  });
  s = reduce(s, { type: 'focus-project', id: PID });
  return s;
}

function contentOf(state: SampleState, nodeId: string, projectId = PID): string | undefined {
  return findNode(state.projects.find((p) => p.id === projectId)!.nodes, nodeId)?.content;
}

function titleOf(state: SampleState, nodeId: string, projectId = PID): string | undefined {
  return findNode(state.projects.find((p) => p.id === projectId)!.nodes, nodeId)?.title;
}

function todayRow(state: SampleState, projectId = PID) {
  const key = writingDayKey(NOON, 0);
  return displayLogRows(state, projectId).find((row) => row.date === key);
}

class FakeDisk implements DiskFile {
  bytes: Uint8Array;
  writes = 0;
  constructor(readonly name: string, initial: Uint8Array) {
    this.bytes = initial.slice();
  }
  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }
  async write(next: Uint8Array): Promise<void> {
    this.writes += 1;
    this.bytes = next.slice();
  }
  async queryPermission(): Promise<'granted'> {
    return 'granted';
  }
  async requestPermission(): Promise<'granted'> {
    return 'granted';
  }
}

function makeFakeEnv(): SaveEnvironment {
  return {
    canPickFiles: true,
    targets: createMemoryTargetStore(),
    verify: verifyBytesForSave,
    pickSaveLocation: async () => null,
    share: async () => 'shared',
  };
}

/**
 * 模擬 EditorPane + useWritingSurface.replaceText + sampleStore reducer：
 * - replaceText(next, caret, { countForToday: false }) 會先 flush() 尚未暫存的真正新打字，
 *   再清除 trashCapture 並以 countForToday: false 送出 commit-text。
 */
function createFlowHarness(
  initial: SampleState,
  opts: {
    projectId?: string;
    currentId: string;
    live?: string | null;
    persistSucceeds?: () => boolean;
    onBeforeAutoSaveResolve?: () => void;
  },
) {
  const projectId = opts.projectId ?? PID;
  let state = initial;
  let currentId = opts.currentId;
  let live: string | null =
    opts.live === undefined ? (contentOf(state, currentId, projectId) ?? '') : opts.live;
  let composing = false;
  let rescanCount = 0;
  const sent: Action[] = [];
  const replaceCalls: Array<{
    next: string;
    caret: number;
    options?: { countForToday?: boolean };
  }> = [];

  const send = (action: Action) => {
    sent.push(action);
    state = reduce(state, action);
  };

  const replaceText = (
    next: string,
    caret: number,
    options?: { countForToday?: boolean },
  ): boolean => {
    if (composing) return false;
    replaceCalls.push({ next, caret, options });
    if (options?.countForToday === false && live !== null) {
      // 對齊 useWritingSurface.ts replaceRef：先送出尚未進入 store 的真正新打字
      send({ type: 'commit-text', projectId, nodeId: currentId, text: live });
    }
    live = next;
    send({
      type: 'commit-text',
      projectId,
      nodeId: currentId,
      text: next,
      ...(options?.countForToday !== undefined ? { countForToday: options.countForToday } : {}),
    });
    return true;
  };

  let nextVerSeq = 1;
  const deps: VersionRestoreFlowDeps = {
    getNodes: () => state.projects.find((p) => p.id === projectId)?.nodes ?? null,
    readLive: () => live,
    isComposing: () => composing,
    isReadOnly: () => isProjectChapterVersionsReadOnly(state, projectId),
    getCurrentProjectId: () => state.activeProjectId,
    getCurrentChapterId: () => currentId,
    saveAutoBeforeRestore: async (input) => {
      opts.onBeforeAutoSaveResolve?.();
      if (isProjectChapterVersionsReadOnly(state, projectId)) {
        return { kind: 'read-only', persisted: false };
      }
      const fullInput: Omit<CreateManuscriptVersionInput, 'source'> = {
        ...input,
        version_id: `22222222-3333-4444-8555-${String(nextVerSeq++).padStart(12, '0')}`,
        saved_at_ms: Date.now() + nextVerSeq,
      };
      const result = saveAutoVersionBeforeRestore(
        getProjectChapterVersions(state, projectId),
        fullInput,
      );
      if (opts.persistSucceeds && !opts.persistSucceeds()) {
        return { ...result, persisted: false };
      }
      if (result.kind !== 'reused-latest') {
        send({
          type: 'chapter-version-save-auto-before-restore',
          projectId,
          input: fullInput,
        });
      }
      return { ...result, persisted: true };
    },
    replaceText,
    setRestoreUndo: (snapshot) => send({ type: 'chapter-version-set-restore-undo', snapshot }),
    clearRestoreUndo: () => send({ type: 'chapter-version-clear-restore-undo' }),
    onAfterApplyOrUndo: () => {
      rescanCount += 1;
    },
  };

  const formatDeps: FormatFlowDeps = {
    getNodes: () => state.projects.find((p) => p.id === projectId)?.nodes ?? null,
    readLive: () => live,
    isComposing: () => composing,
    syncCurrent: (next, syncOptions) =>
      replaceText(next, Math.min(next.length, next.length), syncOptions),
    applyOthers: (changes, snapshot) => send({ type: 'format-apply', projectId, changes, snapshot }),
    undoOthers: (entries, undoOptions) =>
      send({
        type: 'format-undo',
        projectId,
        entries,
        ...(undoOptions?.countForToday !== undefined ? { countForToday: undoOptions.countForToday } : {}),
      }),
    clearSnapshot: () => send({ type: 'format-clear' }),
  };

  return {
    sent,
    replaceCalls,
    get state() {
      return state;
    },
    set state(next: SampleState) {
      state = next;
    },
    get live() {
      return live;
    },
    get currentId() {
      return currentId;
    },
    get rescanCount() {
      return rescanCount;
    },
    typeLive(text: string) {
      live = text;
    },
    switchChapter(nodeId: string) {
      currentId = nodeId;
      live = contentOf(state, nodeId, projectId) ?? '';
    },
    setComposing(value: boolean) {
      composing = value;
    },
    send,
    restore(
      targetVersion: ManuscriptVersion,
      extra?: Partial<VersionRestoreRequest>,
    ) {
      return executeVersionRestore(deps, {
        projectId,
        currentId,
        openedProjectId: projectId,
        openedChapterId: currentId,
        targetVersion,
        ...extra,
      });
    },
    undo() {
      return executeVersionRestoreUndo(deps, {
        projectId,
        currentId,
        snapshot: state.versionRestoreUndo,
      });
    },
    applyFormat(kind: 'indent' | 'unify-punctuation' = 'indent') {
      return executeFormat(formatDeps, {
        projectId,
        currentId,
        openedProjectId: projectId,
        openedChapterId: currentId,
        kind,
        scope: 'chapter',
      });
    },
  };
}

describe('WO-140 第 4 段：回到舊版、自動保存、產品層復原與今日字數防護', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('先完成自動保存（含 600ms live draft 未暫存新字），才以 replaceText(target.content, 0, { countForToday: false }) 替換正文；章名、卡片與他章不變', async () => {
    let state = baseState();
    const oldTarget = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666001',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章　舊章名不該蓋過新章名',
      content: '【範例】這是更早以前的舊版正文內容。',
      note: '大改前',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: oldTarget,
    });
    // 把章名改成新的，驗證還原時不會被舊版 chapter_title_snapshot 覆寫
    const newTree = sampleTree();
    newTree[0]!.children![0]!.title = '【範例】第一章　修改後的新章名';
    state = reduce(state, { type: 'set-nodes', projectId: PID, nodes: newTree });

    const beforeCards = state.projects.find((p) => p.id === PID)!.cards;
    const beforeC3 = contentOf(state, 'c3');
    const beforeS1 = contentOf(state, 's1');

    const h = createFlowHarness(state, { currentId: 'c1' });
    // 使用者在 600ms 停筆緩衝內剛新打了一句，尚未 commit 到 store
    const liveDraftText = `${contentOf(state, 'c1')!}而且我剛又多打了一句還沒暫存的話。`;
    h.typeLive(liveDraftText);

    const outcome = await h.restore(oldTarget);
    expect(outcome.status).toBe('restored');
    if (outcome.status !== 'restored') return;

    // 1. replaceText 明確以 caret = 0 與 { countForToday: false } 呼叫
    expect(h.replaceCalls).toEqual([
      {
        next: oldTarget.content,
        caret: 0,
        options: { countForToday: false },
      },
    ]);
    expect(h.rescanCount).toBe(1);

    // 2. 正文已換成舊版；章名、子幕、他章、卡片完全不變
    expect(contentOf(h.state, 'c1')).toBe(oldTarget.content);
    expect(h.live).toBe(oldTarget.content);
    expect(titleOf(h.state, 'c1')).toBe('【範例】第一章　修改後的新章名');
    expect(contentOf(h.state, 's1')).toBe(beforeS1);
    expect(contentOf(h.state, 'c3')).toBe(beforeC3);
    expect(h.state.projects.find((p) => p.id === PID)!.cards).toEqual(beforeCards);

    // 3. 自動保存版本必須包含剛才未暫存的 live draft 全文與自動備註
    const c1Versions = versionsForChapter(getProjectChapterVersions(h.state, PID), 'c1');
    expect(c1Versions).toHaveLength(2);
    const autoSaved = c1Versions[0]!;
    expect(autoSaved.source).toBe('auto-before-restore');
    expect(autoSaved.note).toBe(MANUSCRIPT_VERSION_AUTO_NOTE);
    expect(autoSaved.content).toBe(liveDraftText);
    expect(autoSaved.chapter_title_snapshot).toBe('【範例】第一章　修改後的新章名');

    // 4. 復原快照已寫入記憶體
    expect(h.state.versionRestoreUndo).toEqual({
      projectId: PID,
      chapterId: 'c1',
      targetVersionId: oldTarget.version_id,
      autoSavedVersionId: autoSaved.version_id,
      beforeContent: liveDraftText,
      afterContent: oldTarget.content,
    });
  });

  it('自動保存失敗時絕不替換正文，也不建立 versionRestoreUndo 快照', async () => {
    let state = baseState();
    const oldTarget = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666002',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】不應覆蓋掉現在正文的舊版。',
      note: '',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: oldTarget,
    });

    const originalBody = contentOf(state, 'c1')!;
    const h = createFlowHarness(state, {
      currentId: 'c1',
      persistSucceeds: () => false,
    });
    h.typeLive(`${originalBody}加上尚未存檔的新打字。`);

    const outcome = await h.restore(oldTarget);
    expect(outcome).toEqual({ status: 'auto-save-failed' });
    expect(h.replaceCalls).toEqual([]);
    expect(h.live).toBe(`${originalBody}加上尚未存檔的新打字。`);
    expect(contentOf(h.state, 'c1')).toBe(originalBody);
    expect(h.state.versionRestoreUndo).toBeUndefined();
    expect(h.rescanCount).toBe(0);
  });

  it('組字中防護：還原與復原在組字中都不動正文也不清掉復原快照，結束組字後可正常執行', async () => {
    let state = baseState();
    const oldTarget = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666003',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】舊版內容。',
      note: '留念',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: oldTarget,
    });

    const beforeBody = contentOf(state, 'c1')!;
    const h = createFlowHarness(state, { currentId: 'c1' });

    // 1. 還原時正在組字 -> 中止，連自動保存都不觸發
    h.setComposing(true);
    expect(await h.restore(oldTarget)).toEqual({ status: 'composing' });
    expect(getProjectChapterVersions(h.state, PID)).toHaveLength(1);
    expect(h.replaceCalls).toEqual([]);

    // 2. 結束組字後成功還原
    h.setComposing(false);
    const restored = await h.restore(oldTarget);
    expect(restored.status).toBe('restored');
    expect(contentOf(h.state, 'c1')).toBe(oldTarget.content);

    // 3. 復原時正在組字 -> 中止，且保留 versionRestoreUndo
    h.setComposing(true);
    expect(h.undo()).toEqual({ status: 'composing' });
    expect(contentOf(h.state, 'c1')).toBe(oldTarget.content);
    expect(h.state.versionRestoreUndo).not.toBeNull();

    // 4. 結束組字後成功復原
    h.setComposing(false);
    const undone = h.undo();
    expect(undone.status).toBe('restored');
    expect(contentOf(h.state, 'c1')).toBe(beforeBody);
    expect(h.state.versionRestoreUndo).toBeNull();
  });

  it('產品層「復原」保留剛才自動保存的那一則版本，且在還原後即使於該章新打字仍可一併復原', async () => {
    let state = baseState();
    const oldTarget = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666004',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】回到這個較早的版本。',
      note: '第一版',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: oldTarget,
    });

    const beforeBody = contentOf(state, 'c1')!;
    const h = createFlowHarness(state, { currentId: 'c1' });
    const restoreRes = await h.restore(oldTarget);
    expect(restoreRes.status).toBe('restored');
    expect(getProjectChapterVersions(h.state, PID)).toHaveLength(2);
    const autoSavedId = h.state.versionRestoreUndo!.autoSavedVersionId;

    // 換成舊版後，使用者在該章新打字並送出 commit-text：versionRestoreUndo 不可自動清除
    const editedAfterRestore = `${oldTarget.content}這裡是還原後又新補的文字。`;
    h.typeLive(editedAfterRestore);
    h.send({
      type: 'commit-text',
      projectId: PID,
      nodeId: 'c1',
      text: editedAfterRestore,
    });
    expect(h.state.versionRestoreUndo).not.toBeNull();

    // 按下產品層「復原」：以 replaceText(beforeContent, 0, { countForToday: false }) 連之後新打的字一起還原
    const undoRes = h.undo();
    expect(undoRes.status).toBe('restored');
    expect(h.replaceCalls.at(-1)).toEqual({
      next: beforeBody,
      caret: 0,
      options: { countForToday: false },
    });
    expect(contentOf(h.state, 'c1')).toBe(beforeBody);
    expect(h.live).toBe(beforeBody);
    expect(h.state.versionRestoreUndo).toBeNull();

    // 剛才自動保存的版本必須完整留在清單裡，不能因為按了「復原」被刪掉
    const remaining = versionsForChapter(getProjectChapterVersions(h.state, PID), 'c1');
    expect(remaining).toHaveLength(2);
    expect(remaining.some((v) => v.version_id === autoSavedId)).toBe(true);
    expect(h.undo()).toEqual({ status: 'none' });
  });

  it('今日字數防護（今日 0 字與今日已有進度）：還原與復原不增減今日字數，不增大量貼上／刪除與刪稿暫存區，只有真正新打的字才算', async () => {
    // 準備長度足夠跨過大量刪除／貼上門檻（> 300 字）的兩份正文
    const longBefore = '【範例】港口夜雨滂沱，燈塔在遠方一閃一滅，船隻在浪間搖晃。\n'.repeat(18);
    const longOld = '【範例】晴朗午後的港灣靜悄悄，海鷗停在舊木棧道上歇息。\n'.repeat(6);
    expect(classifyTextDelta(longBefore, longOld, { source: 'type' }).largeDelete).toBe(true);
    expect(classifyTextDelta(longOld, longBefore, { source: 'type' }).largeInsert).toBe(true);

    // 狀況 1：今日 0 字起點（既有舊文以 countForToday: false 寫入）
    let stateZero = baseState();
    stateZero = reduce(stateZero, {
      type: 'commit-text',
      projectId: PID,
      nodeId: 'c1',
      text: longBefore,
      countForToday: false,
    });
    const oldVersion = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666005',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: longOld,
      note: '短版',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    stateZero = reduce(stateZero, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: oldVersion,
    });
    expect(stateZero.schedule.open?.wordCount ?? 0).toBe(0);

    const tracker = createTrashCaptureTracker();
    const hZero = createFlowHarness(stateZero, { currentId: 'c1' });
    expect((await hZero.restore(oldVersion)).status).toBe('restored');
    expect(hZero.state.schedule.open?.wordCount ?? 0).toBe(0);
    expect(todayRow(hZero.state)?.word_count ?? 0).toBe(0);
    expect(todayRow(hZero.state)?.paste_large_count ?? 0).toBe(0);
    expect(todayRow(hZero.state)?.delete_large_count ?? 0).toBe(0);
    expect(hZero.sent.some((a) => a.type === 'note-large')).toBe(false);
    expect(tracker.getLastAutoTrash()).toBeNull();
    expect(hZero.state.fileExtras[PID]?.trash).toBeUndefined();
    // 章總字數有正確反映舊版長度
    expect(countWords(contentOf(hZero.state, 'c1')!)).toBe(countWords(longOld));

    expect(hZero.undo().status).toBe('restored');
    expect(hZero.state.schedule.open?.wordCount ?? 0).toBe(0);
    expect(todayRow(hZero.state)?.word_count ?? 0).toBe(0);
    expect(todayRow(hZero.state)?.paste_large_count ?? 0).toBe(0);
    expect(todayRow(hZero.state)?.delete_large_count ?? 0).toBe(0);
    expect(countWords(contentOf(hZero.state, 'c1')!)).toBe(countWords(longBefore));

    // 狀況 2：今日已有進度（今天在 c2 寫了 40 字，且 c1 剛新打 5 字尚未停筆暫存）
    const todayTypedInC2 = '【範例】' + '寫'.repeat(36);
    const todayBaseWords = countWords(todayTypedInC2);
    let stateProgress = reduce(stateZero, {
      type: 'commit-text',
      projectId: PID,
      nodeId: 'c2',
      text: todayTypedInC2,
    });
    expect(stateProgress.schedule.open?.wordCount).toBe(todayBaseWords);

    const hProg = createFlowHarness(stateProgress, { currentId: 'c1' });
    const newlyTypedSuffix = '新打五個字';
    hProg.typeLive(`${longBefore}${newlyTypedSuffix}`);

    expect((await hProg.restore(oldVersion)).status).toBe('restored');
    const expectedTodayWords = todayBaseWords + countWords(newlyTypedSuffix);
    expect(hProg.state.schedule.open?.wordCount).toBe(expectedTodayWords);
    expect(todayRow(hProg.state)?.word_count).toBe(expectedTodayWords);

    // 全書字數依實際正文精確更新
    const projAfterRestore = hProg.state.projects.find((p) => p.id === PID)!;
    expect(countBookWords(projAfterRestore.nodes)).toBe(
      countWords(titleOf(hProg.state, 'v1')!) +
        countWords(titleOf(hProg.state, 'c1')!) +
        countWords(titleOf(hProg.state, 's1')!) +
        countWords(titleOf(hProg.state, 'c2')!) +
        countWords(titleOf(hProg.state, 'c3')!) +
        countWords(longOld) +
        countWords(contentOf(hProg.state, 's1')!) +
        countWords(todayTypedInC2) +
        countWords(contentOf(hProg.state, 'c3')!),
    );

    // 復原後今日字數依然是 expectedTodayWords，不灌水也不扣減
    expect(hProg.undo().status).toBe('restored');
    expect(hProg.state.schedule.open?.wordCount).toBe(expectedTodayWords);
    expect(todayRow(hProg.state)?.word_count).toBe(expectedTodayWords);
  });

  it('versionRestoreUndo 與 formatUndo 互斥；換稿或刪掉該章即清除，且不標記 dirty 或遞增 contentRevById', async () => {
    let state = baseState();
    const v1 = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666006',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】第一行沒有縮排\n第二行也準備測試排版',
      note: 'v1',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: v1,
    });

    const h = createFlowHarness(state, { currentId: 'c1' });
    // 先執行一次排版，產生 formatUndo
    expect(h.applyFormat('indent').status).toBe('applied');
    expect(h.state.formatUndo).not.toBeNull();
    expect(h.state.versionRestoreUndo).toBeNull();

    // 回到舊版：應建立 versionRestoreUndo 並清除 formatUndo
    const revBeforeSetUndo = h.state.contentRevById?.[PID] ?? 0;
    const restoreRes = await h.restore(v1);
    expect(restoreRes.status).toBe('restored');
    expect(h.state.versionRestoreUndo).not.toBeNull();
    expect(h.state.formatUndo).toBeNull();

    // 單獨測試 set / clear versionRestoreUndo 不增加 contentRevById
    h.send({ type: 'chapter-version-clear-restore-undo' });
    expect(h.state.versionRestoreUndo).toBeNull();
    // 上一步 auto-save 與 replaceText 各有變動，記下清完後的 rev 再測 set/clear 本身零增量
    const revClean = h.state.contentRevById?.[PID] ?? 0;
    const sampleSnap = {
      projectId: PID,
      chapterId: 'c1',
      targetVersionId: v1.version_id,
      autoSavedVersionId: v1.version_id,
      beforeContent: 'a',
      afterContent: 'b',
    };
    h.send({ type: 'chapter-version-set-restore-undo', snapshot: sampleSnap });
    expect(h.state.contentRevById?.[PID] ?? 0).toBe(revClean);
    h.send({ type: 'chapter-version-clear-restore-undo' });
    expect(h.state.contentRevById?.[PID] ?? 0).toBe(revClean);
    expect(revBeforeSetUndo).toBeGreaterThanOrEqual(0);

    // 重新回到舊版取得快照後，再執行排版：應建立 formatUndo 並清除 versionRestoreUndo
    expect((await h.restore(v1)).status).toBe('restored');
    expect(h.state.versionRestoreUndo).not.toBeNull();
    expect(h.applyFormat('indent').status).toBe('applied');
    expect(h.state.formatUndo).not.toBeNull();
    expect(h.state.versionRestoreUndo).toBeNull();

    // 換稿（focus-project 到 OTHER）會清除 versionRestoreUndo
    expect((await h.restore(v1)).status).toBe('restored');
    expect(h.state.versionRestoreUndo).not.toBeNull();
    h.send({ type: 'focus-project', id: OTHER });
    expect(h.state.versionRestoreUndo).toBeNull();

    // 切回 PID、再次回到舊版，刪掉該章（set-nodes 移除 c1）會清除 versionRestoreUndo（但依決-3 保留版本列）
    h.send({ type: 'focus-project', id: PID });
    expect((await h.restore(v1)).status).toBe('restored');
    const snapshotBeforeDelete = h.state.versionRestoreUndo;
    expect(snapshotBeforeDelete).not.toBeNull();
    const withoutC1 = sampleTree().filter((n) => n.id !== 'v1');
    h.send({ type: 'set-nodes', projectId: PID, nodes: withoutC1 });
    expect(h.state.versionRestoreUndo).toBeNull();
    expect(getProjectChapterVersions(h.state, PID).length).toBeGreaterThanOrEqual(1);
    expect(h.undo()).toEqual({ status: 'none' });
    // 若持有已刪章的殘留快照直接呼叫 executeVersionRestoreUndo，會判定為 invalid 並清快照
    let clearedInvalid = false;
    expect(
      executeVersionRestoreUndo(
        {
          getNodes: () => h.state.projects.find((p) => p.id === PID)?.nodes ?? null,
          isComposing: () => false,
          replaceText: () => true,
          clearRestoreUndo: () => {
            clearedInvalid = true;
          },
        },
        { projectId: PID, currentId: 'c1', snapshot: snapshotBeforeDelete },
      ),
    ).toEqual({ status: 'invalid' });
    expect(clearedInvalid).toBe(true);
  });

  it('非同步自動保存期間若換章、改字或進入組字，立即中止且不覆寫新正文；目標無效或 stale 亦安全擋下', async () => {
    let state = baseState();
    const v1 = createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666007',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】舊版文字。',
      note: '',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 60_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: PID,
      input: v1,
    });

    // 1. 開啟時的章節／稿子不符 -> stale
    const hStale = createFlowHarness(state, { currentId: 'c1' });
    expect(await hStale.restore(v1, { openedChapterId: 'c3' })).toEqual({ status: 'stale' });
    expect(await hStale.restore(v1, { openedProjectId: OTHER })).toEqual({ status: 'stale' });
    // 他章的版本不能套用到本尊以外的章
    expect(await hStale.restore({ ...v1, chapter_id: 'c3' })).toEqual({ status: 'no-target' });
    // 目標是資料夾（不可寫入）-> no-target
    expect(await hStale.restore({ ...v1, chapter_id: 'v1' })).toEqual({ status: 'no-target' });

    // 2. 自動保存等待期間使用者在寫作框改了字 -> 中止不覆寫
    let typedDuringSave = '';
    const hEdited = createFlowHarness(state, {
      currentId: 'c1',
      onBeforeAutoSaveResolve: () => {
        typedDuringSave = `${contentOf(state, 'c1')!}存版途中新打的字`;
        hEdited.typeLive(typedDuringSave);
      },
    });
    expect(await hEdited.restore(v1)).toEqual({ status: 'stale' });
    expect(hEdited.replaceCalls).toEqual([]);
    expect(hEdited.live).toBe(typedDuringSave);

    // 3. 自動保存等待期間切換到別章 -> 中止不覆寫
    const hSwitched = createFlowHarness(state, {
      currentId: 'c1',
      onBeforeAutoSaveResolve: () => {
        hSwitched.switchChapter('c3');
      },
    });
    expect(await hSwitched.restore(v1)).toEqual({ status: 'stale' });
    expect(hSwitched.replaceCalls).toEqual([]);
  });

  it('上限 20 份互動：20 份皆有手寫備註時回到舊版暫留第 21 份（overLimit: true）；與最新一版相同時沿用不重複', async () => {
    let state = baseState();
    for (let i = 1; i <= MANUSCRIPT_VERSION_CHAPTER_LIMIT; i += 1) {
      state = reduce(state, {
        type: 'chapter-version-save-manual',
        projectId: PID,
        input: {
          version_id: `22222222-3333-4444-8555-${String(100 + i).padStart(12, '0')}`,
          chapter_id: 'c1',
          chapter_title_snapshot: '【範例】第一章',
          content: `【範例】手寫備註版本內容 #${i}`,
          note: `手寫備註 ${i}`,
          saved_at_ms: NOON.getTime() - (30 - i) * 1000,
        },
      });
    }
    const allBefore = versionsForChapter(getProjectChapterVersions(state, PID), 'c1');
    expect(allBefore).toHaveLength(20);
    const oldestManual = allBefore[allBefore.length - 1]!;

    const h = createFlowHarness(state, { currentId: 'c1' });
    const outcome = await h.restore(oldestManual);
    expect(outcome.status).toBe('restored');
    if (outcome.status !== 'restored') return;
    expect(outcome.overLimit).toBe(true);
    expect(versionsForChapter(getProjectChapterVersions(h.state, PID), 'c1')).toHaveLength(21);

    // 復原後把目前正文設為與最新一版相同，再還原時應沿用最新一版（reused-latest）不重複增加
    expect(h.undo().status).toBe('restored');
    const latestNow = versionsForChapter(getProjectChapterVersions(h.state, PID), 'c1')[0]!;
    const countBeforeReuse = versionsForChapter(getProjectChapterVersions(h.state, PID), 'c1').length;
    const reuseRes = await h.restore(oldestManual);
    expect(reuseRes.status).toBe('restored');
    if (reuseRes.status === 'restored') {
      expect(reuseRes.autoSave.kind).toBe('reused-latest');
      expect(reuseRes.autoSave.version.version_id).toBe(latestNow.version_id);
    }
    expect(versionsForChapter(getProjectChapterVersions(h.state, PID), 'c1')).toHaveLength(
      countBeforeReuse,
    );
  });

  it('真實 sampleStore + persistProjectNow 端到端驗證：落盤成功才換正文；落盤失敗絕不換正文', async () => {
    const dir = createMemoryDirectory();
    const space = createDirectoryAppSpace(dir);
    vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(space);

    const bytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】還原整合.db', bytes);
    const env = makeFakeEnv();
    let state = createState(NOON);
    const dispatch = (a: Action) => {
      state = reduce(state, a);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes,
      diskFile: disk,
      dispatch,
      env,
      store: null,
      now: NOON,
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });
    const project = state.projects.find((p) => p.id === opened.id)!;
    const chId = listWritableTargetNodes(project.nodes)[0]!.node.id;

    // 存一筆舊版
    const vOld = createManuscriptVersion({
      version_id: generateUuidV4(),
      chapter_id: chId,
      chapter_title_snapshot: findNode(project.nodes, chId)?.title ?? '',
      content: '【範例】真正寫進 AppSpace 測試用的舊版正文。',
      note: '目標舊版',
      source: 'manual',
      saved_at_ms: NOON.getTime() - 10_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: vOld,
    });
    await persistProjectNow({
      state,
      projectId: opened.id,
      dispatch,
      onStashResult: () => undefined,
    });

    const currentBefore = contentOf(state, chId, opened.id) ?? '';
    let live = `${currentBefore}＋新打但未暫存的文字`;

    const realDeps: VersionRestoreFlowDeps = {
      getNodes: () => state.projects.find((p) => p.id === opened.id)?.nodes ?? null,
      readLive: () => live,
      isComposing: () => false,
      isReadOnly: () => isProjectChapterVersionsReadOnly(state, opened.id),
      getCurrentProjectId: () => state.activeProjectId,
      getCurrentChapterId: () => chId,
      saveAutoBeforeRestore: async (input) => {
        if (isProjectChapterVersionsReadOnly(state, opened.id)) {
          return { kind: 'read-only', persisted: false };
        }
        const fullInput: Omit<CreateManuscriptVersionInput, 'source'> = {
          ...input,
          version_id: generateUuidV4(),
          saved_at_ms: Date.now(),
        };
        const result = saveAutoVersionBeforeRestore(
          getProjectChapterVersions(state, opened.id),
          fullInput,
        );
        if (result.kind === 'blocked-full') {
          return { ...result, persisted: false };
        }
        if (result.kind === 'reused-latest') {
          const persisted = await persistProjectNow({
            state,
            projectId: opened.id,
            dispatch,
            onStashResult: () => undefined,
          });
          return { ...result, persisted };
        }
        dispatch({
          type: 'chapter-version-save-auto-before-restore',
          projectId: opened.id,
          input: fullInput,
        });
        const persisted = await persistProjectNow({
          state,
          projectId: opened.id,
          dispatch,
          onStashResult: () => undefined,
        });
        return { ...result, persisted };
      },
      replaceText: (next, _caret, options) => {
        dispatch({ type: 'commit-text', projectId: opened.id, nodeId: chId, text: live });
        live = next;
        dispatch({
          type: 'commit-text',
          projectId: opened.id,
          nodeId: chId,
          text: next,
          ...(options?.countForToday !== undefined ? { countForToday: options.countForToday } : {}),
        });
        return true;
      },
      setRestoreUndo: (snapshot) =>
        dispatch({ type: 'chapter-version-set-restore-undo', snapshot }),
      clearRestoreUndo: () => dispatch({ type: 'chapter-version-clear-restore-undo' }),
    };

    const okOutcome = await executeVersionRestore(realDeps, {
      projectId: opened.id,
      currentId: chId,
      openedProjectId: opened.id,
      openedChapterId: chId,
      targetVersion: vOld,
    });
    expect(okOutcome.status).toBe('restored');
    expect(contentOf(state, chId, opened.id)).toBe(vOld.content);

    const stored = await loadStoredBooks();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.chapterVersions?.kind).toBe('ok');
    if (stored[0]?.chapterVersions?.kind === 'ok') {
      expect(
        stored[0].chapterVersions.versions.some(
          (v) => v.source === 'auto-before-restore' && v.content === `${currentBefore}＋新打但未暫存的文字`,
        ),
      ).toBe(true);
    }

    // 模擬 AppSpace 寫入失敗：必須中止，不更換正文
    vi.spyOn(browserSpace, 'appSpace').mockRejectedValueOnce(new Error('disk full'));
    live = `${vOld.content}＋準備失敗前的新字`;
    const failOutcome = await executeVersionRestore(realDeps, {
      projectId: opened.id,
      currentId: chId,
      openedProjectId: opened.id,
      openedChapterId: chId,
      targetVersion: vOld,
    });
    expect(failOutcome).toEqual({ status: 'auto-save-failed' });
    expect(live).toBe(`${vOld.content}＋準備失敗前的新字`);
    expect(contentOf(state, chId, opened.id)).toBe(vOld.content);

    // 必修 1：第一次暫存失敗已寫進記憶體，第二次同內容再按「用這一版」走 reused-latest 仍必須再寫暫存；
    // 若暫存仍失敗則仍不換正文，直到暫存成功才可換正文
    vi.spyOn(browserSpace, 'appSpace').mockRejectedValueOnce(new Error('disk still full'));
    const retryStillFail = await executeVersionRestore(realDeps, {
      projectId: opened.id,
      currentId: chId,
      openedProjectId: opened.id,
      openedChapterId: chId,
      targetVersion: vOld,
    });
    expect(retryStillFail).toEqual({ status: 'auto-save-failed' });
    expect(live).toBe(`${vOld.content}＋準備失敗前的新字`);
    expect(contentOf(state, chId, opened.id)).toBe(vOld.content);

    const retrySucceed = await executeVersionRestore(realDeps, {
      projectId: opened.id,
      currentId: chId,
      openedProjectId: opened.id,
      openedChapterId: chId,
      targetVersion: vOld,
    });
    expect(retrySucceed.status).toBe('restored');
    if (retrySucceed.status === 'restored') {
      expect(retrySucceed.autoSave.kind).toBe('reused-latest');
      expect(retrySucceed.autoSave.persisted).toBe(true);
    }
    expect(live).toBe(vOld.content);
    expect(contentOf(state, chId, opened.id)).toBe(vOld.content);
  });

  it('必修 2 與必修 4：第 21 份改手寫備註後再換版不得變 22 份且不換正文；滿 20 份換版清掉舊版時提示 VERSION_EVICTED_HINT', async () => {
    // 1. 滿 20 份（含 1 份無手寫備註）→ 改寫正文後換版，清掉最舊無備註版並回傳 VERSION_EVICTED_HINT
    let stateEvict = baseState();
    for (let i = 1; i <= MANUSCRIPT_VERSION_CHAPTER_LIMIT; i += 1) {
      stateEvict = reduce(stateEvict, {
        type: 'chapter-version-save-manual',
        projectId: PID,
        input: {
          version_id: `22222222-3333-4444-8555-${String(200 + i).padStart(12, '0')}`,
          chapter_id: 'c1',
          chapter_title_snapshot: '【範例】第一章',
          content: `【範例】第 ${i} 版內容`,
          note: i === 1 ? '' : `手寫備註 ${i}`,
          saved_at_ms: NOON.getTime() - (30 - i) * 1000,
        },
      });
    }
    const targetInEvict = versionsForChapter(getProjectChapterVersions(stateEvict, PID), 'c1').at(-1)!;
    const hEvict = createFlowHarness(stateEvict, { currentId: 'c1' });
    hEvict.typeLive('【範例】改寫後準備換版的新正文');
    const evictOutcome = await hEvict.restore(targetInEvict);
    expect(evictOutcome.status).toBe('restored');
    if (evictOutcome.status !== 'restored') return;
    expect(evictOutcome.overLimit).toBe(false);
    expect(evictOutcome.autoSave.kind).toBe('saved');
    if (evictOutcome.autoSave.kind === 'saved') {
      expect(evictOutcome.autoSave.evictedCount).toBe(1);
      expect(evictOutcome.autoSave.noticeCode).toBe('auto-saved-evicted-oldest');
    }
    expect(resolveVersionRestoreToast(evictOutcome)).toBe(VERSION_EVICTED_HINT);

    // 2. 20 份皆手寫 → 換版成第 21 份（overLimit 時用 VERSION_RESTORE_OVER_LIMIT_TOAST 不重疊）→
    //    把第 21 份自動保存改成手寫備註 → 改正文再換版：必須失敗（blocked-full）且維持 21 份、正文不動
    let state21 = baseState();
    for (let i = 1; i <= MANUSCRIPT_VERSION_CHAPTER_LIMIT; i += 1) {
      state21 = reduce(state21, {
        type: 'chapter-version-save-manual',
        projectId: PID,
        input: {
          version_id: `22222222-3333-4444-8555-${String(300 + i).padStart(12, '0')}`,
          chapter_id: 'c1',
          chapter_title_snapshot: '【範例】第一章',
          content: `【範例】全手寫第 ${i} 版`,
          note: `手寫 ${i}`,
          saved_at_ms: NOON.getTime() - (30 - i) * 1000,
        },
      });
    }
    const targetIn21 = versionsForChapter(getProjectChapterVersions(state21, PID), 'c1').at(-1)!;
    const h21 = createFlowHarness(state21, { currentId: 'c1' });
    h21.typeLive('【範例】第一次超過 20 份時的正文');
    const firstRestore = await h21.restore(targetIn21);
    expect(firstRestore.status).toBe('restored');
    if (firstRestore.status !== 'restored') return;
    expect(firstRestore.overLimit).toBe(true);
    expect(resolveVersionRestoreToast(firstRestore)).toBe(VERSION_RESTORE_OVER_LIMIT_TOAST);

    const auto21Id = firstRestore.autoSave.version.version_id;
    h21.send({
      type: 'chapter-version-update-note',
      projectId: PID,
      versionId: auto21Id,
      note: '【範例】把第 21 份改成手寫保護',
    });
    expect(versionsForChapter(getProjectChapterVersions(h21.state, PID), 'c1')).toHaveLength(21);

    h21.typeLive('【範例】不應被舊版蓋掉的第 22 次修改');
    const undoBeforeBlocked = h21.state.versionRestoreUndo;
    const blockedRestore = await h21.restore(targetIn21);
    expect(blockedRestore).toEqual({ status: 'auto-save-failed', reason: 'blocked-full' });
    expect(versionsForChapter(getProjectChapterVersions(h21.state, PID), 'c1')).toHaveLength(21);
    expect(h21.live).toBe('【範例】不應被舊版蓋掉的第 22 次修改');
    expect(h21.state.versionRestoreUndo).toEqual(undoBeforeBlocked);
  });

  it('程式碼防護：versionRestoreFlow.ts 無硬寫中文且不碰 noteLarge／clipboard／beforeinput／.value =', () => {
    const src = code(read('./versionRestoreFlow.ts'));
    expect(src).not.toMatch(/noteLarge|note-large|clipboard|beforeinput|dispatchEvent|InputEvent|insertFromPaste/i);
    expect(src).not.toMatch(/\.value\s*=/);
    expect(src).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
  });
});
