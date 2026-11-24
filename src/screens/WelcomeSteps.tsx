import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { DailyProgressBar } from '../components/DailyProgressBar';
import {
  continueNote,
  CUSTOM_ARIA,
  CUSTOM_INPUT_ARIA,
  CUSTOM_LABEL,
  CUSTOM_PLACEHOLDER,
  CUSTOM_UNIT,
  customCurrentLabel,
  BOOK_NOTE,
  DAILY_DEMO_NOTE,
  dailyDemoAria,
  GROUP_ARIA,
  goalOptionAria,
  IOS_SAVE_NOTE,
  START_NAMES,
  START_NOTES,
  STEP3_BODY_REVISIT,
  STEP_BODIES,
  startOptionAria,
  type FinishOutcome,
  type StartChoice,
  type TourStepNumber,
} from '../copy/welcomeCopy';
import { canPickLocalFiles } from '../db/browserDisk';
import { formatInteger } from '../domain/formatNumber';
import { readDeviceSignals } from '../layout/inputMode';
import { readNewBookGoal, writeNewBookGoal } from '../state/newBookGoal';
import { useSample } from '../state/sampleStore';
import {
  commitGoalStep,
  demoGoal,
  finishOutcomeFor,
  goalOptions,
  initialGoalChoice,
  initialStartChoice,
  showsIosSaveNote,
  startChoices,
  type GoalChoice,
  type GoalStep,
} from './welcomeStepsModel';
import type { TourEntry } from './welcomeTourModel';

/**
 * 歡迎導覽三關內容與設定寫入（WO-111，歡迎-4）。外框在 WelcomeTour.tsx（WO-110），這裡只提供：
 * - renderStep：三關內容；stepBody：三關說明。
 * - onStepNext：按「下一關」先檢查，通過就馬上寫該關設定（值沒變不寫）；自己填錯就留在這一關。
 * - onStepSkip：這一關不改；第 3 關跳過讓收尾變「回首頁」。
 * - finishOutcome：收尾主要按鈕照第 3 關結果分流。
 *
 * 寫入：
 * - 第 1 關：actions.setTourDailyGoal，和設定頁「寫作目標」卡片是同一個每日目標（最少 300、當天以最後一次為準）；
 *   不改開著檔案的欄位、不寫 .db；沒有稿子時記在這個裝置的既有紀錄裡，重開後預選。
 * - 第 2 關：WO-109 的 writeNewBookGoal（`jiufang-novel-m.new-book-goal.v1`），不改目前這份稿子的全書目標。
 * - 上一步不回滾已存的設定；跳過不改該關；沒按「下一關」不存。
 */

export interface WelcomeStepsOptions {
  entry: TourEntry;
  /** 再看一次時開著的那份稿子（第 3 關「繼續寫這份稿子」用）；第一次使用為 null。 */
  project: { id: string; title: string } | null;
  /** 測試用：指定要不要顯示 iPhone、iPad 另存小卡；平常沿用既有判斷。 */
  iosSaveNote?: boolean;
}

export interface WelcomeStepsProps {
  renderStep: (step: TourStepNumber) => ReactNode;
  stepBody: (step: TourStepNumber) => string | null;
  onStepNext: (step: TourStepNumber) => boolean;
  onStepSkip: (step: TourStepNumber) => void;
  finishOutcome: FinishOutcome;
}

function detectIosSaveNote(): boolean {
  try {
    const signals = readDeviceSignals();
    return showsIosSaveNote({
      canPickLocalFiles: canPickLocalFiles(),
      userAgent: signals.userAgent ?? '',
      maxTouchPoints: signals.maxTouchPoints ?? 0,
    });
  } catch {
    return false;
  }
}

/** 目前的每日目標：和設定頁同一個算法（當天最後一次，沒有就是預設）。 */
function useSavedDailyGoal(): number {
  const { state } = useSample();
  return state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
}

