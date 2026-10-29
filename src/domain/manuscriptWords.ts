/**
 * 與電腦版快照字數同一套：去掉標籤與空白後，
 * 一個漢字算一個，一段連續的英數算一個。標點不算。
 */
export function countManuscriptWords(text: string): number {
  const clean = text.replace(/<[^>]+>/g, '').replace(/[\s\r\n\t]+/g, '');
  const chinese = clean.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const words = clean.match(/[a-zA-Z0-9]+/g)?.length ?? 0;
  return chinese + words;
}
