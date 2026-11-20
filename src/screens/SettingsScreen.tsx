import { useState } from 'react';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { Link, useParams } from 'react-router-dom';
import { BookIcon, ExternalLinkIcon, PencilIcon } from '../components/Icons';
import { BOOK_GOAL_LABEL, BOOK_SECTION, PRIVACY_TITLE, SETTINGS_EDIT_GOAL_ARIA, SETTINGS_WRITING_LOG_HINT, SPONSOR_BUTTON_LABEL, SPONSOR_DESCRIPTION, SPONSOR_NEW_TAB_HINT, settingsBookGoalLine, settingsDailyGoalLine } from '../copy/userFacing';
import {
  ABOUT_SECTION,
  ABOUT_VERSION_TITLE,
  ABOUT_WELCOME_ARIA,
  ABOUT_WELCOME_HINT,
  ABOUT_WELCOME_TITLE,
  APP_VERSION,
  currentChannel,
  settingsVersionText,
  versionAria,
} from '../copy/aboutCopy';
import { ERROR_BOOK, ERROR_DAILY } from '../copy/welcomeCopy';
import { formatDayEndHour, MIN_DAILY_GOAL } from '../domain/dailyGoal';
import { formatInteger } from '../domain/formatNumber';
import { HALF_WIDTH_SETTING_TITLE, halfWidthSettingAria } from '../copy/halfWidthCopy';
import { useLayout } from '../layout';
import { useHalfWidthReminder } from '../state/halfWidthReminder';
import { useProject, useSample } from '../state/sampleStore';
import { AppearanceSettings } from './AppearanceSettings';
import { BookTitleSettingRow, useBookRename } from './bookTitleUi';
import './halfWidth.css';

/** WO-127：贊助頁面外部連結（純靜態網址，不嵌第三方程式碼）。 */
export const SPONSOR_URL = 'https://www.paypal.com/ncp/payment/22LC8GY9JRDYL';

/** 只改到的那一項才更新。只改每日目標時，不會順便說全書目標已更新。 */
export function goalApplyPlan(
  currentDaily: number,
  nextDaily: number,
  currentBook: number,
  nextBook: number,
): { daily: boolean; book: boolean } {
  return {
    daily: nextDaily !== currentDaily,
    book: nextBook !== currentBook,
  };
}

export type GoalSubmit =
  | { ok: false; error: string }
  | { ok: true; nextDaily: number; nextBook: number };

/** 「修改目標」送出檢查。每日先驗；任一欄不合格就不通過，呼叫端不可存任何一項。 */
export function checkGoalSubmit(dailyText: string, bookText: string): GoalSubmit {
  const nextDaily = Number(dailyText);
  const nextBook = Number(bookText);
  if (!Number.isInteger(nextDaily) || nextDaily < MIN_DAILY_GOAL) {
    return { ok: false, error: ERROR_DAILY };
  }
  if (!Number.isInteger(nextBook) || nextBook < 1) {
    return { ok: false, error: ERROR_BOOK };
  }
  return { ok: true, nextDaily, nextBook };
}

