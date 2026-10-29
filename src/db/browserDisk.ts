import type { DiskFile } from './fileTarget';

interface PickerWindow {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}

function pickerWindow(): PickerWindow {
  return window as unknown as PickerWindow;
}

const DB_TYPE = {
  description: '九方小說編輯器稿子',
  accept: { 'application/octet-stream': ['.db'] },
};

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
      types: [DB_TYPE],
    });
    if (!handle) return null;
    try {
      await withPermission(handle).requestPermission({ mode: 'readwrite' });
    } catch {
      // 讀得到即可先開啟。存回時會再請一次權限。
    }
    const file = diskFileFromHandle(handle);
    return { bytes: await file.read(), file };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function pickSaveFile(suggestedName: string): Promise<DiskFile | null> {
  const host = pickerWindow();
  if (!host.showSaveFilePicker) return null;
  try {
    const handle = await host.showSaveFilePicker({
      suggestedName,
      types: [DB_TYPE],
    });
    try {
      await withPermission(handle).requestPermission({ mode: 'readwrite' });
    } catch {
      // 選檔本身通常已含寫入許可。真正寫入前仍會再確認。
    }
    return diskFileFromHandle(handle);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
