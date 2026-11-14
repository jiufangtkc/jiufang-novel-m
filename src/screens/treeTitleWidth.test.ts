import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const tree = readFileSync(new URL('./ChapterTree.tsx', import.meta.url), 'utf8');

describe('WO-95：目錄章名騰寬度', () => {
  it('縮排跟操作方式走，緊湊 12、寬鬆 16', () => {
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s*\{[^}]*--tree-indent:\s*12px/);
    expect(css).toMatch(/html\[data-pointer="touch"\]\s*\{[^}]*--tree-indent:\s*16px/);
    expect(css).toMatch(/padding-left:\s*calc\(var\(--tree-depth,\s*0\)\s*\*\s*var\(--tree-indent,\s*16px\)\)/);
    expect(tree).toContain("'--tree-depth': depth");
    expect(tree).not.toContain('paddingLeft: 4 + depth * 16');
  });

  it('章列、幕列不放圖示，卷列保留資料夾', () => {
    expect(tree).not.toContain('FileIcon');
    expect(tree).not.toContain('BookmarkIcon');
    expect(tree).toContain('FolderIcon');
    expect(tree).toContain("node.type === 'folder'");
  });

  it('緊湊列高 28、箭頭 24 寬，「⋯」平常不佔位；寬鬆維持可點 44', () => {
    expect(css).toMatch(
      /html\[data-pointer="mouse"\]\s+\.tree-pane\s+\.tree-row\s*\{[^}]*min-height:\s*max\(28px,\s*1\.6em\)/,
    );
    expect(css).toMatch(
      /html\[data-pointer="mouse"\]\s+\.tree-pane\s+\.tree-row\s+\.tree-chevron[\s\S]*?width:\s*24px/,
    );
    expect(css).toMatch(
      /html\[data-pointer="mouse"\]\s+\.tree-pane:not\(\.is-organizing\)\s+\.tree-row\s*>\s*\.icon-button\s*\{[^}]*width:\s*0/,
    );
    expect(css).toMatch(
      /html\[data-pointer="mouse"\]\s+\.tree-pane:not\(\.is-organizing\)\s+\.tree-row:hover\s*>\s*\.icon-button[\s\S]*?width:\s*24px/,
    );
    expect(css).toMatch(
      /html\[data-pointer="touch"\]\s+\.tree-pane:not\(\.is-organizing\)\s+\.tree-row\.is-selected\s*>\s*\.icon-button\s*\{[^}]*width:\s*44px/,
    );
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-pane\s+\.tree-row\s*\{[^}]*gap:\s*8px/);
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-pane\s+\.tree-row\s*\{[^}]*padding-right:\s*8px/);
  });

  it('進度改成小圓點，選取或滑過才看見進度文字', () => {
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row\s+\.badge-dot\s*\{[^}]*width:\s*8px/);
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-row\s+\.badge-dot[\s\S]*?width:\s*10px/);
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row:hover\s+\.badge/);
    expect(css).toMatch(/html\[data-pointer="touch"\]\s+\.tree-row\.is-selected\s+\.badge/);
    expect(tree).toContain('的進度，');
  });

  it('寬鬆章名最多兩行，緊湊一行，滑過約 0.5 秒才出現完整章名', () => {
    expect(css).toMatch(/html\[data-pointer="touch"\][\s\S]*?-webkit-line-clamp:\s*2/);
    expect(css).toMatch(/\.tree-title-tip\s*\{[^}]*max-width:\s*min\(320px/);
    expect(tree).toContain('TIP_DELAY_MS = 500');
    expect(tree).toContain('role="tooltip"');
    expect(tree).toContain('aria-hidden="true"');
    expect(tree).toContain("node.type === 'folder'");
    expect(tree).toContain('LONG_PRESS_MS = 500');
  });

  it('既有滑鼠列的 36 熱區規則還在，沒有把把手改回絕對定位', () => {
    expect(css).toMatch(/html\[data-pointer="mouse"\]\s+\.tree-row[\s\S]*?min-height:\s*var\(--hit-size,\s*36px\)/);
    expect(css).not.toMatch(
      /html\[data-pointer="mouse"\]\s+\.tree-handle[\s\S]*?position:\s*absolute[\s\S]*?right:\s*calc\(2\s*\*\s*var\(--hit-size/,
    );
  });
});
