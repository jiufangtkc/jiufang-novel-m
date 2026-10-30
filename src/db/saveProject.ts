import {
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  SAVE_PERMISSION_DENIED,
  TOAST_SAVED_UNDER_NEW_TITLE,
} from '../copy/userFacing';
import type { DiskFile, TargetStore } from './fileTarget';

export type SaveOutcome =
  | { kind: 'saved'; filename: string }
  | { kind: 'saved-as'; filename: string }
  | { kind: 'saved-under-new-title'; filename: string }
  | { kind: 'handed-off'; via: 'share' | 'download'; filename: string }
  | { kind: 'cancelled' }
  | { kind: 'permission-denied' }
  | { kind: 'write-failed'; restored: boolean }
  | { kind: 'invalid-database' };

export type ProjectSavePlan = 'write-back' | 'pick-new-name' | 'pick-first-save';

export interface SaveEnvironment {
  canPickFiles: boolean;
  targets: TargetStore;
  verify(bytes: Uint8Array): Promise<void>;
  pickSaveLocation(suggestedName: string, startIn?: DiskFile | null): Promise<DiskFile | null>;
  share(filename: string, bytes: Uint8Array): Promise<'shared' | 'downloaded' | 'cancelled'>;
}

export function saveNotice(outcome: SaveOutcome): string | null {
  switch (outcome.kind) {
    case 'saved':
      return '已儲存';
    case 'saved-as':
      return '已另存';
    case 'saved-under-new-title':
      return TOAST_SAVED_UNDER_NEW_TITLE;
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

/**
 * 要跳出存檔視窗時，必須在按下的這一刻先拿到檔案把手，再整理稿子。
 * 已經有把手、而且這次要寫回原檔，就不跳視窗。
 */
export function shouldPickBeforeBuild(input: {
  canPick: boolean;
  needsNewName: boolean;
  remembered: DiskFile | null | undefined;
  hasExternalFile: boolean;
}): boolean {
  if (!input.canPick) return false;
  if (input.needsNewName) return true;
  if (input.remembered) return false;
  if (input.remembered === undefined && input.hasExternalFile) return false;
  return true;
}

/** 分享選單要由手指按下直接叫出。內容事先備好，這裡不再整理。 */
export async function handOffPrepared(
  env: SaveEnvironment,
  filename: string,
  bytes: Uint8Array,
): Promise<SaveOutcome> {
  const via = await env.share(filename, bytes);
  if (via === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'handed-off', via: via === 'shared' ? 'share' : 'download', filename };
}

/**
 * 儲存專案。需要選位置時先跳視窗，使用者取消就完全不整理、不寫入。
 * 用新書名另存時只寫新檔，呼叫端傳入的舊檔不會被寫到。
 */
export async function saveProjectFromClick(input: {
  env: SaveEnvironment;
  bookKey: string;
  plan: ProjectSavePlan;
  writeBackName: string;
  newTitleName: string;
  startIn: DiskFile | null;
  buildBytes: () => Promise<Uint8Array>;
  onRemember?: (file: DiskFile) => void;
}): Promise<SaveOutcome> {
  if (input.plan === 'write-back') {
    let bytes: Uint8Array;
    try {
      bytes = await input.buildBytes();
    } catch {
      return { kind: 'invalid-database' };
    }
    return saveProjectToPlace(input.env, input.bookKey, bytes, input.writeBackName);
  }
  const suggested = input.plan === 'pick-new-name' ? input.newTitleName : input.writeBackName;
  const startIn = input.plan === 'pick-new-name' ? input.startIn : null;
  const picked = await input.env.pickSaveLocation(suggested, startIn);
  if (!picked) return { kind: 'cancelled' };
  let bytes: Uint8Array;
  try {
    bytes = await input.buildBytes();
  } catch {
    return { kind: 'invalid-database' };
  }
  try {
    await input.env.verify(bytes);
  } catch {
    return { kind: 'invalid-database' };
  }
  const wrote = await writeGranted(picked, bytes);
  if (wrote !== 'ready') return wrote;
  await input.env.targets.save(input.bookKey, { filename: picked.name, file: picked });
  input.onRemember?.(picked);
  if (input.plan === 'pick-new-name') {
    return { kind: 'saved-under-new-title', filename: picked.name };
  }
  return { kind: 'saved', filename: picked.name };
}
