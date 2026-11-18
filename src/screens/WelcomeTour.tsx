import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DailyProgressBar } from '../components/DailyProgressBar';
import { APP_VERSION, currentChannel, versionAria, welcomeVersionText, type BuildChannel } from '../copy/aboutCopy';
import {
  channelTagText,
  FINISH_APPEARANCE_LINK_ARIA,
  FINISH_APPEARANCE_NOTE,
  FINISH_HOME,
  FINISH_KICKER,
  FINISH_PRIMARY,
  FINISH_TITLE,
  showsPreviewNote,
  STEP_BACK,
  STEP_BACK_ARIA,
  STEP_PRIMARY,
  STEP_PRIMARY_ARIA,
  STEP_SKIP,
  STEP_SKIP_ARIA,
  STEP_TITLES,
  stepKicker,
  TRAIL_DONE_ARIA,
  TRAIL_NAMES,
  trailAria,
  WELCOME_BODY,
  WELCOME_CLOSE,
  WELCOME_CLOSE_ARIA,
  WELCOME_HEADLINE,
  WELCOME_HEADLINE_SEGMENTS,
  WELCOME_KICKER,
  WELCOME_PREVIEW_NOTE,
  WELCOME_SKIP_ALL,
  WELCOME_SKIP_ALL_ARIA,
  WELCOME_START,
  WELCOME_START_ARIA,
  type FinishOutcome,
  type TourStepNumber,
} from '../copy/welcomeCopy';
import { OPEN_FILE_BUSY } from '../copy/userFacing';
import { useLayout } from '../layout';
import { hasOnboardingRecord, writeOnboardingRecord } from '../state/onboardingRecord';
import {
  backPage,
  cornerAction,
  enterTriggersPrimary,
  isStep,
  nextPage,
  radioArrowTarget,
  recordStatusFor,
  tourPresentation,
  trailDots,
  type TourEntry,
  type TourEvent,
  type TourPage,
} from './welcomeTourModel';
import './welcomeTour.css';

/**
 * 導覽怎麼結束：整趟跳過（回首頁）、關閉（回設定）、收尾按「回首頁」。
 * WO-111：收尾另有「開始寫」（開新稿子對話框／系統選檔）、「繼續寫」（回原寫作頁），
 * 以及再看一次時點外觀那一行（到設定的外觀組）。
 */
export type TourExit = 'skip-all' | 'close' | 'finish-home' | 'finish-new' | 'finish-open' | 'finish-continue' | 'appearance';

const FINISH_EXIT: Record<Exclude<FinishOutcome, 'home'>, TourExit> = {
  new: 'finish-new',
  open: 'finish-open',
  continue: 'finish-continue',
};

