import { useState } from 'react';
import {
  ADD_CATEGORY_BUTTON,
  CATEGORY_BUILTIN_ARIA,
  CATEGORY_BUILTIN_BADGE,
  CATEGORY_DELETE,
  CATEGORY_EMPTY_NAME_ERROR,
  CATEGORY_HAS_CARDS_WARNING,
  CATEGORY_MANAGER_HINT,
  CATEGORY_MOVE_DOWN,
  CATEGORY_MOVE_UP,
  CATEGORY_NAME_PLACEHOLDER,
  CATEGORY_RENAME,
  EDIT_CARD_CANCEL,
  EDIT_CARD_DONE,
  ORGANIZE_CATEGORIES_BUTTON,
} from '../copy/cardEditCopy';
import type { ResolvedCategoryItem } from '../domain/cardCategories';
import type { FileCard } from '../db/projectFile';
import type { LayoutMode } from '../layout/layoutMode';
import './categoryManager.css';

export interface CategoryManagerProps {
  categories: readonly ResolvedCategoryItem[];
  cards: readonly FileCard[];
  onMoveUp: (code: string) => void;
  onMoveDown: (code: string) => void;
  onRename: (code: string, newName: string) => void;
  onDelete: (code: string) => void;
  onAddCategory: (name: string) => void;
  onDone: () => void;
  layoutMode?: LayoutMode;
}

