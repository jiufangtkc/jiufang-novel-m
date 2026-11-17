/**
 * 歡迎導覽文案（WO-110，歡迎-3：外框、出現時機、跳過）。
 *
 * 依據：`ux/2026-11-16-歡迎頁/開單規格.md` B、H-2 與 `用字建議.md`「改後（建議定稿）」、第八節朗讀。
 * - 標【定案】的是九方 2026-11-16 22:16～22:17 定案字（H-2），不再暫定。
 * - 其餘畫面字與朗讀都是【暫定】（工單註記，不顯示在 App）。
 * - 三關內容（選項、自己填、錯誤句、示範進度條、第 3 關選項）與收尾分流的字由 WO-111 補在這裡（檔尾）。
 * - 錯誤句（H-2）、第 1 關小字（H-2）、第 3 關「開新稿子」「開啟稿子」（H-2）是定案字。
 */

import { formatInteger } from '../domain/formatNumber';
import { CHANNEL_LABEL, type BuildChannel } from './aboutCopy';

export type TourStepNumber = 1 | 2 | 3;

/* ── 歡迎頁 ── */

/** 【暫定】小標。 */
export const WELCOME_KICKER = '歡迎來到九方小說編輯器M';

/**
 * 【定案】主句「故事，是一步步走完的。」保留句號。
 * 拆成三段只為控制換行（規格 B-1）：放得下一行；放不下先斷在「故事，」後；再放不下才斷在「是一步步」後。
 * 「一步步」永不拆、句號不單獨落到行首。不用寫死的換行。
 */
export const WELCOME_HEADLINE = '故事，是一步步走完的。';
export const WELCOME_HEADLINE_SEGMENTS = ['故事，', '是一步步', '走完的。'] as const;

/** 【暫定】說明。 */
export const WELCOME_BODY = '花一分鐘，定好你自己的目標，之後隨時都能改。每天打開，就看得到今天走了多遠。';

/** 【暫定】預覽版小字；正式版不顯示。 */
export const WELCOME_PREVIEW_NOTE =
  '預覽版還在測試，有些功能之後可能會改。寫完記得按「另存專案」，把稿子存一份在自己手上。';

/** 【暫定】主要按鈕與朗讀。 */
export const WELCOME_START = '開始';
export const WELCOME_START_ARIA = '開始，到第 1 關';

/** 【暫定】第一次出現時的右上「跳過」：整趟跳過。 */
export const WELCOME_SKIP_ALL = '跳過';
export const WELCOME_SKIP_ALL_ARIA = '跳過導覽，目標先用預設值，直接到首頁';

/** 【暫定】從「設定 › 關於」再看一次時的右上「關閉」：回設定，什麼都不改。 */
export const WELCOME_CLOSE = '關閉';
export const WELCOME_CLOSE_ARIA = '關閉導覽，回到設定，什麼都不改';

/** 版本標籤要不要顯示預覽版小字：只有預覽版顯示。 */
export function showsPreviewNote(channel: BuildChannel): boolean {
  return channel === 'preview';
}

export function channelTagText(channel: BuildChannel): string {
  return CHANNEL_LABEL[channel];
}

/* ── 三關共同 ── */

/** 【暫定】頂端小徑三點名稱。 */
export const TRAIL_NAMES: Record<TourStepNumber, string> = { 1: '每天', 2: '全書', 3: '出發' };

/** 【暫定】小標「第 1 關　每天」，中間是全形空格，不用「・」。 */
export function stepKicker(step: TourStepNumber): string {
  return `第 ${step} 關　${TRAIL_NAMES[step]}`;
}

/** 【暫定】小徑朗讀「第 1 關，共 3 關，每天想寫多少」；收尾「3 關都走完了」。 */
const TRAIL_PURPOSE: Record<TourStepNumber, string> = {
  1: '每天想寫多少',
  2: '新稿子想寫多長',
  3: '今天從哪裡開始',
};

export function trailAria(step: TourStepNumber): string {
  return `第 ${step} 關，共 3 關，${TRAIL_PURPOSE[step]}`;
}

export const TRAIL_DONE_ARIA = '3 關都走完了';

/** 【暫定】三關標題。切頁時焦點移到標題，照畫面字念。 */
export const STEP_TITLES: Record<TourStepNumber, string> = {
  1: '每天想寫多少字？',
  2: '新稿子想寫多長？',
  3: '今天從哪裡開始？',
};

