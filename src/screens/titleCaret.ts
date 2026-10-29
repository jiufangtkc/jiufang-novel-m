/** 章號結尾的空格後面放游標；「新章」這類名稱則整段選取。 */
export function focusTitleInput(input: HTMLInputElement): void {
  input.focus();
  const end = input.value.length;
  if (input.value.endsWith('\u3000')) input.setSelectionRange(end, end);
  else input.select();
}
