import {
  REMOVE_FROM_DEVICE_BODY,
  REMOVE_FROM_DEVICE_CANCEL,
  REMOVE_FROM_DEVICE_CONFIRM,
  removeFromDeviceTitle,
} from '../copy/userFacing';

/**
 * WO-116：首頁最近清單 X 的確認視窗。文案是九方定版的，逐字取自 copy/userFacing。
 * 這個元件只負責畫面；開視窗不改任何資料，只有按「刪掉」才會呼叫 onConfirm。
 */
export function RemoveFromDeviceDialog(props: {
  bookTitle: string;
  busy: boolean;
  /** WO-143：這個裝置上還有其他同書名的稿子時，接在既有內文後面的一句。沒有就不顯示，畫面與以前完全一樣。 */
  extraNote?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={props.onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-from-device-title"
        aria-describedby="remove-from-device-body"
        data-testid="remove-from-device-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-from-device-title">{removeFromDeviceTitle(props.bookTitle)}</h2>
        <p id="remove-from-device-body">
          {props.extraNote ? `${REMOVE_FROM_DEVICE_BODY}${props.extraNote}` : REMOVE_FROM_DEVICE_BODY}
        </p>
        <div className="dialog-actions delete-actions">
          <button
            type="button"
            className="button danger"
            data-testid="remove-from-device-confirm"
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {REMOVE_FROM_DEVICE_CONFIRM}
          </button>
          <button
            type="button"
            className="button secondary"
            data-testid="remove-from-device-cancel"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            {REMOVE_FROM_DEVICE_CANCEL}
          </button>
        </div>
      </div>
    </div>
  );
}
