import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWritingCardsData } from '../components/writingCardsData';
import { MANUSCRIPT_NOT_FOUND, SAMPLE_CARDS_NOTICE } from '../copy/userFacing';
import { DEMO_PROJECTS, type ChapterNode, type DemoProject } from '../data/demo';
import { DEMO_CARDS } from '../data/demoCards';
import { firstFileNode } from './testing/firstFile';
import { openNodeSql } from '../db/nodeSql';
import { readFileProject, writeFileProject } from '../db/projectFile';
import { createVersion14Shell } from '../db/schemaFixture';
import { scheduleFromLogs } from '../db/library';
import { countAchievements, createSchedule, withClock } from '../domain/dailyGoal';
import { loadProjects, normalizeLoadedProject, OUTLINE_STORAGE_KEY, saveProjects } from '../domain/outline';
import { summarizeStats } from '../domain/stats';
import { LIVE_DRAFT_KEY, loadLiveDraft, writeLiveDraft } from '../editor/liveDraft';
import { LayoutProvider } from '../layout';
import { CardsScreen } from '../screens/CardsScreen';
import { FilesScreen } from '../screens/FilesScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LogsScreen } from '../screens/LogsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { Workspace } from '../screens/Workspace';
import { WriteScreen } from '../screens/WriteScreen';
import { DEVICE_SAVE_RECORD_KEY } from './deviceSaveRecord';
import { getCardDraft, navMemoryKey, resetNavMemoryCache, saveCardDraft, saveWritePlace } from './navMemory';
import { dropUntouchedSamples, isUntouchedSample } from './sampleCleanup';
import { cloneDemoProject, createState, reduce, SampleProvider, type SampleState } from './sampleStore';

/** 臺北 2026-11-16 中午。 */
const NOON = new Date('2026-11-16T04:00:00Z');
const EMPTY_HOME = '還沒有稿子。開一本新的，或開啟已經存在的 .db 稿件檔。';
const DEMO_IDS = DEMO_PROJECTS.map((project) => project.id);
/** 「回首頁」連結：react-router Link 到 /。 */
const HOME_LINK = /<a [^>]*href="\/"[^>]*>回首頁<\/a>/;

/** 去掉標籤後的畫面文字（提示句中間夾了連結標籤）。 */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/** 程式產生的本機儲存替身。 */
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

type Store = ReturnType<typeof memoryStore>;

/** 舊版 App 實際寫進 localStorage 的四份範例：深層複製、補 origin、經載入正規化，再由 saveProjects 寫成 JSON。 */
function oldDeviceSamples(): DemoProject[] {
  return DEMO_PROJECTS.map((project) =>
    normalizeLoadedProject({ ...cloneDemoProject(project), origin: project.origin ?? 'demo' }),
  );
}

function storedOutline(store: Store): DemoProject[] {
  return JSON.parse(store.getItem(OUTLINE_STORAGE_KEY) ?? 'null') as DemoProject[];
}

function statsOf(state: SampleState) {
  return summarizeStats(state.schedule, state.logs, countAchievements(state.schedule.settled));
}

function flat(nodes: readonly ChapterNode[]): ChapterNode[] {
  return nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);
}

function renderHome(initialState?: SampleState): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      initialState ? { initialState } : null,
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait' },
        createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(HomeScreen)),
      ),
    ),
  );
}

function renderAt(path: string, initialState?: SampleState): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      initialState ? { initialState } : null,
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait' },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/', element: createElement(HomeScreen) }),
            createElement(Route, {
              path: '/p/:projectId',
              element: createElement(Workspace),
              children: [
                createElement(Route, { key: 'w', path: 'write/:chapterId?', element: createElement(WriteScreen) }),
                createElement(Route, { key: 'c', path: 'cards', element: createElement(CardsScreen) }),
                createElement(Route, { key: 'f', path: 'files', element: createElement(FilesScreen) }),
                createElement(Route, { key: 's', path: 'stats', element: createElement(StatsScreen) }),
                createElement(Route, { key: 'g', path: 'settings', element: createElement(SettingsScreen) }),
                createElement(Route, { key: 'l', path: 'logs', element: createElement(LogsScreen) }),
              ],
            }),
          ),
        ),
      ),
    ),
  );
}

