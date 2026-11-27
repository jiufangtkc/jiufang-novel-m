import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManuscriptVersionSheet, resolveSaveVersionFeedback } from '../components/ManuscriptVersionSheet';
import {
  VERSION_DUPLICATE_HINT,
  VERSION_EVICTED_HINT,
  VERSION_FULL_LOCKED_HINT,
  VERSION_OVER_LIMIT_HINT,
  VERSION_RESTORE_OVER_LIMIT_TOAST,
  VERSION_SAVED_TOAST,
  VERSION_SAVE_STASH_FAIL_HINT,
} from '../copy/manuscriptVersionCopy';
import { createDirectoryAppSpace, createMemoryDirectory, type AppSpace } from '../db/appSpace';
import * as browserSpace from '../db/browserSpace';
import { createArchiveClient } from '../db/chapterArchive';
import {
  CHAPTER_VERSIONS_TABLE,
  CHAPTER_VERSION_META_TABLE,
  CHAPTER_VERSION_TABLES,
  ChapterVersionDataError,
} from '../db/chapterVersionMeta';
import { generateUuidV4 } from '../db/extensionMeta';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import { loadStoredBooks, readBookBytes, writeBookBytes } from '../db/library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from '../db/migrations';
import { readFileProject, snapshotFingerprints } from '../db/projectFile';
import type { SaveEnvironment } from '../db/saveProject';
import { tableNames, type Sql } from '../db/sql';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import { TRASH_ITEMS_TABLE, TRASH_META_TABLE } from '../db/trashMeta';
import { openMemoryDb } from '../db/wasmDb';
import { findNode } from '../data/demo';
import { expandToNode, placeRecovered, withoutNode } from '../domain/chapterOps';
import {
  archiveDeletion,
  deletedFromNode,
  emptyArchive,
  nodeAfterVersionRestore,
  sessionVersions,
  versionsForNode,
  withVersion,
  type BookArchive,
} from '../domain/chapterVersions';
import { writingDayKey } from '../domain/dailyGoal';
import {
  MANUSCRIPT_VERSION_AUTO_NOTE,
  MANUSCRIPT_VERSION_CHAPTER_LIMIT,
  createManuscriptVersion,
  saveAutoVersionBeforeRestore,
  saveManualVersion,
  versionsForChapter,
  type CreateManuscriptVersionInput,
  type ManuscriptVersion,
} from '../domain/manuscriptVersions';
import { loadProjects, type KeyValueStore } from '../domain/outline';
import {
  appendToChapterEndPlan,
  createTrashItem,
  listWritableTargetNodes,
} from '../domain/trash';
import { nodesAfterDeleteUndo } from '../domain/undoDelete';
import { createTrashCaptureTracker } from '../editor/trashCapture';
import {
  executeVersionRestore,
  executeVersionRestoreUndo,
  type VersionRestoreFlowDeps,
} from '../editor/versionRestoreFlow';
import { removeProjectFromDevice } from './removeFromDevice';
import {
  createChapterVersionActions,
  createState,
  executeBackgroundAutoSave,
  getProjectChapterVersionRead,
  getProjectChapterVersions,
  getProjectTrash,
  isProjectChapterVersionsReadOnly,
  manuscriptBytesOn,
  manuscriptSnapshotParts,
  openDatabaseManuscript,
  persistFileBookStash,
  persistLocalAutoStash,
  persistProjectNow,
  reduce,
  restoreDeletedChapterWithArchive,
  runManualSaveProject,
  runSaveProjectAs,
  verifyBytesForSave,
  type Action,
} from './sampleStore';

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

function makeMemoryKeyValueStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function makeFakeEnv(options: {
  canPickFiles: boolean;
  pickSaveLocation?: SaveEnvironment['pickSaveLocation'];
  share?: SaveEnvironment['share'];
}): { env: SaveEnvironment; targets: ReturnType<typeof createMemoryTargetStore> } {
  const targets = createMemoryTargetStore();
  return {
    targets,
    env: {
      canPickFiles: options.canPickFiles,
      targets,
      verify: verifyBytesForSave,
      pickSaveLocation: options.pickSaveLocation ?? (async () => null),
      share: options.share ?? (async () => 'shared'),
    },
  };
}

function setupMemoryAppSpace(): {
  dir: ReturnType<typeof createMemoryDirectory>;
  space: AppSpace;
} {
  const dir = createMemoryDirectory();
  const space = createDirectoryAppSpace(dir);
  vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(space);
  return { dir, space };
}

