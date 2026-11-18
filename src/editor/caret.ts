/** 算出要再捲多少，游標那一行才會落在可視範圍裡，不被鍵盤或邊緣擋住。 */
export function scrollDeltaToReveal(
  caretTop: number,
  caretHeight: number,
  scrollTop: number,
  visibleHeight: number,
  padding = 24,
): number {
  const caretBottom = caretTop + caretHeight;
  const viewTop = scrollTop + padding;
  const viewBottom = scrollTop + visibleHeight - padding;
  if (caretBottom > viewBottom) return caretBottom - viewBottom;
  if (caretTop < viewTop) return caretTop - viewTop;
  return 0;
}

export function measureCaret(textarea: HTMLTextAreaElement): { top: number; height: number } | null {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === null || end === null) return null;
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const fields = [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
  ] as const;
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.left = '-9999px';
  mirror.style.top = '0';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  for (const field of fields) {
    mirror.style[field] = style[field];
  }
  mirror.textContent = textarea.value.slice(0, start);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(start, end) || '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  const height = marker.offsetHeight || Number.parseFloat(style.lineHeight) || 28;
  mirror.remove();
  return { top, height };
}

export function revealCaret(textarea: HTMLTextAreaElement): void {
  const measured = measureCaret(textarea);
  if (!measured) return;
  const delta = scrollDeltaToReveal(
    measured.top,
    measured.height,
    textarea.scrollTop,
    textarea.clientHeight,
  );
  if (delta !== 0) textarea.scrollTop += delta;
}

/**
 * WO-88：看卡片的下方面板蓋住正文底部多少像素。
 * 只有「面板頂端落在正文中間、與正文左右有重疊」才算遮擋；
 * 側邊抽屜（中等、橫拿）、寬版右欄的面板頂端不低於正文頂端或左右不重疊，一律回 0，不套用直拿扣高。
 */
export function panelCoverFromBottom(
  text: { top: number; bottom: number; left: number; right: number },
  panel: { top: number; bottom: number; left: number; right: number },
): number {
  const overlapX = Math.min(text.right, panel.right) - Math.max(text.left, panel.left);
  if (overlapX <= 0) return 0;
  if (panel.top <= text.top) return 0;
  const covered = text.bottom - panel.top;
  if (covered <= 0) return 0;
  return Math.min(covered, text.bottom - text.top);
}

export const PANEL_ROOM_ATTR = 'data-card-panel-room';

/** 關閉看卡片時，恢復開啟時為了捲得到游標行而暫時加大的底部留白。 */
export function restorePanelRoom(textarea: HTMLTextAreaElement | null): void {
  if (!textarea || !textarea.hasAttribute(PANEL_ROOM_ATTR)) return;
  textarea.style.paddingBottom = textarea.getAttribute(PANEL_ROOM_ATTR) ?? '';
  textarea.removeAttribute(PANEL_ROOM_ATTR);
}

/**
 * WO-88：面板拉起後，讓游標整行留在面板上方的可見區。
 * 已可見就不捲；文末捲不到時只暫時加大這一張正文的底部留白（關閉時由 restorePanelRoom 恢復）。
 */
export function revealCaretAbovePanel(textarea: HTMLTextAreaElement, panel: HTMLElement): number {
  const measured = measureCaret(textarea);
  if (!measured) return 0;
  const covered = panelCoverFromBottom(
    textarea.getBoundingClientRect(),
    panel.getBoundingClientRect(),
  );
  if (covered <= 0) return 0;
  const visible = Math.max(0, textarea.clientHeight - covered);
  const delta = scrollDeltaToReveal(
    measured.top,
    measured.height,
    textarea.scrollTop,
    visible,
  );
  if (delta <= 0) return 0;
  const room = textarea.scrollHeight - textarea.clientHeight - textarea.scrollTop;
  if (delta > room) {
    if (!textarea.hasAttribute(PANEL_ROOM_ATTR)) {
      textarea.setAttribute(PANEL_ROOM_ATTR, textarea.style.paddingBottom);
    }
    const current = Number.parseFloat(getComputedStyle(textarea).paddingBottom) || 0;
    textarea.style.paddingBottom = `${current + (delta - room)}px`;
  }
  textarea.scrollTop += delta;
  return delta;
}
