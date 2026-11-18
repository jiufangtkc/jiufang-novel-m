/**
 * WO-104 返工 3：鍵盤測試頁。同一棵 React 樹裡掛真實的 EditorPane 與 CardEditor（共用正式的查字典 tracker），
 * 資料只用專案內建的示範 fixture。僅供 src/dictionary/dictionary.wo104-r3.browser.test.ts 以 Vite 打包後載入。
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CardEditor } from '../../src/components/CardEditor';
import { LayoutProvider } from '../../src/layout';
import { EditorPane } from '../../src/screens/EditorPane';
import { SampleProvider } from '../../src/state/sampleStore';
import { demoFixtureState } from '../../src/state/testing/sampleFixture';
import type { ChapterNode } from '../../src/data/demo';

const state = demoFixtureState(new Date('2026-11-15T12:00:00Z'));
const project = state.projects[0];
const firstChapter = (nodes: ChapterNode[]): ChapterNode | null => {
  for (const n of nodes) {
    if (n.type === 'chapter') return n;
    const c = n.children ? firstChapter(n.children) : null;
    if (c) return c;
  }
  return null;
};
const chapter: ChapterNode = { ...(firstChapter(project.nodes) as ChapterNode), content: '' };

const card = { id: 'card-r3', title: '測試卡片', content: '', color: null };

createRoot(document.getElementById('root') as HTMLElement).render(
  <SampleProvider initialState={state}>
    <LayoutProvider initialMode="wide">
      <MemoryRouter initialEntries={[`/p/${project.id}/write`]}>
        <div id="body-host">
          <EditorPane projectId={project.id} chapter={chapter} />
        </div>
        <div id="card-host">
          <CardEditor card={card} initialMode="edit" layoutMode="wide" onSave={() => {}} onDone={() => {}} />
        </div>
      </MemoryRouter>
    </LayoutProvider>
  </SampleProvider>,
);
