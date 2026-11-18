import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPEN_DB_FAIL } from '../copy/userFacing';
import { canPickLocalFiles } from '../db/browserDisk';
import { writePath } from '../domain/openManuscript';
import { dispatchOpen, readBrowserRouteEnv } from '../domain/openFileRoute';
import { useSample } from '../state/sampleStore';

export type OpenFileResult = 'opened' | 'cancelled' | 'failed';

/**
 * 首頁「開啟稿子」原本的做法抽出來共用（WO-111：歡迎導覽收尾「開始寫」也走這裡，不另造一套）。
 * - 支援開檔與存檔 picker 且不是 Windows 桌面：openWithPicker（之後可直接寫回）。
 * - 不支援，或 WO-123 起的 Windows 桌面（系統選檔視窗遮住瀏覽器時 picker 會被瀏覽器取消）：
 *   點隱藏的 file input，選了 .db 交給 importFile。input 沒有原檔把手，第一次儲存會問存放位置。
 * - 分流集中在 domain/openFileRoute.ts 的 dispatchOpen。
 * - 打開就進寫作頁；打不開跳 OPEN_DB_FAIL。.db 用檔案自己的目標。
 * open 一定要在按鈕的點擊裡直接呼叫（系統選檔需要使用者手勢）。after 只用來通知結果（例如沒選檔就回首頁）。
 */
export function useOpenManuscriptFile(): {
  busy: boolean;
  open: (after?: (result: OpenFileResult) => void) => void;
  input: ReactElement;
} {
  const { actions } = useSample();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<((result: OpenFileResult) => void) | null>(null);
  const busyRef = useRef(false);
  const begin = () => {
    busyRef.current = true;
    setBusy(true);
  };
  const end = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const settle = (result: OpenFileResult) => {
    const after = afterRef.current;
    afterRef.current = null;
    after?.(result);
  };

  // 系統選檔按「取消」時 file input 會發 cancel（不支援的瀏覽器就不會通知，照舊停在原處）。
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onCancel = () => settle('cancelled');
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, []);

  const open = (after?: (result: OpenFileResult) => void) => {
    // WO-121：讀取中不重複開選檔（按鈕改顯示 OPEN_FILE_BUSY）。
    if (busyRef.current) return;
    afterRef.current = after ?? null;
    dispatchOpen({
      canPick: canPickLocalFiles(),
      env: readBrowserRouteEnv(),
      runPicker: () => {
        begin();
        // 這一行仍在點擊的同步段落裡：openWithPicker 第一步就是 showOpenFilePicker。
        void actions
          .openWithPicker()
          .then((opened) => {
            if (opened) {
              navigate(writePath(opened.id, opened.chapterId));
              settle('opened');
            } else {
              settle('cancelled');
            }
          })
          .catch(() => {
            actions.toast(OPEN_DB_FAIL);
            settle('failed');
          })
          .finally(end);
      },
      clickInput: () => inputRef.current?.click(),
    });
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".db,application/octet-stream,application/x-sqlite3"
      hidden
      data-testid="open-db"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
          settle('cancelled');
          return;
        }
        begin();
        void actions
          .importFile(file)
          .then((opened) => {
            navigate(writePath(opened.id, opened.chapterId));
            settle('opened');
          })
          .catch(() => {
            actions.toast(OPEN_DB_FAIL);
            settle('failed');
          })
          .finally(end);
      }}
    />
  );

  return { busy, open, input };
}
