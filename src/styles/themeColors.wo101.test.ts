import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_IDS, type ThemeId } from '../layout/deviceTheme';

/**
 * WO-101：三套深色主題色票、C 案分色與最終色票表工程注意事項。
 * 以原始碼靜態檢查＋依色票實際疊色計算對比，不開瀏覽器、不截圖。
 */

/** import.meta.glob 列出的路徑是相對這個測試檔，換成絕對路徑。 */
function absolute(paths: string[]): string[] {
  return paths.map((rel) => new URL(rel, import.meta.url).pathname).sort();
}

const CSS_FILES = absolute(Object.keys(import.meta.glob('../**/*.css'))).filter((file) => !file.includes('/fonts/'));
const SOURCE_FILES = absolute(Object.keys(import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.d.ts'])));
const GLOBAL = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

interface Rule {
  file: string;
  selectors: string[];
  decls: Map<string, string>;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取出最內層規則（@media 裡的也算）。 */
function parseRules(css: string, file: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripComments(css).matchAll(re)) {
    const selectorText = match[1]!.trim();
    if (selectorText.startsWith('@')) continue;
    const decls = new Map<string, string>();
    for (const part of match[2]!.split(';')) {
      const index = part.indexOf(':');
      if (index < 0) continue;
      decls.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
    rules.push({ file, selectors: selectorText.split(',').map((s) => s.trim()), decls });
  }
  return rules;
}

const ALL_RULES = CSS_FILES.flatMap((file) => parseRules(readFileSync(file, 'utf8'), file));
const GLOBAL_RULES = parseRules(GLOBAL, 'global.css');

/** 某一套主題在 <html data-theme> 上算出來的自訂屬性（依原始碼順序疊）。 */
function themeVars(theme: ThemeId): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rule of GLOBAL_RULES) {
    const applies = rule.selectors.some(
      (sel) => sel === ':root' || sel === '[data-theme]' || sel === `[data-theme="${theme}"]`,
    );
    if (!applies) continue;
    for (const [key, value] of rule.decls) if (key.startsWith('--')) vars.set(key, value);
  }
  return vars;
}

function resolveVar(vars: Map<string, string>, value: string, depth = 0): string {
  if (depth > 10) throw new Error(`變數循環：${value}`);
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name: string) => {
    const raw = vars.get(name);
    if (raw == null) throw new Error(`未定義變數 ${name}`);
    return resolveVar(vars, raw, depth + 1);
  });
}

function hex(theme: ThemeId, name: string): string {
  return resolveVar(themeVars(theme), `var(${name})`).toUpperCase();
}

type Rgb = [number, number, number];

