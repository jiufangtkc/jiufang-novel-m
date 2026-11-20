/**
 * 設定頁「關於」組文案與版本字串（WO-108）。
 * 版本號碼來自 package.json（建置時帶入），不在這裡手填第二份。
 * 畫面字除另註明外均為【暫定】；版本寫法為九方 2026-11-16 22:16 定案：不寫 v、括號全形。
 */

export type BuildChannel = 'preview' | 'production';

/** 正式站網址清單。日後自訂網域加在這裡；一律精確比對 hostname，不用包含字串猜。 */
export const PRODUCTION_HOSTNAMES: readonly string[] = ['jiufang-novel-m.pages.dev'];

export const CHANNEL_LABEL: Record<BuildChannel, string> = {
  preview: '預覽版',
  production: '正式版',
};

export const ABOUT_SECTION = '關於';
export const ABOUT_VERSION_TITLE = '版本';
export const ABOUT_WELCOME_TITLE = '再看一次歡迎導覽';
export const ABOUT_WELCOME_HINT = '調整每日目標和新稿子的全書目標';
export const ABOUT_WELCOME_ARIA = '再看一次歡迎導覽，可以調整每日目標和新稿子的全書目標';

/** 過渡空頁（WO-110 接上正式導覽後取代）。 */
export const WELCOME_PLACEHOLDER_TITLE = '歡迎導覽';
export const WELCOME_PLACEHOLDER_BODY = '歡迎導覽還在準備中。';
export const WELCOME_PLACEHOLDER_BACK_ARIA = '返回設定';

/** 目前版本號碼（package.json 的 version）。獨立打包環境未注入 __APP_VERSION__ 時安全退回空字串。 */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

/** 精確 hostname 為正式站才是正式版；其他（分支預覽、本機、取不到網址）一律預覽版。 */
export function channelForHostname(hostname: string | null | undefined): BuildChannel {
  return hostname && PRODUCTION_HOSTNAMES.includes(hostname.toLowerCase()) ? 'production' : 'preview';
}

export function currentChannel(): BuildChannel {
  try {
    return channelForHostname(globalThis.location?.hostname);
  } catch {
    return 'preview';
  }
}

/** 設定頁版本列：「0.1.0（預覽版）」，全形括號。 */
export function settingsVersionText(version: string, channel: BuildChannel): string {
  return `${version}（${CHANNEL_LABEL[channel]}）`;
}

/** 歡迎頁版本字：「版本 0.1.0」。 */
export function welcomeVersionText(version: string): string {
  return `版本 ${version}`;
}

/** 合併朗讀一次：「版本 0.1.0，預覽版」。 */
export function versionAria(version: string, channel: BuildChannel): string {
  return `版本 ${version}，${CHANNEL_LABEL[channel]}`;
}
