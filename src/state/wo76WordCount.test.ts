import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countAchievements, writingDayKey } from '../domain/dailyGoal';
import { summarizeStats } from '../domain/stats';
import { countBookWords, countWords } from '../domain/wordCount';
import { versionFromNode } from '../domain/chapterVersions';
import { removalImpact } from '../domain/chapterOps';
import { openNodeSql } from '../db/nodeSql';
import { readFileProject, treeWordCount, writeFileProject } from '../db/projectFile';
import { createVersion14Shell } from '../db/schemaFixture';
import { scheduleFromLogs } from '../db/library';
import { firstFileNode } from './testing/firstFile';
import { createState, manuscriptSnapshotParts, reduce, type SampleState } from './sampleStore';
import { demoFixtureState } from './testing/sampleFixture';

/** 與 qa/存檔再開/run.mjs 相同的兩段正文：本章 28。 */
const P1 = '港口起霧，燈塔還看得見。';
const P2 = '她把舊地圖攤在桌上，等潮水退去。';
const NOON = new Date('2026-11-14T04:00:00Z');
const TODAY = writingDayKey(NOON, 0);

function projectOf(state: SampleState, id: string) {
  return state.projects.find((item) => item.id === id)!;
}

function chapterOf(state: SampleState, projectId: string) {
  return firstFileNode(projectOf(state, projectId).nodes)!;
}

function write(state: SampleState, projectId: string, text: string): SampleState {
  return reduce(state, { type: 'commit-text', projectId, nodeId: chapterOf(state, projectId).id, text });
}

function todayWords(state: SampleState): number {
  return summarizeStats(state.schedule, state.logs, countAchievements(state.schedule.settled)).todayWords;
}

/** 依另存流程寫進一份空白 .db，再像「開啟稿子」一樣讀回、接上畫面。 */
function saveAndReopen(state: SampleState, projectId: string) {
  const project = projectOf(state, projectId);
  const parts = manuscriptSnapshotParts(state, project);
  const { db, sql } = openNodeSql();
  let loaded: ReturnType<typeof readFileProject>;
  try {
    createVersion14Shell(sql);
    writeFileProject(sql, parts.info, project.nodes, parts.cards, parts.logs);
    loaded = readFileProject(sql);
  } finally {
    db.close();
  }
  const reopened = reduce(state, {
    type: 'attach-file',
    project: {
      id: 'reopened',
      dbKey: 'reopened',
      title: loaded.info.title,
      updatedLabel: '剛剛',
      bookGoal: loaded.info.targetWordCount,
      nodes: loaded.tree,
      origin: 'file',
    },
    schedule: scheduleFromLogs(loaded.logs, loaded.info.dailyTargetWordCount, NOON),
    extras: { info: loaded.info, cards: loaded.cards, logs: loaded.logs },
  });
  return { parts, loaded, reopened };
}

describe('WO-76 同一段文字，各路徑字數相同', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('WO-76：新稿打兩段，未存檔與另存重開的本章、今天、全書字數都一樣', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-new', title: '【範例】新稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-new' });
    state = write(state, 'p-new', `${P1}\n`);
    state = write(state, 'p-new', `${P1}\n${P2}`);

    const chapterBefore = countWords(chapterOf(state, 'p-new').content ?? '');
    const bookBefore = countBookWords(projectOf(state, 'p-new').nodes);
    expect(chapterBefore).toBe(28);
    expect(todayWords(state)).toBe(28);
    // 全書含卷名、章名、幕名（WO-124b 長篇新稿的三層範例），本章不含
    expect(bookBefore).toBe(28 + countWords('第一卷') + countWords(chapterOf(state, 'p-new').title) + countWords('第一幕'));

    const { parts, loaded, reopened } = saveAndReopen(state, 'p-new');
    expect(parts.logs.find((log) => log.date === TODAY)?.word_count).toBe(28);
    expect(loaded.wordCount).toBe(bookBefore);
    expect(treeWordCount(loaded.tree)).toBe(bookBefore);
    expect(projectOf(reopened, 'reopened').origin).toBe('file');
    expect(countWords(chapterOf(reopened, 'reopened').content ?? '')).toBe(28);
    expect(countBookWords(projectOf(reopened, 'reopened').nodes)).toBe(bookBefore);
    expect(todayWords(reopened)).toBe(28);
  });

  it('WO-76：重開成檔案稿後接著打字，今日增量和未存檔的稿子相同（不因來源換算法）', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-new', title: '【範例】新稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-new' });
    state = write(state, 'p-new', P1);
    const { reopened } = saveAndReopen(state, 'p-new');

    const extra = `${P1}\n${P2}他說,OK.買了iPhone 15……`;
    const unsaved = write(state, 'p-new', extra);
    let fromFile = reduce(reopened, { type: 'focus-project', id: 'reopened' });
    fromFile = write(fromFile, 'reopened', extra);

    expect(todayWords(unsaved)).toBe(countWords(extra));
    expect(todayWords(fromFile)).toBe(todayWords(unsaved));
    expect(countBookWords(projectOf(fromFile, 'reopened').nodes)).toBe(
      countBookWords(projectOf(unsaved, 'p-new').nodes),
    );
  });

  it('WO-76：範例書暫存前後字數相同，刪章提示與章節舊版也用同一套', () => {
    const state = demoFixtureState(NOON);
    const fog = projectOf(state, 'fog');
    const first = fog.nodes.find((node) => node.type !== 'folder') ?? fog.nodes[0]!;
    const asFile = { ...fog, origin: 'file' as const };
    expect(countBookWords(asFile.nodes)).toBe(countBookWords(fog.nodes));
    const { loaded } = saveAndReopen(state, 'fog');
    expect(loaded.wordCount).toBe(countBookWords(fog.nodes));

    const body = (function sum(node: typeof first): number {
      return (node.type === 'folder' ? 0 : countWords(node.content ?? '')) +
        (node.children ?? []).reduce((total, child) => total + sum(child), 0);
    })(first);
    expect(removalImpact(first).words).toBe(body);
    const version = versionFromNode({ id: 'c', title: '第一章', content: `${P1}\n${P2}` }, 0, 'v1');
    expect(version.wordCount).toBe(28);
  });
});
