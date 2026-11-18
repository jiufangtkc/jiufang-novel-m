import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MANUSCRIPT_NOT_FOUND,
  MANUSCRIPT_NOT_FOUND_AFTER_LINK,
  MANUSCRIPT_NOT_FOUND_BEFORE_LINK,
  MANUSCRIPT_NOT_FOUND_LINK,
} from '../copy/userFacing';
import { DEMO_PROJECTS } from '../data/demo';
import { normalizeLoadedProject, saveProjects } from '../domain/outline';
import { LayoutProvider } from '../layout';
import { resetNavMemoryCache } from '../state/navMemory';
import { cloneDemoProject, createState, SampleProvider, type SampleState } from '../state/sampleStore';
import { CardsScreen } from './CardsScreen';
import { FilesScreen } from './FilesScreen';
import { FontLicenseScreen } from './FontLicenseScreen';
import { HomeScreen } from './HomeScreen';
import { LogsScreen } from './LogsScreen';
import { SettingsScreen } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { Workspace } from './Workspace';
import { WriteScreen } from './WriteScreen';

const NOON = new Date('2026-11-16T04:00:00Z');
const EMPTY_HOME = '還沒有稿子。開一本新的，或開啟已經存在的 .db 稿件檔。';
/** 「回首頁」連結（react-router Link 會輸出成 a 標籤）；取出 href。 */
const HOME_LINK = /<a [^>]*data-testid="not-found-home-link"[^>]*>回首頁<\/a>/;

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function hrefOf(html: string): string | null {
  const tag = html.match(HOME_LINK)?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1] ?? null;
}

/** 與 App.tsx 相同的路由結構。 */
const routes: RouteObject[] = [
  { path: '/', element: createElement(HomeScreen) },
  {
    path: '/p/:projectId',
    element: createElement(Workspace),
    children: [
      { path: 'write/:chapterId?', element: createElement(WriteScreen) },
      { path: 'cards', element: createElement(CardsScreen) },
      { path: 'files', element: createElement(FilesScreen) },
      { path: 'stats', element: createElement(StatsScreen) },
      { path: 'settings', element: createElement(SettingsScreen) },
      { path: 'font-license', element: createElement(FontLicenseScreen) },
      { path: 'logs', element: createElement(LogsScreen) },
    ],
  },
];

function render(router: ReturnType<typeof createMemoryRouter>, state: SampleState): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: state },
      createElement(LayoutProvider, { initialMode: 'phone-portrait' }, createElement(RouterProvider, { router })),
    ),
  );
}

/** 程式產生的本機儲存替身。 */
function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
  };
}

/** 舊裝置只有四份未改範例，啟動後全部被清掉的狀態。 */
function stateAfterSamplesCleared(): SampleState {
  const store = memoryStore();
  vi.stubGlobal('localStorage', store);
  saveProjects(
    store,
    DEMO_PROJECTS.map((project) => normalizeLoadedProject({ ...cloneDemoProject(project), origin: 'demo' })),
  );
  const state = createState(NOON);
  expect(state.projects).toEqual([]);
  return state;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  resetNavMemoryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WO-95 返工：找不到稿子提示的「回首頁」可點', () => {
  it('拆開的三段接起來與既有句子一字不差，沒有新用字', () => {
    expect(MANUSCRIPT_NOT_FOUND_BEFORE_LINK + MANUSCRIPT_NOT_FOUND_LINK + MANUSCRIPT_NOT_FOUND_AFTER_LINK).toBe(
      MANUSCRIPT_NOT_FOUND,
    );
    expect(MANUSCRIPT_NOT_FOUND).toBe('找不到這份稿子。請回首頁重新開啟。');
    expect(MANUSCRIPT_NOT_FOUND_LINK).toBe('回首頁');
  });

  it.each(['/p/fog/write', '/p/fog/write/ch-1', '/p/fog/cards', '/p/second/files', '/p/old/stats', '/p/long/settings', '/p/fog/logs'])(
    '沒有任何稿子時開 %s：提示整句文字不變，「回首頁」是連到 / 的連結；點下後回到首頁、看得到「開新稿子」',
    async (path) => {
      const state = stateAfterSamplesCleared();
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      const before = render(router, state);
      expect(textOf(before)).toContain(MANUSCRIPT_NOT_FOUND);
      expect(before).toMatch(HOME_LINK);
      expect(before).not.toContain('開新稿子');
      const href = hrefOf(before);
      expect(href).toBe('/');

      // 測試環境沒有 DOM 可發點擊事件；Link 被點下時做的就是讓路由前往 href，這裡讓同一個路由照做。
      await router.navigate(href!);
      expect(router.state.location.pathname).toBe('/');
      const after = render(router, state);
      expect(after).toContain('data-testid="home-screen"');
      expect(after).toContain('開新稿子');
      expect(after).toContain('開啟稿子');
      expect(after).toContain(EMPTY_HOME);
      expect(textOf(after)).not.toContain(MANUSCRIPT_NOT_FOUND);
      router.dispose();
    },
  );

  it('不自動導回首頁：停在提示頁，路徑不變（手機儲存的檔案稿可能稍後才掛回）', () => {
    const state = stateAfterSamplesCleared();
    const router = createMemoryRouter(routes, { initialEntries: ['/p/file-123/write'] });
    render(router, state);
    expect(router.state.location.pathname).toBe('/p/file-123/write');
    router.dispose();
  });

  it('各畫面找不到稿子時都用同一個元件，不再直接印出整句', () => {
    for (const name of ['Workspace', 'WriteScreen', 'CardsScreen', 'FilesScreen', 'StatsScreen', 'SettingsScreen', 'LogsScreen', 'FontLicenseScreen']) {
      const source = readFileSync(new URL(`./${name}.tsx`, import.meta.url), 'utf8');
      expect(source, name).toContain('<ManuscriptNotFound />');
      expect(source, name).not.toContain('{MANUSCRIPT_NOT_FOUND}');
    }
  });
});
