/**
 * WO-143：「留下這一份，刪掉同一本的其他份」。逐份呼叫既有的刪除流程（removeFromDevice），
 * 任何一份失敗（回 false 或丟錯）就停下，已刪的不回復，剩下的不再試。
 * 呼叫端只傳「isSameBook 的其他份」的稿子代號；這裡不判斷、不自動刪任何東西。
 */
export async function removeOtherCopies(input: {
  ids: readonly string[];
  remove: (id: string) => Promise<boolean>;
}): Promise<{ removed: string[]; failedId: string | null }> {
  const removed: string[] = [];
  for (const id of input.ids) {
    let ok = false;
    try {
      ok = await input.remove(id);
    } catch {
      ok = false;
    }
    if (!ok) return { removed, failedId: id };
    removed.push(id);
  }
  return { removed, failedId: null };
}
