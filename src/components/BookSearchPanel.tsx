/**
 * WO-63 全書搜尋畫面：搜尋框、範圍、找與取代開關、依章分組的結果、取代這處／取代全部、確認視窗與復原。
 * 四種版面共用同一個元件，只換外框：
 * - page：手機直拿整頁
 * - right：手機橫拿約 350、中等約 380 的右側面板（正文讓位）
 * - left：寬版左欄（與目錄切換）
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  BACK_TO_WRITING_ARIA,
  BODY_ONLY_NOTE,
  BOOK_SEARCH_TITLE,
  CLEAR_REPLACE_ARIA,
  CLEAR_SEARCH_ARIA,
  CONFIRM_CANCEL,
  CONFIRM_TITLE,
  CONFIRM_UNDO_HINT,
  FIND_REPLACE_TOGGLE,
  NO_CHAPTER_FOR_SCOPE,
  REPLACE_ALL,
  REPLACE_INPUT_ARIA,
  REPLACE_ONE,
  REPLACE_WITH_LABEL,
  REPLACED_MARK,
  SCOPE_BOOK,
  SCOPE_CHAPTER,
  SCOPE_GROUP_ARIA,
  SEARCH_EMPTY_HINT,
  SEARCH_INPUT_ARIA,
  SEARCH_INPUT_PLACEHOLDER,
  UNDO_DONE,
  UNDO_LAST_REPLACE,
  UNDO_SHORT,
  confirmCardsNote,
  confirmReplaceLine,
  confirmSummary,
  hitCountLabel,
  hitRowAria,
  replaceDoneMessage,
  replaceOneAria,
  searchNotFound,
  searchSummary,
  undoBarMessage,
} from '../copy/bookSearchCopy';
import { BackIcon, CloseIcon } from './Icons';
import type { BookSearchController } from './BookSearchPanelState';
import type { ReplacedMark } from './BookSearchPanelModel';
import { CardsNoteIcon, CheckIcon, SearchIcon, SwapIcon, UndoIcon } from './BookSearchPanelParts';
import './BookSearchPanel.css';

type Row =
  | { kind: 'hit'; start: number; index: number; ordinal: number; before: string; match: string; after: string }
  | { kind: 'done'; start: number; mark: ReplacedMark };

export function BookSearchPanel({
  search,
  variant,
  compact = false,
}: {
  search: BookSearchController;
  variant: 'page' | 'right' | 'left';
  /** 手機橫拿：太矮，頁首併進搜尋框那一行，確認視窗省略各章明細。 */
  compact?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = search.open && (variant !== 'page' || search.view === 'results');

  // 回結果：捲回原本的位置
  useLayoutEffect(() => {
    if (!visible || !listRef.current) return;
    listRef.current.scrollTop = search.listScroll.current;
  }, [visible, search.listScroll]);

  // 剛打開搜尋時，游標放進搜尋框（不是正文，不影響正文游標）
  const openedRef = useRef(false);
  useEffect(() => {
    if (search.open && !openedRef.current) {
      openedRef.current = true;
      if (!search.input) inputRef.current?.focus({ preventScroll: true });
    }
    if (!search.open) openedRef.current = false;
  }, [search.open, search.input]);

  // 目前這一筆（取代這處後自動換到下一筆）捲進畫面
  useEffect(() => {
    if (!visible || search.currentIndex < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-hit-index="${search.currentIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [visible, search.currentIndex]);

  if (!search.open) return null;

  const total = search.hits.length;
  const chapterScopeEmpty = search.scope === 'chapter' && !search.hasChapter;
  const close = (
    <button
      type="button"
      className="icon-button book-search-close"
      aria-label={BACK_TO_WRITING_ARIA}
      data-testid="search-close"
      onClick={search.closeSearch}
    >
      {variant === 'page' ? <BackIcon /> : <CloseIcon size={20} />}
    </button>
  );

  const markRowsFor = (nodeId: string) => search.marks.filter((mark) => mark.nodeId === nodeId);
  const groupIds = new Set(search.groups.map((group) => group.nodeId));
  // 只剩「已取代」的章也要留著顯示
  const extraGroups: { nodeId: string; title: string }[] = [];
  for (const mark of search.marks) {
    if (groupIds.has(mark.nodeId) || extraGroups.some((g) => g.nodeId === mark.nodeId)) continue;
    const title = search.record?.entries.find((entry) => entry.nodeId === mark.nodeId)?.title ?? '';
    extraGroups.push({ nodeId: mark.nodeId, title });
  }

  const renderGroup = (nodeId: string, title: string, rowsIn: Row[]) => {
    const rows = rowsIn.sort((a, b) => a.start - b.start);
    const hitCount = rows.filter((row) => row.kind === 'hit').length;
    const doneCount = rows.length - hitCount;
    return (
      <section key={nodeId} className="book-search-group" data-testid="search-group" data-node-id={nodeId}>
        <h3 className="book-search-group-head">
          <span className="book-search-group-title">{title}</span>
          <span className="book-search-group-count" data-testid="search-group-count">
            {hitCount === 0 && doneCount > 0 ? `${REPLACED_MARK} ${hitCountLabel(doneCount)}` : hitCountLabel(hitCount)}
          </span>
        </h3>
        {rows.map((row) =>
          row.kind === 'hit' ? (
            <div
              key={`h-${row.index}`}
              className={row.index === search.currentIndex ? 'book-search-row is-current' : 'book-search-row'}
              data-hit-index={row.index}
            >
              <button
                type="button"
                className="book-search-hit"
                data-testid="search-hit"
                aria-label={hitRowAria(title, row.ordinal + 1, row.before, row.match, row.after)}
                aria-current={row.index === search.currentIndex ? 'true' : undefined}
                onPointerDown={(event) => search.guardDown(event, () => search.jumpTo({ nodeId, ordinal: row.ordinal }))}
                onClick={() => search.guardClick(() => search.jumpTo({ nodeId, ordinal: row.ordinal }))}
              >
                {row.before ? '…' : ''}
                {row.before}
                <mark className="book-search-match">{row.match}</mark>
                {row.after}
                {row.after ? '…' : ''}
              </button>
              {search.replaceOpen ? (
                <button
                  type="button"
                  className="book-search-replace-one"
                  data-testid="replace-one"
                  aria-label={replaceOneAria(title, row.ordinal + 1)}
                  onClick={() => search.replaceOneAt({ nodeId, ordinal: row.ordinal })}
                >
                  {REPLACE_ONE}
                </button>
              ) : null}
            </div>
          ) : (
            <div key={`d-${row.mark.recordId}-${row.start}`} className="book-search-row is-done" data-testid="search-replaced">
              <p className="book-search-hit is-done">
                {row.mark.before ? '…' : ''}
                {row.mark.before}
                <s className="book-search-old">{row.mark.original}</s>
                <mark className="book-search-new">{row.mark.replacement}</mark>
                {row.mark.after}
                {row.mark.after ? '…' : ''}
              </p>
              <span className="book-search-done-tag">{REPLACED_MARK}</span>
            </div>
          ),
        )}
      </section>
    );
  };

  let body: ReactNode;
  if (chapterScopeEmpty) {
    body = <p className="book-search-hint">{NO_CHAPTER_FOR_SCOPE}</p>;
  } else if (!search.query.trim()) {
    body = <p className="book-search-hint">{SEARCH_EMPTY_HINT}</p>;
  } else if (total === 0 && search.marks.length === 0) {
    body = (
      <p className="book-search-hint" role="status">
        {searchNotFound(search.query)}
      </p>
    );
  } else {
    body = (
      <>
        {search.groups.map((group) =>
          renderGroup(group.nodeId, group.title, [
            ...group.hits.map<Row>((item) => ({
              kind: 'hit',
              start: item.hit.start,
              index: item.index,
              ordinal: item.ordinal,
              before: item.hit.before,
              match: item.hit.match,
              after: item.hit.after,
            })),
            ...markRowsFor(group.nodeId).map<Row>((mark) => ({ kind: 'done', start: mark.start, mark })),
          ]),
        )}
        {extraGroups.map((group) =>
          renderGroup(
            group.nodeId,
            group.title,
            markRowsFor(group.nodeId).map<Row>((mark) => ({ kind: 'done', start: mark.start, mark })),
          ),
        )}
      </>
    );
  }

  return (
    <section
      className={`book-search-panel is-${variant}${compact ? ' is-compact' : ''}`}
      data-testid="book-search-panel"
      data-variant={variant}
      aria-label={BOOK_SEARCH_TITLE}
      hidden={!visible}
    >
      {variant !== 'left' && !compact ? (
        <header className="book-search-header">
          {variant === 'page' ? close : null}
          <h2>{BOOK_SEARCH_TITLE}</h2>
          {variant === 'right' ? close : null}
        </header>
      ) : null}
      <div className="book-search-top">
        <div className="book-search-field">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="search"
            value={search.input}
            placeholder={SEARCH_INPUT_PLACEHOLDER}
            aria-label={SEARCH_INPUT_ARIA}
            data-testid="search-input"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              search.setInput(event.currentTarget.value, (event.nativeEvent as InputEvent).isComposing === true)
            }
            onCompositionEnd={(event) => search.commitInput(event.currentTarget.value)}
          />
          {search.input ? (
            <button
              type="button"
              className="book-search-clear"
              aria-label={CLEAR_SEARCH_ARIA}
              onClick={() => search.commitInput('')}
            >
              <CloseIcon size={18} />
            </button>
          ) : null}
          {compact && variant === 'right' ? close : null}
        </div>
        {search.replaceOpen ? (
          <label className="book-search-field is-replace">
            <span className="book-search-field-label">{REPLACE_WITH_LABEL}</span>
            <input
              type="text"
              value={search.replacement}
              aria-label={REPLACE_INPUT_ARIA}
              data-testid="replace-input"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => search.setReplacement(event.currentTarget.value)}
            />
            {search.replacement ? (
              <button
                type="button"
                className="book-search-clear"
                aria-label={CLEAR_REPLACE_ARIA}
                onClick={() => search.setReplacement('')}
              >
                <CloseIcon size={18} />
              </button>
            ) : null}
          </label>
        ) : null}
        <div className="book-search-options">
          <div className="book-search-scope" role="radiogroup" aria-label={SCOPE_GROUP_ARIA}>
            {(['book', 'chapter'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={search.scope === scope}
                className={search.scope === scope ? 'book-search-chip is-on' : 'book-search-chip'}
                data-testid={scope === 'book' ? 'scope-book' : 'scope-chapter'}
                onClick={() => search.setScope(scope)}
              >
                {scope === 'book' ? SCOPE_BOOK : SCOPE_CHAPTER}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={search.replaceOpen ? 'book-search-chip is-on' : 'book-search-chip'}
            aria-pressed={search.replaceOpen}
            data-testid="find-replace-toggle"
            onClick={search.toggleReplace}
          >
            <SwapIcon size={16} />
            {FIND_REPLACE_TOGGLE}
          </button>
          <span className="book-search-summary" data-testid="search-summary" role="status">
            {search.query.trim() && !chapterScopeEmpty ? searchSummary(total, search.chapters) : ''}
          </span>
        </div>
        <p className="book-search-note" data-testid="body-only-note">
          <CardsNoteIcon size={16} />
          {BODY_ONLY_NOTE}
        </p>
        {search.record ? (
          <div className="book-search-undo-bar" data-testid="search-undo-bar">
            <CheckIcon size={16} />
            <span className="book-search-undo-text">
              {undoBarMessage(search.record.total, search.record.query, search.record.replacement)}
            </span>
            <button type="button" className="book-search-undo" data-testid="undo-last-replace" onClick={search.undo}>
              <UndoIcon size={16} />
              {UNDO_LAST_REPLACE}
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="book-search-results"
        ref={listRef}
        data-testid="search-results"
        onScroll={(event) => {
          search.listScroll.current = event.currentTarget.scrollTop;
        }}
      >
        {body}
      </div>
      <footer className="book-search-dock">
        {search.done ? (
          <div className="book-search-done" data-testid="replace-done" role="status" key={search.done.token}>
            {search.done.kind === 'replaced' ? (
              <>
                <span>{replaceDoneMessage(search.done.total, search.done.chapters)}</span>
                {search.record ? (
                  <button type="button" className="book-search-undo" data-testid="undo-from-notice" onClick={search.undo}>
                    <UndoIcon size={16} />
                    {UNDO_SHORT}
                  </button>
                ) : null}
              </>
            ) : (
              <span>{UNDO_DONE}</span>
            )}
          </div>
        ) : null}
        {search.replaceOpen ? (
          <button
            type="button"
            className="book-search-replace-all"
            data-testid="replace-all"
            disabled={total === 0}
            onClick={search.requestReplaceAll}
          >
            <SwapIcon size={18} />
            {REPLACE_ALL}
          </button>
        ) : null}
      </footer>
      {search.confirmOpen ? <ConfirmReplaceAll search={search} compact={compact} /> : null}
    </section>
  );
}

function ConfirmReplaceAll({ search, compact }: { search: BookSearchController; compact: boolean }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="sheet-backdrop book-search-backdrop" role="presentation" onClick={search.cancelReplaceAll}>
      <div
        className="dialog book-search-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-search-confirm-title"
        data-testid="replace-all-confirm"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            search.cancelReplaceAll();
          } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            search.confirmReplaceAll();
          }
        }}
      >
        <h2 id="book-search-confirm-title">{CONFIRM_TITLE}</h2>
        <p>{confirmReplaceLine(search.query, search.replacement)}</p>
        <p className="book-search-confirm-total" data-testid="confirm-summary">
          {confirmSummary(search.hits.length, search.chapters)}
        </p>
        {compact ? null : (
          <ul className="book-search-confirm-list" data-testid="confirm-chapters">
            {search.groups.map((group) => (
              <li key={group.nodeId}>
                <span>{group.title}</span>
                <span>{hitCountLabel(group.hits.length)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="book-search-note" data-testid="confirm-cards-note">
          <CardsNoteIcon size={16} />
          {confirmCardsNote(search.confirmExample)}
        </p>
        <p className="hint">{CONFIRM_UNDO_HINT}</p>
        <div className="dialog-actions">
          <button type="button" className="button secondary" data-testid="confirm-cancel" onClick={search.cancelReplaceAll}>
            {CONFIRM_CANCEL}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="button primary"
            data-testid="confirm-replace-all"
            onClick={search.confirmReplaceAll}
          >
            {REPLACE_ALL}
          </button>
        </div>
      </div>
    </div>
  );
}
