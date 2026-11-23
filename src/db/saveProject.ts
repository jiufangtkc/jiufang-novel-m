import {
  SAVE_CONFLICT_TOAST,
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  SAVE_PERMISSION_DENIED,
  TOAST_SAVED_UNDER_NEW_TITLE,
} from '../copy/userFacing';
import { SAVE_PICKER_ABORTED_TOAST } from '../copy/userFacing';
import type { DiskFile, SaveTarget, TargetStore } from './fileTarget';
import { sha256Hex } from './fingerprint';
import { recallOpenFileFingerprint, rememberOpenFileFingerprint } from './openFileMemory';
import { isSavePickerAborted } from './savePickerAbort';

export type SaveOutcome =
  | { kind: 'picker-aborted' }
  | { kind: 'saved'; filename: string }
  | { kind: 'saved-as'; filename: string }
  | { kind: 'saved-under-new-title'; filename: string }
  | { kind: 'handed-off'; via: 'share' | 'download'; filename: string }
  | { kind: 'external-conflict'; filename: string }
  | { kind: 'cancelled' }
  | { kind: 'permission-denied' }
  | { kind: 'write-failed'; restored: boolean }
  | { kind: 'invalid-database' };

export type ProjectSavePlan = 'write-back' | 'pick-new-name' | 'pick-first-save';

