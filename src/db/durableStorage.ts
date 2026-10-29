/** 先掛上失敗處理，避免還沒人等待時變成未處理的拒絕。之後 await 仍會失敗。 */
export function catchEarlyRejection<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

export async function requestDurableStorage(
  storage: { persist?: () => Promise<boolean> } | null | undefined,
): Promise<boolean> {
  if (!storage || typeof storage.persist !== 'function') return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