async function mutateBytes(
  bytes: Uint8Array,
  run: (sql: Sql) => void,
): Promise<Uint8Array> {
  const db = await openMemoryDb(bytes);
  try {
    run(db.sql);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

function sampleVersionInput(overrides?: {
  version_id?: string;
  chapter_id?: string;
  chapter_title_snapshot?: string;
  content?: string;
  note?: string;
  saved_at_ms?: number;
  sort_order?: number;
}) {
  return {
    version_id: overrides?.version_id ?? '22222222-3333-4444-8555-666666666601',
    chapter_id: overrides?.chapter_id ?? 'ch-sample-doc-1',
    chapter_title_snapshot: overrides?.chapter_title_snapshot ?? '第一章　霧中燈號',
    content: overrides?.content ?? '【範例】港口夜霧濃重，遠處的燈塔依舊閃爍著微光。',
    note: overrides?.note ?? '大改前先留一版',
    saved_at_ms: overrides?.saved_at_ms ?? 1_700_000_100_000,
    ...(overrides?.sort_order !== undefined ? { sort_order: overrides.sort_order } : {}),
  };
}

async function writeBookWithVersions(
  base: Uint8Array,
  versions: readonly ManuscriptVersion[],
): Promise<Uint8Array> {
  const book = await readBookBytes('暫存', base, 'ver-helper');
  return writeBookBytes(
    base,
    book.info,
    book.tree,
    book.cards,
    book.logs,
    undefined,
    undefined,
    undefined,
    undefined,
    versions,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WO-140 第 3 段：稿子版本狀態管理與本機暫存／存檔接線', () => {
  it('打開舊稿（absent 且清單為空）不設 dirty、不增 contentRevById、暫存與自動存檔皆零寫入不建新表（P0-4）', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】舊稿無版本.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-26T10:10:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T10:10:00+08:00'),
    });

    expect(disk.writes).toBe(0);
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBeFalsy();
    expect(state.contentRevById?.[opened.id] ?? 0).toBe(0);
    expect(getProjectChapterVersionRead(state, opened.id)).toEqual({ kind: 'absent' });
    expect(getProjectChapterVersions(state, opened.id)).toEqual([]);
    expect(isProjectChapterVersionsReadOnly(state, opened.id)).toBe(false);

    const project = state.projects.find((p) => p.id === opened.id)!;
    const extra = state.fileExtras[project.dbKey!]!;
    expect(manuscriptSnapshotParts(state, project).chapterVersions).toEqual([]);

    await persistFileBookStash({
      state,
      project,
      extra,
      dispatch,
      onStashResult: () => undefined,
    });

    const storedAfterStash = await loadStoredBooks();
    expect(storedAfterStash).toHaveLength(1);
    const dbAfterStash = await openMemoryDb(storedAfterStash[0]!.bytes);
    try {
      for (const table of CHAPTER_VERSION_TABLES) {
        expect(tableNames(dbAfterStash.sql).has(table)).toBe(false);
      }
    } finally {
      dbAfterStash.close();
    }

    const autoOutcome = await executeBackgroundAutoSave({
      projectId: opened.id,
      getState: () => state,
      getStatus: () => 'active',
      lastSavedRevById: { [opened.id]: 0 },
      inflight: { current: null },
      env,
      dispatch,
      store: kv,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      isPreviouslyFailed: () => false,
    });
    expect(autoOutcome).toBe('no-changes');
    expect(disk.writes).toBe(0);

    // 就算後來有改正文但從未存過版本，寫出 .db 仍不應偷建版本表
    const chId = listWritableTargetNodes(project.nodes)[0]!.node.id;
    state = reduce(state, { type: 'focus-project', id: opened.id });
    state = reduce(state, {
      type: 'commit-text',
      projectId: opened.id,
      nodeId: chId,
      text: '【範例】僅修改正文、未存版本。',
    });
    const manualSave = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: { [opened.id]: 0 },
      onSaved: () => undefined,
      store: kv,
    });
    expect(manualSave?.kind).toBe('saved');
    const dbAfterTextSave = await openMemoryDb(disk.bytes);
    try {
      for (const table of CHAPTER_VERSION_TABLES) {
        expect(tableNames(dbAfterTextSave.sql).has(table)).toBe(false);
      }
    } finally {
      dbAfterTextSave.close();
    }
  });

  it('未升格新稿：設 dirty 與 contentRev、未存檔前重整自 localStorage 讀回不丟、升格時帶入 FileExtras.chapterVersions', async () => {
    const kv = makeMemoryKeyValueStore();
    let state = createState(new Date('2026-11-26T10:00:00+08:00'));
    state = reduce(state, {
      type: 'add-project',
      id: 'new-ver-book',
      title: '【範例】新稿版本測試',
      shape: 'novel',
    });
    const newProject = state.projects.find((p) => p.id === 'new-ver-book')!;
    const chId = listWritableTargetNodes(newProject.nodes)[0]!.node.id;

    // 還沒存過版本時，狀態為 absent；升格時也不應建立空表
    expect(getProjectChapterVersionRead(state, 'new-ver-book')).toEqual({ kind: 'absent' });
    const revBefore = state.contentRevById?.['new-ver-book'] ?? 0;

    const input1 = sampleVersionInput({
      chapter_id: chId,
      chapter_title_snapshot: '第一章',
      content: '【範例】新稿第一章第一版內容。',
      note: '初稿留存',
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: 'new-ver-book',
      input: input1,
    });

    expect(state.saveMeta['new-ver-book']?.dirtySinceFileSave).toBe(true);
    expect(state.contentRevById?.['new-ver-book']).toBe(revBefore + 1);
    const savedList = getProjectChapterVersions(state, 'new-ver-book');
    expect(savedList).toHaveLength(1);
    expect(savedList[0]!.content).toBe('【範例】新稿第一章第一版內容。');

    // 正文與最新一版相同時重複送出應略過且不增加 contentRevById
    const stateBeforeDup = state;
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: 'new-ver-book',
      input: { ...input1, version_id: '22222222-3333-4444-8555-666666666699' },
    });
    expect(state).toBe(stateBeforeDup);
    expect(state.contentRevById?.['new-ver-book']).toBe(revBefore + 1);

    // 寫入 localStorage（模擬未存成外部檔前重整）
    const stashOk = persistLocalAutoStash({
      store: kv,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      dispatch: (a) => {
        state = reduce(state, a);
      },
      onStashResult: () => undefined,
    });
    expect(stashOk).toBe(true);

    const reloadedProjects = loadProjects(kv);
    const reloadedBook = reloadedProjects?.find((p) => p.id === 'new-ver-book');
    expect(reloadedBook?.manuscriptVersions).toEqual(savedList);

    // 升格成檔案時把版本帶入 FileExtras.chapterVersions，並寫進 .db
    state = reduce(state, {
      type: 'promote-stored',
      projectId: 'new-ver-book',
      key: 'new-ver-key',
      filename: '【範例】新稿版本測試.db',
    });
    expect(state.fileExtras['new-ver-key']?.chapterVersions).toEqual({
      kind: 'ok',
      revision: 1,
      versions: savedList,
    });

    const promoted = state.projects.find((p) => p.id === 'new-ver-book')!;
    const bytes = await manuscriptBytesOn(state, promoted, null);
    const reopened = await readBookBytes('【範例】新稿版本測試.db', bytes, 'reopen-promoted');
    expect(reopened.chapterVersions).toEqual({
      kind: 'ok',
      revision: 1,
      versions: savedList,
    });
  });

  it('檔案稿：立即 persistProjectNow 重整不丟、標記 dirty 與 contentRev、自動存檔／手動儲存／另存再開帶進 .db', async () => {
    const { space } = setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】原檔版本.db', originalBytes);
    const saveAsDisk = new FakeDisk('【範例】另存版本.db', new Uint8Array());
    const { env } = makeFakeEnv({
      canPickFiles: true,
      pickSaveLocation: async () => saveAsDisk,
    });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-26T10:10:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T10:10:00+08:00'),
    });
    const openedProject = state.projects.find((p) => p.id === opened.id)!;
    const chId = listWritableTargetNodes(openedProject.nodes)[0]!.node.id;

    // 1. 手動存一版，立即寫進 App 空間（未外部存檔前重整不丟）
    const input1 = sampleVersionInput({
      chapter_id: chId,
      content: '【範例】海風吹過碼頭，船隻正準備靠岸。',
      note: '第一版備註',
      saved_at_ms: 1_700_000_200_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: input1,
    });
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBe(true);
    expect(state.contentRevById?.[opened.id]).toBe(1);

    const persisted = await persistProjectNow({
      state,
      projectId: opened.id,
      dispatch,
      onStashResult: () => undefined,
      store: kv,
    });
    expect(persisted).toBe(true);
    const storedBeforeAuto = await loadStoredBooks();
    expect(storedBeforeAuto).toHaveLength(1);
    expect(storedBeforeAuto[0]?.chapterVersions?.kind).toBe('ok');
    if (storedBeforeAuto[0]?.chapterVersions?.kind === 'ok') {
      expect(storedBeforeAuto[0].chapterVersions.versions).toHaveLength(1);
      expect(storedBeforeAuto[0].chapterVersions.versions[0]!.note).toBe('第一版備註');
    }

    // 2. 改備註（未變動內容時不額外遞增；實際改變才設 dirty 與 contentRev）
    const stateBeforeSameNote = state;
    state = reduce(state, {
      type: 'chapter-version-update-note',
      projectId: opened.id,
      versionId: input1.version_id,
      note: '第一版備註',
    });
    expect(state).toBe(stateBeforeSameNote);

    state = reduce(state, {
      type: 'chapter-version-update-note',
      projectId: opened.id,
      versionId: input1.version_id,
      note: '修過語氣後的備註',
    });
    expect(state.contentRevById?.[opened.id]).toBe(2);
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBe(true);

    // 3. 電腦 5 分鐘自動存檔帶走版本與更新後備註
    const lastSavedRevById: Record<string, number> = { [opened.id]: 0 };
    const autoOutcome = await executeBackgroundAutoSave({
      projectId: opened.id,
      getState: () => state,
      getStatus: () => 'active',
      lastSavedRevById,
      inflight: { current: null },
      env,
      dispatch,
      store: kv,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      isPreviouslyFailed: () => false,
    });
    expect(autoOutcome).toMatchObject({ kind: 'saved' });
    expect(disk.writes).toBe(1);
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBe(false);

    const reopenedDisk = await readBookBytes(disk.name, disk.bytes, 'verify-auto');
    expect(reopenedDisk.chapterVersions).toMatchObject({
      kind: 'ok',
      revision: 1,
    });
    if (reopenedDisk.chapterVersions?.kind === 'ok') {
      expect(reopenedDisk.chapterVersions.versions).toHaveLength(1);
      expect(reopenedDisk.chapterVersions.versions[0]!.note).toBe('修過語氣後的備註');
    }

    // 4. 另存專案也把版本帶走，另存後重新打開仍完整保留
    const projectAfterAuto = state.projects.find((p) => p.id === opened.id)!;
    const saveAsRes = await runSaveProjectAs({
      state,
      project: projectAfterAuto,
      dispatch,
      env,
      preparedBytes: null,
    });
    expect(saveAsRes.outcome.kind).toBe('saved-as');
    const reopenedSaveAs = await openDatabaseManuscript({
      filename: saveAsDisk.name,
      bytes: saveAsDisk.bytes,
      diskFile: saveAsDisk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T10:05:00+08:00'),
    });
    const reopenedVersions = getProjectChapterVersions(state, reopenedSaveAs.id);
    expect(reopenedVersions).toHaveLength(1);
    expect(reopenedVersions[0]!.content).toBe('【範例】海風吹過碼頭，船隻正準備靠岸。');
    expect(reopenedVersions[0]!.note).toBe('修過語氣後的備註');

    // 5. 丟掉與 10 秒內復原丟掉，以及手動儲存寫進 .db
    const discardedTarget = getProjectChapterVersions(state, opened.id)[0]!;
    state = reduce(state, {
      type: 'chapter-version-discard',
      projectId: opened.id,
      versionId: discardedTarget.version_id,
    });
    expect(getProjectChapterVersions(state, opened.id)).toEqual([]);
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBe(true);
    expect(state.contentRevById?.[opened.id]).toBe(3);

    state = reduce(state, {
      type: 'chapter-version-restore-discarded',
      projectId: opened.id,
      version: discardedTarget,
    });
    expect(getProjectChapterVersions(state, opened.id)).toEqual([discardedTarget]);
    expect(state.contentRevById?.[opened.id]).toBe(4);

    // 聚焦回原檔並手動儲存
    state = reduce(state, { type: 'focus-project', id: opened.id });
    const manualRes = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById,
      onSaved: () => undefined,
      store: kv,
    });
    expect(manualRes?.kind).toBe('saved');
    const reopenedAfterManual = await readBookBytes(disk.name, disk.bytes, 'verify-manual');
    expect(reopenedAfterManual.chapterVersions).toEqual({
      kind: 'ok',
      revision: 1,
      versions: [discardedTarget],
    });

    // 清理本機副本
    for (const proj of [...state.projects]) {
      if (proj.origin !== 'file') continue;
      const ok = await removeProjectFromDevice({
        project: proj,
        store: kv,
        removeCopy: async (key) => space.remove(key),
        removeTarget: async () => undefined,
      });
      expect(ok).toBe(true);
      state = reduce(state, { type: 'remove-project', id: proj.id });
    }
    expect(await loadStoredBooks()).toEqual([]);
  });

  it('四態唯讀保護：newer-revision 與 corrupt 拒絕修改版本資料，正文仍可存，verifyBytesForSave 僅擋 corrupt', async () => {
    setupMemoryAppSpace();
    const raw = await generateDesktopSampleBytes();
    const seededVersion = createManuscriptVersion(
      sampleVersionInput({
        version_id: '22222222-3333-4444-8555-666666666611',
        chapter_id: 'ch-sample-doc-1',
        content: '【範例】既有的版本內容。',
        note: '原有備註',
        saved_at_ms: 1_700_000_300_000,
      }),
    );
    const withVersions = await writeBookWithVersions(raw, [seededVersion]);

    // 1. newer-revision（format_revision = 2）：verifyBytesForSave 放行，版本唯讀，正文仍可寫回 .db 且原表不動
    const newerBytes = await mutateBytes(withVersions, (sql) => {
      sql.exec(`UPDATE ${CHAPTER_VERSION_META_TABLE} SET format_revision = 2`);
    });
    await expect(verifyBytesForSave(newerBytes)).resolves.toBeUndefined();

    const newerDisk = new FakeDisk('【範例】較新版本.db', newerBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();
    let state = createState(new Date('2026-11-26T10:20:00+08:00'));
    const dispatch = (a: Action) => {
      state = reduce(state, a);
    };

    const openedNewer = await openDatabaseManuscript({
      filename: newerDisk.name,
      bytes: newerBytes,
      diskFile: newerDisk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T10:20:00+08:00'),
    });
    expect(getProjectChapterVersionRead(state, openedNewer.id)).toEqual({
      kind: 'newer-revision',
      revision: 2,
    });
    expect(isProjectChapterVersionsReadOnly(state, openedNewer.id)).toBe(true);
    expect(getProjectChapterVersions(state, openedNewer.id)).toEqual([]);

    // 所有版本修改動作皆應被拒絕（回傳原 state、不設 dirty、不增 contentRev）
    const stateBeforeMutate = state;
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: openedNewer.id,
      input: sampleVersionInput({ version_id: 'should-not-save', content: '【範例】不應寫入' }),
    });
    state = reduce(state, {
      type: 'chapter-version-save-auto-before-restore',
      projectId: openedNewer.id,
      input: sampleVersionInput({ version_id: 'should-not-auto', content: '【範例】不應寫入' }),
    });
    state = reduce(state, {
      type: 'chapter-version-update-note',
      projectId: openedNewer.id,
      versionId: seededVersion.version_id,
      note: '不應改寫',
    });
    state = reduce(state, {
      type: 'chapter-version-discard',
      projectId: openedNewer.id,
      versionId: seededVersion.version_id,
    });
    state = reduce(state, {
      type: 'chapter-version-restore-discarded',
      projectId: openedNewer.id,
      version: seededVersion,
    });
    expect(state).toBe(stateBeforeMutate);

    // 正文仍可編輯並存進 .db，且不破壞 format_revision = 2 的版本表
    const newerProject = state.projects.find((p) => p.id === openedNewer.id)!;
    const chId = listWritableTargetNodes(newerProject.nodes)[0]!.node.id;
    expect(manuscriptSnapshotParts(state, newerProject).chapterVersions).toBeUndefined();

    state = reduce(state, { type: 'focus-project', id: openedNewer.id });
    state = reduce(state, {
      type: 'commit-text',
      projectId: openedNewer.id,
      nodeId: chId,
      text: '【範例】在 newer-revision 下仍可正常更新正文並存檔。',
    });
    const manualRes = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: { [openedNewer.id]: 0 },
      onSaved: () => undefined,
      store: kv,
    });
    expect(manualRes?.kind).toBe('saved');
    expect(newerDisk.writes).toBe(1);

    const dbAfterNewerSave = await openMemoryDb(newerDisk.bytes);
    try {
      const loaded = readFileProject(dbAfterNewerSave.sql);
      expect(loaded.chapterVersions).toEqual({ kind: 'newer-revision', revision: 2 });
      expect(findNode(loaded.tree, chId)?.content).toBe(
        '【範例】在 newer-revision 下仍可正常更新正文並存檔。',
      );
      const rawRow = dbAfterNewerSave.sql.select(
        `SELECT content, note FROM ${CHAPTER_VERSIONS_TABLE} WHERE version_id = ?`,
        [seededVersion.version_id],
      );
      expect(rawRow).toEqual([{ content: '【範例】既有的版本內容。', note: '原有備註' }]);
    } finally {
      dbAfterNewerSave.close();
    }

    // 2. corrupt：verifyBytesForSave 擋下外部存檔；開檔不擋正文、版本唯讀、正文仍可暫存於 App 空間且不覆寫損壞表
    const corruptBytes = await mutateBytes(withVersions, (sql) => {
      sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET word_count = -5`);
    });
    await expect(verifyBytesForSave(corruptBytes)).rejects.toThrow(ChapterVersionDataError);

    const openedCorrupt = await openDatabaseManuscript({
      filename: '【範例】損壞版本表.db',
      bytes: corruptBytes,
      diskFile: null,
      dispatch,
      env: makeFakeEnv({ canPickFiles: false }).env,
      store: kv,
      now: new Date('2026-11-26T10:25:00+08:00'),
    });
    expect(getProjectChapterVersionRead(state, openedCorrupt.id).kind).toBe('corrupt');
    expect(isProjectChapterVersionsReadOnly(state, openedCorrupt.id)).toBe(true);
    expect(getProjectChapterVersions(state, openedCorrupt.id)).toEqual([]);

    const stateBeforeCorruptMutate = state;
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: openedCorrupt.id,
      input: sampleVersionInput({ version_id: 'should-not-save-corrupt' }),
    });
    expect(state).toBe(stateBeforeCorruptMutate);

    state = reduce(state, { type: 'focus-project', id: openedCorrupt.id });
    state = reduce(state, {
      type: 'commit-text',
      projectId: openedCorrupt.id,
      nodeId: chId,
      text: '【範例】版本表損壞時，正文仍可寫入本機暫存。',
    });
    const corruptProject = state.projects.find((p) => p.id === openedCorrupt.id)!;
    expect(manuscriptSnapshotParts(state, corruptProject).chapterVersions).toBeUndefined();
    const corruptPersisted = await persistProjectNow({
      state,
      projectId: openedCorrupt.id,
      dispatch,
      onStashResult: () => undefined,
      store: kv,
    });
    expect(corruptPersisted).toBe(true);

    const storedBooks = await loadStoredBooks();
    const corruptStored = storedBooks.find((b) => b.key === corruptProject.dbKey)!;
    expect(corruptStored.chapterVersions?.kind).toBe('corrupt');
    expect(findNode(corruptStored.tree, chId)?.content).toBe(
      '【範例】版本表損壞時，正文仍可寫入本機暫存。',
    );
  });

  it('今日字數在「今日 0 字」與「今日已有進度」兩種狀態下，存成版本、自動保存、改備註、丟掉、復原丟掉皆不增減今日字數，只有真正新打的字才算', async () => {
    const now = new Date('2026-11-26T10:30:00+08:00');
    const todayKey = writingDayKey(now, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    setupMemoryAppSpace();
    try {
      const originalBytes = await generateDesktopSampleBytes();
      const disk = new FakeDisk('【範例】今日字數版本.db', originalBytes);
      const { env } = makeFakeEnv({ canPickFiles: true });
      const kv = makeMemoryKeyValueStore();

      let state = createState(now);
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };

      const opened = await openDatabaseManuscript({
        filename: disk.name,
        bytes: originalBytes,
        diskFile: disk,
        dispatch,
        env,
        store: kv,
        now,
      });
      state = reduce(state, { type: 'focus-project', id: opened.id });
      const openedProject = state.projects.find((p) => p.id === opened.id)!;
      const chId = listWritableTargetNodes(openedProject.nodes)[0]!.node.id;

      // 預置既有的 120 字舊文（countForToday: false，模擬今日 0 字起點）
      const oldBody = '【範例】' + '霧'.repeat(116);
      state = reduce(state, {
        type: 'commit-text',
        projectId: opened.id,
        nodeId: chId,
        text: oldBody,
        countForToday: false,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      // 狀態 1：今日 0 字時，存成版本、改備註、丟掉、復原丟掉、自動保存皆不改今日字數
      const v1Input = sampleVersionInput({
        version_id: '22222222-3333-4444-8555-666666666621',
        chapter_id: chId,
        content: oldBody,
        note: '今日零字存版',
        saved_at_ms: now.getTime(),
      });
      state = reduce(state, {
        type: 'chapter-version-save-manual',
        projectId: opened.id,
        input: v1Input,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      state = reduce(state, {
        type: 'chapter-version-update-note',
        projectId: opened.id,
        versionId: v1Input.version_id,
        note: '改過備註',
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      const v1 = getProjectChapterVersions(state, opened.id)[0]!;
      state = reduce(state, {
        type: 'chapter-version-discard',
        projectId: opened.id,
        versionId: v1.version_id,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      state = reduce(state, {
        type: 'chapter-version-restore-discarded',
        projectId: opened.id,
        version: v1,
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      // 自動保存（不同正文模擬前情）也不動今日字數
      state = reduce(state, {
        type: 'chapter-version-save-auto-before-restore',
        projectId: opened.id,
        input: {
          version_id: '22222222-3333-4444-8555-666666666622',
          chapter_id: chId,
          chapter_title_snapshot: '第一章',
          content: oldBody + '舊',
          note: MANUSCRIPT_VERSION_AUTO_NOTE,
          saved_at_ms: now.getTime() + 1000,
        },
      });
      expect(state.schedule.open?.wordCount).toBe(0);

      // 狀態 2：今日已有進度（真正新打 35 字）
      const withToday35 = oldBody + '新'.repeat(35);
      state = reduce(state, {
        type: 'commit-text',
        projectId: opened.id,
        nodeId: chId,
        text: withToday35,
      });
      expect(state.schedule.open?.wordCount).toBe(35);

      const v2Input = sampleVersionInput({
        version_id: '22222222-3333-4444-8555-666666666623',
        chapter_id: chId,
        content: withToday35,
        note: '今日有進度後存版',
        saved_at_ms: now.getTime() + 2000,
      });
      state = reduce(state, {
        type: 'chapter-version-save-manual',
        projectId: opened.id,
        input: v2Input,
      });
      expect(state.schedule.open?.wordCount).toBe(35);

      state = reduce(state, {
        type: 'chapter-version-update-note',
        projectId: opened.id,
        versionId: v2Input.version_id,
        note: '更新今日進度後備註',
      });
      expect(state.schedule.open?.wordCount).toBe(35);

      const v2 = getProjectChapterVersions(state, opened.id).find(
        (v) => v.version_id === v2Input.version_id,
      )!;
      state = reduce(state, {
        type: 'chapter-version-discard',
        projectId: opened.id,
        versionId: v2.version_id,
      });
      expect(state.schedule.open?.wordCount).toBe(35);

      state = reduce(state, {
        type: 'chapter-version-restore-discarded',
        projectId: opened.id,
        version: v2,
      });
      expect(state.schedule.open?.wordCount).toBe(35);

      // 只有真正新打的字（再加 10 字）才計入今日字數
      state = reduce(state, {
        type: 'commit-text',
        projectId: opened.id,
        nodeId: chId,
        text: withToday35 + '字'.repeat(10),
      });
      expect(state.schedule.open?.wordCount).toBe(45);

      // 存進 .db 後確認 writing_logs 今日字數精確為 45
      const saved = await runManualSaveProject({
        getState: () => state,
        dispatch,
        env,
        inflight: { current: null },
        lastSavedRevById: { [opened.id]: 0 },
        onSaved: () => undefined,
        store: kv,
      });
      expect(saved?.kind).toBe('saved');
      const reopened = await readBookBytes(disk.name, disk.bytes, 'verify-wc');
      expect(reopened.logs.find((l) => l.date === todayKey)?.word_count).toBe(45);
    } finally {
      vi.useRealTimers();
    }
  });

  it('刪掉整章（set-nodes）不刪除該章的版本紀錄，救回原章節後版本仍在（決-3）', () => {
    let state = createState(new Date('2026-11-26T10:00:00+08:00'));
    state = reduce(state, {
      type: 'add-project',
      id: 'del-ch-book',
      title: '【範例】刪章留版本',
      shape: 'novel',
    });
    const proj = state.projects.find((p) => p.id === 'del-ch-book')!;
    const originalNodes = proj.nodes;
    const chId = listWritableTargetNodes(originalNodes)[0]!.node.id;

    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: 'del-ch-book',
      input: sampleVersionInput({
        version_id: '22222222-3333-4444-8555-666666666631',
        chapter_id: chId,
        content: '【範例】被刪章的珍貴舊版。',
        note: '留著',
      }),
    });
    expect(getProjectChapterVersions(state, 'del-ch-book')).toHaveLength(1);

    // 刪掉該章（nodes 清空）
    state = reduce(state, {
      type: 'set-nodes',
      projectId: 'del-ch-book',
      nodes: [],
    });
    expect(getProjectChapterVersions(state, 'del-ch-book')).toHaveLength(1);

    // 救回原章節（相同 node.id）後版本依然對得回來
    state = reduce(state, {
      type: 'set-nodes',
      projectId: 'del-ch-book',
      nodes: originalNodes,
    });
    const versions = getProjectChapterVersions(state, 'del-ch-book');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.chapter_id).toBe(chId);
    expect(versions[0]!.content).toBe('【範例】被刪章的珍貴舊版。');
  });
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

describe('WO-140 第 6 段：刪章救回回歸、上限互動與四功能共存驗證', () => {
  it('刪掉整章（不重開：10 秒刪除復原與最近刪除救回）→ 原章所有版本、備註、時間皆完整仍在，且不自動清孤兒列', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】刪章不重開.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();
    const archive = createMemoryArchiveClient();

    let state = createState(new Date('2026-11-26T14:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T14:00:00+08:00'),
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });

    const targets = listWritableTargetNodes(state.projects.find((p) => p.id === opened.id)!.nodes);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const targetChapter = targets[0]!.node;
    const otherChapter = targets[1]!.node;

    // 幫目標章存下 3 筆版本（手寫備註、空白備註、自動保存）與 1 筆別章版本
    const expectedTargetVersions: ManuscriptVersion[] = [
      createManuscriptVersion({
        version_id: '33333333-4444-4555-8666-000000000001',
        chapter_id: targetChapter.id,
        chapter_title_snapshot: targetChapter.title,
        content: '【範例】霧港第一章第一版',
        note: '大改前初稿',
        source: 'manual',
        saved_at_ms: 1_764_130_001_000,
        sort_order: 0,
      }),
      createManuscriptVersion({
        version_id: '33333333-4444-4555-8666-000000000002',
        chapter_id: targetChapter.id,
        chapter_title_snapshot: targetChapter.title,
        content: '【範例】霧港第一章第二版（無備註）',
        note: '',
        source: 'manual',
        saved_at_ms: 1_764_130_002_000,
        sort_order: 0,
      }),
      createManuscriptVersion({
        version_id: '33333333-4444-4555-8666-000000000003',
        chapter_id: targetChapter.id,
        chapter_title_snapshot: targetChapter.title,
        content: '【範例】霧港第一章第三版（自動保存）',
        note: MANUSCRIPT_VERSION_AUTO_NOTE,
        source: 'auto-before-restore',
        saved_at_ms: 1_764_130_003_000,
        sort_order: 0,
      }),
    ];

    for (const ver of expectedTargetVersions) {
      state = reduce(state, {
        type: ver.source === 'auto-before-restore'
          ? 'chapter-version-save-auto-before-restore'
          : 'chapter-version-save-manual',
        projectId: opened.id,
        input: ver,
      });
    }
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: sampleVersionInput({
        version_id: '33333333-4444-4555-8666-000000000099',
        chapter_id: otherChapter.id,
        chapter_title_snapshot: otherChapter.title,
        content: '【範例】第二章保留不動的版本',
        note: '他章版本',
        saved_at_ms: 1_764_130_004_000,
      }),
    });
    // 設定一張屬於該章的復原提示快照，驗證刪章會清掉提示但不刪版本列
    state = reduce(state, {
      type: 'chapter-version-set-restore-undo',
      snapshot: {
        projectId: opened.id,
        chapterId: targetChapter.id,
        targetVersionId: expectedTargetVersions[0]!.version_id,
        autoSavedVersionId: expectedTargetVersions[2]!.version_id,
        beforeContent: expectedTargetVersions[2]!.content,
        afterContent: expectedTargetVersions[0]!.content,
      },
    });

    // 1. 刪掉整章（同時寫入最近刪除 archive，比照 WriteScreen.removeNode）
    const nodesBeforeDelete = state.projects.find((p) => p.id === opened.id)!.nodes;
    const whenDelete = 1_764_130_100_000;
    const deletedRecord = deletedFromNode(
      nodesBeforeDelete,
      targetChapter.id,
      whenDelete,
      `del-${whenDelete}-${targetChapter.id}`,
    )!;
    expect(deletedRecord).not.toBeNull();
    await archive.update(
      opened.id,
      (curr) => archiveDeletion(curr, deletedRecord, versionsForNode(deletedRecord.node, whenDelete)),
      'delete',
    );
    const nodesAfterDelete = withoutNode(nodesBeforeDelete, targetChapter.id)!;
    state = reduce(state, { type: 'set-nodes', projectId: opened.id, nodes: nodesAfterDelete });

    expect(findNode(state.projects.find((p) => p.id === opened.id)!.nodes, targetChapter.id)).toBeNull();
    expect(state.versionRestoreUndo).toBeNull();
    // 決-3：不自動清掉孤兒版本列，且只看別章時不會出現已刪章版本
    const allWhileDeleted = getProjectChapterVersions(state, opened.id);
    expect(allWhileDeleted).toHaveLength(4);
    expect(versionsForChapter(allWhileDeleted, targetChapter.id)).toHaveLength(3);
    expect(versionsForChapter(allWhileDeleted, otherChapter.id)).toHaveLength(1);
    expect((await archive.read(opened.id)).deleted).toHaveLength(1);

    // 2. 10 秒刪除復原救回同一章（nodesAfterDeleteUndo + restoreDeletedChapterWithArchive）
    const undoNodes = expandToNode(
      nodesAfterDeleteUndo(nodesAfterDelete, { snapshot: [], deleted: deletedRecord }),
      targetChapter.id,
    );
    const undoOutcome = await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId: opened.id,
      record: deletedRecord,
      nodes: undoNodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId: opened.id,
          dispatch,
          onStashResult: () => undefined,
          store: kv,
        }),
    });
    expect(undoOutcome.persisted).toBe(true);
    expect((await archive.read(opened.id)).deleted).toEqual([]);
    expect(findNode(state.projects.find((p) => p.id === opened.id)!.nodes, targetChapter.id)?.title).toBe(
      targetChapter.title,
    );

    const recoveredVersions = versionsForChapter(
      getProjectChapterVersions(state, opened.id),
      targetChapter.id,
    );
    expect(recoveredVersions).toEqual([
      expectedTargetVersions[2],
      expectedTargetVersions[1],
      expectedTargetVersions[0],
    ]);
  });

  it('刪掉整章後存檔進 .db 並關閉重開 → 從「最近刪除」救回同一章 → 原章所有版本、備註、時間皆完整仍在（含未升格新稿重整）', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】刪章存檔重開.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();
    const archive = createMemoryArchiveClient();

    let state = createState(new Date('2026-11-26T14:10:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T14:10:00+08:00'),
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });

    const targets = listWritableTargetNodes(state.projects.find((p) => p.id === opened.id)!.nodes);
    const targetChapter = targets[0]!.node;
    const savedV1 = createManuscriptVersion({
      version_id: '33333333-4444-4555-8666-000000000101',
      chapter_id: targetChapter.id,
      chapter_title_snapshot: targetChapter.title,
      content: '【範例】刪章存檔前第一版',
      note: '轉折前備份',
      source: 'manual',
      saved_at_ms: 1_764_131_001_000,
      sort_order: 0,
    });
    const savedV2 = createManuscriptVersion({
      version_id: '33333333-4444-4555-8666-000000000102',
      chapter_id: targetChapter.id,
      chapter_title_snapshot: targetChapter.title,
      content: '【範例】刪章存檔前第二版',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
      source: 'auto-before-restore',
      saved_at_ms: 1_764_131_002_000,
      sort_order: 1,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: savedV1,
    });
    state = reduce(state, {
      type: 'chapter-version-save-auto-before-restore',
      projectId: opened.id,
      input: savedV2,
    });

    // 刪掉整章並記進「最近刪除」，接著寫進 .db（模擬刪章後先存檔關閉）
    const nodesBeforeDelete = state.projects.find((p) => p.id === opened.id)!.nodes;
    const deletedRecord = deletedFromNode(
      nodesBeforeDelete,
      targetChapter.id,
      1_764_131_050_000,
      'del-persist-reopen',
    )!;
    await archive.update(
      opened.id,
      (curr) => archiveDeletion(curr, deletedRecord, versionsForNode(deletedRecord.node, 1_764_131_050_000)),
      'delete',
    );
    state = reduce(state, {
      type: 'set-nodes',
      projectId: opened.id,
      nodes: withoutNode(nodesBeforeDelete, targetChapter.id)!,
    });

    const savedWhileDeleted = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: { [opened.id]: 0 },
      onSaved: () => undefined,
      store: kv,
    });
    expect(savedWhileDeleted?.kind).toBe('saved');

    // 直接檢查寫進 .db 的內容：chapters 已無該章，但 jiufangm_chapter_versions 仍原樣留著原 chapter_id
    const dbWhileDeleted = await openMemoryDb(disk.bytes);
    try {
      const fileLoaded = readFileProject(dbWhileDeleted.sql);
      expect(findNode(fileLoaded.tree, targetChapter.id)).toBeNull();
      expect(fileLoaded.chapterVersions).toEqual({
        kind: 'ok',
        revision: 1,
        versions: [savedV2, savedV1],
      });
    } finally {
      dbWhileDeleted.close();
    }

    // 模擬關閉 App 後重新打開該 .db（建立全新 state）
    let reopenedState = createState(new Date('2026-11-26T14:20:00+08:00'));
    const reopenedDispatch = (action: Action) => {
      reopenedState = reduce(reopenedState, action);
    };
    const reopened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: disk.bytes,
      diskFile: disk,
      dispatch: reopenedDispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T14:20:00+08:00'),
    });
    reopenedState = reduce(reopenedState, { type: 'focus-project', id: reopened.id });
    expect(findNode(reopenedState.projects.find((p) => p.id === reopened.id)!.nodes, targetChapter.id)).toBeNull();
    expect(getProjectChapterVersions(reopenedState, reopened.id)).toEqual([savedV2, savedV1]);

    // 從「最近刪除」救回同一章（注意打開 .db 後以 bookArchive[id] 對應；此處沿用原 bookId/opened.id 模擬同一本書的最近刪除紀錄）
    const deletedList = (await archive.read(opened.id)).deleted;
    expect(deletedList).toHaveLength(1);
    const currentNodes = reopenedState.projects.find((p) => p.id === reopened.id)!.nodes;
    const placedNodes = expandToNode(placeRecovered(currentNodes, deletedList[0]!, false), targetChapter.id);
    const recoverOutcome = await restoreDeletedChapterWithArchive({
      state: reopenedState,
      dispatch: reopenedDispatch,
      projectId: reopened.id,
      record: deletedList[0]!,
      nodes: placedNodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId: reopened.id,
          dispatch: reopenedDispatch,
          onStashResult: () => undefined,
          store: kv,
        }),
    });
    expect(recoverOutcome.persisted).toBe(true);
    expect(findNode(reopenedState.projects.find((p) => p.id === reopened.id)!.nodes, targetChapter.id)).not.toBeNull();
    expect(
      versionsForChapter(getProjectChapterVersions(reopenedState, reopened.id), targetChapter.id),
    ).toEqual([savedV2, savedV1]);

    // 再存回 .db 並檢查重開後依然一致
    const resaved = await runManualSaveProject({
      getState: () => reopenedState,
      dispatch: reopenedDispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: { [reopened.id]: 0 },
      onSaved: () => undefined,
      store: kv,
    });
    expect(resaved?.kind).toBe('saved');
    const reopenedFinal = await readBookBytes(disk.name, disk.bytes, 'verify-recovered-final');
    expect(findNode(reopenedFinal.tree, targetChapter.id)?.title).toBe(targetChapter.title);
    expect(reopenedFinal.chapterVersions).toEqual({
      kind: 'ok',
      revision: 1,
      versions: [savedV2, savedV1],
    });

    // 補充驗證：未升格新稿刪章後經 localStorage 重整，再從「最近刪除」救回同一章，版本亦完整仍在
    let localState = createState(new Date('2026-11-26T14:25:00+08:00'));
    localState = reduce(localState, {
      type: 'add-project',
      id: 'local-del-reopen',
      title: '【範例】未升格刪章重整',
      shape: 'novel',
    });
    const localNodes = localState.projects.find((p) => p.id === 'local-del-reopen')!.nodes;
    const localCh = listWritableTargetNodes(localNodes)[0]!.node;
    const localVer = createManuscriptVersion({
      version_id: '33333333-4444-4555-8666-000000000109',
      chapter_id: localCh.id,
      chapter_title_snapshot: localCh.title,
      content: '【範例】未升格新稿被刪章的版本',
      note: '本地留存',
      source: 'manual',
      saved_at_ms: 1_764_131_200_000,
    });
    localState = reduce(localState, {
      type: 'chapter-version-save-manual',
      projectId: 'local-del-reopen',
      input: localVer,
    });
    const localDeleted = deletedFromNode(localNodes, localCh.id, 1_764_131_300_000, 'del-local')!;
    localState = reduce(localState, {
      type: 'set-nodes',
      projectId: 'local-del-reopen',
      nodes: withoutNode(localNodes, localCh.id)!,
    });
    persistLocalAutoStash({
      store: kv,
      projects: localState.projects,
      activeProjectId: localState.activeProjectId,
      dispatch: (a) => {
        localState = reduce(localState, a);
      },
      onStashResult: () => undefined,
    });
    const reloadedLocal = loadProjects(kv)!.find((p) => p.id === 'local-del-reopen')!;
    expect(reloadedLocal.manuscriptVersions).toEqual([localVer]);
    const localRecovered = expandToNode(
      placeRecovered(reloadedLocal.nodes, localDeleted, false),
      localCh.id,
    );
    expect(findNode(localRecovered, localCh.id)).not.toBeNull();
    expect(versionsForChapter(reloadedLocal.manuscriptVersions ?? [], localCh.id)).toEqual([localVer]);
  });

  it('滿 20 份清理規則、20 份全手寫阻止手動存、回到舊版暫留第 21 份與提醒、連續還原不無限膨脹（store + flow + .db + Sheet）', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】上限互動測試.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-26T14:30:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T14:30:00+08:00'),
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });
    const targets = listWritableTargetNodes(state.projects.find((p) => p.id === opened.id)!.nodes);
    const chA = targets[0]!.node;
    const chB = targets[1]!.node;

    // 在他章 B 存 1 份版本，確保後續滿限與清理都不會波及他章
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: sampleVersionInput({
        version_id: '44444444-5555-4666-8777-0000000000b1',
        chapter_id: chB.id,
        chapter_title_snapshot: chB.title,
        content: '【範例】章 B 保護測試',
        note: '章B備註',
        saved_at_ms: 1_764_132_000_000,
      }),
    });

    // 1. 構造章 A 滿 20 份：第 1 份有手寫備註、第 2 份自動保存、第 3 份無備註手動、第 4～20 份皆手寫備註
    for (let i = 1; i <= MANUSCRIPT_VERSION_CHAPTER_LIMIT; i += 1) {
      const id = `44444444-5555-4666-8777-${String(i).padStart(12, '0')}`;
      const savedAt = 1_764_132_000_000 + i * 1_000;
      if (i === 2) {
        state = reduce(state, {
          type: 'chapter-version-save-auto-before-restore',
          projectId: opened.id,
          input: {
            version_id: id,
            chapter_id: chA.id,
            chapter_title_snapshot: chA.title,
            content: `【範例】章 A 第 ${i} 份自動保存`,
            note: MANUSCRIPT_VERSION_AUTO_NOTE,
            saved_at_ms: savedAt,
          },
        });
      } else {
        state = reduce(state, {
          type: 'chapter-version-save-manual',
          projectId: opened.id,
          input: {
            version_id: id,
            chapter_id: chA.id,
            chapter_title_snapshot: chA.title,
            content: `【範例】章 A 第 ${i} 份正文`,
            note: i === 3 ? '' : `手寫備註 ${i}`,
            saved_at_ms: savedAt,
          },
        });
      }
    }
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id)).toHaveLength(20);

    // 手動存第 21 份：先清掉第 2 份（最舊且無手寫保護的自動保存），第 1 份手寫保留
    const manualInput21 = {
      version_id: '44444444-5555-4666-8777-000000000021',
      chapter_id: chA.id,
      chapter_title_snapshot: chA.title,
      content: '【範例】章 A 新手動版 21',
      note: '新手寫備註 21',
      saved_at_ms: 1_764_132_100_000,
    };
    const saveRes21 = saveManualVersion(getProjectChapterVersions(state, opened.id), manualInput21);
    expect(saveRes21.kind).toBe('saved');
    if (saveRes21.kind === 'saved') {
      expect(saveRes21.noticeCode).toBe('saved-evicted-oldest');
      expect(saveRes21.evictedVersions.map((v) => v.version_id)).toEqual([
        '44444444-5555-4666-8777-000000000002',
      ]);
    }
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: manualInput21,
    });
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id)).toHaveLength(20);
    expect(
      getProjectChapterVersions(state, opened.id).some(
        (v) => v.version_id === '44444444-5555-4666-8777-000000000001',
      ),
    ).toBe(true);

    // 再手動存第 22 份：清掉第 3 份（無備註手動版），現在 20 份全都有手寫備註
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: {
        version_id: '44444444-5555-4666-8777-000000000022',
        chapter_id: chA.id,
        chapter_title_snapshot: chA.title,
        content: '【範例】章 A 新手動版 22',
        note: '新手寫備註 22',
        saved_at_ms: 1_764_132_101_000,
      },
    });
    const full20Versions = versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id);
    expect(full20Versions).toHaveLength(20);
    expect(full20Versions.every((v) => v.source === 'manual' && v.note.trim() !== '')).toBe(true);

    // 2. 20 份全手寫時阻止手動存（blocked-full），不改 state、不增 contentRevById
    const blockedInput = {
      version_id: '44444444-5555-4666-8777-000000000023',
      chapter_id: chA.id,
      chapter_title_snapshot: chA.title,
      content: '【範例】應被擋下的第 23 版',
      note: '無法存入',
      saved_at_ms: 1_764_132_102_000,
    };
    const blockedCheck = saveManualVersion(getProjectChapterVersions(state, opened.id), blockedInput);
    expect(blockedCheck.kind).toBe('blocked-full');
    if (blockedCheck.kind === 'blocked-full') {
      expect(blockedCheck.reasonCode).toBe('all-manual-noted-full');
    }
    const revBeforeBlocked = state.contentRevById?.[opened.id] ?? 0;
    const stateBeforeBlocked = state;
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: blockedInput,
    });
    expect(state).toBe(stateBeforeBlocked);
    expect(state.contentRevById?.[opened.id]).toBe(revBeforeBlocked);

    // 驗證第 5 段對應文案仍齊備（供 UI 提示使用）
    expect(VERSION_EVICTED_HINT).toContain('已滿 20 份');
    expect(VERSION_FULL_LOCKED_HINT).toContain('都有備註');
    expect(VERSION_RESTORE_OVER_LIMIT_TOAST).toContain('暫時多留一份自動保存');

    // 3. 20 份全手寫時「回到舊版」暫留第 21 份並提醒，且連續還原不無限膨脹
    let liveBody = '【範例】章 A 目前正在寫的新草稿（第一輪）';
    state = reduce(state, {
      type: 'commit-text',
      projectId: opened.id,
      nodeId: chA.id,
      text: liveBody,
      countForToday: false,
    });

    const makeRestoreDeps = (): VersionRestoreFlowDeps => ({
      getNodes: () => state.projects.find((p) => p.id === opened.id)?.nodes ?? null,
      readLive: () => liveBody,
      isComposing: () => false,
      isReadOnly: () => isProjectChapterVersionsReadOnly(state, opened.id),
      getCurrentProjectId: () => state.activeProjectId,
      getCurrentChapterId: () => chA.id,
      saveAutoBeforeRestore: async (input) => {
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
            store: kv,
          });
          return { ...result, persisted };
        }
        state = reduce(state, {
          type: 'chapter-version-save-auto-before-restore',
          projectId: opened.id,
          input: fullInput,
        });
        const persisted = await persistProjectNow({
          state,
          projectId: opened.id,
          dispatch,
          onStashResult: () => undefined,
          store: kv,
        });
        return { ...result, persisted };
      },
      replaceText: (next, _caret, options) => {
        state = reduce(state, {
          type: 'commit-text',
          projectId: opened.id,
          nodeId: chA.id,
          text: liveBody,
        });
        liveBody = next;
        state = reduce(state, {
          type: 'commit-text',
          projectId: opened.id,
          nodeId: chA.id,
          text: next,
          ...(options?.countForToday !== undefined ? { countForToday: options.countForToday } : {}),
        });
        return true;
      },
      setRestoreUndo: (snapshot) =>
        dispatch({ type: 'chapter-version-set-restore-undo', snapshot }),
      clearRestoreUndo: () => dispatch({ type: 'chapter-version-clear-restore-undo' }),
    });

    const targetOld = full20Versions[full20Versions.length - 1]!;
    const restore1 = await executeVersionRestore(makeRestoreDeps(), {
      projectId: opened.id,
      currentId: chA.id,
      openedProjectId: opened.id,
      openedChapterId: chA.id,
      targetVersion: targetOld,
    });
    expect(restore1.status).toBe('restored');
    if (restore1.status !== 'restored') return;
    expect(restore1.overLimit).toBe(true);
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id)).toHaveLength(21);

    // 確認版本 Sheet 在 21 份時顯示 21／20 份與暫留整理提醒
    const sheetOverLimitHtml = renderToStaticMarkup(
      createElement(ManuscriptVersionSheet, {
        open: true,
        projectId: opened.id,
        chapterId: chA.id,
        chapterTitle: chA.title,
        versions: versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id),
        versionRead: getProjectChapterVersionRead(state, opened.id),
        layoutMode: 'phone-portrait',
        isComposing: () => false,
        onClose: () => undefined,
        onSaveVersion: async () => ({ kind: 'blocked-full' }) as const,
        onUpdateNote: async () => ({ kind: 'updated' }) as const,
        onDiscard: async () => ({ kind: 'discarded' }) as const,
        onUndoDiscard: async () => ({ kind: 'restored' }) as const,
        onRestoreVersion: async () => ({ status: 'no-target' }) as const,
      }),
    );
    expect(sheetOverLimitHtml).toContain('這一章已存 21／20 份');
    expect(sheetOverLimitHtml).toContain(VERSION_OVER_LIMIT_HINT);

    // 按「復原」後保留該自動保存；接著在該章再改字並連續還原第 2、3 次，數量收斂在 21 不會變 22、23
    expect(
      executeVersionRestoreUndo(makeRestoreDeps(), {
        projectId: opened.id,
        currentId: chA.id,
        snapshot: state.versionRestoreUndo,
      }).status,
    ).toBe('restored');
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id)).toHaveLength(21);

    for (const round of [2, 3]) {
      liveBody = `【範例】章 A 第 ${round} 輪修改後的內容`;
      state = reduce(state, {
        type: 'commit-text',
        projectId: opened.id,
        nodeId: chA.id,
        text: liveBody,
        countForToday: false,
      });
      const res = await executeVersionRestore(makeRestoreDeps(), {
        projectId: opened.id,
        currentId: chA.id,
        openedProjectId: opened.id,
        openedChapterId: chA.id,
        targetVersion: targetOld,
      });
      expect(res.status).toBe('restored');
      if (res.status === 'restored') {
        expect(res.overLimit).toBe(true);
      }
      const currentChAVersions = versionsForChapter(
        getProjectChapterVersions(state, opened.id),
        chA.id,
      );
      expect(currentChAVersions).toHaveLength(21);
      expect(
        currentChAVersions.filter((v) => v.source === 'auto-before-restore').map((v) => v.content),
      ).toEqual([`【範例】章 A 第 ${round} 輪修改後的內容`]);
    }

    // 寫進 .db 並重開後維持 21 份且通過存檔檢驗，章 B 的 1 份仍完好
    const savedOverLimit = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: { [opened.id]: 0 },
      onSaved: () => undefined,
      store: kv,
    });
    expect(savedOverLimit?.kind).toBe('saved');
    await expect(verifyBytesForSave(disk.bytes)).resolves.toBeUndefined();

    const reopened = await readBookBytes(disk.name, disk.bytes, 'verify-21-converge');
    expect(reopened.chapterVersions?.kind).toBe('ok');
    if (reopened.chapterVersions?.kind === 'ok') {
      expect(versionsForChapter(reopened.chapterVersions.versions, chA.id)).toHaveLength(21);
      expect(versionsForChapter(reopened.chapterVersions.versions, chB.id)).toHaveLength(1);
    }

    // 整理丟掉其中 1 份手寫版本後即恢復 20 份（19 手寫 + 1 自動保存）
    state = reduce(state, {
      type: 'chapter-version-discard',
      projectId: opened.id,
      versionId: full20Versions[0]!.version_id,
    });
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chA.id)).toHaveLength(20);
  });

  it('四功能共存回歸：「找回舊版」「最近刪除」「刪稿暫存區」與本單「版本」並存於同稿，既有行為與資料完全不受影響', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const baseDb = await openMemoryDb(originalBytes);
    const baseSnapshots = snapshotFingerprints(baseDb.sql);
    baseDb.close();

    const disk = new FakeDisk('【範例】四功能共存.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();
    const archive = createMemoryArchiveClient();

    let state = createState(new Date('2026-11-26T14:35:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };
    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T14:35:00+08:00'),
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });

    const targets = listWritableTargetNodes(state.projects.find((p) => p.id === opened.id)!.nodes);
    const ch1 = targets[0]!.node;
    const ch2 = targets[1]!.node;

    // 1. 「找回舊版」（本機 IndexedDB 安全網）：寫入 ch1 的自動備份版本
    const session = sessionVersions({
      baseline: ch1.content ?? '',
      lastKept: ch1.content ?? '',
      content: '【範例】半小時自動留下的本機舊版',
      baselineStored: false,
      node: { id: ch1.id, title: ch1.title },
      savedAt: 1_764_133_000_000,
    });
    await archive.update(opened.id, (curr) => {
      let next = curr;
      for (const ver of session.versions) next = withVersion(next, ver);
      return next;
    });
    const archiveVersionsBefore = (await archive.read(opened.id)).versions[ch1.id] ?? [];
    expect(archiveVersionsBefore.length).toBeGreaterThanOrEqual(1);

    // 2. 「刪稿暫存區」（.db 附加表 jiufangm_trash_*）：透過 trashCapture 收集並寫入一筆刪稿
    const deletedParagraph =
      '【範例】' + '港口夜霧濃得化不開，遠方的漁火在浪尖忽明忽滅，他收起筆記本準備離開。'.repeat(4);
    const bodyWithTrashPara = `【範例】開頭段落。\n${deletedParagraph}\n【範例】結尾段落。`;
    const bodyAfterManualDelete = '【範例】開頭段落。\n\n【範例】結尾段落。';
    const tracker = createTrashCaptureTracker();
    tracker.noteSelection(
      bodyWithTrashPara.indexOf(deletedParagraph),
      bodyWithTrashPara.indexOf(deletedParagraph) + deletedParagraph.length,
      bodyWithTrashPara.length,
    );
    const captureRes = tracker.handleEdit({
      chapterId: ch1.id,
      before: bodyWithTrashPara,
      after: bodyAfterManualDelete,
      source: 'type',
      nowMs: 1_764_133_010_000,
    });
    expect(captureRes.kind).toBe('capture');
    if (captureRes.kind !== 'capture') throw new Error('expected capture');

    const trashItem = createTrashItem({
      itemId: '55555555-6666-4777-8888-000000000001',
      chapterId: ch1.id,
      chapterTitleSnapshot: ch1.title,
      content: captureRes.payload.deletedText,
      wordCount: captureRes.payload.wordCount,
      beforeAnchor: captureRes.payload.beforeAnchor,
      afterAnchor: captureRes.payload.afterAnchor,
      charOffset: captureRes.payload.charOffset,
      reason: '先收著這段描寫',
      deletedAtMs: captureRes.payload.capturedAtMs,
    });
    state = reduce(state, { type: 'trash-add', projectId: opened.id, item: trashItem });
    state = reduce(state, {
      type: 'commit-text',
      projectId: opened.id,
      nodeId: ch1.id,
      text: bodyAfterManualDelete,
    });
    const todayAfterRealWrite = state.schedule.open?.wordCount ?? 0;

    // 3. 本單「版本」（.db 附加表 jiufangm_chapter_version_*）：存 ch1 舊版，再修改正文並回到舊版、按復原
    const manualV1 = createManuscriptVersion({
      version_id: '55555555-6666-4777-8888-000000000002',
      chapter_id: ch1.id,
      chapter_title_snapshot: ch1.title,
      content: '【範例】版本庫存下的第一版',
      note: '共存基準版',
      source: 'manual',
      saved_at_ms: 1_764_133_020_000,
    });
    state = reduce(state, {
      type: 'chapter-version-save-manual',
      projectId: opened.id,
      input: manualV1,
    });

    let liveBody = `${bodyAfterManualDelete}新寫一段文字`;
    const flowDeps: VersionRestoreFlowDeps = {
      getNodes: () => state.projects.find((p) => p.id === opened.id)?.nodes ?? null,
      readLive: () => liveBody,
      isComposing: () => false,
      isReadOnly: () => isProjectChapterVersionsReadOnly(state, opened.id),
      getCurrentProjectId: () => state.activeProjectId,
      getCurrentChapterId: () => ch1.id,
      saveAutoBeforeRestore: async (input) => {
        const fullInput: Omit<CreateManuscriptVersionInput, 'source'> = {
          ...input,
          version_id: '55555555-6666-4777-8888-000000000003',
          saved_at_ms: 1_764_133_030_000,
        };
        const result = saveAutoVersionBeforeRestore(
          getProjectChapterVersions(state, opened.id),
          fullInput,
        );
        state = reduce(state, {
          type: 'chapter-version-save-auto-before-restore',
          projectId: opened.id,
          input: fullInput,
        });
        return {
          ...result,
          persisted: result.kind !== 'blocked-full',
        };
      },
      replaceText: (next, _caret, options) => {
        state = reduce(state, { type: 'commit-text', projectId: opened.id, nodeId: ch1.id, text: liveBody });
        liveBody = next;
        state = reduce(state, {
          type: 'commit-text',
          projectId: opened.id,
          nodeId: ch1.id,
          text: next,
          ...(options?.countForToday !== undefined ? { countForToday: options.countForToday } : {}),
        });
        return true;
      },
      setRestoreUndo: (snapshot) =>
        dispatch({ type: 'chapter-version-set-restore-undo', snapshot }),
      clearRestoreUndo: () => dispatch({ type: 'chapter-version-clear-restore-undo' }),
    };

    const restoreVerRes = await executeVersionRestore(flowDeps, {
      projectId: opened.id,
      currentId: ch1.id,
      openedProjectId: opened.id,
      openedChapterId: ch1.id,
      targetVersion: manualV1,
    });
    expect(restoreVerRes.status).toBe('restored');
    // 確認「版本」還原不觸發刪稿暫存區、不改動既有暫存項目、不動本機找回舊版
    expect(tracker.getLastAutoTrash()).toBeNull();
    expect(getProjectTrash(state, opened.id)).toEqual([trashItem]);
    expect((await archive.read(opened.id)).versions[ch1.id]).toEqual(archiveVersionsBefore);

    // 從刪稿暫存區把段落放回 ch2（章末），確認不影響 ch1 的版本與 versionRestoreUndo
    const ch2BeforePutBack = findNode(state.projects.find((p) => p.id === opened.id)!.nodes, ch2.id)?.content ?? '';
    const putBackPlan = appendToChapterEndPlan(ch2BeforePutBack, trashItem.content, 'end');
    state = reduce(state, {
      type: 'trash-put-back',
      projectId: opened.id,
      itemId: trashItem.itemId,
      targetNodeId: ch2.id,
      nextBody: putBackPlan.nextBody,
    });
    expect(getProjectTrash(state, opened.id)).toEqual([]);
    expect(getProjectChapterVersions(state, opened.id)).toHaveLength(2);
    expect(state.versionRestoreUndo?.chapterId).toBe(ch1.id);

    // 4. 「最近刪除」刪除 ch2 並保留於 archive.deleted，再救回 ch2
    const nodesBeforeDelCh2 = state.projects.find((p) => p.id === opened.id)!.nodes;
    const ch2DeletedRecord = deletedFromNode(
      nodesBeforeDelCh2,
      ch2.id,
      1_764_133_040_000,
      'del-ch2-coexist',
    )!;
    await archive.update(
      opened.id,
      (curr) => archiveDeletion(curr, ch2DeletedRecord, versionsForNode(ch2DeletedRecord.node, 1_764_133_040_000)),
      'delete',
    );
    state = reduce(state, {
      type: 'set-nodes',
      projectId: opened.id,
      nodes: withoutNode(nodesBeforeDelCh2, ch2.id)!,
    });
    expect((await archive.read(opened.id)).deleted).toHaveLength(1);
    // ch1 的復原提示與版本皆不受 ch2 被刪除影響
    expect(state.versionRestoreUndo?.chapterId).toBe(ch1.id);
    expect(getProjectChapterVersions(state, opened.id)).toHaveLength(2);

    // 驗證「找回舊版」純函式 nodeAfterVersionRestore 仍只換正文不改章名、且不影響版本表
    const ch1NodeNow = findNode(state.projects.find((p) => p.id === opened.id)!.nodes, ch1.id)!;
    const legacyRestored = nodeAfterVersionRestore(ch1NodeNow, archiveVersionsBefore[0]!);
    expect(legacyRestored.title).toBe(ch1NodeNow.title);
    expect(legacyRestored.content).toBe(archiveVersionsBefore[0]!.content);

    // 救回 ch2 並重新加回一筆刪稿暫存區，存成 .db 驗證共存結構
    const recoveredCh2Nodes = expandToNode(
      placeRecovered(state.projects.find((p) => p.id === opened.id)!.nodes, ch2DeletedRecord, false),
      ch2.id,
    );
    await restoreDeletedChapterWithArchive({
      state,
      dispatch,
      projectId: opened.id,
      record: ch2DeletedRecord,
      nodes: recoveredCh2Nodes,
      archive,
      persistBook: (nextState) =>
        persistProjectNow({
          state: nextState,
          projectId: opened.id,
          dispatch,
          onStashResult: () => undefined,
          store: kv,
        }),
    });

    const trashItem2 = createTrashItem({
      itemId: '55555555-6666-4777-8888-000000000004',
      chapterId: ch1.id,
      chapterTitleSnapshot: ch1.title,
      content: '【範例】' + '海'.repeat(105),
      reason: '共存第二筆刪稿',
      deletedAtMs: 1_764_133_050_000,
    });
    state = reduce(state, { type: 'trash-add', projectId: opened.id, item: trashItem2 });

    const manualSave = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: { [opened.id]: 0 },
      onSaved: () => undefined,
      store: kv,
    });
    expect(manualSave?.kind).toBe('saved');

    // 檢查 .db：schema 維持 14、snapshots 未被寫入任何版本資料、trash 與 chapterVersions 兩表並存完整
    const dbFinal = await openMemoryDb(disk.bytes);
    try {
      expect(CURRENT_SCHEMA_VERSION).toBe(14);
      expect(currentSchemaVersion(dbFinal.sql)).toBe(14);
      expect(snapshotFingerprints(dbFinal.sql)).toEqual(baseSnapshots);
      const tables = tableNames(dbFinal.sql);
      expect(tables.has(TRASH_META_TABLE)).toBe(true);
      expect(tables.has(TRASH_ITEMS_TABLE)).toBe(true);
      expect(tables.has(CHAPTER_VERSION_META_TABLE)).toBe(true);
      expect(tables.has(CHAPTER_VERSIONS_TABLE)).toBe(true);
    } finally {
      dbFinal.close();
    }

    const reopened = await readBookBytes(disk.name, disk.bytes, 'verify-coexist-final');
    expect(reopened.trash).toEqual({
      kind: 'ok',
      revision: 1,
      items: [trashItem2],
    });
    expect(reopened.chapterVersions?.kind).toBe('ok');
    if (reopened.chapterVersions?.kind === 'ok') {
      expect(reopened.chapterVersions.versions).toHaveLength(2);
    }
    expect(findNode(reopened.tree, ch2.id)?.content).toContain(deletedParagraph);
    // 今日字數只包含最初真正手動打字增加的部分，不受還原或放回灌水
    expect(state.schedule.open?.wordCount).toBe(todayAfterRealWrite + 6);
  });

  it('返工驗證（必修 1～3）：暫存失敗時所有版本寫入皆不得回傳 persisted: true；reused-latest 必須重試暫存；21 份限制與復原不掉自動保存', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】返工 store 驗證.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-26T15:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T15:00:00+08:00'),
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });
    const chId = listWritableTargetNodes(
      state.projects.find((p) => p.id === opened.id)!.nodes,
    )[0]!.node.id;

    let stashShouldSucceed = true;
    let persistAttempts = 0;
    const actions = createChapterVersionActions({
      getState: () => state,
      dispatch,
      persistVersionsState: async (projectId, nextState) => {
        persistAttempts += 1;
        if (!stashShouldSucceed) return false;
        return persistProjectNow({
          state: nextState,
          projectId,
          dispatch,
          onStashResult: () => undefined,
          store: kv,
        });
      },
    });

    // 1. 手動存、改備註（含同字未變動）、丟掉、放回、自動保存（含 reused-latest）：暫存失敗一律回傳 persisted: false
    stashShouldSucceed = false;
    const manualFail = await actions.saveChapterVersion(opened.id, {
      version_id: '66666666-7777-4888-8999-000000000001',
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】暫存失敗時的手動版',
      note: '備註一',
      saved_at_ms: 1_764_140_001_000,
    });
    expect(manualFail.kind).toBe('saved');
    expect(manualFail.persisted).toBe(false);

    const noteChangeFail = await actions.updateChapterVersionNote(
      opened.id,
      '66666666-7777-4888-8999-000000000001',
      '備註二',
    );
    expect(noteChangeFail.kind).toBe('updated');
    expect(noteChangeFail.persisted).toBe(false);

    // 即使備註字面與目前相同（state 無變動），暫存失敗仍不得回傳 persisted: true
    const sameNoteFail = await actions.updateChapterVersionNote(
      opened.id,
      '66666666-7777-4888-8999-000000000001',
      '備註二',
    );
    expect(sameNoteFail.kind).toBe('updated');
    expect(sameNoteFail.persisted).toBe(false);

    const discardFail = await actions.discardChapterVersion(
      opened.id,
      '66666666-7777-4888-8999-000000000001',
    );
    expect(discardFail.kind).toBe('discarded');
    expect(discardFail.persisted).toBe(false);

    const restoreDiscardFail = await actions.restoreDiscardedChapterVersion(
      opened.id,
      getProjectChapterVersions(state, opened.id)[0] ??
        createManuscriptVersion({
          version_id: '66666666-7777-4888-8999-000000000001',
          chapter_id: chId,
          chapter_title_snapshot: '第一章（範例）',
          content: '【範例】暫存失敗時的手動版',
          note: '備註二',
          source: 'manual',
          saved_at_ms: 1_764_140_001_000,
        }),
    );
    expect(restoreDiscardFail.kind).toBe('restored');
    expect(restoreDiscardFail.persisted).toBe(false);

    // 2. 自動保存第一次暫存失敗；第二次因內容與最新一版相同走 reused-latest，必須再次走暫存
    const autoFail1 = await actions.saveAutoChapterVersionBeforeRestore(opened.id, {
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】自動保存暫存重試正文',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
    });
    expect(autoFail1.kind).toBe('saved');
    expect(autoFail1.persisted).toBe(false);

    const attemptsBeforeRetry = persistAttempts;
    const autoReuseStillFail = await actions.saveAutoChapterVersionBeforeRestore(opened.id, {
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】自動保存暫存重試正文',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
    });
    expect(autoReuseStillFail.kind).toBe('reused-latest');
    expect(autoReuseStillFail.persisted).toBe(false);
    expect(persistAttempts).toBe(attemptsBeforeRetry + 1);

    stashShouldSucceed = true;
    const autoReuseOk = await actions.saveAutoChapterVersionBeforeRestore(opened.id, {
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】自動保存暫存重試正文',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
    });
    expect(autoReuseOk.kind).toBe('reused-latest');
    expect(autoReuseOk.persisted).toBe(true);

    // 3. 補滿到 20 份手寫 + 1 份自動保存（共 21 份）：
    //    丟掉 1 份手寫再立即放回，自動保存仍在且數量回到 21；把自動保存改成手寫備註後再自動保存被擋下
    for (let i = 2; i <= 20; i += 1) {
      const saved = await actions.saveChapterVersion(opened.id, {
        version_id: `66666666-7777-4888-8999-${String(i).padStart(12, '0')}`,
        chapter_id: chId,
        chapter_title_snapshot: '第一章（範例）',
        content: `【範例】手寫版 #${i}`,
        note: `手寫備註 #${i}`,
        saved_at_ms: 1_764_140_010_000 + i * 1_000,
      });
      expect(saved.kind).toBe('saved');
      expect(saved.persisted).toBe(true);
    }
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(20);

    const auto21 = await actions.saveAutoChapterVersionBeforeRestore(opened.id, {
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第 21 份自動保存正文',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
      saved_at_ms: 1_764_140_100_000,
    });
    expect(auto21.kind).toBe('saved');
    expect(auto21.persisted).toBe(true);
    if (auto21.kind !== 'saved') throw new Error('expected saved');
    expect(auto21.overLimit).toBe(true);
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(21);

    const manualToDiscard = getProjectChapterVersions(state, opened.id).find(
      (v) => v.source === 'manual',
    )!;
    const discarded = await actions.discardChapterVersion(opened.id, manualToDiscard.version_id);
    expect(discarded.kind).toBe('discarded');
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(20);

    const undone = await actions.restoreDiscardedChapterVersion(opened.id, manualToDiscard);
    expect(undone.kind).toBe('restored');
    expect(undone.persisted).toBe(true);
    const listAfterUndo = versionsForChapter(getProjectChapterVersions(state, opened.id), chId);
    expect(listAfterUndo).toHaveLength(21);
    expect(listAfterUndo.some((v) => v.version_id === auto21.version.version_id)).toBe(true);

    // 把第 21 份自動保存改成手寫備註後，再呼叫自動保存必須被擋（不變成 22）
    const notePromoted = await actions.updateChapterVersionNote(
      opened.id,
      auto21.version.version_id,
      '【範例】改成手寫保護',
    );
    expect(notePromoted.kind).toBe('updated');
    expect(notePromoted.persisted).toBe(true);

    const autoBlocked = await actions.saveAutoChapterVersionBeforeRestore(opened.id, {
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】不可新增的第 22 份',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
      saved_at_ms: 1_764_140_200_000,
    });
    expect(autoBlocked.kind).toBe('blocked-full');
    expect(autoBlocked.persisted).toBe(false);
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(21);
  });

  it('返工 2：手動存成版本暫存失敗後，同一正文重試須再走暫存、失敗維持失敗提示、成功只留一份且重載不丟', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】返工 2 手動存版重試.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-26T15:25:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-26T15:25:00+08:00'),
    });
    state = reduce(state, { type: 'focus-project', id: opened.id });
    const chId = listWritableTargetNodes(
      state.projects.find((p) => p.id === opened.id)!.nodes,
    )[0]!.node.id;

    let stashShouldSucceed = false;
    let persistAttempts = 0;
    const actions = createChapterVersionActions({
      getState: () => state,
      dispatch,
      persistVersionsState: async (projectId, nextState) => {
        persistAttempts += 1;
        if (!stashShouldSucceed) return false;
        return persistProjectNow({
          state: nextState,
          projectId,
          dispatch,
          onStashResult: () => undefined,
          store: kv,
        });
      },
    });

    const content = '【範例】手動存版暫存失敗重試正文';

    // 1. 首次手動存暫存失敗：已進記憶體，persisted 為 false，提示暫存失敗
    const firstTry = await actions.saveChapterVersion(opened.id, {
      version_id: '77777777-8888-4999-8aaa-000000000001',
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content,
      note: '備註測試',
      saved_at_ms: 1_764_141_001_000,
    });
    expect(persistAttempts).toBe(1);
    expect(firstTry.kind).toBe('saved');
    expect(firstTry.persisted).toBe(false);
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(1);
    expect(
      resolveSaveVersionFeedback(
        firstTry.kind === 'saved'
          ? { kind: 'saved', noticeCode: firstTry.noticeCode, persisted: firstTry.persisted }
          : { kind: 'read-only' },
      ),
    ).toEqual({ message: VERSION_SAVE_STASH_FAIL_HINT, clearDraft: false });

    // 2. 同一正文再按一次且暫存仍失敗：必須再走暫存，仍回 persisted: false，畫面不得變成去重提示
    const secondTryStillFail = await actions.saveChapterVersion(opened.id, {
      version_id: '77777777-8888-4999-8aaa-000000000002',
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content,
      note: '備註測試',
      saved_at_ms: 1_764_141_002_000,
    });
    expect(persistAttempts).toBe(2);
    expect(secondTryStillFail.kind).toBe('duplicate');
    expect(secondTryStillFail.persisted).toBe(false);
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(1);
    const secondFeedback = resolveSaveVersionFeedback({
      kind: 'duplicate',
      persisted: secondTryStillFail.persisted,
    });
    expect(secondFeedback).toEqual({
      message: VERSION_SAVE_STASH_FAIL_HINT,
      clearDraft: false,
    });
    expect(secondFeedback.message).not.toBe(VERSION_DUPLICATE_HINT);

    // 3. 暫存恢復後同一正文再按一次：必須再走暫存且成功，清單仍只有一份，重整讀回 App 空間確實存在
    stashShouldSucceed = true;
    const thirdTryOk = await actions.saveChapterVersion(opened.id, {
      version_id: '77777777-8888-4999-8aaa-000000000003',
      chapter_id: chId,
      chapter_title_snapshot: '第一章（範例）',
      content,
      note: '備註測試',
      saved_at_ms: 1_764_141_003_000,
    });
    expect(persistAttempts).toBe(3);
    expect(thirdTryOk.kind).toBe('duplicate');
    expect(thirdTryOk.persisted).toBe(true);
    expect(versionsForChapter(getProjectChapterVersions(state, opened.id), chId)).toHaveLength(1);
    expect(
      resolveSaveVersionFeedback({
        kind: 'duplicate',
        persisted: thirdTryOk.persisted,
      }),
    ).toEqual({
      message: VERSION_SAVED_TOAST,
      clearDraft: true,
    });

    const storedAfterRetry = await loadStoredBooks();
    expect(storedAfterRetry).toHaveLength(1);
    expect(storedAfterRetry[0]?.chapterVersions?.kind).toBe('ok');
    if (storedAfterRetry[0]?.chapterVersions?.kind === 'ok') {
      expect(storedAfterRetry[0].chapterVersions.versions).toHaveLength(1);
      expect(storedAfterRetry[0].chapterVersions.versions[0]!.version_id).toBe(
        '77777777-8888-4999-8aaa-000000000001',
      );
      expect(storedAfterRetry[0].chapterVersions.versions[0]!.content).toBe(content);
    }
  });
});
