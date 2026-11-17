import { describe, expect, it } from 'vitest';
import { shareDatabase, databaseSharePayload } from './library';
import {
  DOCX_MIME,
  DOWNLOAD_URL_REVOKE_DELAY_MS,
  TXT_MIME,
  deliverFile,
  fileSharePayload,
  makeExportFile,
  downloadFile,
  shouldPreferDownload,
  type DeliveryEnv,
} from './fileDelivery';

/**
 * WO-103：匯出全文的交付路徑（模擬 iPhone Safari 的 canShare／share 與無分享能力時的下載）。
 * 真機（11/28）才確認分享面板「儲存到檔案」；這裡只證明網頁端的行為與成功界線。
 */

interface Recorder {
  env: DeliveryEnv;
  log: string[];
  shared: ShareData[];
  timers: Array<{ run: () => void; delay: number }>;
  anchors: HTMLAnchorElement[];
}

interface FakeOptions {
  canShare?: boolean;
  canShareThrows?: boolean;
  share?: (data: ShareData) => Promise<void>;
  clickThrows?: boolean;
  /** 預設為 iPhone：粗指標、有觸控。 */
  fine?: boolean;
  coarse?: boolean;
  touch?: number;
}

function fakeEnv(options: FakeOptions = {}): Recorder {
  const log: string[] = [];
  const shared: ShareData[] = [];
  const timers: Recorder['timers'] = [];
  const anchors: HTMLAnchorElement[] = [];
  const env: DeliveryEnv = {
    share:
      options.share === undefined && options.canShare === undefined
        ? undefined
        : async (data) => {
            shared.push(data);
            log.push('share');
            if (options.share) await options.share(data);
          },
    canShare:
      options.canShare === undefined
        ? undefined
        : () => {
            if (options.canShareThrows) throw new Error('模擬能力檢查拋錯');
            return options.canShare!;
          },
    pointerFine: () => options.fine ?? false,
    pointerCoarse: () => options.coarse ?? true,
    maxTouchPoints: () => options.touch ?? 5,
    createObjectURL: () => {
      log.push('create-url');
      return 'blob:fake-1';
    },
    revokeObjectURL: (url) => log.push(`revoke:${url}`),
    createLink: () => {
      const anchor = {
        href: '',
        download: '',
        click: () => {
          log.push(`click:${anchor.download}:${anchor.href}`);
          if (options.clickThrows) throw new Error('模擬無法下載');
        },
      } as unknown as HTMLAnchorElement;
      anchors.push(anchor);
      log.push('attach-hidden-link');
      return { anchor, remove: () => log.push('remove-link') };
    },
    schedule: (run, delay) => {
      timers.push({ run, delay });
      log.push(`schedule:${delay}`);
    },
  };
  return { env, log, shared, timers, anchors };
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

describe('WO-103 檔案交付：能分享就分享，否則下載', () => {
  it('檔案的名稱、MIME、位元組正確；Word 與 TXT 各自的 MIME', async () => {
    const docx = makeExportFile(BYTES, '霧港_全文_20261116-2105.docx', DOCX_MIME);
    expect(docx.name).toBe('霧港_全文_20261116-2105.docx');
    expect(docx.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(new Uint8Array(await docx.arrayBuffer())).toEqual(BYTES);
    const txt = makeExportFile(new TextEncoder().encode('第一章\n內容'), '霧港_自選章節_20261116-2105.txt', TXT_MIME);
    expect(txt.type).toBe('text/plain;charset=utf-8');
    expect(await txt.text()).toBe('第一章\n內容');
    // 交付的是副本：之後改原陣列不影響檔案
    const source = new Uint8Array([1, 2, 3]);
    const copy = makeExportFile(source, 'a.txt', TXT_MIME);
    source[0] = 9;
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('能分享檔案（iPhone Safari）：只傳檔案本身，成功回 shared，不再下載', async () => {
    const rec = fakeEnv({ canShare: true });
    const file = makeExportFile(BYTES, 'a.docx', DOCX_MIME);
    expect(await deliverFile(file, rec.env)).toBe('shared');
    expect(rec.shared).toEqual([{ files: [file] }]);
    expect(Object.keys(fileSharePayload(file))).toEqual(['files']);
    expect(rec.log).toEqual(['share']);
  });

  it('分享被取消（AbortError）回 cancelled，不自動改成下載', async () => {
    const rec = fakeEnv({ canShare: true, share: async () => { throw domError('AbortError'); } });
    expect(await deliverFile(makeExportFile(BYTES, 'a.docx', DOCX_MIME), rec.env)).toBe('cancelled');
    expect(rec.log).toEqual(['share']);
  });

  it('首次分享遇手勢失效（NotAllowedError）回 needs-gesture；之後 download 模式只下載、不再分享', async () => {
    const rec = fakeEnv({ canShare: true, share: async () => { throw domError('NotAllowedError'); } });
    const file = makeExportFile(BYTES, 'a.docx', DOCX_MIME);
    expect(await deliverFile(file, rec.env)).toBe('needs-gesture');
    expect(rec.log).toEqual(['share']);
    expect(await deliverFile(file, rec.env, 'download')).toBe('downloaded');
    expect(rec.shared).toHaveLength(1);
    expect(rec.log.slice(1)).toEqual([
      'create-url',
      'attach-hidden-link',
      'click:a.docx:blob:fake-1',
      'remove-link',
      `schedule:${DOWNLOAD_URL_REVOKE_DELAY_MS}`,
    ]);
  });

  it('其他分享錯誤（DataError／NotSupportedError）與能力檢查拋錯：改走下載並成功', async () => {
    for (const name of ['DataError', 'NotSupportedError']) {
      const rec = fakeEnv({ canShare: true, share: async () => { throw domError(name); } });
      expect(await deliverFile(makeExportFile(BYTES, 'a.docx', DOCX_MIME), rec.env)).toBe('downloaded');
      expect(rec.log[0]).toBe('share');
      expect(rec.log).toContain('click:a.docx:blob:fake-1');
    }
    const checkThrows = fakeEnv({ canShare: true, canShareThrows: true });
    expect(await deliverFile(makeExportFile(BYTES, 'a.docx', DOCX_MIME), checkThrows.env)).toBe('downloaded');
    expect(checkThrows.shared).toEqual([]);
  });

  it('精細指標（Windows Edge）即使 canShare 為真也直接下載、不呼叫 share；有觸控的精細指標與無觸控裝置亦同', async () => {
    const cases: FakeOptions[] = [
      { canShare: true, fine: true, coarse: false, touch: 0 },
      { canShare: true, fine: true, coarse: false, touch: 10 },
      { canShare: true, fine: true, coarse: true, touch: 5 },
      { canShare: true, fine: false, coarse: true, touch: 0 },
      { canShare: true, fine: false, coarse: false, touch: 0 },
    ];
    for (const options of cases) {
      const rec = fakeEnv(options);
      expect(await deliverFile(makeExportFile(BYTES, 'a.docx', DOCX_MIME), rec.env)).toBe('downloaded');
      expect(rec.shared).toEqual([]);
      expect(rec.log).not.toContain('share');
    }
  });

  it('shouldPreferDownload：只有具觸控且粗指標才先分享；無法確認時下載；每次讀當下值', () => {
    expect(shouldPreferDownload(fakeEnv({ fine: false, coarse: true, touch: 5 }).env)).toBe(false);
    expect(shouldPreferDownload(fakeEnv({ fine: false, coarse: false, touch: 5 }).env)).toBe(true);
    const unknown = { ...fakeEnv().env, pointerFine: undefined, pointerCoarse: undefined, maxTouchPoints: undefined };
    expect(shouldPreferDownload(unknown)).toBe(true);
    const throwing = { ...fakeEnv().env, maxTouchPoints: () => { throw new Error('x'); } };
    expect(shouldPreferDownload(throwing)).toBe(true);
    let touch = 5;
    const live = { ...fakeEnv().env, maxTouchPoints: () => touch };
    expect(shouldPreferDownload(live)).toBe(false);
    touch = 0;
    expect(shouldPreferDownload(live)).toBe(true);
  });

  it('下載連結點擊失敗：回報錯誤並清理連結與物件網址（auto 與 download 都一樣），不回備妥', async () => {
    for (const mode of ['auto', 'download'] as const) {
      const rec = fakeEnv({ clickThrows: true, canShare: true, fine: true });
      await expect(deliverFile(makeExportFile(BYTES, 'a.txt', TXT_MIME), rec.env, mode)).rejects.toThrow('模擬無法下載');
      expect(rec.log).toEqual(['create-url', 'attach-hidden-link', 'click:a.txt:blob:fake-1', 'remove-link', 'revoke:blob:fake-1']);
    }
    // 分享失敗後的下載後備也失敗：丟出錯誤
    const both = fakeEnv({ clickThrows: true, canShare: true, share: async () => { throw domError('DataError'); } });
    await expect(deliverFile(makeExportFile(BYTES, 'a.txt', TXT_MIME), both.env)).rejects.toThrow('模擬無法下載');
    expect(both.log.at(-1)).toBe('revoke:blob:fake-1');
  });

  it('downloadFile 可直接使用', () => {
    const rec = fakeEnv();
    expect(downloadFile(makeExportFile(BYTES, 'a.docx', DOCX_MIME), rec.env)).toBe('downloaded');
  });

  it('不能分享檔案時：掛進頁面的隱藏連結設 download 再點、點完移除，物件網址延後釋放', async () => {
    for (const rec of [fakeEnv(), fakeEnv({ canShare: false })]) {
      const file = makeExportFile(BYTES, '霧港_全文.docx', DOCX_MIME);
      expect(await deliverFile(file, rec.env)).toBe('downloaded');
      expect(rec.shared).toEqual([]);
      expect(rec.log).toEqual([
        'create-url',
        'attach-hidden-link',
        'click:霧港_全文.docx:blob:fake-1',
        'remove-link',
        `schedule:${DOWNLOAD_URL_REVOKE_DELAY_MS}`,
      ]);
      expect(DOWNLOAD_URL_REVOKE_DELAY_MS).toBeGreaterThanOrEqual(30_000);
      // 時間到才釋放
      rec.timers[0]!.run();
      expect(rec.log.at(-1)).toBe('revoke:blob:fake-1');
    }
  });

  it('下載點擊就失敗時：移除連結、立刻釋放網址並丟出錯誤（呼叫端當作無法匯出、不計次）', async () => {
    const rec = fakeEnv({ clickThrows: true });
    await expect(deliverFile(makeExportFile(BYTES, 'a.txt', TXT_MIME), rec.env)).rejects.toThrow('模擬無法下載');
    expect(rec.log).toEqual(['create-url', 'attach-hidden-link', 'click:a.txt:blob:fake-1', 'remove-link', 'revoke:blob:fake-1']);
  });

  it('既有 .db 交付不變：shareDatabase 仍強制 .db 與 application/octet-stream', () => {
    expect(typeof shareDatabase).toBe('function');
    const file = new File([new Uint8Array([1])], 'a.db', { type: 'application/octet-stream' });
    expect(databaseSharePayload(file)).toEqual({ files: [file] });
  });
});