/** 【暫定】每關右上「跳過」：這一關不改，到下一關。 */
export const STEP_SKIP = '跳過';
export const STEP_SKIP_ARIA: Record<TourStepNumber, string> = {
  1: '跳過這一關，每日目標不變，到第 2 關',
  2: '跳過這一關，新稿子的全書目標不變，到第 3 關',
  3: '跳過這一關，直接看最後一頁',
};

/** 【暫定】上一步。 */
export const STEP_BACK = '上一步';
export const STEP_BACK_ARIA: Record<TourStepNumber, string> = {
  1: '上一步，回到歡迎頁',
  2: '上一步，回到第 1 關',
  3: '上一步，回到第 2 關',
};

/** 【暫定】主要按鈕：第 1、2 關「下一關」，第 3 關「就這樣，出發」。 */
export const STEP_PRIMARY: Record<TourStepNumber, string> = {
  1: '下一關',
  2: '下一關',
  3: '就這樣，出發',
};
export const STEP_PRIMARY_ARIA: Record<TourStepNumber, string> = {
  1: '下一關，到第 2 關',
  2: '下一關，到第 3 關',
  3: '就這樣，出發，到最後一頁',
};

/* ── 收尾 ── */

/** 【暫定】小標與唯一一句鼓勵（標題不加句號）。 */
export const FINISH_KICKER = '都設好了';
export const FINISH_TITLE = '今天先寫一點就好';

/** 【暫定】外觀入口一行。第一次使用還沒有稿子，只是文字、不做連結。 */
export const FINISH_APPEARANCE_NOTE = '想換顏色或正文字級，可以到「設定」的「外觀」改。';

/** 【暫定】收尾主要按鈕：第 3 關按了跳過（或還沒選）時回首頁。其他分流（開始寫、繼續寫）由 WO-111 接上。 */
export const FINISH_HOME = '回首頁';

/* ── WO-111：三關內容與收尾分流 ── */


/** 【暫定】三關說明（第 3 關從設定再看一次時換成 STEP3_BODY_REVISIT）。 */
export const STEP_BODIES: Record<TourStepNumber, string> = {
  1: '挑一個不勉強的數字就好。之後隨時可以在「設定」裡改。',
  2: '還沒想好也沒關係，先選一個，寫著寫著再調。',
  3: '挑一個開始就好，這兩個在首頁也找得到。',
};

/** 【暫定】從「設定 › 關於」再看一次時第 3 關的說明。 */
export const STEP3_BODY_REVISIT = '剛剛的目標已經存好了。';

export interface GoalOptionCopy {
  value: number;
  /** 畫面上的數字，例如「1,000 字」「10 萬字」。 */
  amount: string;
  /** 小字。 */
  note: string;
}

/**
 * 第 1 關四個選項：數字【暫定】；小字「一小步、慢慢走、穩穩前進、大步走」是九方 22:16 定案字（H-2），不再暫定。
 * 小字只寫感覺，不寫時間。
 */
export const DAILY_OPTIONS: readonly GoalOptionCopy[] = [
  { value: 300, amount: '300 字', note: '一小步' },
  { value: 500, amount: '500 字', note: '慢慢走' },
  { value: 1000, amount: '1,000 字', note: '穩穩前進' },
  { value: 2000, amount: '2,000 字', note: '大步走' },
];

/** 【暫定】第 2 關四個選項（大字用「萬」）。 */
export const BOOK_OPTIONS: readonly GoalOptionCopy[] = [
  { value: 50000, amount: '5 萬字', note: '中篇' },
  { value: 100000, amount: '10 萬字', note: '長篇' },
  { value: 200000, amount: '20 萬字', note: '大長篇' },
  { value: 300000, amount: '30 萬字', note: '超長篇' },
];

/** 【暫定】選項朗讀：名稱加小字，例「1,000 字，穩穩前進」。已選取、第幾個由系統念。 */
export function goalOptionAria(option: GoalOptionCopy): string {
  return `${option.amount}，${option.note}`;
}

/** 【暫定】自己填。 */
export const CUSTOM_LABEL = '自己填';
export const CUSTOM_ARIA = '自己填，點了可以輸入數字';
export const CUSTOM_UNIT = '字';

/** 【暫定】目前的值不在選項裡時：「自己填　1,500 字」（全形空格，完整千分位，不換算成萬）。 */
export function customCurrentLabel(value: number): string {
  return `${CUSTOM_LABEL}　${formatInteger(value)} ${CUSTOM_UNIT}`;
}

