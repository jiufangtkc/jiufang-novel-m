// @ts-ignore
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @ts-ignore
import { mkdtempSync, writeFileSync } from 'node:fs';
// @ts-ignore
import { tmpdir } from 'node:os';
// @ts-ignore
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROGRESS_LABELS, type ProgressCode } from '../domain/labels';

const CDP_HTTP = 'http://127.0.0.1:9222';

function isLayoutChromeAvailable(): boolean {
  try {
    execSync(`curl -sf ${CDP_HTTP}/json/version`, { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function hGap(left: { right: number }, right: { left: number }): number {
  return right.left - left.right;
}

function overlapsHorizontally(
  a: { left: number; right: number },
  b: { left: number; right: number },
): boolean {
  return a.right > b.left && b.right > a.left;
}

interface RowMeasure {
  code: ProgressCode;
  main: DOMRectLike;
  progress: DOMRectLike;
  handle: DOMRectLike;
  more: DOMRectLike;
}

interface DOMRectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

function treeRowFixtureCss(fullCss: string): string {
  const root = fullCss.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
  const pointerMouse = fullCss.match(/html\[data-pointer="mouse"\]\s*\{[\s\S]*?\}/)?.[0] ?? '';
  const treeStart = fullCss.indexOf('.tree-list');
  const treeEnd = fullCss.indexOf('.tree-inline-rename input');
  const badgeStart = fullCss.indexOf('.badge {');
  const badgeEnd = fullCss.indexOf('.editor {', badgeStart);
  const treeBlock = treeStart >= 0 && treeEnd > treeStart ? fullCss.slice(treeStart, treeEnd) : '';
  const badgeBlock =
    badgeStart >= 0 && badgeEnd > badgeStart ? fullCss.slice(badgeStart, badgeEnd) : '';
  return `${root}\n${pointerMouse}\nbody { margin: 0; background: var(--bg); }\n${badgeBlock}\n${treeBlock}`;
}

function buildFixtureHtml(css: string, codes: ProgressCode[]): string {
  const rows = codes
    .map(
      (code) => `
    <div class="tree-row measure-hover" data-code="${code}">
      <span class="tree-chevron-spacer"></span>
      <button type="button" class="tree-main">
        <span class="tree-icon type-file"><svg width="20" height="20"></svg></span>
        <span class="node-name">第二章　燈塔</span>
      </button>
      <button type="button" class="tree-progress" aria-label="進度">
        <span class="badge" data-progress="${code}"><span class="badge-dot"></span>${PROGRESS_LABELS[code]}</span>
      </button>
      <button type="button" class="tree-handle" aria-label="拖曳把手"><span>⋮⋮</span></button>
      <button type="button" class="icon-button" aria-label="更多">⋯</button>
    </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-Hant" data-pointer="mouse" data-layout="wide">
<head>
<meta charset="utf-8">
<style>
${css}
html[data-pointer="mouse"] .tree-pane:not(.is-organizing) .tree-row.measure-hover .tree-handle {
  width: var(--hit-size, 36px);
  min-width: var(--hit-size, 36px);
  max-width: var(--hit-size, 36px);
  height: var(--hit-size, 36px);
  opacity: 1;
  overflow: visible;
  pointer-events: auto;
  background: var(--bg);
  border-radius: 4px;
}
.fixture { width: 320px; background: var(--bg); padding: 8px; }
.tree-pane:not(.is-organizing) .tree-handle { width: 0; min-width: 0; max-width: 0; opacity: 0; overflow: hidden; }
.tree-row.measure-hover .tree-handle { width: var(--hit-size, 36px); min-width: var(--hit-size, 36px); max-width: var(--hit-size, 36px); opacity: 1; }
</style>
</head>
<body>
  <div class="tree-pane fixture">
    ${rows}
  </div>
</body>
</html>`;
}

async function cdpCall<T>(
  ws: WebSocket,
  waiters: Map<number, (msg: { id?: number; error?: { message: string }; result?: T }) => void>,
  seq: { value: number },
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const id = ++seq.value;
  return new Promise<T>((resolve, reject) => {
    waiters.set(id, (msg) => {
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result as T);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function measureViaCdp(htmlPath: string): Promise<RowMeasure[]> {
  const fileUrl = `file://${htmlPath}`;
  const created = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(fileUrl)}`, { method: 'PUT' });
  if (!created.ok) throw new Error('無法在 CDP 開啟量測頁');
  const target = (await created.json()) as { id: string; webSocketDebuggerUrl: string };

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const waiters = new Map<number, (msg: { id?: number; error?: { message: string }; result?: unknown }) => void>();
  const seq = { value: 0 };

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 連線失敗')));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as { id?: number };
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)!(msg);
      waiters.delete(msg.id);
    }
  });

  const expression = `(() => {
    const rows = [...document.querySelectorAll('.tree-row.measure-hover')];
    return rows.map((row) => {
      const pick = (sel) => {
        const el = row.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        code: row.dataset.code,
        main: pick('.tree-main'),
        progress: pick('.tree-progress'),
        handle: pick('.tree-handle'),
        more: pick('.icon-button'),
      };
    });
  })()`;

  try {
    await cdpCall(ws, waiters, seq, 'Runtime.enable');
    await new Promise((r) => setTimeout(r, 600));
    const evalResult = await cdpCall<{ result: { value: RowMeasure[] } }>(ws, waiters, seq, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    const rows = evalResult.result?.value;
    if (!rows?.length) throw new Error('CDP 量測無資料');
    return rows;
  } finally {
    await fetch(`${CDP_HTTP}/json/close/${target.id}`, { method: 'PUT' }).catch(() => undefined);
    ws.close();
  }
}

async function measureTreeRowHitZones(): Promise<RowMeasure[]> {
  const css = treeRowFixtureCss(readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8'));
  const codes = Object.keys(PROGRESS_LABELS) as ProgressCode[];
  const html = buildFixtureHtml(css, codes);
  const tmpDir = mkdtempSync(join(tmpdir(), 'wo86-'));
  const tmpHtmlPath = join(tmpDir, 'fixture.html');
  writeFileSync(tmpHtmlPath, html, 'utf8');
  return measureViaCdp(tmpHtmlPath);
}

function assertTreeRowHitZonesSeparated(rows: RowMeasure[]): void {
  expect(rows.length).toBe(Object.keys(PROGRESS_LABELS).length);
  for (const row of rows) {
    expect(row.main, row.code).toBeTruthy();
    expect(row.progress, row.code).toBeTruthy();
    expect(row.handle, row.code).toBeTruthy();
    expect(row.more, row.code).toBeTruthy();

    expect(overlapsHorizontally(row.main, row.progress), `${row.code}：章名與進度重疊`).toBe(false);
    expect(overlapsHorizontally(row.progress, row.handle), `${row.code}：進度與把手重疊`).toBe(false);
    expect(overlapsHorizontally(row.handle, row.more), `${row.code}：把手與更多重疊`).toBe(false);
    expect(overlapsHorizontally(row.main, row.handle), `${row.code}：章名與把手重疊`).toBe(false);

    expect(hGap(row.main, row.progress), `${row.code}：章名與進度間距`).toBeGreaterThanOrEqual(0);
    expect(hGap(row.progress, row.handle), `${row.code}：進度與把手間距`).toBeGreaterThanOrEqual(0);
    expect(hGap(row.handle, row.more), `${row.code}：把手與更多間距`).toBeGreaterThanOrEqual(0);
  }
}

describe('WO-86：滑鼠目錄列熱區不重疊（Chrome 量測）', () => {
  it.runIf(isLayoutChromeAvailable())(
    '各進度標記寬度下，章名／進度／把手／⋯ 邊界無水平重疊',
    async () => {
      const rows = await measureTreeRowHitZones();
      assertTreeRowHitZonesSeparated(rows);
    },
    30_000,
  );

  it('WO-86：固定像素偏移的舊定位會與加寬進度熱區重疊', () => {
    const progress = { left: 177.4, right: 224 };
    const handleOld = { left: 170, right: 206 };
    expect(overlapsHorizontally(progress, handleOld)).toBe(true);
  });
});