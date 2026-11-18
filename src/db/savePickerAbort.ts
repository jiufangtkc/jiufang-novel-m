/**
 * WO-123：存檔 picker（showSaveFilePicker）回 AbortError 時，用這個可辨識的錯誤把「來源是存檔 picker」帶出去，
 * 讓存檔結果能跳「縮小選檔視窗」提示。手機分享取消、沒有 picker 等其他 cancelled 不會用到它。
 * 真正按取消也會回 AbortError，程式分不出來，所以兩種情況都會拋這個錯。
 */
export class SavePickerAbortedError extends Error {
  readonly savePickerAborted = true;
  constructor() {
    super('存檔選位置視窗被中止');
    this.name = 'SavePickerAbortedError';
  }
}

export function isSavePickerAborted(error: unknown): boolean {
  return error instanceof SavePickerAbortedError;
}