let store: Store;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  store = memoryStore();
  vi.stubGlobal('localStorage', store);
  resetNavMemoryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetNavMemoryCache();
});

describe('WO-95 a. 全新空白 localStorage', () => {
  it('projects 與最近清單都是空的；重新建立 state 仍空；統計沒有固定範例數字', () => {
    const state = createState(NOON);
    expect(state.projects).toEqual([]);
    expect(state.recentIds).toEqual([]);
    expect(state.logs).toEqual([]);
    expect(state.demoLogs).toEqual([]);
    expect(state.schedule.settled).toEqual([]);
    expect(state.schedule.open?.wordCount ?? 0).toBe(0);
    const stats = statsOf(state);
    expect(stats.todayWords).toBe(0);
    expect(stats.last7Words).toBe(0);
    expect(stats.activeDays).toBe(0);
    expect(stats.streak).toBe(0);
    expect(stats.longestStreak).toBe(0);
    expect(stats.totalDurationSeconds).toBe(0);
    expect(stats.achievementCount).toBe(0);
    // 每日目標沿用原本的預設值，不強制歸零
    expect(stats.todayGoal).toBe(1000);

    // App 掛上後會把非檔案稿清單寫回本機；空清單也照樣寫成 []，讀回仍是空的，不再放範例
    saveProjects(store, state.projects);
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBe('[]');
    expect(loadProjects(store)).toEqual([]);
    const again = createState(NOON);
    expect(again.projects).toEqual([]);
    expect(again.recentIds).toEqual([]);
  });

  it('首頁實際顯示既有空狀態句與「開新稿子」「開啟稿子」，沒有任何範例稿子', () => {
    const html = renderHome();
    expect(html).toContain(EMPTY_HOME);
    expect(html).toContain('開新稿子');
    expect(html).toContain('開啟稿子');
    expect(html).toContain('data-testid="open-db"');
    expect(html).not.toContain('data-testid="project-card"');
    expect(html).not.toContain('【範例】');
  });
});

describe('WO-95 b. 本機只有四份未改範例', () => {
  it('依實際寫入格式讀回後全部移除，存成空陣列，再建 state 不復生', () => {
    saveProjects(store, oldDeviceSamples());
    const state = createState(NOON);
    expect(state.projects).toEqual([]);
    expect(state.recentIds).toEqual([]);
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBe('[]');

    const reopened = createState(NOON);
    expect(reopened.projects).toEqual([]);
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBe('[]');
    expect(renderHome(reopened)).toContain(EMPTY_HOME);
  });

  it('只動到位置、上次編輯標籤或目錄展開，仍算沒改過', () => {
    const samples = oldDeviceSamples().map((project) => ({
      ...project,
      updatedLabel: '剛剛',
      lastOpenedNodeId: flat(project.nodes).find((node) => node.type !== 'folder')!.id,
      lastCursor: 3,
      nodes: project.nodes.map((node) => ({ ...node, expanded: node.expanded === false })),
    }));
    saveProjects(store, samples);
    // 只有位置記憶（沒有未完成卡片草稿）也不算改過
    saveWritePlace('fog', {
      chapterId: 'ch-1',
      chapterOpen: true,
      selectionStart: 1,
      selectionEnd: 1,
      scrollTop: 0,
      keyboard: false,
    }, store);
    resetNavMemoryCache();
    store.setItem(
      DEVICE_SAVE_RECORD_KEY,
      JSON.stringify({ saveMeta: { fog: { lastAutoSaveMs: 1, lastManualSaveMs: null, lastExportMs: null, lastProjectSaveMs: null } } }),
    );
    expect(createState(NOON).projects).toEqual([]);
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBe('[]');
  });

  it('更早的版本存下、沒有卡片欄位的範例，經同一套正規化後也算沒改過', () => {
    const legacy = DEMO_PROJECTS.map((project) => {
      const copy = cloneDemoProject(project) as Partial<DemoProject>;
      delete copy.cards;
      delete copy.categoryOrderRaw;
      delete copy.expandedCategoriesRaw;
      delete copy.categoriesMetaRaw;
      return copy;
    });
    store.setItem(OUTLINE_STORAGE_KEY, JSON.stringify(legacy));
    expect(createState(NOON).projects).toEqual([]);
  });

  it('重複執行結果相同：第二次不再改動本機儲存', () => {
    const edited = oldDeviceSamples();
    edited[0] = { ...edited[0]!, title: '霧港紀事（我改的書名）' };
    saveProjects(store, edited);
    const first = createState(NOON);
    const afterFirst = store.getItem(OUTLINE_STORAGE_KEY);
    const second = createState(NOON);
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBe(afterFirst);
    expect(second.projects).toEqual(first.projects);
    expect(second.projects.map((project) => project.id)).toEqual(['fog']);
  });
});

