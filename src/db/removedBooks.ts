/**
 * WO-116：這次開著期間，使用者已按「刪掉」從這個裝置拿掉的稿子代號。
 *
 * 只存在記憶體，不是「不要顯示」旗標：真正的暫存（本機儲存、App 空間副本）都會刪掉。
 * 這份名單只負責擋「刪除前就已經開始、刪除後才完成」的非同步作業（啟動讀取、自動暫存、離頁寫回），
 * 避免它們把已刪稿子加回清單或重新寫回儲存。
 * 稿子代號帶有建立時間、不會重複使用，所以名單留到頁面關閉即可。
 */
const removed = new Set<string>();

export function markBookRemoved(id: string): void {
  if (id) removed.add(id);
}

export function isBookRemoved(id: string | null | undefined): boolean {
  return Boolean(id) && removed.has(id as string);
}

/** 刪除失敗時取消登記，稿子仍在這個裝置上，要能繼續正常存。 */
export function unmarkBookRemoved(id: string): void {
  removed.delete(id);
}

export function removedBookIds(): string[] {
  return [...removed];
}

/** 只給測試在案例之間還原用。 */
export function resetRemovedBooksForTest(): void {
  removed.clear();
}
