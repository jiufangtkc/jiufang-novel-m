import { useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { IMPORT_TEXT_STORAGE_FAIL, IMPORT_TEXT_UNREADABLE } from '../copy/userFacing';
import { writePath } from '../domain/openManuscript';
import { useSample } from '../state/sampleStore';

/**
 * WO-99 原本在檔案頁的「匯入文字檔」介面邏輯；WO-120 搬到首頁，行為不變：
 * - 重用既有 actions.importTextFile，不另寫匯入。
 * - 處理中再按不會重複匯入；取消選檔（沒有選到檔）什麼都不做、不顯示錯誤。
 * - 成功直接開成新稿子（導向寫作頁）；讀不出來、存不下各顯示原本那一句。
 * pick 要在按鈕的點擊裡直接呼叫（系統選檔需要使用者手勢）。
 */
export function useImportTextFile(): {
  busy: boolean;
  error: string | null;
  pick: () => void;
  input: ReactElement;
} {
  const { actions } = useSample();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const run = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const result = await actions.importTextFile(file);
      if (result.kind === 'imported') {
        navigate(writePath(result.id, result.chapterId));
        return;
      }
      if (result.kind === 'unreadable') setError(IMPORT_TEXT_UNREADABLE);
      if (result.kind === 'storage-failed') setError(IMPORT_TEXT_STORAGE_FAIL);
    } catch {
      setError(IMPORT_TEXT_UNREADABLE);
    } finally {
      setBusy(false);
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".txt,text/plain"
      hidden
      data-testid="import-text-input"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || busy) return;
        void run(file);
      }}
    />
  );

  return { busy, error, pick, input };
}
