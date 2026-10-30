export function focusWritingBody(
  textarea: { focus(): void; value: string; setSelectionRange(start: number, end: number): void } | null,
): boolean {
  if (!textarea) return false;
  textarea.focus();
  const end = textarea.value.length;
  textarea.setSelectionRange(end, end);
  return true;
}
