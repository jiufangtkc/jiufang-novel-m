// @ts-nocheck
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const repoRoot = new URL('../..', import.meta.url).pathname;

function canLoadPlaywright(): boolean {
  try {
    createRequire(import.meta.url).resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`等待預覽伺服器逾時：${url}`);
}

const hasPlaywright = canLoadPlaywright();

describe.skipIf(!hasPlaywright)('WO-92 瀏覽器量測：資料集挑色「完成」在視窗內', () => {
  /** @type {import('node:child_process').ChildProcess | null} */
  let preview = null;

  beforeAll(async () => {
    execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' });
    try {
      execSync('npx playwright install chromium', { cwd: repoRoot, stdio: 'pipe' });
    } catch {
      /* 已安裝或環境自帶 Chromium */
    }
    preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173'], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    await waitForUrl('http://127.0.0.1:4173/');
  }, 180000);

  afterAll(() => {
    preview?.kill('SIGTERM');
  });

  it('390×844、844×390、900×900、1280×900、1920×900「完成」完整可點', async () => {
    const { runViewportChecks } = await import(
      '../../qa/wo92-color-picker-done-viewport/run.mjs'
    );
    const failures = await runViewportChecks();
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 180000);
});