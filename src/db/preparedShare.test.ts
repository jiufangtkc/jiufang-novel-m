import { describe, expect, it } from 'vitest';
import {
  currentShareGeneration,
  dismissRenameSavePrompt,
  peekPreparedShare,
  rememberPreparedShare,
  shareBytesForSaveAs,
} from './preparedShare';

describe('等一下之後再另存', () => {
  it('丟掉改書名當下的預備檔，另存用後來寫的內容', () => {
    const projectId = 'book-later';
    const stale = new Uint8Array([1, 0, 0]);
    const latest = new Uint8Array([2, 9, 8]);
    const generation = currentShareGeneration(projectId);
    rememberPreparedShare(projectId, {
      key: 'k',
      filename: '改名前.db',
      bytes: stale,
    }, generation);

    dismissRenameSavePrompt(projectId);

    expect(peekPreparedShare(projectId)).toBeNull();
    expect(rememberPreparedShare(projectId, {
      key: 'k',
      filename: '改名前.db',
      bytes: stale,
    }, generation)).toBe(false);
    expect(peekPreparedShare(projectId)).toBeNull();
    expect(Array.from(shareBytesForSaveAs({ prepared: stale, latest }))).toEqual(Array.from(latest));
  });
});
