import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

describe('改書名畫面接線', () => {
  it('檔案頁不包書名號，橘字與檔名分開', () => {
    const files = source('FilesScreen.tsx');
    expect(files).not.toContain('《{project.title}》');
    expect(files).toContain('目前的稿子：');
    expect(files).toContain('titlePendingNotice');
    expect(files).toContain('currentFileLine');
    expect(files).toContain('project.hasExternalFile');
  });

  it('統計頁標題固定，書名另外一行', () => {
    const stats = source('StatsScreen.tsx');
    expect(stats).toContain('STATS_HEADING');
    expect(stats).not.toContain('— 寫作統計');
    expect(stats).toContain('stats-book-name');
  });

  it('設定頁書名列與目標卡分開，分頁標題不跟書名', () => {
    const settings = source('SettingsScreen.tsx');
    expect(settings).toContain('BOOK_SECTION');
    expect(settings).toContain('BookTitleSettingRow');
    expect(settings).toContain('BOOK_GOAL_LABEL');
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<title>九方小說編輯器M</title>');
  });

  it('章名點外面走確定，空白不刪掉剛開的章', () => {
    const tree = source('ChapterTree.tsx');
    expect(tree).toContain('commitInlineChapterTitle');
    expect(tree).toContain('onDismissInline');
    expect(tree).toContain("commit('outside')");
    const write = source('WriteScreen.tsx');
    expect(write).toContain('onDismissInline={() => {');
    expect(write).not.toMatch(/onDismissInline=\{\(\) => \{\s*cancelFresh/);
  });
});