export function useWelcomeSteps({ entry, project, iosSaveNote }: WelcomeStepsOptions): WelcomeStepsProps {
  const { actions } = useSample();
  const savedDaily = useSavedDailyGoal();
  const [savedBook, setSavedBook] = useState(() => readNewBookGoal());
  // null＝還沒動過，跟著已存的值預選（中途重入、從設定再看一次都帶目前的值）。
  const [dailyChoice, setDailyChoice] = useState<GoalChoice | null>(null);
  const [bookChoice, setBookChoice] = useState<GoalChoice | null>(null);
  const [startChoice, setStartChoice] = useState<StartChoice | null>(null);
  const [finishOutcome, setFinishOutcome] = useState<FinishOutcome>('home');
  const [error, setError] = useState<{ step: GoalStep; message: string } | null>(null);
  const [showIos] = useState(() => iosSaveNote ?? detectIosSaveNote());
  const inputRef = useRef<HTMLInputElement>(null);

  const hasProject = project !== null;
  const daily = dailyChoice ?? initialGoalChoice(1, savedDaily);
  const book = bookChoice ?? initialGoalChoice(2, savedBook);
  const start = startChoice ?? initialStartChoice(entry, hasProject);

  const choose = (step: GoalStep, next: GoalChoice) => {
    // 改選項或開始輸入：錯誤消失、外框還原。
    setError(null);
    if (step === 1) setDailyChoice(next);
    else setBookChoice(next);
  };

  const onStepNext = (step: TourStepNumber): boolean => {
    if (step === 3) {
      setFinishOutcome(finishOutcomeFor({ kind: 'next', choice: start }));
      return true;
    }
    const choice = step === 1 ? daily : book;
    const result =
      step === 1
        ? commitGoalStep(1, choice, savedDaily, (value) => actions.setTourDailyGoal(value))
        : commitGoalStep(2, choice, savedBook, (value) => {
            writeNewBookGoal(value);
            setSavedBook(readNewBookGoal());
          });
    if (!result.ok) {
      // 不換頁、不寫設定；焦點回輸入框，錯誤句設成提醒馬上念。
      setError({ step, message: result.message });
      inputRef.current?.focus();
      return false;
    }
    setError(null);
    // 已存好：選取改回跟著已存的值預選（上一步回來看到的就是存好的值）。
    if (step === 1) setDailyChoice(null);
    else setBookChoice(null);
    return true;
  };

  const onStepSkip = (step: TourStepNumber) => {
    // 這一關不改：選取回到已存的值；錯誤不留到這一關以外。
    setError(null);
    if (step === 1) setDailyChoice(null);
    else if (step === 2) setBookChoice(null);
    else setFinishOutcome(finishOutcomeFor({ kind: 'skip' }));
  };

  const stepBody = (step: TourStepNumber): string | null =>
    step === 3 && entry === 'revisit' ? STEP3_BODY_REVISIT : STEP_BODIES[step];

  const renderStep = (step: TourStepNumber): ReactNode => {
    if (step === 3) {
      return (
        <StartStep
          choices={startChoices(entry, hasProject)}
          selected={start}
          projectTitle={project?.title ?? null}
          showIosNote={showIos}
          onSelect={setStartChoice}
        />
      );
    }
    return (
      <GoalStepView
        key={step}
        step={step}
        choice={step === 1 ? daily : book}
        saved={step === 1 ? savedDaily : savedBook}
        error={error?.step === step ? error.message : null}
        inputRef={inputRef}
        onChoose={(next) => choose(step, next)}
        onLeave={() => setError(null)}
      />
    );
  };

  return { renderStep, stepBody, onStepNext, onStepSkip, finishOutcome };
}

/* ── 第 1、2 關 ── */

