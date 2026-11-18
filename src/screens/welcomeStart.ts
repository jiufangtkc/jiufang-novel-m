/**
 * WO-111：從「設定 › 關於」再看一次歡迎導覽、第 3 關選「開新稿子」，收尾按「開始寫」時，
 * 帶這個路由狀態回首頁，首頁就打開現有的「開新稿子」對話框（全書目標由 WO-109 的新稿子預設帶入）。
 */
export const WELCOME_START_NEW_STATE = { welcomeStart: 'new' } as const;

export function isWelcomeStartNew(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { welcomeStart?: unknown }).welcomeStart === 'new';
}