function rgb(value: string): Rgb {
  const m = value.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`不是 6 碼色碼：${value}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** color-mix(in srgb, top N%, transparent) 疊在 base 上。 */
function over(top: Rgb, alpha: number, base: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(top[i]! * alpha + base[i]! * (1 - alpha))) as Rgb;
}

const EXPECTED: Record<ThemeId, Record<string, string>> = {
  forest: {
    '--bg': '#121A16', '--panel': '#18221D', '--editor': '#1D2B24', '--text': '#E4E9E3', '--muted': '#9FB0A6',
    '--accent': '#8FCBB5', '--on-accent': '#121A16', '--success': '#98C379', '--warning': '#E89A5C',
    '--danger': '#E06C75', '--border': '#2A3A32', '--final': '#E3C26F', '--folder': '#B9AD8C',
    '--code-text': '#C5BEE0', '--search-current': '#E5C07B',
  },
  celadon: {
    '--bg': '#101D23', '--panel': '#16252C', '--editor': '#1C323C', '--text': '#E4EEF2', '--muted': '#9BB4BB',
    '--accent': '#7AC8D8', '--on-accent': '#101D23', '--success': '#98C379', '--warning': '#E89A5C',
    '--danger': '#E06C75', '--border': '#293F48', '--final': '#E3C26F', '--folder': '#B9AD8C',
    '--code-text': '#C5BEE0', '--search-current': '#E5C07B',
  },
  classic: {
    '--bg': '#1E1E1E', '--panel': '#252526', '--editor': '#1A1A2E', '--text': '#E3E3E3', '--muted': '#A0A0A0',
    '--accent': '#61AFEF', '--on-accent': '#1E1E1E', '--success': '#98C379', '--warning': '#E89A5C',
    '--danger': '#E06C75', '--border': '#3C3C3C', '--final': '#06D6A0', '--folder': '#B9AD8C',
    '--code-text': '#C5BEE0', '--search-current': '#E5C07B',
  },
};

describe('WO-101：三套主題色票（最終色票表 v1 第 2 節）', () => {
  it.each(THEME_IDS)('%s 每個變數都等於最終表', (theme) => {
    for (const [name, value] of Object.entries(EXPECTED[theme])) {
      expect(hex(theme, name), `${theme} ${name}`).toBe(value);
    }
    expect(themeVars(theme).get('--accent-soft')).toBe('color-mix(in srgb, var(--accent) 18%, transparent)');
  });

  it('沒有 data-theme 時（:root）就是森林綠；舊青瓷色票不再出現', () => {
    // 全部 24 個介面樣式檔都納入檢查（不含字型；WO-142 新增 components/symbolBar.css，WO-110 新增 screens/welcomeTour.css，WO-122 新增 components/formatTools.css，WO-128 新增 screens/timelineScreen.css，WO-129 新增 components/whatsNewDialog.css，WO-130 新增 components/saveReminder.css，WO-138 新增 components/trashSheet.css，WO-140 新增 components/manuscriptVersionSheet.css，WO-144 新增 components/quickIdea.css）
    expect(CSS_FILES.length).toBe(24);
    expect(CSS_FILES.some((f) => f.endsWith('/styles/global.css'))).toBe(true);
    const rootOnly = new Map<string, string>();
    for (const rule of GLOBAL_RULES) {
      if (!rule.selectors.includes(':root')) continue;
      for (const [k, v] of rule.decls) if (k.startsWith('--')) rootOnly.set(k, v);
    }
    expect(resolveVar(rootOnly, 'var(--bg)')).toBe('#121A16');
    expect(resolveVar(rootOnly, 'var(--editor)')).toBe('#1D2B24');
    expect(resolveVar(rootOnly, 'var(--writing-surround)')).toBe('#121A16');
    const allCss = CSS_FILES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n').toUpperCase();
    for (const old of ['#141D1D', '#1A2626', '#203130', '#E6EFEC', '#A3B7B2', '#A8D8C8', '#2C3D3C']) {
      expect(allCss).not.toContain(old);
    }
  });

  it('版面變數不當主題色：只定義在 :root 與指標模式', () => {
    for (const theme of THEME_IDS) {
      const block = GLOBAL_RULES.find((r) => r.selectors.includes(`[data-theme="${theme}"]`))!;
      for (const name of ['--safe-top', '--safe-bottom', '--vv-height', '--vv-offset', '--hit-size', '--body-font-scale', '--tree-indent']) {
        expect(block.decls.has(name)).toBe(false);
      }
    }
    expect(GLOBAL).toMatch(/html\[data-pointer="mouse"\] \{\s*--hit-size: 36px;\s*--tree-indent: 12px;/);
  });
});

/* ---------- C 案 ---------- */

/** 寫作頁「不能寫」的容器。selector 最右邊那一節含這些 class 就算。 */
const SURROUND_CLASSES = [
  'write-layout', 'editor', 'editor-pane', 'tree-pane', 'write-aside', 'editor-status', 'thumb-bar',
  'nav-rail', 'bottom-nav', 'tree-tools', 'organize-actions', 'editor-empty', 'writing-cards-drawer',
  'writing-cards-header', 'writing-card-place', 'tree-search-tabs', 'book-search-panel',
];

function lastCompound(selector: string): string {
  const parts = selector.split(/\s+|>|\+|~/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function classesOf(compound: string): string[] {
  return [...compound.replace(/:has\([^)]*\)/g, '').matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]!);
}

function backgroundOf(rule: Rule): string | null {
  const value = rule.decls.get('background') ?? rule.decls.get('background-color');
  return value == null ? null : value.replace(/\s*!important$/, '');
}

const LAYOUTS = ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const;

describe('WO-101：C 案（只有正文欄用 --editor）', () => {
  it('寫作頁所有不能寫的容器（含四種版面、鍵盤狀態、側欄、導覽）底色都是 --writing-surround', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const rule of ALL_RULES) {
      const bg = backgroundOf(rule);
      if (bg == null) continue;
      for (const selector of rule.selectors) {
        const classes = classesOf(lastCompound(selector));
        if (!classes.some((c) => SURROUND_CLASSES.includes(c))) continue;
        if (classes.includes('is-page')) continue; // 手機直拿全書搜尋是整頁，不在寫作頁上
        checked += 1;
        if (bg !== 'var(--writing-surround)' && bg !== 'transparent') {
          offenders.push(`${rule.file.replace(/.*\/src\//, 'src/')}：${selector} → ${bg}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(checked).toBeGreaterThan(15);
    // 頁首在寫作頁也是四周底色
    expect(GLOBAL).toMatch(/\.write-layout \.topbar,\s*\.editor \.topbar \{ background: var\(--writing-surround\); \}/);
    // 寫作頁時最上面的安全區
    expect(GLOBAL).toMatch(/\.app-shell:has\(\.write-layout\) \{\s*background: var\(--writing-surround\);/);
  });

  it('--editor 只給真正能打字的 .editor-input（和設定頁小色塊的內方塊）', () => {
    const users: string[] = [];
    for (const rule of ALL_RULES) {
      if (backgroundOf(rule) !== 'var(--editor)') continue;
      users.push(...rule.selectors);
    }
    expect(users.sort()).toEqual(['.editor-input', '.theme-swatch > span'].sort());
  });

  it('四種版面各自的側欄規則都改成四周底色，沒有殘留 --bg／--panel', () => {
    const want: Array<[string, string]> = [
      ['phone-landscape', 'html[data-layout="phone-landscape"] .tree-pane'],
      ['medium', 'html[data-layout="medium"] .tree-pane'],
      ['wide', 'html[data-layout="wide"] .write-layout .tree-pane'],
      ['wide', 'html[data-layout="wide"] .write-aside'],
      ['phone-landscape', 'html[data-layout="phone-landscape"] .workspace[data-landscape-rail="show"] > .nav-rail'],
    ];
    for (const [, selector] of want) {
      const rule = ALL_RULES.find((r) => r.selectors.includes(selector) && backgroundOf(r) != null);
      expect(rule, selector).toBeTruthy();
      expect(backgroundOf(rule!), selector).toBe('var(--writing-surround)');
    }
  });

  it.each(THEME_IDS)('%s：三套 × 四種版面，正文欄與四周不同色、四周同一色；經典深藍四周是 --panel 不是 --bg', (theme) => {
    const surround = hex(theme, '--writing-surround');
    const editor = hex(theme, '--editor');
    expect(surround).not.toBe(editor);
    if (theme === 'classic') {
      expect(surround).toBe('#252526');
      expect(surround).not.toBe(hex(theme, '--bg'));
    } else {
      expect(surround).toBe(hex(theme, '--bg'));
    }
    for (const layout of LAYOUTS) {
      // 某版面下會套到的規則：沒有限定版面的，或限定這個版面的
      const applicable = ALL_RULES.filter((rule) =>
        rule.selectors.some((s) => !/data-layout=/.test(s) || s.includes(`data-layout="${layout}"`)),
      );
      const colors = new Set<string>();
      for (const rule of applicable) {
        const bg = backgroundOf(rule);
        if (bg == null || bg === 'transparent') continue;
        for (const selector of rule.selectors) {
          if (/data-layout=/.test(selector) && !selector.includes(`data-layout="${layout}"`)) continue;
          const classes = classesOf(lastCompound(selector));
          if (!classes.some((c) => SURROUND_CLASSES.includes(c)) || classes.includes('is-page')) continue;
          colors.add(resolveVar(themeVars(theme), bg).toUpperCase());
        }
      }
      expect([...colors], `${theme} ${layout}`).toEqual([surround]);
      const input = ALL_RULES.filter((r) => r.selectors.includes('.editor-input') && backgroundOf(r) != null);
      expect(input.map((r) => resolveVar(themeVars(theme), backgroundOf(r)!).toUpperCase())).toEqual([editor]);
    }
  });

  it('鍵盤開啟時的規則不把容器改成別的底色（工具列沿用頁尾四周底色）', () => {
    let seen = 0;
    for (const rule of ALL_RULES) {
      for (const selector of rule.selectors) {
        if (!/is-keyboard|keyboard-open/.test(selector)) continue;
        seen += 1;
        const bg = backgroundOf(rule);
        const classes = classesOf(lastCompound(selector));
        if (classes.some((c) => SURROUND_CLASSES.includes(c) || c === 'editor-input')) {
          expect(bg == null || bg === 'var(--writing-surround)', selector).toBe(true);
        } else {
          // 鍵盤時的按鈕等只能是透明或滑過時的中性白色疊層，不另給主題底色
          expect(bg == null || bg === 'transparent' || /^rgba\(255, 255, 255, 0\.\d+\)$/.test(bg), selector).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

/* ---------- 工程注意事項 ---------- */

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripComments(css).match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`找不到 ${selector}`);
  return m[1]!;
}

const SEARCH_CSS = readFileSync(new URL('../components/BookSearchPanel.css', import.meta.url), 'utf8');
const MD_CSS = readFileSync(new URL('../components/cardMarkdown.css', import.meta.url), 'utf8');

describe('WO-101：最終色票表工程注意事項', () => {
  it('(1)(6) 資料夾走 --folder；行內程式碼走 --code-text，區塊程式碼仍 --text、連結仍 --accent', () => {
    expect(GLOBAL).toMatch(/\.tree-icon\.type-folder \{ color: var\(--folder\); \}/);
    expect(block(MD_CSS, '.card-md-codespan')).toMatch(/color: var\(--code-text\)/);
    expect(stripComments(MD_CSS)).toMatch(/\.card-md-code-block code[^{]*\{[^}]*color: var\(--text\)/);
    expect(stripComments(MD_CSS)).toMatch(/\.card-md-link[^{]*\{[^}]*color: var\(--accent\)/);
  });

  it('(2)(3) 真警告用 --warning；--warning 只剩真警告與取代範圍警告在用', () => {
    expect(GLOBAL).toMatch(/\.files-status-line\.is-warning \{ color: var\(--warning\); \}/);
    expect(block(GLOBAL, '.rename-warn')).toMatch(/color: var\(--warning\)/);
    const users = ALL_RULES.filter((r) => [...r.decls.values()].some((v) => v.includes('var(--warning)')))
      .flatMap((r) => r.selectors)
      .sort();
    expect(users).toEqual(['.book-search-note', '.files-status-line.is-warning', '.rename-warn'].sort());
  });

  it('(4) 範例卡片告知條：字 --text、底強調色 10%；不新增 --notice', () => {
    const notice = block(GLOBAL, '.cards-file-notice');
    expect(notice).toMatch(/color: var\(--text\)/);
    expect(notice).toMatch(/background: color-mix\(in srgb, var\(--accent\) 10%, transparent\)/);
    expect(GLOBAL).not.toContain('--notice');
  });

  it('(5) 取代範圍警告：字 --warning、框 65%、底 10%，都用 color-mix；註解是警告語意', () => {
    const note = block(SEARCH_CSS, '.book-search-note');
    expect(note).toMatch(/color: var\(--warning\)/);
    expect(note).toMatch(/border: 1px solid color-mix\(in srgb, var\(--warning\) 65%, transparent\)/);
    expect(note).toMatch(/background: color-mix\(in srgb, var\(--warning\) 10%, transparent\)/);
    expect(SEARCH_CSS).not.toContain('黃框');
    expect(SEARCH_CSS).toMatch(/\/\* 取代範圍警告[^*]*\*\/\s*\.book-search-note \{/);
  });

  it('(7) 搜尋螢光筆：目前這筆 40%＋2px 同色外圈、其他 20%、結果列表 35%', () => {
    expect(block(SEARCH_CSS, '.search-mark')).toMatch(/background: color-mix\(in srgb, var\(--search-current\) 20%, transparent\)/);
    const current = block(SEARCH_CSS, '.search-mark.is-current');
    expect(current).toMatch(/background: color-mix\(in srgb, var\(--search-current\) 40%, transparent\)/);
    expect(current).toMatch(/box-shadow: 0 0 0 2px var\(--search-current\)/);
    expect(current).not.toContain('50%');
    expect(block(SEARCH_CSS, '.book-search-match')).toMatch(/background: color-mix\(in srgb, var\(--search-current\) 35%, transparent\)/);
  });

  it('介面樣式不再寫死舊黃；使用者資料色（demoCards 的 #e5c07b）完全不改', () => {
    for (const file of CSS_FILES) {
      // 唯一允許的是 --search-current 變數本身的定義
      const css = readFileSync(file, 'utf8').replace(/--search-current: #E5C07B;/g, '');
      expect(css, file).not.toMatch(/#e5c07b/i);
      expect(css, file).not.toMatch(/rgba\(\s*229,\s*192,\s*123/);
    }
    const tsx = SOURCE_FILES.filter((f) => !f.endsWith('demoCards.ts'));
    expect(tsx.length).toBeGreaterThan(50);
    for (const file of tsx) expect(readFileSync(file, 'utf8'), file).not.toMatch(/#e5c07b/i);
    const demo = readFileSync(new URL('../data/demoCards.ts', import.meta.url), 'utf8');
    expect(demo.match(/#e5c07b/gi)?.length).toBe(4);
  });

  it('(8) 主按鈕 --accent 底配 --on-accent 字，沒有白字配淺強調色', () => {
    expect(block(GLOBAL, '.button.primary')).toMatch(/color: var\(--on-accent\)/);
    const offenders: string[] = [];
    let primaries = 0;
    for (const rule of ALL_RULES) {
      const bg = backgroundOf(rule);
      if (bg == null || !/^var\(--(accent|primary|primary-hover)\)$/.test(bg)) continue;
      primaries += 1;
      const color = rule.decls.get('color');
      if (color != null && color !== 'var(--on-accent)') offenders.push(`${rule.selectors.join(', ')} → ${color}`);
      if (color === undefined && /primary|save|confirm|done/.test(rule.selectors.join(' '))) {
        // 底色是強調色卻沒指定字色：必須另有規則給字色，這裡逐一列出
        offenders.push(`${rule.selectors.join(', ')} 沒有字色`);
      }
    }
    // hover 規則只換底色、沿用原本的 --on-accent 字色，不算違規
    const real = offenders.filter((o) => !/:hover|沒有字色/.test(o));
    expect(real).toEqual([]);
    expect(primaries).toBeGreaterThan(8);
    for (const file of CSS_FILES) {
      for (const rule of parseRules(readFileSync(file, 'utf8'), file)) {
        const bg = backgroundOf(rule) ?? '';
        if (/var\(--(accent|primary)\)/.test(bg)) expect(rule.decls.get('color') ?? '', rule.selectors.join()).not.toMatch(/#fff/i);
      }
    }
    expect(stripComments(SEARCH_CSS)).not.toContain('#10202e');
  });

  it('(8) 舊變數都有定義、跟主題走；主題色不再靠寫死 fallback', () => {
    const forest = themeVars('forest');
    const classic = themeVars('classic');
    for (const name of ['--surface', '--text-muted', '--primary', '--primary-hover', '--button-bg', '--button-hover', '--input-bg', '--border-hover', '--hover']) {
      expect(forest.has(name), name).toBe(true);
      expect(resolveVar(forest, `var(${name})`)).not.toMatch(/#007acc|#0062a3/i);
    }
    expect(resolveVar(forest, 'var(--surface)')).toBe('#18221D');
    expect(resolveVar(classic, 'var(--surface)')).toBe('#252526');
    expect(resolveVar(forest, 'var(--text-muted)')).toBe('#9FB0A6');
    expect(resolveVar(forest, 'var(--primary)')).toBe('#8FCBB5');

    // 每個用到的變數都有定義（App 執行時寫入的版面變數除外）
    const runtime = new Set(['--force-safe-top', '--force-safe-bottom', '--tree-depth']);
    const defined = new Set<string>();
    for (const rule of ALL_RULES) for (const k of rule.decls.keys()) if (k.startsWith('--')) defined.add(k);
    for (const file of CSS_FILES) {
      const css = stripComments(readFileSync(file, 'utf8'));
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        if (runtime.has(m[1]!)) continue;
        expect(defined.has(m[1]!), `${file} 用到未定義的 ${m[1]}`).toBe(true);
      }
      // 主題色變數不得再帶寫死 fallback（例如 var(--primary, #007acc)）
      expect(css, file).not.toMatch(/var\(--(bg|panel|editor|text|muted|accent|border|danger|surface|text-muted|primary|primary-hover|button-bg|button-hover|input-bg|border-hover|hover),/);
    }
    expect(stripComments(readFileSync(new URL('../screens/importExport.css', import.meta.url), 'utf8'))).toContain('var(--surface)');
  });

  it('(9) Final 徽章維持綠 #06D6A0、不跟 --final；Discarded 與危險按鈕不改', () => {
    const final = GLOBAL_RULES.find((r) => r.selectors.includes('.badge[data-progress="Final"]'))!;
    expect(final.decls.get('color')).toBe('var(--badge-final)');
    for (const theme of THEME_IDS) expect(hex(theme, '--badge-final')).toBe('#06D6A0');
    expect([...final.decls.values()].join(' ')).not.toContain('--final)');
    expect(GLOBAL).toContain('.badge[data-progress="Discarded"] { color: #ef476f;');
    expect(GLOBAL).toContain('.button.danger { background: #ef476f; color: #1e1e1e; }');
  });

  it('(10) 進度條：進行中跟 --accent；達標 --final（森林綠／青瓷金、經典深藍綠）；1px 33% 外圈＋14px 柔光、不閃爍', () => {
    const fill = block(GLOBAL, '.daily-bar-fill');
    expect(fill).toMatch(/background: var\(--accent\)/);
    expect(fill).not.toContain('gradient');
    expect(GLOBAL).not.toMatch(/#4a90e2,\s*#61afef/i);
    expect(block(GLOBAL, '.daily-bar.is-met .daily-bar-fill')).toMatch(/background: var\(--final\)/);
    const glow = block(GLOBAL, '.daily-bar.is-met .daily-bar-track');
    expect(glow.replace(/\s+/g, ' ')).toContain(
      'box-shadow: 0 0 0 1px color-mix(in srgb, var(--final) 33%, transparent), 0 0 14px color-mix(in srgb, var(--final) 33%, transparent)',
    );
    expect(glow).not.toContain('rgba(6, 214, 160');
    expect(hex('forest', '--final')).toBe('#E3C26F');
    expect(hex('celadon', '--final')).toBe('#E3C26F');
    expect(hex('classic', '--final')).toBe('#06D6A0');
    for (const rule of ALL_RULES) {
      if (!rule.selectors.some((s) => s.includes('daily-bar'))) continue;
      expect(rule.decls.has('animation'), rule.selectors.join()).toBe(false);
      expect(rule.decls.get('transition') ?? '', rule.selectors.join()).not.toMatch(/box-shadow|all/);
    }
    expect(block(GLOBAL, '.daily-bar-track')).toMatch(/background: var\(--border\)/);
  });

  it('(11) 透明度一律 color-mix；統計頁進度圈跟著主題', () => {
    for (const file of CSS_FILES) {
      const css = stripComments(readFileSync(file, 'utf8'));
      // 主題色的舊 rgba（經典深藍強調、面板、#007acc）都不再寫死
      expect(css, file).not.toMatch(/rgba\(\s*97,\s*175,\s*239/);
      expect(css, file).not.toMatch(/rgba\(\s*37,\s*37,\s*38/);
      expect(css, file).not.toMatch(/rgba\(\s*0,\s*122,\s*204/);
      expect(css, file).not.toMatch(/#007acc|#0062a3/i);
    }
    const stats = readFileSync(new URL('../screens/StatsScreen.tsx', import.meta.url), 'utf8');
    expect(stats).not.toMatch(/#3C3C3C|#61AFEF/i);
    expect(GLOBAL).toMatch(/\.ring-track \{ stroke: var\(--border\); \}/);
    expect(GLOBAL).toMatch(/\.ring-value \{ stroke: var\(--accent\); \}/);
  });
});

describe('WO-101：依色票實際疊色的對比', () => {
  it.each(THEME_IDS)('%s', (theme) => {
    const c = (name: string) => rgb(hex(theme, name));
    expect(contrast(c('--text'), c('--editor'))).toBeGreaterThanOrEqual(7);
    expect(contrast(c('--muted'), c('--panel'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c('--code-text'), c('--panel'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c('--warning'), c('--panel'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c('--accent'), c('--panel'))).toBeGreaterThanOrEqual(3);
    expect(contrast(c('--on-accent'), c('--accent'))).toBeGreaterThanOrEqual(3);
    expect(contrast(c('--final'), c('--panel'))).toBeGreaterThanOrEqual(3);
    expect(contrast(c('--folder'), c('--panel'))).toBeGreaterThanOrEqual(3);
    expect(contrast(c('--accent'), c('--border'))).toBeGreaterThanOrEqual(3);
    // 白字在淺強調色上不合格，所以主按鈕必須用 --on-accent
    if (theme !== 'classic') expect(contrast([255, 255, 255], c('--accent'))).toBeLessThan(3);
    // 搜尋目前這筆：40% 螢光筆疊在正文欄上，正文字仍 ≥ 4.5；50% 時不合格
    const current40 = over(c('--search-current'), 0.4, c('--editor'));
    expect(contrast(c('--text'), current40)).toBeGreaterThanOrEqual(4.5);
    const current50 = over(c('--search-current'), 0.5, c('--editor'));
    expect(contrast(c('--text'), current50)).toBeLessThan(4.5);
    // 其他命中 20%（正文欄）、結果列表 35%（四周底）
    expect(contrast(c('--text'), over(c('--search-current'), 0.2, c('--editor')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c('--text'), over(c('--search-current'), 0.35, c('--writing-surround')))).toBeGreaterThanOrEqual(4.5);
  });
});

const VERSION_SHEET_CSS = readFileSync(new URL('../components/manuscriptVersionSheet.css', import.meta.url), 'utf8');

describe('WO-141：新舊版比較標記語意變數與三套主題對比', () => {
  it('新增比較標記語意 CSS 變數皆衍生自既有主題變數，不寫死色碼', () => {
    const forest = themeVars('forest');
    expect(forest.get('--compare-del-text')).toBe('var(--muted)');
    expect(forest.get('--compare-del-line')).toBe('color-mix(in srgb, var(--muted) 80%, transparent)');
    expect(forest.get('--compare-add-text')).toBe('var(--accent)');
    expect(forest.get('--compare-add-bg')).toBe('color-mix(in srgb, var(--accent) 18%, transparent)');

    const delRule = block(VERSION_SHEET_CSS, '.version-compare-del');
    expect(delRule).toMatch(/color:\s*var\(--compare-del-text\)/);
    expect(delRule).toMatch(/text-decoration:\s*line-through/);
    expect(delRule).toMatch(/text-decoration-color:\s*var\(--compare-del-line\)/);

    const insRule = block(VERSION_SHEET_CSS, '.version-compare-ins');
    expect(insRule).toMatch(/color:\s*var\(--compare-add-text\)/);
    expect(insRule).toMatch(/background:\s*var\(--compare-add-bg\)/);
  });

  it.each(THEME_IDS)('%s：刪掉的字（灰色加劃線）與新加的字（主題色加底色）在比較正文與圖例都看得清楚（對比 ≥ 4.5）', (theme) => {
    const c = (name: string) => rgb(hex(theme, name));
    // 刪掉的字（--muted）在比較正文（--bg）與圖例（--panel）上皆達 AA 4.5
    expect(contrast(c('--muted'), c('--bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c('--muted'), c('--panel'))).toBeGreaterThanOrEqual(4.5);
    // 新加的字（--accent）疊 18% 同色底於比較正文（--bg）與圖例（--panel）上皆達 AA 4.5
    const addBgInBody = over(c('--accent'), 0.18, c('--bg'));
    const addBgInLegend = over(c('--accent'), 0.18, c('--panel'));
    expect(contrast(c('--accent'), addBgInBody)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c('--accent'), addBgInLegend)).toBeGreaterThanOrEqual(4.5);
  });
});
