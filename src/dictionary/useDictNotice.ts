import { useEffect, useMemo, useState } from 'react';
import { createDictNotice } from './dictNotice';

/** 沒網路提示：回傳是否顯示、顯示（重新計時）、立即隱藏 */
export function useDictNotice() {
  const notice = useMemo(() => createDictNotice(), []);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(notice.isVisible());
    const off = notice.subscribe(() => setVisible(notice.isVisible()));
    return () => {
      off();
      notice.hide();
    };
  }, [notice]);
  return { visible, show: notice.show, hide: notice.hide };
}
