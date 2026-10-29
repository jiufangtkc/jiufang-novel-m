import {
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  SAVE_PERMISSION_DENIED,
} from '../copy/userFacing';
import type { DiskFile, TargetStore } from './fileTarget';

export type SaveOutcome =
  | { kind: 'saved'; filename: string }
  | { kind: 'saved-as'; filename: string }
  | { kind: 'handed-off'; via: 'share' | 'download'; filename: string }
  | { kind: 'cancelled' }
  | { kind: 'permission-denied' }
  | { kind: 'write-failed'; restored: boolean }
  | { kind: 'invalid-database' };

export interface SaveEnvironment {
  canPickFiles: boolean;
  targets: TargetStore;
  verify(bytes: Uint8Array): Promise<void>;
  pickSaveLocation(suggestedName: string): Promise<DiskFile | null>;
  share(filename: string, bytes: Uint8Array): Promise<'shared' | 'downloaded' | 'cancelled'>;
}

export function saveNotice(outcome: SaveOutcome): string | null {
  switch (outcome.kind) {
    case 'saved':
      return '已儲存';
    case 'saved-as':
      return '已另存';
    case 'handed-off':
      return outcome.via === 'share' ? '已另存' : '已下載，請自行放到想放的位置';
    case 'cancelled':
      return null;
    case 'permission-denied':
      return SAVE_PERMISSION_DENIED;
    case 'write-failed':
      return outcome.restored ? SAVE_PARTIAL_FAIL : SAVE_FATAL_FAIL;
    case 'invalid-database':
      return SAVE_FATAL_FAIL;
    default:
      return null;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function ensurePermission(file: DiskFile): Promise<boolean> {
  const current = await file.queryPermission();
  if (current === 'granted') return true;
  return (await file.requestPermission()) === 'granted';
}

/** 先讀出原檔。寫入失敗時若內容已變，再把原檔寫回去。 */
export async function writeWithoutDestroying(file: DiskFile, bytes: Uint8Array): Promise<'ok' | { restored: boolean }> {
  const backup = await file.read();
  try {
    await file.write(bytes);
    return 'ok';
  } catch {
    try {
      const current = await file.read();
      if (sameBytes(current, backup)) return { restored: true };
      await file.write(backup);
      return { restored: sameBytes(await file.read(), backup) };
    } catch {
      return { restored: false };
    }
  }
}

async function writeGranted(file: DiskFile, bytes: Uint8Array): Promise<SaveOutcome | 'ready'> {
  if (!(await ensurePermission(file))) return { kind: 'permission-denied' };
  const wrote = await writeWithoutDestroying(file, bytes);
  if (wrote !== 'ok') return { kind: 'write-failed', restored: wrote.restored };
  return 'ready';
}

/** 存回開啟時的位置。僅在已有檔案把手或支援選檔寫回時可用；手機請改用另存專案。 */
export async function saveProjectToPlace(
  env: SaveEnvironment,
  bookKey: string,
  bytes: Uint8Array,
  suggestedName: string,
): Promise<SaveOutcome> {
  try {
    await env.verify(bytes);
  } catch {
    return { kind: 'invalid-database' };
  }
  const target = await env.targets.load(bookKey);
  const filename = target?.filename || suggestedName;
  if (target?.file) {
    const wrote = await writeGranted(target.file, bytes);
    if (wrote !== 'ready') return wrote;
    return { kind: 'saved', filename: target.file.name || filename };
  }
  if (env.canPickFiles) {
    const picked = await env.pickSaveLocation(filename);
    if (!picked) return { kind: 'cancelled' };
    const wrote = await writeGranted(picked, bytes);
    if (wrote !== 'ready') return wrote;
    await env.targets.save(bookKey, { filename: picked.name, file: picked });
    return { kind: 'saved', filename: picked.name };
  }
  return { kind: 'cancelled' };
}

/**
 * 另存到作家指定的新位置。
 * 桌機選好後，「儲存專案」之後改寫這個新檔。
 * 手機走分享選單，檔名用書名_時間戳；不記住新檔名供儲存專案使用。
 */
export async function saveProjectAsNew(
  env: SaveEnvironment,
  bookKey: string,
  bytes: Uint8Array,
  suggestedName: string,
): Promise<SaveOutcome> {
  try {
    await env.verify(bytes);
  } catch {
    return { kind: 'invalid-database' };
  }
  if (env.canPickFiles) {
    const picked = await env.pickSaveLocation(suggestedName);
    if (!picked) return { kind: 'cancelled' };
    const wrote = await writeGranted(picked, bytes);
    if (wrote !== 'ready') return wrote;
    await env.targets.save(bookKey, { filename: picked.name, file: picked });
    return { kind: 'saved-as', filename: picked.name };
  }
  const via = await env.share(suggestedName, bytes);
  if (via === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'handed-off', via: via === 'shared' ? 'share' : 'download', filename: suggestedName };
}
