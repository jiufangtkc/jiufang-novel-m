import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as copy from '../copy/duplicateOpenCopy';
import {
  BADGE_SAME_BOOK,
  BADGE_SAME_TITLE,
  DUPLICATE_CANCEL,
  KEEP_ONE_BUTTON,
  KEEP_ONE_CANCEL,
  KEEP_ONE_CONFIRM,
  KEEP_ONE_PARTIAL_FAILED,
  KEEP_ONE_UNSAVED_NOTE,
  REPLACE_CONFIRM,
  REPLACE_OLD_REMOVE_FAILED,
  SAME_BOOK_BODY,
  SAME_BOOK_DIFFERS_NOTE,
  SAME_BOOK_OPEN_EXISTING,
  SAME_BOOK_REPLACE,
  SAME_TITLE_KEEP_SEPARATE,
  SAME_TITLE_OPEN_EXISTING,
  filenameLine,
  keepOneBody,
  keepOneTitle,
  removeAlsoSameTitleNote,
  replaceConfirmBody,
  replaceConfirmTitle,
  sameBookTitle,
  sameTitleBody,
  sameTitleTitle,
} from '../copy/duplicateOpenCopy';
import { REMOVE_FROM_DEVICE_BODY } from '../copy/userFacing';
import { resetRemovedBooksForTest } from '../db/removedBooks';
import type { DuplicateOpenInfo } from '../domain/duplicateOpen';
import { LayoutProvider } from '../layout';
import { resetNavMemoryCache } from '../state/navMemory';
import { removeOtherCopies } from '../state/keepOnlyThis';
import { recentListEntries } from '../state/recentProjects';
import { addProjectAction, createState, reduce, SampleProvider, type SampleState } from '../state/sampleStore';
import { DuplicateOpenDialog } from './DuplicateOpenDialog';
import { HomeScreen } from './HomeScreen';
import { KeepOnlyThisDialog } from './KeepOnlyThisDialog';
import { RemoveFromDeviceDialog } from './RemoveFromDeviceDialog';

const UUID_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const NOON = new Date('2026-11-27T04:00:00Z');
const noop = () => undefined;

function memoryStore() {
  const data = new Map<string, string>();
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStore());
  resetNavMemoryCache();
  resetRemovedBooksForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNavMemoryCache();
  resetRemovedBooksForTest();
});

/** 以程式產生的範例稿組出首頁狀態：每筆 [代號, 書名, 身分證, 檔名]。 */
function homeState(
  rows: Array<[string, string, string | undefined, string | undefined, boolean?]>,
): SampleState {
  let state = createState(NOON);
  rows.forEach(([id, title], index) => {
    state = reduce(state, addProjectAction(id, title, 'novel', 1000 + index));
  });
  return {
    ...state,
    projects: state.projects.map((project) => {
      const row = rows.find(([id]) => id === project.id)!;
      return { ...project, bookUuid: row[2], filename: row[3], bookMetaPersisted: row[4] };
    }),
  };
}

function renderHome(state: SampleState): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: state },
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait' },
        createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(HomeScreen)),
      ),
    ),
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

/** 用字檔裡所有「字串常數」（函式型的另外呼叫後取字串）。 */
const copyStrings: string[] = Object.values(copy as Record<string, unknown>).filter(
  (value): value is string => typeof value === 'string',
);

