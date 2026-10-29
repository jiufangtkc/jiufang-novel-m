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