describe('WO-95 c. 改過的範例只留那一份，內容一字不動', () => {
  it('四份中一份正文改過：只留那份，內容完全不變，其餘三份移除', () => {
    const samples = oldDeviceSamples();
    const fog = samples.find((project) => project.id === 'fog')!;
    const edited: DemoProject = {
      ...fog,
      updatedLabel: '剛剛',
      nodes: fog.nodes.map((volume) => ({
        ...volume,
        children: volume.children?.map((chapter) =>
          chapter.id === 'ch-1' ? { ...chapter, content: `${chapter.content}\n\n我自己寫的一句話。` } : chapter,
        ),
      })),
    };
    const stored = samples.map((project) => (project.id === 'fog' ? edited : project));
    saveProjects(store, stored);
    const rawBefore = JSON.stringify(edited);

    const state = createState(NOON);
    expect(state.projects.map((project) => project.id)).toEqual(['fog']);
    expect(state.recentIds).toEqual(['fog']);
    expect(JSON.stringify(state.projects[0])).toBe(rawBefore);
    expect(flat(state.projects[0]!.nodes).find((node) => node.id === 'ch-1')!.content).toContain('我自己寫的一句話。');
    expect(storedOutline(store)).toEqual([JSON.parse(rawBefore)]);

    // 重新整理後仍在，內容仍相同
    const reopened = createState(NOON);
    expect(JSON.stringify(reopened.projects)).toBe(JSON.stringify([JSON.parse(rawBefore)]));
  });

  type Mutation = [string, string, (project: DemoProject) => DemoProject];
  const firstFile = (project: DemoProject) => flat(project.nodes).find((node) => node.type !== 'folder')!;
  const mapNodes = (nodes: ChapterNode[], fn: (node: ChapterNode) => ChapterNode): ChapterNode[] =>
    nodes.map((node) => fn({ ...node, ...(node.children ? { children: mapNodes(node.children, fn) } : {}) }));
  const mutations: Mutation[] = [
    ['書名', 'second', (p) => ({ ...p, title: '我的第二本' })],
    ['全書目標', 'old', (p) => ({ ...p, bookGoal: 12345 })],
    ['章節改名', 'long', (p) => ({ ...p, nodes: mapNodes(p.nodes, (n) => (n.id === 'long-3' ? { ...n, title: '第三章　改名' } : n)) })],
    ['章節排序', 'long', (p) => ({ ...p, nodes: [p.nodes[1]!, p.nodes[0]!, ...p.nodes.slice(2)] })],
    ['新增章', 'second', (p) => ({ ...p, nodes: [...p.nodes, { id: 'ch-new', type: 'file', title: '第二章　', progress: 'Draft', content: '' }] })],
    ['刪除章', 'long', (p) => ({ ...p, nodes: p.nodes.slice(0, -1) })],
    ['新增幕', 'fog', (p) => ({ ...p, nodes: mapNodes(p.nodes, (n) => (n.id === 'ch-3' ? { ...n, children: [{ id: 'sc-new', type: 'scene', title: '幕 1　新幕', progress: 'Draft', content: '' }] } : n)) })],
    ['刪除幕', 'fog', (p) => ({ ...p, nodes: mapNodes(p.nodes, (n) => (n.id === 'ch-2' ? { ...n, children: n.children!.slice(1) } : n)) })],
    ['進度', 'old', (p) => ({ ...p, nodes: mapNodes(p.nodes, (n) => (n.id === firstFile(p).id ? { ...n, progress: 'Final' } : n)) })],
    ['正文清空', 'second', (p) => ({ ...p, nodes: mapNodes(p.nodes, (n) => (n.id === 'second-ch' ? { ...n, content: '' } : n)) })],
    ['新增卡片', 'fog', (p) => ({ ...p, cards: [...p.cards!, { ...DEMO_CARDS[0]!, id: '90000000-0000-4000-8000-000000000001', title: '我的卡片' }] })],
    ['刪除卡片', 'second', (p) => ({ ...p, cards: p.cards!.slice(1) })],
    ['修改卡片內容', 'old', (p) => ({ ...p, cards: p.cards!.map((c, i) => (i === 2 ? { ...c, content: `${c.content}補一句` } : c)) })],
    ['修改卡片顏色', 'long', (p) => ({ ...p, cards: p.cards!.map((c, i) => (i === 0 ? { ...c, color: '#000000' } : c)) })],
    ['卡片排序', 'fog', (p) => ({ ...p, cards: [p.cards![1]!, p.cards![0]!, ...p.cards!.slice(2)] })],
    ['分類順序', 'second', (p) => ({ ...p, categoryOrderRaw: JSON.stringify([...JSON.parse(p.categoryOrderRaw!)].reverse()) })],
    ['自訂分類改名', 'old', (p) => ({ ...p, categoriesMetaRaw: JSON.stringify({ custom_5ce4e001: '我的分類' }) })],
    ['展開分類', 'long', (p) => ({ ...p, expandedCategoriesRaw: '["character"]' })],
    ['單篇／長篇', 'old', (p) => ({ ...p, shape: 'single' })],
    ['存過檔的標記', 'second', (p) => ({ ...p, hasExternalFile: true, titleInFile: p.title, filename: '第二本.db' })],
    ['不認得的欄位', 'fog', (p) => ({ ...p, somethingNew: 1 } as DemoProject)],
  ];

  it.each(mutations)('只改了「%s」也保留（%s），其餘未改範例照樣移除', (_label, id, mutate) => {
    const stored = oldDeviceSamples().map((project) => (project.id === id ? mutate(project) : project));
    saveProjects(store, stored);
    const expected = JSON.stringify(stored.find((project) => project.id === id));
    const state = createState(NOON);
    expect(state.projects.map((project) => project.id)).toEqual([id]);
    expect(JSON.stringify(state.projects[0])).toBe(expected);
    expect(storedOutline(store).map((project) => project.id)).toEqual([id]);
  });

  it('目標或存檔紀錄另存在裝置紀錄裡時也算用過，保留那份', () => {
    saveProjects(store, oldDeviceSamples());
    const schedule = withClock(createSchedule({ dayEndHour: 0, defaultGoal: 2000 }), NOON);
    store.setItem(
      DEVICE_SAVE_RECORD_KEY,
      JSON.stringify({
        saveMeta: { old: { lastAutoSaveMs: null, lastManualSaveMs: null, lastExportMs: 123, lastProjectSaveMs: null } },
        goalById: { second: schedule },
        logsById: { second: [] },
        exportedFiles: {},
      }),
    );
    const state = createState(NOON);
    expect(state.projects.map((project) => project.id).sort()).toEqual(['old', 'second']);
  });
});

