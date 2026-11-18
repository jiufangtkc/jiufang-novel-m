/**
 * WO-65：來回記住位置、卡片編輯暫存的新增畫面文字。
 * 「寫作位置已記住：…」沿用 writingCardEditCopy；「已存好「○○」」沿用 cardEditCopy 的 savedCardToast，
 * 只暫存時不使用「已存好」。
 */

/** 回資料集或看卡片時，記住的那張卡片已被刪除（停在原分類清單） */
export const CARD_DELETED_NOTICE = '這張卡片已刪除，可到最近刪除找回';

/** 看卡片：點正文結束編輯後，卡片還有沒按「完成」的修改 */
export const CARD_DRAFT_KEPT_NOTICE = '還沒按「完成」的修改先留在這裡，按「編輯」接著改';
