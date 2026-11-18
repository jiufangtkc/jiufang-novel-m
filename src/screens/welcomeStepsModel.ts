/**
 * 歡迎導覽三關內容的純函式（WO-111，歡迎-4）。畫面在 WelcomeSteps.tsx。
 *
 * - 第 1 關每日目標、第 2 關新稿子全書目標：四個選項加「自己填」，單選互斥。
 * - 自己填按「下一關」才檢查：先判空白，再判合法整數與下限（每日 300、全書 1）。空白不轉成 0。
 * - 第 3 關：開新稿子／開啟稿子；從設定再看一次時多「繼續寫這份稿子」並預選。
 * - 收尾分流：第 3 關選了什麼就做什麼，按跳過＝回首頁。
 */

import { MIN_DAILY_GOAL } from '../domain/dailyGoal';
import { formatInteger } from '../domain/formatNumber';
import {
  BOOK_OPTIONS,
  DAILY_OPTIONS,
  ERROR_BOOK,
  ERROR_DAILY,
  ERROR_EMPTY,
  type FinishOutcome,
  type GoalOptionCopy,
  type StartChoice,
} from '../copy/welcomeCopy';
import type { TourEntry } from './welcomeTourModel';

export type GoalStep = 1 | 2;

/** 每一關的選取：四個選項之一的數值，或自己填（text 是輸入框裡的字）。 */
export type GoalChoice = { kind: 'option'; value: number } | { kind: 'custom'; text: string };

export function goalOptions(step: GoalStep): readonly GoalOptionCopy[] {
  return step === 1 ? DAILY_OPTIONS : BOOK_OPTIONS;
}

/** 預選：目前的值在選項裡就選那一個；不在（再看一次常見）就直接選自己填並填好完整千分位。 */
export function initialGoalChoice(step: GoalStep, current: number): GoalChoice {
  if (goalOptions(step).some((option) => option.value === current)) return { kind: 'option', value: current };
  return { kind: 'custom', text: formatInteger(current) };
}

/**
 * 讀自己填的字。先全形轉半形（全形數字、全形逗號），去掉前後空白。
 * - 什麼都沒有 → empty（不當成 0）。
 * - 純數字，或照千分位每三位一個逗號（例如 1,500、80,000）→ number。
 * - 其他（小數、負號、亂碼、逗號位置不對、超出安全整數）→ invalid。
 */
export type ParsedGoalInput = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'invalid' };

export function parseGoalInput(raw: string): ParsedGoalInput {
  const text = raw.normalize('NFKC').trim();
  if (text === '') return { kind: 'empty' };
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return { kind: 'invalid' };
  const value = Number(text.replace(/,/g, ''));
  if (!Number.isSafeInteger(value)) return { kind: 'invalid' };
  return { kind: 'number', value };
}

export type GoalCheck = { ok: true; value: number } | { ok: false; message: string };

/** 這一關最小值：每日 300、全書 1。 */
export function goalMinimum(step: GoalStep): number {
  return step === 1 ? MIN_DAILY_GOAL : 1;
}

/** 按「下一關」時的檢查。選項一定合法；自己填先判空白，再判整數與下限。 */
export function checkGoalChoice(step: GoalStep, choice: GoalChoice): GoalCheck {
  if (choice.kind === 'option') return { ok: true, value: choice.value };
  const parsed = parseGoalInput(choice.text);
  if (parsed.kind === 'empty') return { ok: false, message: ERROR_EMPTY };
  const wrong = step === 1 ? ERROR_DAILY : ERROR_BOOK;
  if (parsed.kind === 'invalid' || parsed.value < goalMinimum(step)) return { ok: false, message: wrong };
  return { ok: true, value: parsed.value };
}

/**
 * 按「下一關」：檢查通過就馬上寫這一關的設定；值和已存的一樣就不寫。檢查沒過不寫、留在這一關。
 * write 由呼叫端給：第 1 關是和設定頁同一個每日目標，第 2 關是新稿子的全書目標預設。
 */
export function commitGoalStep(
  step: GoalStep,
  choice: GoalChoice,
  saved: number,
  write: (value: number) => void,
): GoalCheck & { wrote?: boolean } {
  const check = checkGoalChoice(step, choice);
  if (!check.ok) return check;
  if (check.value === saved) return { ...check, wrote: false };
  write(check.value);
  return { ...check, wrote: true };
}

/** 第 1 關示範進度條用的目標：選了選項就是那個數；自己填且填得合法就跟著填的數；否則維持目前已存的值。 */
export function demoGoal(choice: GoalChoice, saved: number): number {
  const check = checkGoalChoice(1, choice);
  return check.ok ? check.value : saved;
}

/* ── 第 3 關與收尾 ── */

/** 第 3 關的選項（順序即畫面順序）：再看一次且有開著的稿子時，「繼續寫這份稿子」排第一。沒有範例書。 */
export function startChoices(entry: TourEntry, hasProject: boolean): StartChoice[] {
  return entry === 'revisit' && hasProject ? ['continue', 'new', 'open'] : ['new', 'open'];
}

/** 第 3 關預選第一個。 */
export function initialStartChoice(entry: TourEntry, hasProject: boolean): StartChoice {
  return startChoices(entry, hasProject)[0];
}

/** 第 3 關按「就這樣，出發」時，收尾要做的事就是選的那一項；按「跳過」則回首頁。 */
export function finishOutcomeFor(event: { kind: 'next'; choice: StartChoice } | { kind: 'skip' }): FinishOutcome {
  return event.kind === 'skip' ? 'home' : event.choice;
}

/** 收尾外觀那一行：只有再看一次、而且有開著的稿子時才做成連結；第一次使用只是文字。 */
export function appearanceIsLink(entry: TourEntry, hasProject: boolean): boolean {
  return entry === 'revisit' && hasProject;
}

/* ── iPhone、iPad 另存小卡 ── */

/**
 * 只在 iPhone、iPad 上顯示：沿用既有「只能另存」的判斷（沒有開檔與存檔 picker，見 browserDisk.canPickLocalFiles），
 * 再加上既有裝置訊號（inputMode.guessInputMode 同一套：iPhone、iPad，含回報成 Macintosh 的多點觸控 iPad）。
 * 沒有 picker 的桌面瀏覽器、Android 都不算。
 */
export function isIphoneOrIpad(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function showsIosSaveNote(input: { canPickLocalFiles: boolean; userAgent: string; maxTouchPoints: number }): boolean {
  return !input.canPickLocalFiles && isIphoneOrIpad(input.userAgent, input.maxTouchPoints);
}
