import React, { useState } from 'react';
import {
  CARD_COLOR_CHANGE_TO,
  CARD_COLOR_CURRENT,
  CARD_COLOR_DEFAULT,
  CARD_COLOR_HEX_INVALID,
  CARD_COLOR_HEX_LABEL,
  CARD_COLOR_HEX_PLACEHOLDER,
  EDIT_CARD_CANCEL,
  EDIT_CARD_DONE,
} from '../copy/cardEditCopy';
import {
  CARD_COLOR_REGEX,
  DEFAULT_CARD_COLOR,
  formatCardColorForSave,
  getDesktopColorGrid,
  getPhoneColorGrid,
  isValidCardColor,
  normalizeHexColor,
} from '../domain/cardColors';
import type { LayoutMode } from '../layout/layoutMode';
import './cardColorPicker.css';

export interface CardColorPickerProps {
  currentColor?: string;
  initialColor?: string;
  onSelectColor?: (color: string) => void;
  onDone: (color: string) => void;
  onCancel?: () => void;
  layoutMode?: LayoutMode;
}

export function CardColorPicker({
  currentColor = DEFAULT_CARD_COLOR,
  initialColor,
  onSelectColor,
  onDone,
  onCancel,
  layoutMode = 'phone-portrait',
}: CardColorPickerProps) {
  const safeCurrentColor = isValidCardColor(currentColor?.trim())
    ? currentColor.trim()
    : DEFAULT_CARD_COLOR;

  const [selectedColor, setSelectedColor] = useState<string>(
    normalizeHexColor(initialColor) ?? normalizeHexColor(safeCurrentColor) ?? DEFAULT_CARD_COLOR,
  );
  const [hexInput, setHexInput] = useState<string>(selectedColor);
  const [hexError, setHexError] = useState<string | null>(null);

  const isPortrait = layoutMode === 'phone-portrait';
  const gridRows = isPortrait ? getPhoneColorGrid() : getDesktopColorGrid();
  const gridClass = isPortrait
    ? 'grid-portrait'
    : layoutMode === 'medium'
      ? 'grid-medium'
      : 'grid-desktop';

  const handleSelectSwatch = (color: string) => {
    const normalized = normalizeHexColor(color) ?? color;
    setSelectedColor(normalized);
    setHexInput(normalized);
    setHexError(null);
    onSelectColor?.(normalized);
  };

  const handleSelectDefault = () => {
    setSelectedColor(DEFAULT_CARD_COLOR);
    setHexInput(DEFAULT_CARD_COLOR);
    setHexError(null);
    onSelectColor?.(DEFAULT_CARD_COLOR);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHexInput(val);
    const normalized = normalizeHexColor(val);
    if (normalized) {
      setSelectedColor(normalized);
      setHexError(null);
      onSelectColor?.(normalized);
    }
  };

  const handleHexBlur = () => {
    const trimmed = hexInput.trim();
    if (!CARD_COLOR_REGEX.test(trimmed)) {
      setHexError(CARD_COLOR_HEX_INVALID);
    } else {
      setHexError(null);
    }
  };

  const handleDone = () => {
    const trimmed = hexInput.trim();
    if (!CARD_COLOR_REGEX.test(trimmed)) {
      setHexError(CARD_COLOR_HEX_INVALID);
      return;
    }
    const finalColor = formatCardColorForSave(trimmed);
    onDone(finalColor);
  };

  return (
    <div
      className="card-color-picker"
      data-testid="card-color-picker"
      data-layout={layoutMode}
    >
      <div className="card-color-picker-header">
        <h3 className="card-color-picker-title">卡片顏色</h3>
        <div className="color-picker-compare" data-testid="color-picker-compare">
          <button
            type="button"
            className="color-compare-item color-compare-button"
            onClick={() => handleSelectSwatch(safeCurrentColor)}
            title="選回原顏色"
            aria-label={`選回原顏色 ${safeCurrentColor}`}
            data-testid="color-restore-original"
          >
            {CARD_COLOR_CURRENT}{' '}
            <span
              className="color-compare-dot"
              style={{ backgroundColor: safeCurrentColor }}
              aria-hidden="true"
            />{' '}
            <code>{safeCurrentColor.toLowerCase()}</code>
          </button>
          <span className="color-compare-sep" aria-hidden="true">
            →
          </span>
          <span className="color-compare-item">
            {CARD_COLOR_CHANGE_TO}{' '}
            <span
              className="color-compare-dot"
              style={{ backgroundColor: selectedColor }}
              aria-hidden="true"
            />{' '}
            <code>{selectedColor.toLowerCase()}</code>
          </span>
        </div>
      </div>

      <div className="color-picker-grid-container">
        <div className={`color-picker-grid ${gridClass}`} role="grid" aria-label="卡片選色盤">
          {gridRows.map((row, rIdx) => (
            <div key={rIdx} className="color-picker-row" role="row">
              {row.map((color) => {
                const isSelected = selectedColor.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch-button ${isSelected ? 'is-selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => handleSelectSwatch(color)}
                    aria-label={`顏色 ${color}`}
                    aria-selected={isSelected}
                    role="gridcell"
                    data-testid={`color-swatch-${color.toLowerCase().replace('#', '')}`}
                  >
                    {isSelected && <span className="color-swatch-indicator" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="color-picker-controls">
        <div className="color-picker-inline-row">
          <button
            type="button"
            className="color-default-button"
            onClick={handleSelectDefault}
            data-testid="color-default-button"
          >
            {CARD_COLOR_DEFAULT}
          </button>

          <div className="color-hex-group">
            <label htmlFor="card-color-hex-input" className="color-hex-label">
              {CARD_COLOR_HEX_LABEL}
            </label>
            <input
              id="card-color-hex-input"
              type="text"
              className={`color-hex-input ${hexError ? 'is-invalid' : ''}`}
              placeholder={CARD_COLOR_HEX_PLACEHOLDER}
              value={hexInput}
              onChange={handleHexChange}
              onBlur={handleHexBlur}
              data-testid="color-hex-input"
              maxLength={7}
            />
          </div>
        </div>

        {hexError && (
          <p className="color-error-text" role="alert" data-testid="color-error-text">
            {hexError}
          </p>
        )}
      </div>

      <div className="color-picker-actions">
        {onCancel && (
          <button
            type="button"
            className="color-action-button color-action-cancel"
            onClick={onCancel}
            data-testid="color-action-cancel"
          >
            {EDIT_CARD_CANCEL}
          </button>
        )}
        <button
          type="button"
          className="color-action-button color-action-done"
          onClick={handleDone}
          data-testid="color-action-done"
        >
          {EDIT_CARD_DONE}
        </button>
      </div>
    </div>
  );
}