export function GoalStepView({
  step,
  choice,
  saved,
  error,
  inputRef,
  onChoose,
  onLeave,
}: {
  step: GoalStep;
  choice: GoalChoice;
  saved: number;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChoose: (next: GoalChoice) => void;
  onLeave: () => void;
}) {
  const options = goalOptions(step);
  const custom = choice.kind === 'custom';
  const errorId = `welcome-goal-error-${step}`;
  const inputId = `welcome-goal-input-${step}`;
  // 目前已存的值不在選項裡（再看一次常見）：自己填直接寫出那個數。
  const savedIsCustom = !options.some((option) => option.value === saved);

  // 離開這一關（上一步、跳過、下一關）就不留錯誤。
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  useEffect(() => () => leaveRef.current(), []);

  const pickCustom = (event: MouseEvent<HTMLButtonElement>) => {
    if (!custom) onChoose({ kind: 'custom', text: savedIsCustom ? formatInteger(saved) : '' });
    // 用手點的才把焦點移到輸入框；方向鍵在選項間移動時不搶焦點。
    if (event.detail > 0) window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="welcome-goal" data-testid={`welcome-goal-${step}`}>
      <div className="welcome-options is-grid" role="radiogroup" aria-label={GROUP_ARIA[step]}>
        {options.map((option) => {
          const checked = choice.kind === 'option' && choice.value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="welcome-option"
              aria-label={goalOptionAria(option)}
              data-testid={`welcome-option-${step}-${option.value}`}
              onClick={() => onChoose({ kind: 'option', value: option.value })}
            >
              <span className="welcome-option-name" aria-hidden="true">
                {option.amount}
              </span>
              <span className="welcome-option-note" aria-hidden="true">
                {option.note}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          tabIndex={custom ? 0 : -1}
          className="welcome-option welcome-option-custom"
          aria-label={CUSTOM_ARIA}
          data-testid={`welcome-option-${step}-custom`}
          onClick={pickCustom}
        >
          <span className="welcome-option-name" aria-hidden="true">
            {savedIsCustom ? customCurrentLabel(saved) : CUSTOM_LABEL}
          </span>
        </button>
      </div>
      {custom ? (
        <div className="welcome-custom" data-testid={`welcome-custom-${step}`}>
          <span className="welcome-custom-field" data-invalid={error ? 'true' : 'false'}>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
              className="welcome-custom-input"
              placeholder={CUSTOM_PLACEHOLDER[step]}
              aria-label={CUSTOM_INPUT_ARIA[step]}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              data-testid={`welcome-custom-input-${step}`}
              value={choice.text}
              onChange={(event) => onChoose({ kind: 'custom', text: event.target.value })}
            />
            <span className="welcome-custom-unit" aria-hidden="true">
              {CUSTOM_UNIT}
            </span>
          </span>
          {error ? (
            <p id={errorId} className="welcome-error" role="alert" data-testid={`welcome-error-${step}`}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {step === 1 ? (
        <>
          {/* 示範：就是寫作頁那條進度條，數字跟著選的目標變；今天字數固定 0，不算入今天。 */}
          <div className="welcome-demo" role="img" aria-label={dailyDemoAria(demoGoal(choice, saved))} data-testid="welcome-demo">
            <DailyProgressBar words={0} goal={demoGoal(choice, saved)} met={false} />
          </div>
          <p className="welcome-note">{DAILY_DEMO_NOTE}</p>
        </>
      ) : (
        <p className="welcome-note">{BOOK_NOTE}</p>
      )}
    </div>
  );
}

/* ── 第 3 關 ── */

export function StartStep({
  choices,
  selected,
  projectTitle,
  showIosNote,
  onSelect,
}: {
  choices: StartChoice[];
  selected: StartChoice;
  projectTitle: string | null;
  showIosNote: boolean;
  onSelect: (choice: StartChoice) => void;
}) {
  return (
    <div className="welcome-start" data-testid="welcome-start">
      <div className="welcome-options" role="radiogroup" aria-label={GROUP_ARIA[3]}>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={choice === selected}
            tabIndex={choice === selected ? 0 : -1}
            className="welcome-option welcome-option-row"
            aria-label={startOptionAria(choice, projectTitle)}
            data-testid={`welcome-start-${choice}`}
            onClick={() => onSelect(choice)}
          >
            <span className="welcome-option-name" aria-hidden="true">
              {START_NAMES[choice]}
            </span>
            <span className="welcome-option-note" aria-hidden="true">
              {choice === 'continue' ? continueNote(projectTitle) : START_NOTES[choice]}
            </span>
          </button>
        ))}
      </div>
      {showIosNote ? (
        <p className="welcome-ios-note" data-testid="welcome-ios-note">
          {IOS_SAVE_NOTE}
        </p>
      ) : null}
    </div>
  );
}