export interface SaveEnvironment {
  canPickFiles: boolean;
  targets: TargetStore;
  verify(bytes: Uint8Array): Promise<void>;
  /** WO-123：存檔 picker 回 AbortError 時 reject SavePickerAbortedError；其他取消（無 picker 等）仍回 null。 */
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
    case 'external-conflict':
      return SAVE_CONFLICT_TOAST;
    case 'cancelled':
      return null;
    case 'picker-aborted':
      return SAVE_PICKER_ABORTED_TOAST;
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

/** 選存檔位置。AbortError 轉成 'aborted'（用來跳提示）；其他錯誤照舊丟出。 */
async function pickLocation(
  env: SaveEnvironment,
  suggestedName: string,
  startIn?: DiskFile | null,
): Promise<DiskFile | null | 'aborted'> {
  try {
    return await env.pickSaveLocation(suggestedName, startIn);
  } catch (error) {
    if (isSavePickerAborted(error)) return 'aborted';
    throw error;
  }
}

async function ensurePermission(file: DiskFile): Promise<boolean> {
  const current = await file.queryPermission();
  if (current === 'granted') return true;
  return (await file.requestPermission()) === 'granted';
}

/** 先讀出原檔。若有基準指紋且原檔已變，立刻停手回傳 'conflict'；寫入失敗時若內容已變，再把原檔寫回去。 */
export async function writeWithoutDestroying(
  file: DiskFile,
  bytes: Uint8Array,
  expectedFingerprint?: string | null,
): Promise<'ok' | 'conflict' | { restored: boolean }> {
  const backup = await file.read();
  if (expectedFingerprint && backup.byteLength > 0) {
    const actualFingerprint = sha256Hex(backup);
    if (actualFingerprint !== expectedFingerprint) {
      return 'conflict';
    }
  }
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

async function writeGranted(
  file: DiskFile,
  bytes: Uint8Array,
  expectedFingerprint?: string | null,
): Promise<SaveOutcome | 'ready'> {
  if (!(await ensurePermission(file))) return { kind: 'permission-denied' };
  const wrote = await writeWithoutDestroying(file, bytes, expectedFingerprint);
  if (wrote === 'conflict') return { kind: 'external-conflict', filename: file.name };
  if (wrote !== 'ok') return { kind: 'write-failed', restored: wrote.restored };
  return 'ready';
}

async function rememberTargetFingerprint(
  targets: TargetStore,
  bookKey: string,
  file: DiskFile,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const fp = sha256Hex(bytes);
  rememberOpenFileFingerprint(bookKey, file, fp);
  try {
    await targets.save(bookKey, {
      filename,
      file,
      lastKnownFingerprint: fp,
    });
  } catch {
    // 磁碟寫入已成功；IndexedDB 保存把手或指紋失敗時不否定本次存檔結果。
  }
}

async function resolveExpectedFingerprint(
  targets: TargetStore,
  bookKey: string,
  file: DiskFile,
  loadedTarget?: SaveTarget | null,
): Promise<string | null> {
  const inMemory = recallOpenFileFingerprint(bookKey, file);
  if (inMemory !== undefined) return inMemory;
  if (loadedTarget !== undefined) return loadedTarget?.lastKnownFingerprint ?? null;
  const target = await targets.load(bookKey).catch(() => null);
  return target?.lastKnownFingerprint ?? null;
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
    const expectedFp = await resolveExpectedFingerprint(env.targets, bookKey, target.file, target);
    const wrote = await writeGranted(target.file, bytes, expectedFp);
    if (wrote !== 'ready') {
      if (wrote.kind === 'external-conflict') {
        return { kind: 'external-conflict', filename: target.file.name || filename };
      }
      return wrote;
    }
    const savedName = target.file.name || filename;
    await rememberTargetFingerprint(env.targets, bookKey, target.file, savedName, bytes);
    return { kind: 'saved', filename: savedName };
  }
  if (env.canPickFiles) {
    const picked = await pickLocation(env, filename);
    if (picked === 'aborted') return { kind: 'picker-aborted' };
    if (!picked) return { kind: 'cancelled' };
    const wrote = await writeGranted(picked, bytes);
    if (wrote !== 'ready') return wrote;
    await rememberTargetFingerprint(env.targets, bookKey, picked, picked.name, bytes);
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
    const picked = await pickLocation(env, suggestedName);
    if (picked === 'aborted') return { kind: 'picker-aborted' };
    if (!picked) return { kind: 'cancelled' };
    const wrote = await writeGranted(picked, bytes);
    if (wrote !== 'ready') return wrote;
    await rememberTargetFingerprint(env.targets, bookKey, picked, picked.name, bytes);
    return { kind: 'saved-as', filename: picked.name };
  }
  const via = await env.share(suggestedName, bytes);
  if (via === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'handed-off', via: via === 'shared' ? 'share' : 'download', filename: suggestedName };
}

export type AutoSaveOutcome =
  | { kind: 'saved'; filename: string }
  | { kind: 'external-conflict'; filename: string }
  | { kind: 'no-handle' }
  | { kind: 'needs-permission'; permission: 'prompt' | 'denied' }
  | { kind: 'invalid-database' }
  | { kind: 'write-failed'; restored: boolean };

/**
 * WO-130：背景自動存檔寫回既有檔案把手。
 * - 不開選檔視窗（沒有把手就回 no-handle）。
 * - 不主動呼叫 requestPermission()（未允許就回 needs-permission）。
 * - 沿用同一條 env.verify 與 writeWithoutDestroying 安全寫回鏈。
 */
export async function autoSaveProjectToPlace(
  env: Pick<SaveEnvironment, 'targets' | 'verify'>,
  bookKey: string,
  bytes: Uint8Array,
  fallbackName = '',
  fallbackFile?: DiskFile | null,
): Promise<AutoSaveOutcome> {
  try {
    await env.verify(bytes);
  } catch {
    return { kind: 'invalid-database' };
  }
  if (fallbackFile) {
    const resolvedName = fallbackFile.name || fallbackName;
    const expectedFp = await resolveExpectedFingerprint(env.targets, bookKey, fallbackFile);
    const result = await autoSaveWithFile(fallbackFile, bytes, resolvedName, expectedFp);
    if (result.kind === 'saved') {
      await rememberTargetFingerprint(env.targets, bookKey, fallbackFile, result.filename, bytes);
      return result;
    }
    if (result.kind !== 'needs-permission') {
      return result;
    }
    const target = await env.targets.load(bookKey).catch(() => null);
    if (target?.file && target.file !== fallbackFile) {
      const targetFp = await resolveExpectedFingerprint(env.targets, bookKey, target.file, target);
      const retry = await autoSaveWithFile(target.file, bytes, target.filename || resolvedName, targetFp);
      if (retry.kind === 'saved') {
        await rememberTargetFingerprint(env.targets, bookKey, target.file, retry.filename, bytes);
      }
      return retry;
    }
    return result;
  }
  const target = await env.targets.load(bookKey).catch(() => null);
  const file = target?.file ?? null;
  if (!file) return { kind: 'no-handle' };
  const resolvedName = target?.filename || fallbackName;
  const expectedFp = await resolveExpectedFingerprint(env.targets, bookKey, file, target);
  const result = await autoSaveWithFile(file, bytes, resolvedName, expectedFp);
  if (result.kind === 'saved') {
    await rememberTargetFingerprint(env.targets, bookKey, file, result.filename, bytes);
  }
  return result;
}

async function autoSaveWithFile(
  file: DiskFile,
  bytes: Uint8Array,
  fallbackName: string,
  expectedFingerprint?: string | null,
): Promise<AutoSaveOutcome> {
  let permission: 'granted' | 'prompt' | 'denied';
  try {
    permission = await file.queryPermission();
  } catch {
    return { kind: 'needs-permission', permission: 'prompt' };
  }
  if (permission !== 'granted') {
    return { kind: 'needs-permission', permission };
  }
  try {
    const wrote = await writeWithoutDestroying(file, bytes, expectedFingerprint);
    if (wrote === 'conflict') {
      return { kind: 'external-conflict', filename: file.name || fallbackName };
    }
    if (wrote !== 'ok') return { kind: 'write-failed', restored: wrote.restored };
    return { kind: 'saved', filename: file.name || fallbackName };
  } catch {
    return { kind: 'write-failed', restored: false };
  }
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
  const picked = await pickLocation(input.env, suggested, startIn);
  if (picked === 'aborted') return { kind: 'picker-aborted' };
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
  input.onRemember?.(picked);
  await rememberTargetFingerprint(input.env.targets, input.bookKey, picked, picked.name, bytes);
  if (input.plan === 'pick-new-name') {
    return { kind: 'saved-under-new-title', filename: picked.name };
  }
  return { kind: 'saved', filename: picked.name };
}