describe('WO-95 d. 未併回草稿', () => {
  it('範例有未併回 live draft：即使正文等於範例也保留，草稿不清、不覆寫', () => {
    saveProjects(store, oldDeviceSamples());
    const old = DEMO_PROJECTS.find((project) => project.id === 'old')!;
    const draft = { projectId: 'old', chapterId: 'old-ch', text: old.nodes[0]!.content!, at: 1234 };
    writeLiveDraft(store, draft);
    const rawDraft = store.getItem(LIVE_DRAFT_KEY);

    const state = createState(NOON);
    expect(state.projects.map((project) => project.id)).toEqual(['old']);
    expect(store.getItem(LIVE_DRAFT_KEY)).toBe(rawDraft);
    expect(loadLiveDraft(store)).toEqual(draft);
    expect(flat(state.projects[0]!.nodes)[0]!.content).toBe(old.nodes[0]!.content);

    // 草稿內容與正文不同時一樣保留，正文不被範例覆寫
    store = memoryStore();
    vi.stubGlobal('localStorage', store);
    saveProjects(store, oldDeviceSamples());
    writeLiveDraft(store, { ...draft, text: '還沒併回的新字' });
    const second = createState(NOON);
    expect(second.projects.map((project) => project.id)).toEqual(['old']);
    expect(loadLiveDraft(store)?.text).toBe('還沒併回的新字');
  });

  it('位置記憶裡有未完成的卡片草稿：保留該稿，卡片草稿也還在', () => {
    saveProjects(store, oldDeviceSamples());
    const cardId = DEMO_CARDS[3]!.id;
    saveCardDraft('long', cardId, { title: '改到一半', content: '還沒按完成', color: '#3C3F41' }, store);
    resetNavMemoryCache();
    const rawMemory = store.getItem(navMemoryKey('long'));

    const state = createState(NOON);
    expect(state.projects.map((project) => project.id)).toEqual(['long']);
    expect(store.getItem(navMemoryKey('long'))).toBe(rawMemory);
    resetNavMemoryCache();
    expect(getCardDraft('long', cardId, store)).toEqual({ title: '改到一半', content: '還沒按完成', color: '#3C3F41' });
  });

  it('讀不到位置記憶時當作有草稿，保守留稿', () => {
    const throwing = {
      ...memoryStore(),
      getItem: (key: string) => {
        if (key.startsWith('jiufang-novel-m.nav-memory.v1:')) throw new Error('讀不到');
        return key === OUTLINE_STORAGE_KEY ? JSON.stringify(oldDeviceSamples()) : null;
      },
    };
    vi.stubGlobal('localStorage', throwing);
    const state = createState(NOON);
    expect(state.projects.map((project) => project.id)).toEqual(DEMO_IDS);
    // 沒有拿掉任何一份，就不寫回
    expect(throwing.data.has(OUTLINE_STORAGE_KEY)).toBe(false);
  });
});

