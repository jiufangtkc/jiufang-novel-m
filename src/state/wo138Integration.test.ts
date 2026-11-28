import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../copy/aboutCopy';
import { findReleaseNote, RELEASE_NOTES } from '../data/whatsNew';
import { createDirectoryAppSpace, createMemoryDirectory } from '../db/appSpace';
import * as browserSpace from '../db/browserSpace';
import { readBookBytes, writeBookBytes } from '../db/library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from '../db/migrations';
import { readFileProject, writeFileProject } from '../db/projectFile';
import { tableNames, type Sql } from '../db/sql';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import { TRASH_ITEMS_TABLE, TRASH_META_TABLE } from '../db/trashMeta';
import { openMemoryDb } from '../db/wasmDb';
import {
  appendToChapterEndPlan,
  computePutBackPlan,
  createTrashItem,
  isTrashOriginalNodeAlive,
  listWritableTargetNodes,
  TRASH_AUTO_MIN_WORDS,
} from '../domain/trash';
import { LARGE_TEXT_THRESHOLD } from '../domain/writingLog';
import { executeFormat } from '../editor/formatFlow';
import { createTrashCaptureTracker } from '../editor/trashCapture';
import { createState, getProjectTrash, reduce } from './sampleStore';

function setupMemoryAppSpace() {
  const dir = createMemoryDirectory();
  const space = createDirectoryAppSpace(dir);
  vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(space);
  return space;
}

