export interface PreparedShare {
  key: string;
  filename: string;
  bytes: Uint8Array;
}

const prepared = new Map<string, PreparedShare>();
const generation = new Map<string, number>();

export function currentShareGeneration(projectId: string): number {
  return generation.get(projectId) ?? 0;
}

/** 改書名時先備好的分享檔。世代不對就不要寫回去，避免「等一下」之後又被補上。 */
export function rememberPreparedShare(
  projectId: string,
  share: PreparedShare,
  generationAtStart: number,
): boolean {
  if ((generation.get(projectId) ?? 0) !== generationAtStart) return false;
  prepared.set(projectId, share);
  return true;
}

export function peekPreparedShare(projectId: string): PreparedShare | null {
  return prepared.get(projectId) ?? null;
}

/** 選「等一下」或關掉卡片時，丟掉預備檔，並讓進行中的準備作廢。 */
export function dismissRenameSavePrompt(projectId: string): void {
  prepared.delete(projectId);
  generation.set(projectId, (generation.get(projectId) ?? 0) + 1);
}

/** 另存一律用當下最新內容。改書名時備好的舊檔不能拿來分享。 */
export function shareBytesForSaveAs(input: {
  prepared: Uint8Array | null;
  latest: Uint8Array;
}): Uint8Array {
  void input.prepared;
  return input.latest;
}