describe('WO-95 e. 自己的稿子與範例並存', () => {
  it('新開稿、從檔案開的稿子完全不動；同名、含【範例】或同內建識別碼但 origin 為 file 都不誤刪', () => {
    const mine: DemoProject = {
      id: 'p-1700000000000',
      title: '【範例】霧港紀事',
      updatedLabel: '剛剛',
      bookGoal: 100000,
      origin: 'demo',
      lastOpenedNodeId: 'ch-mine',
      lastCursor: 0,
      cards: [],
      categoryOrderRaw: '["summary","character","world","timeline","ai_chat"]',
      expandedCategoriesRaw: null,
      categoriesMetaRaw: '{}',
      nodes: [{ id: 'ch-mine', type: 'file', title: '第一章　', progress: 'Draft', content: '我自己的稿子。' }],
    };
    const sameAsSample = { ...oldDeviceSamples()[1]!, id: 'p-1700000000001' };
    const fileFog: DemoProject = { ...oldDeviceSamples()[0]!, origin: 'file', dbKey: 'fog' };
    const stored = [mine, sameAsSample, fileFog, ...oldDeviceSamples()];
    saveProjects(store, stored);
    const schedule = withClock(createSchedule({ dayEndHour: 0, defaultGoal: 1000 }), NOON);
    const myLogs = [{ id: 1, date: '2026-11-15', duration: 60, word_count: 7, ai_continuation_count: 0, ai_continuation_chars: 0, ai_chat_count: 0, ai_details: '{}', paste_large_count: 0, delete_large_count: 0 }];
    store.setItem(
      DEVICE_SAVE_RECORD_KEY,
      JSON.stringify({ saveMeta: {}, goalById: { [mine.id]: schedule }, logsById: { [mine.id]: myLogs }, exportedFiles: {} }),
    );

    const state = createState(NOON);
    expect(state.projects.map((project) => project.id)).toEqual([mine.id, sameAsSample.id, 'fog']);
    expect(JSON.stringify(state.projects[0])).toBe(JSON.stringify(mine));
    expect(JSON.stringify(state.projects[1])).toBe(JSON.stringify(sameAsSample));
    expect(state.projects[2]!.origin).toBe('file');
    expect(JSON.stringify(state.projects[2])).toBe(JSON.stringify(fileFog));
    expect(state.logsById[mine.id]).toEqual(myLogs);
    expect(state.goalById[mine.id]).toBeDefined();
    // 寫回本機時只拿掉未改範例，自己的稿子原樣留著（從檔案開的稿子本來就不寫進這個清單）
    expect(storedOutline(store).map((project) => project.id)).toEqual([mine.id, sameAsSample.id]);
  });

  it('dropUntouchedSamples 不碰非內建識別碼與 origin 為 file 的稿子', () => {
    const context = { liveDraft: null, hasCardDrafts: () => false, record: { saveMeta: {}, goalById: {}, logsById: {} } };
    const fileFog = { ...oldDeviceSamples()[0]!, origin: 'file' as const };
    expect(isUntouchedSample(fileFog, context)).toBe(false);
    expect(isUntouchedSample({ ...oldDeviceSamples()[0]!, id: 'fog-copy' }, context)).toBe(false);
    const { kept, removedIds } = dropUntouchedSamples([fileFog, ...oldDeviceSamples()], context);
    expect(kept).toEqual([fileFog]);
    expect(removedIds).toEqual(DEMO_IDS);
  });

  it('讀回缺卡片欄位的自己稿子時，補空卡片與新稿子預設分類，不塞範例卡片', () => {
    const legacyMine = { id: 'p-1', title: '我的舊稿', updatedLabel: '昨天', bookGoal: 1000, nodes: [] } as DemoProject;
    store.setItem(OUTLINE_STORAGE_KEY, JSON.stringify([legacyMine]));
    const [loaded] = createState(NOON).projects;
    expect(loaded!.cards).toEqual([]);
    expect(loaded!.categoryOrderRaw).toBe('["summary","character","world","timeline","ai_chat"]');
    expect(loaded!.categoriesMetaRaw).toBe('{}');
    expect(loaded!.expandedCategoriesRaw).toBeNull();
  });

  it('壞掉或拿不準的範例資料一律保留', () => {
    const context = { liveDraft: null, hasCardDrafts: () => false, record: { saveMeta: {}, goalById: {}, logsById: {} } };
    const broken = { ...oldDeviceSamples()[2]!, nodes: null } as unknown as DemoProject;
    expect(isUntouchedSample(broken, context)).toBe(false);
    const throwingDrafts = { ...context, hasCardDrafts: () => { throw new Error('讀不到'); } };
    expect(isUntouchedSample(oldDeviceSamples()[0]!, throwingDrafts)).toBe(false);
  });
});