export function SettingsScreen() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const { isAtLeastMedium, mode, pointer, setInputMode, bodyFontScale, setBodyFontScale } = useLayout();
  const wide = isAtLeastMedium;
  const rename = useBookRename(project);
  const [editing, setEditing] = useState(false);
  const goalNow = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  const [daily, setDaily] = useState(String(goalNow));
  const [book, setBook] = useState(String(project?.bookGoal ?? 100000));
  const [error, setError] = useState('');
  const [halfWidthOn, setHalfWidthOn] = useHalfWidthReminder();
  const channel = currentChannel();
  if (!project) return <ManuscriptNotFound />;

  return (
    <div className="page" data-testid="settings-screen">
      <header className="topbar">
        <h1>設定</h1>
      </header>
      <div className="scroll-pane settings-page">
        <p className="settings-kicker">{BOOK_SECTION}</p>
        <BookTitleSettingRow
          title={project.title}
          onClick={() => rename.open(wide ? 'center' : 'sheet')}
        />
        <article className="setting-card goal-card" aria-labelledby="settings-goal-heading">
          <span className="project-icon">
            <BookIcon size={22} />
          </span>
          <span className="goal-copy">
            <strong id="settings-goal-heading">{BOOK_GOAL_LABEL}</strong>
            <small className="goal-lines">
              <span>{settingsBookGoalLine(formatInteger(project.bookGoal))}</span>
              <span>{settingsDailyGoalLine(formatInteger(goalNow))}</span>
            </small>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={SETTINGS_EDIT_GOAL_ARIA}
            onClick={() => {
              setDaily(String(goalNow));
              setBook(String(project.bookGoal));
              setError('');
              setEditing(true);
            }}
          >
            <PencilIcon />
          </button>
        </article>
        <label className="field">
          一天幾點結束
          <select
            data-testid="day-end-hour"
            value={state.schedule.dayEndHour}
            onChange={(event) => actions.setHour(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {formatDayEndHour(hour)}
              </option>
            ))}
          </select>
          <span className="hint">預設是午夜 12 點。改了只影響之後的寫作日，已經算好的日子不變。</span>
        </label>
        <AppearanceSettings
          pointer={pointer}
          bodyFontScale={bodyFontScale}
          layoutMode={mode}
          onChange={setInputMode}
          onBodyFontScale={setBodyFontScale}
        />
        {/* WO-76 乙段：只存在這個裝置，不寫進稿子的 .db。 */}
        <button
          type="button"
          className="setting-row half-width-setting"
          data-testid="half-width-setting"
          aria-label={halfWidthSettingAria(halfWidthOn)}
          onClick={() => setHalfWidthOn(!halfWidthOn)}
        >
          <span>
            <strong>{HALF_WIDTH_SETTING_TITLE}</strong>
          </span>
          <span className={halfWidthOn ? 'setting-switch is-on' : 'setting-switch'} aria-hidden="true">
            <span />
          </span>
        </button>
        <Link className="setting-row" to={`/p/${project.id}/logs`}>
          <span>
            <strong>寫作過程紀錄</strong>
            <small>{SETTINGS_WRITING_LOG_HINT}</small>
          </span>
        </Link>
        <Link className="setting-row" to={`/p/${project.id}/font-license`} data-testid="font-license-link">
          <span>
            <strong>芫荽字型授權</strong>
            <small>SIL Open Font License 1.1，作者 But Ko／Fontworks</small>
          </span>
        </Link>
        <Link className="setting-row" to={`/p/${project.id}/privacy`} data-testid="privacy-link">
          <span>
            <strong>{PRIVACY_TITLE}</strong>
          </span>
        </Link>
        {/* WO-108：關於組。版本只顯示；再看一次先接到過渡空頁，WO-110 取代。 */}
        <section aria-labelledby="about-heading" data-testid="about-section">
          <h2 id="about-heading" className="settings-kicker">
            {ABOUT_SECTION}
          </h2>
          <div
            className="setting-row about-version-row"
            data-testid="about-version"
            role="group"
            aria-label={versionAria(APP_VERSION, channel)}
          >
            <span aria-hidden="true">
              <strong>{ABOUT_VERSION_TITLE}</strong>
            </span>
            <span className="about-version-value" aria-hidden="true">
              {settingsVersionText(APP_VERSION, channel)}
            </span>
          </div>
          <Link
            className="setting-row about-welcome-row"
            to={`/p/${project.id}/welcome`}
            data-testid="about-welcome-link"
            aria-label={ABOUT_WELCOME_ARIA}
          >
            <span>
              <strong>{ABOUT_WELCOME_TITLE}</strong>
              <small>{ABOUT_WELCOME_HINT}</small>
            </span>
          </Link>
          {/* WO-127：純外部連結，不嵌 PayPal 腳本、不載外部圖、不追蹤，離線照常顯示。 */}
          <a
            className="setting-row about-sponsor-row"
            href={SPONSOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="about-sponsor-link"
          >
            <span>
              <strong>
                {SPONSOR_BUTTON_LABEL}
                <span className="about-sponsor-icon">
                  <ExternalLinkIcon size={16} />
                </span>
              </strong>
              <span className="sr-only">{SPONSOR_NEW_TAB_HINT}</span>
              <small>{SPONSOR_DESCRIPTION}</small>
            </span>
          </a>
        </section>
      </div>
      {editing && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setEditing(false)}>
          <form
            className="dialog"
            role="dialog"
            aria-labelledby="goal-dialog-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const checked = checkGoalSubmit(daily, book);
              if (!checked.ok) {
                setError(checked.error);
                return;
              }
              const { nextDaily, nextBook } = checked;
              const plan = goalApplyPlan(goalNow, nextDaily, project.bookGoal, nextBook);
              if (plan.daily) actions.setGoal(nextDaily);
              if (plan.book) actions.setBookGoal(project.id, nextBook);
              setEditing(false);
            }}
          >
            <h2 id="goal-dialog-title">修改目標</h2>
            <label>
              每日目標（字）
              <input
                data-testid="daily-goal-input"
                inputMode="numeric"
                value={daily}
                onChange={(event) => setDaily(event.target.value)}
              />
            </label>
            <label>
              全書目標（字）
              <input
                inputMode="numeric"
                value={book}
                onChange={(event) => setBook(event.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <p className="hint">一天之內可以改每日目標。達標與否，以當天最後一次設定為準。</p>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setEditing(false)}>
                取消
              </button>
              <button type="submit" className="button primary" data-testid="apply-goal">
                套用
              </button>
            </div>
          </form>
        </div>
      )}
      {rename.dialogs}
    </div>
  );
}