export function CategoryManager({
  categories,
  cards,
  onMoveUp,
  onMoveDown,
  onRename,
  onDelete,
  onAddCategory,
  onDone,
  layoutMode = 'phone-portrait',
}: CategoryManagerProps) {
  const [renamingCode, setRenamingCode] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [addError, setAddError] = useState<string | null>(null);

  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const handleStartRename = (cat: ResolvedCategoryItem) => {
    setRenamingCode(cat.id);
    setRenameValue(cat.name);
    setRenameError(null);
  };

  const handleConfirmRename = () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError(CATEGORY_EMPTY_NAME_ERROR);
      return;
    }
    if (renamingCode) {
      onRename(renamingCode, trimmed);
    }
    setRenamingCode(null);
  };

  const handleStartAdd = () => {
    setIsAdding(true);
    setNewCategoryName('');
    setAddError(null);
  };

  const handleConfirmAdd = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setAddError(CATEGORY_EMPTY_NAME_ERROR);
      return;
    }
    onAddCategory(trimmed);
    setIsAdding(false);
  };

  const handleDeleteClick = (cat: ResolvedCategoryItem) => {
    const hasCards = cards.some((c) => c.category === cat.id);
    if (hasCards) {
      setWarningMessage(CATEGORY_HAS_CARDS_WARNING);
      return;
    }
    onDelete(cat.id);
  };

  return (
    <div
      className="category-manager-pane"
      data-testid="category-manager-pane"
      data-layout={layoutMode}
    >
      <header className="category-manager-header">
        <h2 className="category-manager-title">{ORGANIZE_CATEGORIES_BUTTON}</h2>
        {layoutMode !== 'phone-portrait' && (
          <button
            type="button"
            className="category-manager-done-btn"
            onClick={onDone}
            data-testid="category-manager-header-done-btn"
          >
            {EDIT_CARD_DONE}
          </button>
        )}
      </header>

      <div className="category-manager-body">
        <ul className="category-manager-list" data-testid="category-manager-list">
          {categories.map((cat, index) => {
            const count = cards.filter((c) => c.category === cat.id).length;
            const isFirst = index === 0;
            const isLast = index === categories.length - 1;

            return (
              <li
                key={cat.id}
                className="category-manager-item"
                data-testid={`category-manager-item-${cat.id}`}
              >
                <span className="category-manager-name">{cat.name}</span>

                {cat.isBuiltin && (
                  <span
                    className="category-builtin-badge"
                    aria-label={CATEGORY_BUILTIN_ARIA}
                    title={CATEGORY_BUILTIN_ARIA}
                    data-testid={`category-builtin-${cat.id}`}
                  >
                    {CATEGORY_BUILTIN_BADGE}
                  </span>
                )}

                <span className="category-manager-count">{count} 張</span>

                <div className="category-manager-btn-group">
                  {cat.isCustom && (
                    <>
                      <button
                        type="button"
                        className="category-action-icon-btn"
                        onClick={() => handleStartRename(cat)}
                        aria-label={`${CATEGORY_RENAME} ${cat.name}`}
                        data-testid={`category-rename-btn-${cat.id}`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="category-action-icon-btn category-action-delete"
                        onClick={() => handleDeleteClick(cat)}
                        disabled={count > 0}
                        title={count > 0 ? CATEGORY_HAS_CARDS_WARNING : undefined}
                        aria-label={
                          count > 0
                            ? `${CATEGORY_DELETE} ${cat.name}（${CATEGORY_HAS_CARDS_WARNING}）`
                            : `${CATEGORY_DELETE} ${cat.name}`
                        }
                        data-testid={`category-delete-btn-${cat.id}`}
                      >
                        🗑
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className="category-action-icon-btn"
                    onClick={() => onMoveUp(cat.id)}
                    disabled={isFirst}
                    aria-label={`${CATEGORY_MOVE_UP} ${cat.name}`}
                    data-testid={`category-move-up-btn-${cat.id}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="category-action-icon-btn"
                    onClick={() => onMoveDown(cat.id)}
                    disabled={isLast}
                    aria-label={`${CATEGORY_MOVE_DOWN} ${cat.name}`}
                    data-testid={`category-move-down-btn-${cat.id}`}
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="category-manager-hint">{CATEGORY_MANAGER_HINT}</p>
      </div>

      <footer className="category-manager-footer">
        <button
          type="button"
          className="category-add-btn"
          onClick={handleStartAdd}
          data-testid="category-manager-add-btn"
        >
          <span>+</span>
          <span>{ADD_CATEGORY_BUTTON}</span>
        </button>

        <button
          type="button"
          className="category-manager-done-btn"
          onClick={onDone}
          data-testid="category-manager-done-btn"
        >
          {EDIT_CARD_DONE}
        </button>
      </footer>

      {/* 改名對話框 */}
      {renamingCode && (
        <div className="category-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="category-dialog-card">
            <h3 className="category-dialog-title">{CATEGORY_RENAME}</h3>
            <input
              type="text"
              className="category-dialog-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={CATEGORY_NAME_PLACEHOLDER}
              data-testid="category-rename-input"
              autoFocus
            />
            {renameError && <p className="color-error-text">{renameError}</p>}
            <div className="category-dialog-actions">
              <button
                type="button"
                className="category-dialog-btn category-dialog-cancel"
                onClick={() => setRenamingCode(null)}
              >
                {EDIT_CARD_CANCEL}
              </button>
              <button
                type="button"
                className="category-dialog-btn category-dialog-primary"
                onClick={handleConfirmRename}
                data-testid="category-rename-confirm-btn"
              >
                {EDIT_CARD_DONE}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增分類對話框 */}
      {isAdding && (
        <div className="category-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="category-dialog-card">
            <h3 className="category-dialog-title">{ADD_CATEGORY_BUTTON}</h3>
            <input
              type="text"
              className="category-dialog-input"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={CATEGORY_NAME_PLACEHOLDER}
              data-testid="category-add-input"
              autoFocus
            />
            {addError && <p className="color-error-text">{addError}</p>}
            <div className="category-dialog-actions">
              <button
                type="button"
                className="category-dialog-btn category-dialog-cancel"
                onClick={() => setIsAdding(false)}
              >
                {EDIT_CARD_CANCEL}
              </button>
              <button
                type="button"
                className="category-dialog-btn category-dialog-primary"
                onClick={handleConfirmAdd}
                data-testid="category-add-confirm-btn"
              >
                {ADD_CATEGORY_BUTTON}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 有卡片警告對話框 */}
      {warningMessage && (
        <div className="category-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="category-dialog-card">
            <h3 className="category-dialog-title">無法刪除分類</h3>
            <p style={{ margin: 0, lineHeight: 1.5 }}>{warningMessage}</p>
            <div className="category-dialog-actions">
              <button
                type="button"
                className="category-dialog-btn category-dialog-primary"
                onClick={() => setWarningMessage(null)}
                data-testid="category-warning-dismiss-btn"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