describe('WO-95 f. 空白狀態的既有操作', () => {
  it('開新稿子後可進寫作、寫字，統計從自己的資料計算', () => {
    let state = createState(NOON);
    state = reduce(state, { type: 'add-project', id: 'p-new', title: '我的新稿', shape: 'novel' });
    expect(state.recentIds).toEqual(['p-new']);
    state = reduce(state, { type: 'focus-project', id: 'p-new' });
    const chapterId = firstFileNode(state.projects[0]!.nodes)!.id;
    expect(statsOf(state).todayWords).toBe(0);
    state = reduce(state, { type: 'commit-text', projectId: 'p-new', nodeId: chapterId, text: '霧從港口退去。' });
    expect(statsOf(state).todayWords).toBe(7);
    expect(statsOf(state).achievementCount).toBe(0);
    expect(state.logs.map((log) => log.date)).toEqual(['2026-11-16']);
    expect(state.projects.some((project) => DEMO_IDS.includes(project.id))).toBe(false);

    const home = renderHome(state);
    expect(home).toContain('我的新稿');
    expect(home).not.toContain(EMPTY_HOME);
    const write = renderAt(`/p/p-new/write/${chapterId}`, state);
    expect(write).toContain('data-testid="write-screen"');
    expect(textOf(write)).not.toContain(MANUSCRIPT_NOT_FOUND);
    expect(write).not.toContain('【範例】');
  });

  it('開 .db 後可進寫作，用的是檔案自己的內容與紀錄', () => {
    // 程式產生的 .db：空白殼加一章正文
    const { db, sql } = openNodeSql();
    let loaded: ReturnType<typeof readFileProject>;
    try {
      createVersion14Shell(sql);
      writeFileProject(
        sql,
        {
          title: '從檔案開的稿子',
          logline: '',
          currentTheme: '',
          globalFontFamily: '',
          globalFontSize: 12,
          editorFontFamily: '',
          editorFontSize: 16,
          targetWordCount: 50000,
          dailyTargetWordCount: 800,
          categoryOrder: null,
          expandedCategories: null,
          categoriesMeta: '{}',
          lastOpenedNodeId: 'db-ch-1',
          lastCursorPosition: 0,
        },
        [{ id: 'db-ch-1', type: 'file', title: '第一章　檔案', progress: 'Draft', content: '檔案裡的正文。' }],
        [],
        [],
      );
      loaded = readFileProject(sql);
    } finally {
      db.close();
    }
    let state = createState(NOON);
    state = reduce(state, {
      type: 'attach-file',
      project: {
        id: 'file-1',
        dbKey: 'file-1',
        title: loaded.info.title,
        updatedLabel: '剛剛',
        bookGoal: loaded.info.targetWordCount,
        nodes: loaded.tree,
        origin: 'file',
      },
      schedule: scheduleFromLogs(loaded.logs, loaded.info.dailyTargetWordCount, NOON),
      extras: { info: loaded.info, cards: loaded.cards, logs: loaded.logs },
    });
    expect(state.activeProjectId).toBe('file-1');
    expect(statsOf(state).todayGoal).toBe(800);
    expect(statsOf(state).achievementCount).toBe(0);
    const write = renderAt('/p/file-1/write/db-ch-1', state);
    expect(write).toContain('data-testid="write-screen"');
    expect(write).toContain('第一章　檔案');
    expect(write).not.toContain('【範例】');
  });
});