/** 【暫定】自己填輸入框提示。 */
export const CUSTOM_PLACEHOLDER: Record<1 | 2, string> = {
  1: '300 以上',
  2: '例如 80,000',
};

/** 【暫定】自己填輸入框朗讀。 */
export const CUSTOM_INPUT_ARIA: Record<1 | 2, string> = {
  1: '自己填每日目標，單位是字，300 以上',
  2: '自己填新稿子的全書目標，單位是字',
};

/** 【暫定】選項群組朗讀。 */
export const GROUP_ARIA: Record<TourStepNumber, string> = {
  1: '每日目標',
  2: '新稿子的全書目標',
  3: '今天從哪裡開始',
};

/**
 * 自己填的錯誤句（H-2 九方定案，不再暫定；歡迎頁與設定頁同句，設定頁舊句另開小單，這裡不動設定頁）。
 */
export const ERROR_EMPTY = '還沒填數字。也可以直接點上面的選項。';
export const ERROR_DAILY = '每日目標請填 300 以上的整數。';
export const ERROR_BOOK = '全書目標請填 1 以上的整數。';

/** 【暫定】第 1 關示範進度條下的小字（不寫位置）。 */
export const DAILY_DEMO_NOTE = '寫作頁會有這條進度條，寫滿就會出現「達標了」。';

/** 【暫定】示範進度條朗讀：不念斜線，數字跟著選的目標變。 */
export function dailyDemoAria(goal: number): string {
  return `寫作頁的進度條，今天寫了 0 字，每日目標 ${formatInteger(goal)} 字`;
}

/** 【暫定】第 2 關小字。 */
export const BOOK_NOTE = '開新稿子時會自動帶入這個數字，已經有的稿子不會變。之後每本稿子都能在「設定」裡另外改。';

/** 第 3 關的選擇。continue 只在從設定再看一次時出現。 */
export type StartChoice = 'continue' | 'new' | 'open';

/** 第 3 關選項名稱「開新稿子」「開啟稿子」是九方 22:16 定案字（H-2）；「繼續寫這份稿子」與小字【暫定】。 */
export const START_NAMES: Record<StartChoice, string> = {
  continue: '繼續寫這份稿子',
  new: '開新稿子',
  open: '開啟稿子',
};

export const START_NOTES: Record<'new' | 'open', string> = {
  new: '取個書名就能寫，會用剛剛定的全書目標',
  open: '選一個 .db 稿件檔，電腦上存的也可以',
};

/** 【暫定】沒有書名時。 */
export const UNTITLED_BOOK = '未命名稿子';

/** 「繼續寫這份稿子」的小字：書名單獨顯示，不加《》；沒有書名寫「未命名稿子」。 */
export function continueNote(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim();
  return trimmed || UNTITLED_BOOK;
}

/** 【暫定】第 3 關選項朗讀：名稱加小字；繼續寫念「繼續寫這份稿子，（書名）」。 */
export function startOptionAria(choice: StartChoice, title?: string | null): string {
  if (choice === 'continue') return `${START_NAMES.continue}，${continueNote(title)}`;
  return `${START_NAMES[choice]}，${START_NOTES[choice]}`;
}

/** 【暫定】iPhone、iPad 另存小卡（照畫面念）。 */
export const IOS_SAVE_NOTE = '在 iPhone、iPad 上，稿子會自動暫存在 App 裡。要存一份到「檔案」App，請按「另存專案」。';

/** 收尾怎麼走：照第 3 關的結果（跳過＝home）。 */
export type FinishOutcome = 'new' | 'open' | 'home' | 'continue';

/** 【暫定】收尾主要按鈕字與朗讀（按鈕上寫什麼，按下就做什麼；B-6）。回首頁照畫面念，不另給朗讀。 */
export const FINISH_PRIMARY: Record<FinishOutcome, { text: string; aria?: string }> = {
  new: { text: '開始寫', aria: '開始寫，開一本新稿子' },
  open: { text: '開始寫', aria: '開始寫，選一個 .db 稿件檔' },
  home: { text: FINISH_HOME },
  continue: { text: '繼續寫', aria: '繼續寫，回到剛剛寫的地方' },
};

/** 【暫定】收尾外觀那一行做成連結時（再看一次且有開著的稿子）的朗讀。 */
export const FINISH_APPEARANCE_LINK_ARIA = '到設定的外觀，換顏色或正文字級';
