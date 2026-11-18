import { DB_FILE_TYPE_LABEL } from '../copy/userFacing';
import type { DiskFile } from './fileTarget';

interface SavePickerConfig {
  suggestedName?: string;
  startIn?: unknown;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}

interface PickerWindow {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SavePickerConfig) => Promise<FileSystemFileHandle>;
}

function pickerWindow(): PickerWindow {
  return window as unknown as PickerWindow;
}

export const DATABASE_FILE_TYPE = {
  description: DB_FILE_TYPE_LABEL,
  accept: { 'application/octet-stream': ['.db'] },
};

/** 存檔視窗的預設檔名。有舊檔把手時，從那個檔案所在的資料夾開。 */
export function savePickerConfig(suggestedName: string, directoryHint?: unknown): SavePickerConfig {
  const config: SavePickerConfig = {
    suggestedName,
    types: [DATABASE_FILE_TYPE],
  };
  if (directoryHint) config.startIn = directoryHint;
  return config;
}

interface PermissionedHandle extends FileSystemFileHandle {
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<'granted' | 'prompt' | 'denied'>;
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<'granted' | 'prompt' | 'denied'>;
}

function withPermission(handle: FileSystemFileHandle): PermissionedHandle {
  return handle as PermissionedHandle;
}

export function canPickLocalFiles(): boolean {
  if (typeof window === 'undefined') return false;
  const host = pickerWindow();
  return typeof host.showOpenFilePicker === 'function' && typeof host.showSaveFilePicker === 'function';
}

export function diskFileFromHandle(handle: FileSystemFileHandle): DiskFile & { sourceHandle: FileSystemFileHandle } {
  return {
    name: handle.name,
    sourceHandle: handle,
    directoryHint: handle,
    async read() {
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    },
    async write(bytes) {
      const writable = await handle.createWritable();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      try {
        await writable.write(copy);
        await writable.close();
      } catch (error) {
        try {
          await writable.abort();
        } catch {
          // 已經結束的寫入流不必再中止。
        }
        throw error;
      }
    },
    async queryPermission() {
      return withPermission(handle).queryPermission({ mode: 'readwrite' });
    },
    async requestPermission() {
      const result = await withPermission(handle).requestPermission({ mode: 'readwrite' });
      return result === 'granted' ? 'granted' : 'denied';
    },
  };
}

export async function pickExistingDatabase(): Promise<{ bytes: Uint8Array; file: DiskFile } | null> {
  const host = pickerWindow();
  if (!host.showOpenFilePicker) return null;
  try {
    const [handle] = await host.showOpenFilePicker({
      multiple: false,
      excludeAcceptAllOption: false,
      types: [DATABASE_FILE_TYPE],
    });
    if (!handle) return null;
    // WO-121：開檔只讀，不索取寫入權限（含背景呼叫）。把手留著，第一次存檔時由 saveProject 的 ensurePermission 才問。
    const file = diskFileFromHandle(handle);
    return { bytes: await file.read(), file };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

async function pickSaveOnce(suggestedName: string, directoryHint?: unknown): Promise<DiskFile> {
  const host = pickerWindow();
  if (!host.showSaveFilePicker) throw new Error('這個瀏覽器不能選存檔位置');
  const handle = await host.showSaveFilePicker(savePickerConfig(suggestedName, directoryHint));
  try {
    await withPermission(handle).requestPermission({ mode: 'readwrite' });
  } catch {
    // 選檔本身通常已含寫入許可。真正寫入前仍會再確認。
  }
  return diskFileFromHandle(handle);
}

export async function pickSaveFile(suggestedName: string, directoryHint?: unknown): Promise<DiskFile | null> {
  const host = pickerWindow();
  if (!host.showSaveFilePicker) return null;
  try {
    return await pickSaveOnce(suggestedName, directoryHint);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (!directoryHint) throw error;
    try {
      return await pickSaveOnce(suggestedName);
    } catch (again) {
      if (again instanceof DOMException && again.name === 'AbortError') return null;
      throw again;
    }
  }
}