export interface WelcomeTourProps {
  entry: TourEntry;
  /** 收尾今天進度條：實際今天字數與目前每日目標。 */
  todayWords: number;
  dailyGoal: number;
  met: boolean;
  onExit: (exit: TourExit) => void;
  /** 測試用：從指定頁開始。 */
  initialPage?: TourPage;
  /** 測試用：指定預覽版／正式版；平常依網址判斷。 */
  channel?: BuildChannel;
  version?: string;
  /**
   * WO-111 接點：三關內容。沒給時是空的占位區，不寫任何設定。
   * 單選請用 role="radiogroup" 包 role="radio" 的按鈕，方向鍵與 Enter 由外框處理。
   */
  renderStep?: (step: TourStepNumber) => ReactNode;
  /**
   * WO-111 接點：按某關主要按鈕時先呼叫，負責檢查並馬上寫該關設定；回 false 就留在這一關（例如自己填錯）。
   * 沒給時直接到下一關，不寫任何設定。
   */
  onStepNext?: (step: TourStepNumber) => boolean;
  /** WO-111：某關按「跳過」時通知（這一關不改；第 3 關跳過讓收尾變「回首頁」）。 */
  onStepSkip?: (step: TourStepNumber) => void;
  /** WO-111：三關說明（放在小標、標題下面；手機橫拿在左欄）。 */
  stepBody?: (step: TourStepNumber) => string | null;
  /** WO-111：收尾主要按鈕照第 3 關結果分流；沒給是「回首頁」。 */
  finishOutcome?: FinishOutcome;
  /** WO-111：收尾外觀那一行的連結目標（只在再看一次且有開著的稿子時給）；沒給只是文字。 */
  appearanceTo?: string;
  /** WO-121：開稿讀取中。收尾「開始寫」（開啟稿子）改顯示 OPEN_FILE_BUSY 並暫時不能再按。 */
  openBusy?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** 歡迎頁裝飾插圖：小徑從起點彎到完稿（不朗讀、不代表天數）。畫法【視覺暫定，交視覺設計】。 */
function WelcomeIllustration() {
  return (
    <div className="welcome-illustration" aria-hidden="true" data-testid="welcome-illustration">
      <svg viewBox="0 0 240 72" focusable="false" aria-hidden="true">
        <path className="welcome-illustration-path" d="M16 52 C 70 52, 70 20, 120 20 S 170 52, 224 24" />
        <circle className="welcome-illustration-start" cx="16" cy="52" r="6" />
        <circle className="welcome-illustration-end" cx="224" cy="24" r="7" />
      </svg>
    </div>
  );
}

function TourTrail({ page }: { page: TourPage }) {
  const dots = trailDots(page);
  if (!dots) return <span className="welcome-trail-spacer" />;
  const label = page === 'finish' ? TRAIL_DONE_ARIA : trailAria(page as TourStepNumber);
  return (
    <div className="welcome-trail" role="img" aria-label={label} data-testid="welcome-trail">
      {([1, 2, 3] as const).map((n, i) => (
        <span key={n} className="welcome-trail-part">
          {i > 0 ? (
            <span className="welcome-trail-line" data-state={dots[i] === 'todo' ? 'todo' : 'done'} aria-hidden="true" />
          ) : null}
          <span className="welcome-trail-stop" data-state={dots[i]} data-testid={`welcome-trail-dot-${n}`}>
            <span className="welcome-trail-dot" aria-hidden="true" />
            <span className="welcome-trail-name" aria-hidden="true">
              {TRAIL_NAMES[n]}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * 主句換行：三段各包一層不斷行的 inline-block，後兩段再包一層（規格 B-1）。
 * 一行放得下就一行；放不下先在「故事，」後斷；再放不下才在「是一步步」後斷。
 */
function WelcomeHeadline() {
  const [first, second, third] = WELCOME_HEADLINE_SEGMENTS;
  return (
    <span className="welcome-headline" data-testid="welcome-headline" data-text={WELCOME_HEADLINE}>
      <span className="welcome-headline-seg">{first}</span>
      <span className="welcome-headline-group">
        <span className="welcome-headline-seg">{second}</span>
        <span className="welcome-headline-seg">{third}</span>
      </span>
    </span>
  );
}

export function WelcomeTour({
  entry,
  todayWords,
  dailyGoal,
  met,
  onExit,
  initialPage = 'welcome',
  channel = currentChannel(),
  version = APP_VERSION,
  renderStep,
  onStepNext,
  onStepSkip,
  stepBody,
  finishOutcome = 'home',
  appearanceTo,
  openBusy = false,
}: WelcomeTourProps) {
  const { mode } = useLayout();
  const presentation = tourPresentation(mode);
  const [page, setPage] = useState<TourPage>(initialPage);
  const [hadRecordAtStart] = useState(() => hasOnboardingRecord());
  const writtenRef = useRef(false);
  const skippedLastRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // 切頁時焦點移到新頁的標題（第一次打開也一樣）。
  useEffect(() => {
    titleRef.current?.focus();
  }, [page]);

  const record = (event: TourEvent) => {
    const status = recordStatusFor(event, {
      entry,
      writtenThisRun: writtenRef.current,
      hadRecordAtStart,
      skippedLastStep: skippedLastRef.current,
    });
    if (!status) return;
    writtenRef.current = true;
    // 寫不進本機儲存時仍記在記憶體，同一次使用不再自動出現。
    writeOnboardingRecord(status, new Date());
  };

  const goTo = (target: TourPage | null) => {
    if (target === null) return;
    // 走到收尾那一刻就記 done，不延到離開收尾。
    if (target === 'finish') record('reach-finish');
    setPage(target);
  };

  const onCorner = () => {
    const action = cornerAction(page, entry);
    if (action === 'skip-all') {
      record('skip-all');
      onExit('skip-all');
    } else if (action === 'close') {
      onExit('close');
    } else if (action === 'skip-step' && isStep(page)) {
      // 第 3 關跳過直接到收尾，維持 skipped；第 1、2 關跳過當下記 skipped，之後走到收尾改記 done。
      if (page === 3) {
        record('skip-last-step');
        skippedLastRef.current = true;
      } else {
        record('skip-step');
      }
      onStepSkip?.(page);
      goTo(nextPage(page));
    }
  };

  const onPrimary = () => {
    // WO-111：收尾照第 3 關結果分流（開始寫／繼續寫）；回首頁照舊。
    if (page === 'finish' && finishOutcome !== 'home') {
      onExit(FINISH_EXIT[finishOutcome]);
      return;
    }
    if (page === 'finish') {
      onExit('finish-home');
      return;
    }
    if (isStep(page) && onStepNext && !onStepNext(page)) return;
    goTo(nextPage(page));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // 不設 Esc 關閉：Esc 不做任何事。
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        !enterTriggersPrimary({
          tagName: target.tagName,
          role: target.getAttribute('role'),
          type: target.getAttribute('type'),
          isContentEditable: target.isContentEditable,
        })
      ) {
        return;
      }
      event.preventDefault();
      primaryRef.current?.click();
      return;
    }
    if (target.getAttribute('role') === 'radio') {
      const group = target.closest('[role="radiogroup"]');
      const radios = group ? Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')) : [];
      const next = radioArrowTarget(event.key, radios.indexOf(target), radios.length);
      if (next !== null) {
        event.preventDefault();
        radios[next].focus();
        radios[next].click();
      }
      return;
    }
    if (event.key === 'Tab' && rootRef.current) {
      // Tab 只在導覽裡繞，不跑到後面的首頁或設定頁。
      const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const corner = cornerAction(page, entry);
  const cornerText = corner === 'skip-all' ? WELCOME_SKIP_ALL : corner === 'close' ? WELCOME_CLOSE : STEP_SKIP;
  const cornerAria =
    corner === 'skip-all'
      ? WELCOME_SKIP_ALL_ARIA
      : corner === 'close'
        ? WELCOME_CLOSE_ARIA
        : isStep(page)
          ? STEP_SKIP_ARIA[page]
          : undefined;

  const kicker = page === 'welcome' ? WELCOME_KICKER : page === 'finish' ? FINISH_KICKER : stepKicker(page);
  const finishPrimary = FINISH_PRIMARY[finishOutcome] ?? { text: FINISH_HOME };
  const opening = page === 'finish' && finishOutcome === 'open' && openBusy;
  const primaryText = opening
    ? OPEN_FILE_BUSY
    : page === 'welcome'
      ? WELCOME_START
      : page === 'finish'
        ? finishPrimary.text
        : STEP_PRIMARY[page];
  const primaryAria = opening
    ? undefined
    : page === 'welcome'
      ? WELCOME_START_ARIA
      : isStep(page)
        ? STEP_PRIMARY_ARIA[page]
        : finishPrimary.aria;
  const back = backPage(page);

  return (
    <div
      ref={rootRef}
      className="welcome-tour"
      data-testid="welcome-tour"
      data-tour-layout={mode}
      data-presentation={presentation.kind}
      data-columns={presentation.columns}
      data-page={String(page)}
      data-entry={entry}
      onKeyDown={onKeyDown}
    >
      {/* 中等、寬版：後面變暗；點這裡不會關掉導覽。 */}
      {presentation.kind === 'card' ? <div className="welcome-scrim" aria-hidden="true" data-testid="welcome-scrim" /> : null}
      <div className="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-tour-title">
        <header className="welcome-top">
          <TourTrail page={page} />
          {corner ? (
            <button
              type="button"
              className="welcome-skip"
              data-testid="welcome-corner"
              data-action={corner}
              aria-label={cornerAria}
              onClick={onCorner}
            >
              {cornerText}
            </button>
          ) : null}
        </header>
        <div className="welcome-scroll" data-testid="welcome-scroll">
          <div className="welcome-cols">
            <div className="welcome-lead">
              {page === 'welcome' ? <WelcomeIllustration /> : null}
              <p className="welcome-kicker" data-testid="welcome-kicker">
                {kicker}
              </p>
              <h2
                id="welcome-tour-title"
                ref={titleRef}
                tabIndex={-1}
                className={page === 'welcome' ? 'welcome-title is-headline' : 'welcome-title'}
                data-testid="welcome-title"
              >
                {page === 'welcome' ? <WelcomeHeadline /> : page === 'finish' ? FINISH_TITLE : STEP_TITLES[page]}
              </h2>
              {page === 'welcome' ? <p className="welcome-body">{WELCOME_BODY}</p> : null}
              {isStep(page) && stepBody?.(page) ? (
                <p className="welcome-body" data-testid="welcome-step-lead">
                  {stepBody(page)}
                </p>
              ) : null}
            </div>
            <div className="welcome-content">
              {page === 'welcome' ? (
                <>
                  <div
                    className="welcome-version"
                    role="group"
                    aria-label={versionAria(version, channel)}
                    data-testid="welcome-version"
                  >
                    <span aria-hidden="true">{welcomeVersionText(version)}</span>
                    <span className="welcome-channel" data-channel={channel} aria-hidden="true">
                      {channelTagText(channel)}
                    </span>
                  </div>
                  {showsPreviewNote(channel) ? (
                    <p className="welcome-preview-note" data-testid="welcome-preview-note">
                      {WELCOME_PREVIEW_NOTE}
                    </p>
                  ) : null}
                </>
              ) : null}
              {isStep(page) ? (
                <div className="welcome-step-body" data-testid="welcome-step-body" data-step={page}>
                  {renderStep ? renderStep(page) : null}
                </div>
              ) : null}
              {page === 'finish' ? (
                <>
                  <DailyProgressBar words={todayWords} goal={dailyGoal} met={met} />
                  {/* 第一次使用還沒有稿子，只是文字、不做連結；再看一次且有開著的稿子才連到設定的外觀組。 */}
                  {appearanceTo ? (
                    <p className="welcome-appearance-note" data-testid="welcome-appearance-note">
                      <Link
                        className="welcome-appearance-link"
                        to={appearanceTo}
                        aria-label={FINISH_APPEARANCE_LINK_ARIA}
                        data-testid="welcome-appearance-link"
                        onClick={() => onExit('appearance')}
                      >
                        {FINISH_APPEARANCE_NOTE}
                      </Link>
                    </p>
                  ) : (
                    <p className="welcome-appearance-note" data-testid="welcome-appearance-note">
                      {FINISH_APPEARANCE_NOTE}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="welcome-actions">
          {back !== null && isStep(page) ? (
            <button
              type="button"
              className="welcome-back"
              data-testid="welcome-back"
              aria-label={STEP_BACK_ARIA[page]}
              onClick={() => setPage(back)}
            >
              {STEP_BACK}
            </button>
          ) : null}
          <button
            ref={primaryRef}
            type="button"
            className="welcome-primary"
            data-testid="welcome-primary"
            aria-label={primaryAria}
            disabled={opening}
            aria-busy={opening ? 'true' : undefined}
            onClick={onPrimary}
          >
            {primaryText}
          </button>
        </footer>
      </div>
    </div>
  );
}