describe('WO-143：用字守衛', () => {
  const sample = '範例書';
  const all: string[] = [
    ...copyStrings,
    sameBookTitle(sample),
    replaceConfirmTitle(sample),
    replaceConfirmBody(sample),
    sameTitleTitle(sample),
    sameTitleBody(sample),
    filenameLine('範例.db'),
    removeAlsoSameTitleNote(sample),
    keepOneTitle(sample),
    keepOneBody(2),
  ];

  it('逐字等於暫定用字', () => {
    expect(sameBookTitle('道劍')).toBe('這個裝置上已經有「道劍」了');
    expect(SAME_BOOK_BODY).toBe(
      '你剛才選的檔，和這個裝置上已有的稿子是同一本。要打開原本那份，還是用剛選的檔換成這個裝置上的那份？',
    );
    expect(SAME_BOOK_DIFFERS_NOTE).toBe('注意：兩份的內容不一樣。打開原本那份，看到的是這個裝置上的版本，不是剛選的檔。');
    expect([SAME_BOOK_OPEN_EXISTING, SAME_BOOK_REPLACE, DUPLICATE_CANCEL]).toEqual(['打開原本那份', '用剛選的檔取代', '取消']);
    expect(replaceConfirmTitle('道劍')).toBe('要用剛選的檔取代這個裝置上的「道劍」嗎？');
    expect(replaceConfirmBody('道劍')).toBe(
      '這個裝置上的「道劍」還有還沒存回檔案的改動。取代後，那些改動會從這個裝置拿掉，刪了就找不回來。你另存在別處的 .db 稿件檔不會受影響。',
    );
    expect(REPLACE_CONFIRM).toBe('取代');
    expect(sameTitleTitle('道劍')).toBe('這個裝置上已經有一本也叫「道劍」');
    expect(sameTitleBody('道劍')).toBe(
      '剛才選的檔和已有的那本都叫「道劍」，但看起來不是同一份。要打開已有的那本，還是把剛選的檔另外留下來？',
    );
    expect([SAME_TITLE_OPEN_EXISTING, SAME_TITLE_KEEP_SEPARATE]).toEqual(['打開已有的那本', '另外留下']);
    expect([BADGE_SAME_BOOK, BADGE_SAME_TITLE]).toEqual(['同一本的另一份', '書名相同，但不是同一份檔']);
    expect(filenameLine('道劍.db')).toBe('檔名：道劍.db');
    expect(removeAlsoSameTitleNote('道劍')).toBe('這個裝置上還有其他也叫「道劍」的稿子，這次只刪你現在選的這一份。');
    expect(KEEP_ONE_BUTTON).toBe('留下這一份，刪掉同一本的其他份');
    expect(keepOneTitle('道劍')).toBe('留下這一份「道劍」，刪掉這個裝置上同一本的其他份嗎？');
    expect(keepOneBody(2)).toBe('其他 2 份會從這個裝置拿掉，刪了就找不回來。你另存在別處的 .db 稿件檔不會受影響。');
    expect(KEEP_ONE_UNSAVED_NOTE).toBe('其中有的還有還沒存回檔案的改動。');
    expect([KEEP_ONE_CONFIRM, KEEP_ONE_CANCEL]).toEqual(['刪掉其他份', '取消']);
    expect(REPLACE_OLD_REMOVE_FAILED).toBe('剛選的檔已經開好了，但這個裝置上原本那份沒能刪掉，兩份都還在，可以回首頁處理。');
    expect(KEEP_ONE_PARTIAL_FAILED).toBe('有幾份沒能刪掉，已刪掉的不會回復，其餘還在，請再試一次。');
  });

  it('沒有簡體字，也沒有「這台」', () => {
    const simplified = ['删', '设', '备', '这', '从', '会', '开', '关', '档', '还', '个', '么', '对', '为', '时', '给', '击', '后', '仅', '统', '单', '体', '复'];
    for (const text of all) {
      for (const ch of simplified) expect(text, text).not.toContain(ch);
      expect(text).not.toContain('這台');
      expect(text).not.toMatch(/這台.*裝置|裝置.*這台/);
    }
    const source = readFileSync(new URL('../copy/duplicateOpenCopy.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('這台');
  });

  it('元件不硬寫字串：新元件與首頁新增部分只引用用字檔', () => {
    // 去掉註解後，只看引號包起來的字串字面值與 JSX 文字節點（import／識別字名稱不算）。
    const literalsOf = (raw: string): string[] => {
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"])\/\/.*$/gm, '');
      const found: string[] = [];
      for (const match of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`|>([^<>{}]+)</g)) {
        found.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
      }
      return found;
    };
    // HomeScreen 本來就有不屬於本單的短字串（例如開新稿子視窗的「取消」），只檢查 5 個字以上的用字檔常數。
    const targets: Array<[string, number]> = [
      ['DuplicateOpenDialog.tsx', 1],
      ['KeepOnlyThisDialog.tsx', 1],
      ['HomeScreen.tsx', 5],
    ];
    for (const [file, minLength] of targets) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      const literals = literalsOf(source);
      for (const text of copyStrings.filter((value) => value.length >= minLength)) {
        for (const literal of literals) {
          expect(literal, `${file} 不該硬寫：${text}`).not.toContain(text);
        }
      }
    }
  });

  it('守衛不會空過：新元件與首頁確實 import 並使用 duplicateOpenCopy', () => {
    const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    for (const file of ['DuplicateOpenDialog.tsx', 'KeepOnlyThisDialog.tsx', 'HomeScreen.tsx']) {
      expect(read(file), file).toContain("from '../copy/duplicateOpenCopy'");
    }
    expect(read('DuplicateOpenDialog.tsx')).toContain('{DUPLICATE_CANCEL}');
    expect(read('DuplicateOpenDialog.tsx')).toContain('sameBookTitle(info.title)');
    expect(read('KeepOnlyThisDialog.tsx')).toContain('keepOneTitle(props.bookTitle)');
    expect(read('HomeScreen.tsx')).toContain('{KEEP_ONE_BUTTON}');
    expect(read('HomeScreen.tsx')).toContain('BADGE_SAME_BOOK');
  });
});

describe('WO-143：開檔詢問視窗', () => {
  const info = (extra: Partial<DuplicateOpenInfo> = {}): DuplicateOpenInfo => ({
    kind: 'same-book',
    existingId: 'p1',
    title: '道劍',
    existingFilename: '道劍.db',
    openedFilename: '道劍.db',
    hasUnsavedChanges: false,
    contentDiffers: false,
    ...extra,
  });
  const render = (value: DuplicateOpenInfo) =>
    renderToStaticMarkup(createElement(DuplicateOpenDialog, { info: value, onChoose: noop }));

  it('同一本：標題、說明、三顆按鈕、無障礙屬性；內容相同時沒有「內容不一樣」那句', () => {
    const html = render(info());
    expect(html).toContain(sameBookTitle('道劍'));
    expect(html).toContain(SAME_BOOK_BODY);
    expect(html).toContain(SAME_BOOK_OPEN_EXISTING);
    expect(html).toContain(SAME_BOOK_REPLACE);
    expect(html).toContain(DUPLICATE_CANCEL);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="duplicate-open-title"');
    expect(html).not.toContain(SAME_BOOK_DIFFERS_NOTE);
    expect(html).not.toContain(SAME_TITLE_KEEP_SEPARATE);
  });

  it('同一本、內容不同：多一句提醒', () => {
    expect(render(info({ contentDiffers: true }))).toContain(SAME_BOOK_DIFFERS_NOTE);
  });

  it('只是同名：較輕的提示，三顆按鈕是「打開已有的那本」「另外留下」「取消」，沒有「取代」', () => {
    const html = render(info({ kind: 'same-title', contentDiffers: true }));
    expect(html).toContain(sameTitleTitle('道劍'));
    expect(html).toContain(sameTitleBody('道劍'));
    expect(html).toContain(SAME_TITLE_OPEN_EXISTING);
    expect(html).toContain(SAME_TITLE_KEEP_SEPARATE);
    expect(html).toContain(DUPLICATE_CANCEL);
    expect(html).not.toContain(SAME_BOOK_REPLACE);
    expect(html).not.toContain(SAME_BOOK_DIFFERS_NOTE);
  });

  it('原始碼：有未存回檔案的改動才進第二步確認；Esc 與點背景＝取消', () => {
    const source = readFileSync(new URL('./DuplicateOpenDialog.tsx', import.meta.url), 'utf8');
    expect(source).toContain("info.hasUnsavedChanges ? setConfirmingReplace(true) : onChoose('replace')");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("onClick={() => onChoose('cancel')}");
  });

  it('useOpenManuscriptFile：對話框放進它回傳的 input，取消回報 cancelled，開著時維持 busy（begin 在詢問之前）', () => {
    const hook = readFileSync(new URL('./useOpenManuscriptFile.tsx', import.meta.url), 'utf8');
    expect(hook).toContain('<DuplicateOpenDialog info={dup} onChoose={answerDuplicate} />');
    expect(hook).toMatch(/if \(!opened\) \{[^}]*settle\('cancelled'\);\s*return;/);
    expect(hook.indexOf('begin();', hook.indexOf('onChange'))).toBeLessThan(hook.indexOf('importFile(file, null'));
    expect(hook).toContain('dupResolveRef.current?.(\'cancel\')');
  });
});

describe('WO-143 審查必修 1：詢問視窗要蓋過歡迎導覽', () => {
  const css = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  const zOf = (source: string, selector: string): number => {
    const block = source.match(new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
    const z = block?.[1]?.match(/z-index:\s*(\d+)/);
    expect(z, `${selector} 要有 z-index`).not.toBeNull();
    return Number(z![1]);
  };

  it('「已經有了」視窗與「留下這一份」視窗的層級高於歡迎導覽，且低於改版說明', () => {
    const tour = zOf(css('./welcomeTour.css'), '.welcome-tour');
    const dup = zOf(css('../styles/global.css'), '.sheet-backdrop.duplicate-open-backdrop');
    const whatsNew = zOf(css('../components/whatsNewDialog.css'), '.whats-new-backdrop');
    expect(tour).toBe(300);
    expect(dup).toBeGreaterThan(tour);
    expect(dup).toBeLessThan(whatsNew);
    expect(css('../styles/global.css')).toMatch(/\.sheet-backdrop\.duplicate-open-backdrop\s*\{[^}]*position:\s*fixed/);
    expect(css('../styles/global.css')).toMatch(/z-index:\s*\d+\s*!important/);
  });

  it('兩個視窗都套用該層級的 class，並在出現時把焦點移進視窗', () => {
    for (const file of ['DuplicateOpenDialog.tsx', 'KeepOnlyThisDialog.tsx']) {
      const source = css(`./${file}`);
      expect(source, file).toContain('duplicate-open-backdrop');
      expect(source, file).toContain('tabIndex={-1}');
      expect(source, file).toContain('dialogRef.current?.focus()');
    }
  });
});

describe('WO-143：刪除確認視窗多一句', () => {
  const render = (extraNote?: string | null) =>
    renderToStaticMarkup(
      createElement(RemoveFromDeviceDialog, { bookTitle: '道劍', busy: false, extraNote, onConfirm: noop, onCancel: noop }),
    );

  it('沒有同名：與以前完全一樣', () => {
    const before = renderToStaticMarkup(
      createElement(RemoveFromDeviceDialog, { bookTitle: '道劍', busy: false, onConfirm: noop, onCancel: noop }),
    );
    expect(render(null)).toBe(before);
    expect(render(undefined)).toBe(before);
    expect(before).toContain(`<p id="remove-from-device-body">${REMOVE_FROM_DEVICE_BODY}</p>`);
  });

  it('有同名：既有內文逐字不動，後面多一句', () => {
    const html = render(removeAlsoSameTitleNote('道劍'));
    expect(html).toContain(`${REMOVE_FROM_DEVICE_BODY}${removeAlsoSameTitleNote('道劍')}`);
    expect(html).toContain('要從這個裝置刪掉「道劍」嗎？');
  });
});

describe('WO-143：首頁並列', () => {
  it('沒有重名：沒有標示、檔名行與「留下這一份」', () => {
    const html = renderHome(homeState([['p1', '甲書', UUID_A, 'a.db'], ['p2', '乙書', UUID_B, 'b.db']]));
    expect(count(html, 'data-testid="project-card"')).toBe(2);
    expect(html).not.toContain('project-badge');
    expect(html).not.toContain('keep-only-this');
    expect(html).not.toContain('檔名：');
    expect(html).not.toContain('has-keep-one');
  });

  it('同書名兩份不同本：兩份都列，各有檔名與「書名相同，但不是同一份檔」，沒有「留下這一份」', () => {
    const html = renderHome(homeState([['p1', '同名書', UUID_A, 'a.db'], ['p2', '同名書', UUID_B, 'b.db']]));
    expect(count(html, 'data-testid="project-card"')).toBe(2);
    expect(count(html, BADGE_SAME_TITLE)).toBe(2);
    expect(html).toContain(filenameLine('a.db'));
    expect(html).toContain(filenameLine('b.db'));
    expect(html).not.toContain(KEEP_ONE_BUTTON);
    expect(html).not.toContain(BADGE_SAME_BOOK);
  });

  it('同一本兩份：標示「同一本的另一份」，每份都有「留下這一份」小字鈕；X 的標籤仍用書名但刪除對象用代號', () => {
    const html = renderHome(homeState([['p1', '道劍', UUID_A, 'a.db'], ['p2', '道劍', UUID_A, 'b.db']]));
    expect(count(html, 'data-testid="project-card"')).toBe(2);
    expect(count(html, BADGE_SAME_BOOK)).toBe(2);
    expect(count(html, KEEP_ONE_BUTTON)).toBe(2);
    expect(html).not.toContain('keep-only-this-dialog');
    expect(html).not.toContain('remove-from-device-dialog');
    const home = readFileSync(new URL('./HomeScreen.tsx', import.meta.url), 'utf8');
    expect(home).toMatch(/setRemoving\(\{\s*id: project\.id,/);
    expect(home).toContain('remove: actions.removeFromDevice');
  });

  it('審查必修 2：另存分枝（不同的已寫入身分證、相同檔名）標示「書名相同，但不是同一份檔」，沒有「留下這一份」', () => {
    const html = renderHome(
      homeState([['p1', '道劍', UUID_A, '道劍.db', true], ['p2', '道劍', UUID_B, '道劍.db', true]]),
    );
    expect(count(html, 'data-testid="project-card"')).toBe(2);
    expect(count(html, BADGE_SAME_TITLE)).toBe(2);
    expect(html).not.toContain(BADGE_SAME_BOOK);
    expect(html).not.toContain(KEEP_ONE_BUTTON);
  });

  it('三份（兩份同一本、一份只是同名）：「留下這一份」只對同一本那兩份出現', () => {
    const html = renderHome(
      homeState([['p1', '道劍', UUID_A, 'a.db'], ['p2', '道劍', UUID_A, 'b.db'], ['p3', '道劍', UUID_B, 'c.db']]),
    );
    expect(count(html, 'data-testid="project-card"')).toBe(3);
    expect(count(html, KEEP_ONE_BUTTON)).toBe(2);
    expect(count(html, BADGE_SAME_TITLE)).toBe(1);
  });

  it('首頁原始碼用新函式、不再用 WO-84 合併，且「留下一份」開視窗不直接刪', () => {
    const home = readFileSync(new URL('./HomeScreen.tsx', import.meta.url), 'utf8');
    expect(home).toContain('recentListEntries(state.projects, state.recentIds)');
    expect(home).not.toContain('recentDisplayProjects');
    expect(home).toContain('otherIds: entry.otherSameBookIds');
  });
});

describe('WO-143：留下這一份、刪掉同一本的其他份', () => {
  const dialog = (hasUnsaved: boolean) =>
    renderToStaticMarkup(
      createElement(KeepOnlyThisDialog, { bookTitle: '道劍', otherCount: 2, hasUnsaved, busy: false, onConfirm: noop, onCancel: noop }),
    );

  it('視窗用字；有未存回檔案的改動時多一句', () => {
    const plain = dialog(false);
    expect(plain).toContain(keepOneTitle('道劍'));
    expect(plain).toContain(keepOneBody(2));
    expect(plain).not.toContain(KEEP_ONE_UNSAVED_NOTE);
    expect(plain).toContain(KEEP_ONE_CONFIRM);
    expect(plain).toContain(KEEP_ONE_CANCEL);
    expect(dialog(true)).toContain(`${keepOneBody(2)}${KEEP_ONE_UNSAVED_NOTE}`);
  });

  it('只刪同一本的其他份，不刪只是同名的別本', async () => {
    const projects = homeState([['a', '道劍', UUID_A, 'a.db'], ['b', '道劍', UUID_A, 'b.db'], ['c', '道劍', UUID_B, 'c.db']]).projects;
    const entry = recentListEntries(projects, ['a', 'b', 'c']).find((e) => e.project.id === 'a')!;
    const removed: string[] = [];
    const result = await removeOtherCopies({ ids: entry.otherSameBookIds, remove: async (id) => (removed.push(id), true) });
    expect(removed).toEqual(['b']);
    expect(result).toEqual({ removed: ['b'], failedId: null });
  });

  it('任何一份失敗就停下，已刪的不回復，後面的不再試', async () => {
    const tried: string[] = [];
    const result = await removeOtherCopies({
      ids: ['x', 'y', 'z'],
      remove: async (id) => {
        tried.push(id);
        return id !== 'y';
      },
    });
    expect(tried).toEqual(['x', 'y']);
    expect(result).toEqual({ removed: ['x'], failedId: 'y' });
  });

  it('丟錯也當失敗並停下', async () => {
    const result = await removeOtherCopies({
      ids: ['x', 'y'],
      remove: async () => {
        throw new Error('壞了');
      },
    });
    expect(result).toEqual({ removed: [], failedId: 'x' });
  });
});
