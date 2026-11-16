import { Link } from 'react-router-dom';
import {
  MANUSCRIPT_NOT_FOUND_AFTER_LINK,
  MANUSCRIPT_NOT_FOUND_BEFORE_LINK,
  MANUSCRIPT_NOT_FOUND_LINK,
} from '../copy/userFacing';

/**
 * WO-95：「找不到這份稿子。請回首頁重新開啟。」提示，其中「回首頁」可點回首頁。
 * 整句文字與 MANUSCRIPT_NOT_FOUND 完全相同；不自動導回首頁，
 * 免得手機儲存的檔案稿還在非同步掛回時被誤導走。
 */
export function ManuscriptNotFound() {
  return (
    <p className="empty-note">
      {MANUSCRIPT_NOT_FOUND_BEFORE_LINK}
      <Link to="/" className="not-found-home-link" data-testid="not-found-home-link">
        {MANUSCRIPT_NOT_FOUND_LINK}
      </Link>
      {MANUSCRIPT_NOT_FOUND_AFTER_LINK}
    </p>
  );
}
