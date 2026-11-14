import { useRef, type KeyboardEvent } from 'react';
import {
  APPEARANCE_ROW_ORDER,
  APPEARANCE_SECTION,
  inputModeCaption,
  inputModeDescription,
  inputModeGroupAria,
  inputModeName,
  inputModeOptionAria,
  INPUT_MODE_TITLE,
} from '../copy/appearanceCopy';
import { inputModeAfterArrow, type DeviceKind } from '../layout/inputMode';
import type { PointerMode } from '../layout/layoutMode';

function DensityMark({ mode }: { mode: PointerMode }) {
  const count = mode === 'touch' ? 3 : 5;
  return (
    <span className={`input-mode-mark is-${mode}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}

function InputModeOption({
  mode,
  selected,
  buttonRef,
  onChoose,
}: {
  mode: PointerMode;
  selected: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onChoose: (mode: PointerMode) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      className="input-mode-option"
      data-testid={mode === 'touch' ? 'input-mode-touch' : 'input-mode-mouse'}
      aria-checked={selected}
      aria-label={inputModeOptionAria(mode, selected)}
      tabIndex={selected ? 0 : -1}
      onClick={() => onChoose(mode)}
    >
      <DensityMark mode={mode} />
      <strong>{inputModeName(mode)}</strong>
      <small>{inputModeCaption(mode)}</small>
    </button>
  );
}

export function AppearanceSettings({
  pointer,
  deviceKind,
  onChange,
}: {
  pointer: PointerMode;
  deviceKind: DeviceKind;
  onChange: (mode: PointerMode) => void;
}) {
  const touchRef = useRef<HTMLButtonElement | null>(null);
  const mouseRef = useRef<HTMLButtonElement | null>(null);

  function choose(mode: PointerMode) {
    onChange(mode);
    const node = mode === 'touch' ? touchRef.current : mouseRef.current;
    node?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = inputModeAfterArrow(pointer, event.key);
    if (!next) return;
    event.preventDefault();
    choose(next);
  }

  return (
    <section className="appearance-section" aria-labelledby="appearance-heading" data-testid="appearance-section">
      <h2 id="appearance-heading" className="settings-kicker">
        {APPEARANCE_SECTION}
      </h2>
      {APPEARANCE_ROW_ORDER.map((row) => {
        if (row !== 'input-mode') {
          // 正文字級（外觀-3）插在操作方式上方。現在不畫、不放佔位。
          return null;
        }
        return (
          <div key={row} className="input-mode-setting" data-testid="input-mode-setting">
            <p className="input-mode-title" aria-hidden="true">
              {INPUT_MODE_TITLE}
            </p>
            <div
              className="input-mode-options"
              role="radiogroup"
              aria-label={inputModeGroupAria(pointer)}
              aria-describedby="input-mode-hint"
              onKeyDown={onKeyDown}
            >
              <InputModeOption
                mode="touch"
                selected={pointer === 'touch'}
                buttonRef={(node) => {
                  touchRef.current = node;
                }}
                onChoose={choose}
              />
              <InputModeOption
                mode="mouse"
                selected={pointer === 'mouse'}
                buttonRef={(node) => {
                  mouseRef.current = node;
                }}
                onChoose={choose}
              />
            </div>
            <p id="input-mode-hint" className="hint">
              {inputModeDescription(deviceKind)}
            </p>
          </div>
        );
      })}
    </section>
  );
}