function tableShapes(sql: Sql, names: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of names) {
    out[name] = sql.select(`PRAGMA table_info(${name})`);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WO-138 第 7 段：跨版本相容、完整端到端與 0.6.0 整合驗證', () => {
  it('電腦版 8 張共用表結構與 schema_version = 14 不變；舊版 0.4.4／0.5.0 開新檔再存回原樣保留刪稿暫存區', async () => {
    const baseBytes = await generateDesktopSampleBytes();
    const baseDb = await openMemoryDb(baseBytes);
    const desktopTables = [...tableNames(baseDb.sql)]
      .filter((name) => name !== 'sqlite_sequence')
      .sort();
    const baseShapes = tableShapes(baseDb.sql, desktopTables);
    baseDb.close();

    const book060 = await readBookBytes('【範例】060新檔.db', baseBytes, 'compat-check');
    const item = createTrashItem({
      itemId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1',
      chapterId: book060.tree[0]!.id,
      chapterTitleSnapshot: book060.tree[0]!.title,
      content: '【範例】' + '霧'.repeat(110),
      beforeAnchor: '前文錨點，',
      afterAnchor: '後文錨點。',
      charOffset: 5,
      reason: '先保留這段霧景描寫',
      deletedAtMs: 1_700_000_123_000,
      sortOrder: 0,
    });

    // 0.6.0 寫入 .db（含 bookMeta、timeline cards 與 trashItems）
    const existingBookMeta =
      book060.bookMeta?.kind === 'ok' ? book060.bookMeta.meta : undefined;
    const bytes060 = await writeBookBytes(
      baseBytes,
      book060.info,
      book060.tree,
      book060.cards,
      book060.logs,
      undefined,
      undefined,
      existingBookMeta,
      [item],
    );

    // 驗證 schema_version 仍為 14，且電腦版共用表欄位完全一致
    const db060 = await openMemoryDb(bytes060);
    try {
      expect(CURRENT_SCHEMA_VERSION).toBe(14);
      expect(currentSchemaVersion(db060.sql)).toBe(14);
      expect(tableShapes(db060.sql, desktopTables)).toEqual(baseShapes);
      expect(tableNames(db060.sql).has(TRASH_META_TABLE)).toBe(true);
      expect(tableNames(db060.sql).has(TRASH_ITEMS_TABLE)).toBe(true);
    } finally {
      db060.close();
    }

    // 模擬舊版（0.4.4／0.5.0）開啟 0.6.0 檔並編輯正文後再存回（未傳 trashItems，未呼叫 writeTrashData）
    const openedByOlder = await readBookBytes('【範例】舊版開啟.db', bytes060, 'older-open');
    const updatedTree = openedByOlder.tree.map((node, index) =>
      index === 0 ? { ...node, content: `${node.content ?? ''}\n【範例】舊版補充一行。` } : node,
    );
    const savedByOlderBytes = await writeBookBytes(
      bytes060,
      openedByOlder.info,
      updatedTree,
      openedByOlder.cards,
      openedByOlder.logs,
    );

    // 用 0.6.0 重開：舊版補充的正文、卡片與原有的刪稿暫存區皆完好保留
    const reopenedBy060 = await readBookBytes('【範例】新版重開.db', savedByOlderBytes, 'reopen-060');
    expect(reopenedBy060.tree[0]?.content).toContain('【範例】舊版補充一行。');
    expect(reopenedBy060.cards).toEqual(book060.cards);
    expect(reopenedBy060.trash).toEqual({
      kind: 'ok',
      revision: 1,
      items: [item],
    });
  });

  it('附加表（bookMeta、timelineMeta、trashMeta）在同交易並存不衝突', async () => {
    const baseBytes = await generateDesktopSampleBytes();
    const loaded = await readBookBytes('【範例】並存測試.db', baseBytes, 'coexist');
    const item = createTrashItem({
      itemId: 'bbbbbbbb-cccc-4ddd-8eee-fffffffffff1',
      chapterId: loaded.tree[0]!.id,
      chapterTitleSnapshot: loaded.tree[0]!.title,
      content: '【範例】' + '夜'.repeat(105),
      deletedAtMs: 1_700_000_200_000,
    });
    const db = await openMemoryDb(baseBytes);
    try {
      writeFileProject(
        db.sql,
        loaded.info,
        loaded.tree,
        loaded.cards,
        loaded.logs,
        undefined,
        undefined,
        {
          bookUuid: '12345678-1234-4123-8123-123456789012',
          originBookUuid: null,
          createdAtMs: 1_700_000_000_000,
        },
        [item],
      );
      const after = readFileProject(db.sql);
      expect(after.bookMeta).toEqual({
        kind: 'ok',
        revision: 1,
        meta: {
          bookUuid: '12345678-1234-4123-8123-123456789012',
          originBookUuid: null,
          createdAtMs: 1_700_000_000_000,
        },
      });
      expect(after.trash).toEqual({ kind: 'ok', revision: 1, items: [item] });
      expect(after.cards).toEqual(loaded.cards);
    } finally {
      db.close();
    }
  });

  it('自動收集 100 字門檻、排版與刪章不收、改章名／刪章放回與 writingLog 50 字不變', () => {
    expect(TRASH_AUTO_MIN_WORDS).toBe(100);
    expect(LARGE_TEXT_THRESHOLD).toBe(50);

    setupMemoryAppSpace();
    let state = createState(new Date('2026-11-25T16:00:00+08:00'));
    state = reduce(state, {
      type: 'add-project',
      id: 'p-int',
      title: '【範例】整合驗證書稿',
      shape: 'single',
    });
    state = reduce(state, {
      type: 'set-nodes',
      projectId: 'p-int',
      nodes: [
        { id: 'ch-int-1', type: 'file', title: '【範例】第一章', content: '' },
        { id: 'ch-int-2', type: 'file', title: '【範例】第二章', content: '【範例】第二章既有正文。' },
      ],
    });
    const project = state.projects.find((p) => p.id === 'p-int')!;
    const ch1 = project.nodes[0]!;
    const ch2 = project.nodes[1]!;

    // 模擬編輯：先寫入帶段落的初稿
    const prefix = '【範例】夜霧落在石階上，遠處燈塔閃爍著微光。';
    const deleted120 = '他停下腳步回頭望向港口，長堤盡頭的霧氣比剛才更濃了，幾乎看不清碼頭邊停靠的漁船輪廓與潮水拍岸的影子。'.repeat(2) + '這段共有足夠字數。';
    const suffix = '風從海面吹來，帶著鹹味。';
    const initialBody = prefix + deleted120 + suffix;
    state = reduce(state, { type: 'commit-text', projectId: 'p-int', nodeId: ch1.id, text: initialBody });

    // 排版小工具不觸發 trashCapture
    const tracker = createTrashCaptureTracker();
    let liveBody = initialBody;
    const formatOutcome = executeFormat(
      {
        getNodes: () => state.projects.find((p) => p.id === 'p-int')!.nodes,
        readLive: () => liveBody,
        isComposing: () => false,
        syncCurrent: (next) => {
          liveBody = next;
          state = reduce(state, { type: 'commit-text', projectId: 'p-int', nodeId: ch1.id, text: next });
          return true;
        },
        applyOthers: (changes, snapshot) => {
          state = reduce(state, { type: 'format-apply', projectId: 'p-int', changes, snapshot });
        },
        undoOthers: () => undefined,
        clearSnapshot: () => undefined,
      },
      {
        projectId: 'p-int',
        currentId: ch1.id,
        openedProjectId: 'p-int',
        openedChapterId: ch1.id,
        kind: 'indent',
        scope: 'chapter',
      },
    );
    expect(formatOutcome.status).toBe('applied');
    expect(getProjectTrash(state, 'p-int')).toEqual([]);

    // 正文刪除 >= 100 字 → 自動收集
    const afterDelete = liveBody.replace(deleted120, '');
    tracker.noteSelection(
      liveBody.indexOf(deleted120),
      liveBody.indexOf(deleted120) + deleted120.length,
      liveBody.length,
    );
    const outcome = tracker.handleEdit({
      chapterId: ch1.id,
      before: liveBody,
      after: afterDelete,
      source: 'type',
      nowMs: 1_700_000_300_000,
    });
    expect(outcome.kind).toBe('capture');
    if (outcome.kind !== 'capture') throw new Error('expected capture');

    const trashItem = createTrashItem({
      itemId: 'cccccccc-dddd-4eee-8fff-000000000001',
      chapterId: ch1.id,
      chapterTitleSnapshot: ch1.title,
      content: outcome.payload.deletedText,
      wordCount: outcome.payload.wordCount,
      beforeAnchor: outcome.payload.beforeAnchor,
      afterAnchor: outcome.payload.afterAnchor,
      charOffset: outcome.payload.charOffset,
      deletedAtMs: outcome.payload.capturedAtMs,
    });
    state = reduce(state, { type: 'trash-add', projectId: 'p-int', item: trashItem });
    state = reduce(state, { type: 'commit-text', projectId: 'p-int', nodeId: ch1.id, text: afterDelete });

    // 改章名仍認得同一章，且雙錨點可放回原處
    const renamedNodes = state.projects
      .find((p) => p.id === 'p-int')!
      .nodes.map((n) => (n.id === ch1.id ? { ...n, title: '【範例】改名後的第一章' } : n));
    state = reduce(state, { type: 'set-nodes', projectId: 'p-int', nodes: renamedNodes });
    const alive = isTrashOriginalNodeAlive(
      state.projects.find((p) => p.id === 'p-int')!.nodes,
      trashItem.chapterId,
    );
    expect(alive?.title).toBe('【範例】改名後的第一章');

    const planOriginal = computePutBackPlan(alive!.content ?? '', trashItem);
    expect(planOriginal.placement).toBe('original');
    expect(planOriginal.nextBody).toContain(deleted120);

    // 刪掉 ch1 之後，暫存區項目依然留著且可選現有 ch2 放至章末（不新建章）
    const withoutCh1 = state.projects
      .find((p) => p.id === 'p-int')!
      .nodes.filter((n) => n.id !== ch1.id);
    state = reduce(state, { type: 'set-nodes', projectId: 'p-int', nodes: withoutCh1 });
    expect(getProjectTrash(state, 'p-int')).toHaveLength(1);
    expect(
      isTrashOriginalNodeAlive(
        state.projects.find((p) => p.id === 'p-int')!.nodes,
        trashItem.chapterId,
      ),
    ).toBeNull();

    const targets = listWritableTargetNodes(state.projects.find((p) => p.id === 'p-int')!.nodes);
    expect(targets.map((t) => t.node.id)).toContain(ch2.id);
    const pickPlan = appendToChapterEndPlan(ch2.content ?? '', trashItem.content, 'end');
    const pasteBefore = state.logs.reduce((s, l) => s + l.paste_large_count, 0);
    state = reduce(state, {
      type: 'trash-put-back',
      projectId: 'p-int',
      itemId: trashItem.itemId,
      targetNodeId: ch2.id,
      nextBody: pickPlan.nextBody,
    });
    expect(getProjectTrash(state, 'p-int')).toEqual([]);
    expect(state.logs.reduce((s, l) => s + l.paste_large_count, 0)).toBe(pasteBefore);
    expect(
      state.projects.find((p) => p.id === 'p-int')!.nodes.find((n) => n.id === ch2.id)?.content,
    ).toContain(deleted120);
  });

  it('版號 0.11.0 與改版說明一致（0.10.0、0.9.1 與 0.9.0 以下舊條目不動）', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    const lock = JSON.parse(
      readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'),
    ) as {
      version: string;
      packages: { '': { version: string } };
    };
    expect(pkg.version).toBe('0.11.0');
    expect(lock.version).toBe('0.11.0');
    expect(lock.packages[''].version).toBe('0.11.0');
    expect(APP_VERSION).toBe('0.11.0');
    expect(RELEASE_NOTES[0]).toEqual({
      version: '0.11.0',
      items: [
        '寫作頁頁首新增「記靈感」：按一下就能把靈感存成卡片，先放在資料集的「靈感」分類，之後再改到角色或世界觀等分類。',
        '資料集最上面會出現「靈感」分類，可把卡片改到其他分類。',
      ],
    });
    expect(RELEASE_NOTES[1]).toEqual({
      version: '0.10.0',
      items: [
        '寫作頁新增全形標點列：可插入全形空白、破折號、刪節號和引號等出版常用標點，方便在 iPhone 無法使用第三方輸入法時使用。',
      ],
    });
    expect(RELEASE_NOTES[2]).toEqual({
      version: '0.9.1',
      items: [
        '再開同一本稿子時，會先告訴你這個裝置上已經有了，讓你選要打開原本那份，還是用剛選的檔取代，不會再默默多出一份',
        '首頁不再把書名相同的稿子收成一筆，每一份都列出來並標示差別，刪除時也會講清楚刪的是哪一份',
      ],
    });
    expect(RELEASE_NOTES[3]).toEqual({
      version: '0.9.0',
      items: [
        '版本清單新增「比較」：可逐字對照任一份舊版與現在這一章的差異，並自動統計增減字數與改動段數',
        '連續未改動的段落會先收起來，只留前後各一段方便對照，點一下即可展開原文',
      ],
    });
    expect(findReleaseNote('0.8.0')?.items).toEqual([
      '新增稿子版本：可以把這一章目前的樣子存下來，之後查看或回到舊版；版本會跟著稿子檔一起保存',
      '回到舊版之前，會先自動把現在的樣子存一份，回去後也可以復原',
    ]);
    expect(findReleaseNote('0.7.0')?.items).toEqual([
      '排版新增『統一標點』：一鍵把破折號、刪節號、引號和中文裡的半形標點，統一成臺灣出版常用的寫法',
    ]);
    expect(findReleaseNote('0.6.0')?.items).toEqual([
      '從刪稿暫存區放回去的字、以及收進暫存區的刪除，都不會算進今天的進度；只有新打的字才算',
      '新增刪稿暫存區：改稿時一次刪掉較長的段落會先留下來，可註記當時為什麼刪，也能放回原來的章節',
      '這些刪稿會跟著稿子檔一起保存；打錯字的小刪除不會進去，避免存檔無謂變大',
    ]);
    expect(findReleaseNote('0.5.0')?.items).toHaveLength(2);
    expect(findReleaseNote('0.3.0')?.items).toHaveLength(2);
  });
});
