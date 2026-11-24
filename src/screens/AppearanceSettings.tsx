import { useRef, useState, type KeyboardEvent } from 'react';
import {
  APPEARANCE_ROW_ORDER,
  APPEARANCE_SECTION,
  BODY_FONT_DECREASE,
  BODY_FONT_DECREASE_ARIA,
  BODY_FONT_INCREASE,
  BODY_FONT_INCREASE_ARIA,
  BODY_FONT_PREVIEW,
  BODY_FONT_SCALE_DESCRIPTION,
  BODY_FONT_SCALE_TITLE,
  inputModeCaption,
  INPUT_MODE_DESCRIPTION,
  inputModeGroupAria,
  inputModeName,
  inputModeOptionAria,
  INPUT_MODE_TITLE,
  THEME_CAPTIONS,
  THEME_CHANGED_ANNOUNCE,
  THEME_DESCRIPTION,
  THEME_GROUP_ARIA,
  THEME_NAMES,
  THEME_OPTION_ARIA,
  THEME_TITLE,
} from '../copy/appearanceCopy';
import {
  bodyFontScaleAfterArrow,
  bodyFontScaleAria,
  bodyFontScaleLabel,
  bodyPreviewFontPx,
  isBodyFontScale,
  stepBodyFontScale,
  type BodyFontScale,
} from '../layout/bodyFontScale';
import {
  setDeviceTheme,
  THEME_IDS,
  themeAfterArrow,
  useDeviceTheme,
  type ThemeId,
} from '../layout/deviceTheme';
import { inputModeAfterArrow } from '../layout/inputMode';
import type { LayoutMode, PointerMode } from '../layout/layoutMode';

/** 小色塊：外框是四周的顏色，中間小方塊是正文欄的顏色。純裝飾，朗讀跳過。 */
function ThemeSwatch({ theme }: { theme: ThemeId }) {
  return (
    <span className="theme-swatch" data-theme={theme} aria-hidden="true">
      <span />
    </span>
  );
}

/**
 * 主題（WO-101）。選了立刻換色並記在這個裝置；不寫進稿子。
 * 選取狀態由 radio 語意提供；方向鍵在三套之間移動。
 */
function ThemeRow() {
  const theme = useDeviceTheme();
  const [announce, setAnnounce] = useState('');
  const refs = useRef<Partial<Record<ThemeId, HTMLButtonElement | null>>>({});

  function choose(next: ThemeId) {
    refs.current[next]?.focus();
    if (next === theme) return;
    setDeviceTheme(next);
    setAnnounce(THEME_CHANGED_ANNOUNCE[next]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = themeAfterArrow(theme, event.key);
    if (!next) return;
    event.preventDefault();
    choose(next);
  }

  return (
    <div className="theme-setting" data-testid="theme-setting">
      <p className="theme-title" aria-hidden="true">
        {THEME_TITLE}
      </p>
      <p className="hint" data-testid="theme-hint">
        {THEME_DESCRIPTION}
      </p>
      <div
        className="theme-options"
        role="radiogroup"
        aria-label={THEME_GROUP_ARIA}
        data-testid="theme-options"
        onKeyDown={onKeyDown}
      >
        {THEME_IDS.map((id) => {
          const selected = id === theme;
          return (
            <button
              key={id}
              ref={(node) => {
                refs.current[id] = node;
              }}
              type="button"
              role="radio"
              className="theme-option"
              data-testid={`theme-option-${id}`}
              data-theme-option={id}
              aria-checked={selected}
              aria-label={THEME_OPTION_ARIA[id]}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(id)}
            >
              <span className="theme-radio" aria-hidden="true" />
              <ThemeSwatch theme={id} />
              <span className="theme-option-text">
                <strong>{THEME_NAMES[id]}</strong>
                <small>{THEME_CAPTIONS[id]}</small>
              </span>
            </button>
          );
        })}
      </div>
      <span className="sr-only" role="status" aria-live="polite" data-testid="theme-announce">
        {announce}
      </span>
    </div>
  );
}

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

function BodyFontScaleRow({
  scale,
  layoutMode,
  onScale,
}: {
  scale: BodyFontScale;
  layoutMode: LayoutMode;
  onScale: (scale: BodyFontScale) => void;
}) {
  function change(next: BodyFontScale | null) {
    if (next == null || next === scale) return;
    onScale(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight'
    ) {
      return;
    }
    event.preventDefault();
    change(bodyFontScaleAfterArrow(scale, event.key));
  }

  const spoken = bodyFontScaleAria(scale);
  const atMin = scale === 90;
  const atMax = scale === 200;

  return (
    <div className="body-font-setting" data-testid="body-font-setting">
      <div className="body-font-row">
        <p className="body-font-title" aria-hidden="true">
          {BODY_FONT_SCALE_TITLE}
        </p>
        <div
          className="body-font-control"
          role="slider"
          tabIndex={0}
          data-testid="body-font-slider"
          aria-label={spoken}
          aria-valuemin={90}
          aria-valuemax={200}
          aria-valuenow={scale}
          aria-valuetext={spoken}
          onKeyDown={onKeyDown}
        >
          <button
            type="button"
            className="body-font-step"
            data-testid="body-font-decrease"
            aria-label={BODY_FONT_DECREASE_ARIA}
            tabIndex={-1}
            disabled={atMin}
            onClick={() => change(stepBodyFontScale(scale, -1))}
          >
            {BODY_FONT_DECREASE}
          </button>
          <span className="body-font-value" data-testid="body-font-value" aria-hidden="true">
            {bodyFontScaleLabel(scale)}
          </span>
          <button
            type="button"
            className="body-font-step"
            data-testid="body-font-increase"
            aria-label={BODY_FONT_INCREASE_ARIA}
            tabIndex={-1}
            disabled={atMax}
            onClick={() => change(stepBodyFontScale(scale, 1))}
          >
            {BODY_FONT_INCREASE}
          </button>
        </div>
      </div>
      <p className="hint" data-testid="body-font-hint">
        {BODY_FONT_SCALE_DESCRIPTION}
      </p>
      <p
        className="body-font-preview"
        data-testid="body-font-preview"
        aria-hidden="true"
        style={{ fontSize: `${bodyPreviewFontPx(layoutMode, scale)}px` }}
      >
        {BODY_FONT_PREVIEW}
      </p>
    </div>
  );
}

export function AppearanceSettings({
  pointer,
  bodyFontScale,
  layoutMode,
  onChange,
  onBodyFontScale,
}: {
  pointer: PointerMode;
  bodyFontScale: BodyFontScale;
  layoutMode: LayoutMode;
  onChange: (mode: PointerMode) => void;
  onBodyFontScale: (scale: BodyFontScale) => void;
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
        if (row === 'theme') return <ThemeRow key={row} />;
        if (row === 'body-font-scale') {
          const scale = isBodyFontScale(bodyFontScale) ? bodyFontScale : 100;
          return (
            <BodyFontScaleRow
              key={row}
              scale={scale}
              layoutMode={layoutMode}
              onScale={onBodyFontScale}
            />
          );
        }
        if (row !== 'input-mode') return null;
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
              {INPUT_MODE_DESCRIPTION}
            </p>
          </div>
        );
      })}
    </section>
  );
}
