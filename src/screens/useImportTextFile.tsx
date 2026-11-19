import { useRef, useState, type ReactElement, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { IMPORT_TEXT_STORAGE_FAIL, IMPORT_TEXT_UNREADABLE } from '../copy/userFacing';
import { writePath } from '../domain/openManuscript';
import { useLayout } from '../layout';
import { useSample, wholeTextImportChapters, type TextImportPreview } from '../state/sampleStore';
import { ImportTextDialog, type ImportDialogStep } from './ImportTextDialog';

interface ImportSession {
  filename: string;
  /** 已解碼、統一換行的全文（留在記憶體，回去改例子不必重讀）。 */
  text: string;
  example: string;
  step: ImportDialogStep;
  preview: TextImportPreview | null;
}

/**
 * WO-99 原本在檔案頁的「匯入文字檔」介面邏輯；WO-120 搬到首頁；WO-126 改成先預覽再確定：
 * - pick 要在按鈕的點擊裡直接呼叫（系統選檔需要使用者手勢）；取消選檔什麼都不做、不顯示錯誤。
 * - 選到檔先讀取、解碼；讀不出來顯示 IMPORT_TEXT_UNREADABLE，不開視窗。
 * - 解碼成功開匯入視窗：填例子（可留白）→ 看預覽 → 確定匯入／回去改例子／不分章。
 *   預覽階段不建稿、不寫紀錄；關閉視窗不匯入。
 * - 確定或不分章才呼叫 actions.confirmImportText；成功直接開成新稿子（導向寫作頁）。
 */
export function useImportTextFile(): {
  busy: boolean;
  /** 匯入視窗是否開著（首頁要 inert）。 */
  open: boolean;
  error: string | null;
  pick: () => void;
  input: ReactElement;
  dialog: ReactElement | null;
  buttonRef: RefObject<HTMLButtonElement | null>;
} {
  const { actions } = useSample();
  const { isAtLeastMedium } = useLayout();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [reading, setReading] = useState(false);
  const [working, setWorking] = useState<'preview' | 'write' | null>(null);
  const [session, setSession] = useState<ImportSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每次開／關視窗與每次預覽都換一個編號；遲到的結果對不上就丟掉。
  const tokenRef = useRef(0);
  const lockRef = useRef(false);

  const pick = () => {
    if (reading || working !== null || session) return;
    inputRef.current?.click();
  };

  const read = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      const result = await actions.readImportText(file);
      if (result.kind === 'unreadable') {
        setError(IMPORT_TEXT_UNREADABLE);
        return;
      }
      tokenRef.current += 1;
      setSession({ filename: file.name, text: result.text, example: '', step: 'example', preview: null });
    } catch {
      setError(IMPORT_TEXT_UNREADABLE);
    } finally {
      setReading(false);
    }
  };

  const close = () => {
    if (lockRef.current) return;
    tokenRef.current += 1;
    setWorking(null);
    setSession(null);
    // 關閉後焦點回到首頁匯入按鈕。
    setTimeout(() => buttonRef.current?.focus(), 0);
  };

  const preview = async () => {
    if (!session || working !== null) return;
    const token = ++tokenRef.current;
    const { text, example } = session;
    setWorking('preview');
    try {
      const result = await actions.previewImportText(text, example);
      if (token !== tokenRef.current) return;
      setSession((current) => (current ? { ...current, step: 'preview', preview: result } : current));
    } catch {
      if (token !== tokenRef.current) return;
      setSession(null);
      setError(IMPORT_TEXT_UNREADABLE);
    } finally {
      if (token === tokenRef.current) setWorking(null);
    }
  };

  const commit = async (mode: 'preview' | 'whole') => {
    if (!session || lockRef.current) return;
    const chapters = mode === 'whole' ? wholeTextImportChapters(session.text) : session.preview?.chapters;
    if (!chapters) return;
    lockRef.current = true;
    tokenRef.current += 1;
    setWorking('write');
    try {
      const result = await actions.confirmImportText({ filename: session.filename, chapters });
      setSession(null);
      if (result.kind === 'imported') {
        navigate(writePath(result.id, result.chapterId));
        return;
      }
      if (result.kind === 'unreadable') setError(IMPORT_TEXT_UNREADABLE);
      if (result.kind === 'storage-failed') setError(IMPORT_TEXT_STORAGE_FAIL);
    } catch {
      setSession(null);
      setError(IMPORT_TEXT_UNREADABLE);
    } finally {
      lockRef.current = false;
      setWorking(null);
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
        if (!file || reading || working !== null || session) return;
        void read(file);
      }}
    />
  );

  const dialog = session ? (
    <ImportTextDialog
      placement={isAtLeastMedium ? 'center' : 'sheet'}
      step={session.step}
      example={session.example}
      preview={session.preview}
      working={working}
      onExampleChange={(value) => setSession((current) => (current ? { ...current, example: value } : current))}
      onPreview={() => void preview()}
      onBack={() => setSession((current) => (current ? { ...current, step: 'example' } : current))}
      onConfirm={() => void commit('preview')}
      onNoSplit={() => void commit('whole')}
      onClose={close}
    />
  ) : null;

  return { busy: reading, open: session !== null, error, pick, input, dialog, buttonRef };
}