describe('WO-95 沒有任何稿子時各畫面與失效路徑', () => {
  it('直接開寫作、資料集、檔案、統計、設定、紀錄路徑（含已清掉的範例 id）都顯示既有提示，不補回範例', () => {
    saveProjects(store, oldDeviceSamples());
    const state = createState(NOON);
    expect(state.projects).toEqual([]);
    for (const path of [
      '/p/fog/write',
      '/p/fog/write/ch-1',
      '/p/fog/cards',
      '/p/second/files',
      '/p/old/stats',
      '/p/long/settings',
      '/p/fog/logs',
      '/p/p-unknown/write',
    ]) {
      const html = renderAt(path, state);
      expect(textOf(html), path).toContain(MANUSCRIPT_NOT_FOUND);
      expect(html, path).toMatch(HOME_LINK);
      expect(html, path).not.toContain('【範例】');
      expect(html, path).not.toContain(SAMPLE_CARDS_NOTICE);
    }
    expect(renderAt('/', state)).toContain(EMPTY_HOME);
  });

  it('看卡片資料在稿子不存在時是空的，不以路徑識別碼補範例卡片', () => {
    const state = createState(NOON);
    const data = readWritingCardsData(state, 'fog', null);
    expect(data.cards).toEqual([]);
    expect(data.isSample).toBe(false);
  });

  it('位置記憶指向已清掉的範例：清掉後再開不當機，也不重新放回範例', () => {
    saveProjects(store, oldDeviceSamples());
    saveWritePlace('fog', {
      chapterId: 'ch-2',
      chapterOpen: true,
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      keyboard: false,
    }, store);
    resetNavMemoryCache();
    const state = createState(NOON);
    expect(state.projects).toEqual([]);
    const html = renderAt('/p/fog/write/ch-2', state);
    expect(textOf(html)).toContain(MANUSCRIPT_NOT_FOUND);
    expect(html).toMatch(HOME_LINK);
    expect(createState(NOON).projects).toEqual([]);
  });

  it('沒有稿子時改每日目標與一天結束時刻照舊可用，且不帶入範例紀錄', () => {
    let state = createState(NOON);
    state = reduce(state, { type: 'set-goal', goal: 1500 });
    expect(statsOf(state).todayGoal).toBe(1500);
    expect(state.logs).toEqual([]);
    expect(state.schedule.settled).toEqual([]);
  });
});
