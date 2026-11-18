import { useEffect, useReducer, useRef } from 'react';
import type { ChapterNode } from '../data/demo';
import {
  EXPORT_CANCEL,
  EXPORT_COLLAPSE,
  EXPORT_CONFIRM,
  EXPORT_DEVICE_FAIL,
  EXPORT_DIALOG_TITLE,
  EXPORT_EXPAND,
  EXPORT_FORMAT_DOCX,
  EXPORT_FORMAT_LEGEND,
  EXPORT_FORMAT_TXT,
  EXPORT_NO_CHAPTERS,
  EXPORT_PARTIAL_LABEL,
  EXPORT_PICK_CHAPTERS,
  EXPORT_PICKER_CANCEL,
  EXPORT_PICKER_DONE,
  EXPORT_PICKER_TITLE,
  EXPORT_READY_HINT,
  EXPORT_SAVE_FILE,
  EXPORT_SCOPE_ALL,
  EXPORT_SCOPE_LEGEND,
  EXPORT_SCOPE_SELECTED,
  EXPORT_SELECT_ALL,
  EXPORT_SELECT_NONE,
  EXPORT_WORKING,
  exportSelectionSummary,
} from '../copy/userFacing';
import { checkStateOf, type ExportFormat, type ExportScope } from '../domain/fullTextExport';
import { nodeTypeLabel } from '../domain/labels';
import type { FullTextExportOutcome, FullTextExportRequest, PreparedExport } from '../state/sampleStore';
import {
  countSelected,
  exportDialogReducer,
  exportDisabled,
  initialExportDialogState,
  pickerRows,
  standingMessage,
  type ExportDialogState,
} from './exportDialogModel';
import './importExport.css';

const MESSAGE_TEXT = {
  'no-chapters': EXPORT_NO_CHAPTERS,
  'device-fail': EXPORT_DEVICE_FAIL,
} as const;

/**
 * WO-103：檔案頁「匯出全文」打開的選單（暫定，交九方審）。
 * 同一個可捲動選單：上方可捲動內容，下方固定操作列（不蓋住內容）。自選章節在同一個框裡切換畫面。
 */
export function ExportDialog({
  projectId,
  nodes,
  onClose,
  onExport,
  initialState,
}: {
  projectId: string;
  nodes: readonly ChapterNode[];
  onClose: () => void;
  onExport: (
    request: FullTextExportRequest,
    options: { prepared?: PreparedExport; isCancelled: () => boolean },
  ) => Promise<FullTextExportOutcome>;
  /** 測試用：直接放入某個畫面狀態。 */
  initialState?: Partial<ExportDialogState>;
}) {
  const [state, send] = useReducer(exportDialogReducer, initialState, (overrides) => initialExportDialogState(overrides));
  const cancelledRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    send({ type: 'sync-nodes', nodes });
  }, [nodes]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [state.view]);

  const close = () => {
    cancelledRef.current = true;
    onClose();
  };

  const runExport = async (prepared?: PreparedExport) => {
    if (state.busy) return;
    if (!prepared && exportDisabled(state, nodes)) return;
    send({ type: 'start' });
    const outcome = await onExport(
      { projectId, format: state.format, scope: state.scope, selected: state.selected },
      { prepared, isCancelled: () => cancelledRef.current },
    );
    if (cancelledRef.current) return;
    if (outcome.kind === 'delivered') {
      send({ type: 'finish', outcome: 'delivered' });
      onClose();
      return;
    }
    if (outcome.kind === 'needs-gesture') {
      send({ type: 'finish', outcome: 'needs-gesture', prepared: outcome.prepared });
      return;
    }
    send({ type: 'finish', outcome: outcome.kind });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (state.view === 'picker') send({ type: 'picker-cancel' });
    else if (!state.busy) close();
  };

  return (
    <div className="export-dialog-backdrop" role="presentation" data-testid="export-dialog-backdrop">
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        data-testid={state.view === 'menu' ? 'export-dialog' : 'export-picker'}
        onKeyDown={onKeyDown}
      >
        {state.view === 'menu' ? (
          <ExportMenu state={state} nodes={nodes} titleRef={titleRef} send={send} />
        ) : (
          <ExportPicker state={state} nodes={nodes} titleRef={titleRef} send={send} />
        )}
        <div className="export-dialog-actions" data-testid="export-dialog-actions">
          {state.view === 'menu' ? (
            <>
              <button
                type="button"
                className="button secondary"
                data-testid="export-cancel"
                disabled={state.busy}
                onClick={close}
              >
                {EXPORT_CANCEL}
              </button>
              {state.prepared ? (
                <button
                  type="button"
                  className="button primary"
                  data-testid="export-save-file"
                  disabled={state.busy}
                  aria-busy={state.busy ? 'true' : undefined}
                  onClick={() => void runExport(state.prepared ?? undefined)}
                >
                  {EXPORT_SAVE_FILE}
                </button>
              ) : (
                <button
                  type="button"
                  className="button primary"
                  data-testid="export-confirm"
                  disabled={exportDisabled(state, nodes)}
                  aria-busy={state.busy ? 'true' : undefined}
                  onClick={() => void runExport()}
                >
                  {EXPORT_CONFIRM}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="button secondary"
                data-testid="export-picker-cancel"
                onClick={() => send({ type: 'picker-cancel' })}
              >
                {EXPORT_PICKER_CANCEL}
              </button>
              <button
                type="button"
                className="button primary"
                data-testid="export-picker-done"
                disabled={state.draft.size === 0}
                onClick={() => send({ type: 'picker-done' })}
              >
                {EXPORT_PICKER_DONE}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Send = (event: Parameters<typeof exportDialogReducer>[1]) => void;

function ExportMenu({
  state,
  nodes,
  titleRef,
  send,
}: {
  state: ExportDialogState;
  nodes: readonly ChapterNode[];
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  send: Send;
}) {
  const message = standingMessage(state, nodes);
  const { chapters, scenes } = countSelected(nodes, state.selected);
  const formats: Array<{ value: ExportFormat; label: string }> = [
    { value: 'docx', label: EXPORT_FORMAT_DOCX },
    { value: 'txt', label: EXPORT_FORMAT_TXT },
  ];
  const scopes: Array<{ value: ExportScope; label: string }> = [
    { value: 'all', label: EXPORT_SCOPE_ALL },
    { value: 'selected', label: EXPORT_SCOPE_SELECTED },
  ];
  return (
    <div className="export-dialog-body" data-testid="export-dialog-body">
      <h2 id="export-dialog-title" ref={titleRef} tabIndex={-1}>
        {EXPORT_DIALOG_TITLE}
      </h2>
      <fieldset className="export-fieldset" disabled={state.busy}>
        <legend>{EXPORT_FORMAT_LEGEND}</legend>
        {formats.map((item) => (
          <label key={item.value} className="export-choice" data-testid={`export-format-${item.value}`}>
            <input
              type="radio"
              name="export-format"
              value={item.value}
              checked={state.format === item.value}
              onChange={() => send({ type: 'format', format: item.value })}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="export-fieldset" disabled={state.busy}>
        <legend>{EXPORT_SCOPE_LEGEND}</legend>
        {scopes.map((item) => (
          <label key={item.value} className="export-choice" data-testid={`export-scope-${item.value}`}>
            <input
              type="radio"
              name="export-scope"
              value={item.value}
              checked={state.scope === item.value}
              onChange={() => send({ type: 'scope', scope: item.value })}
            />
            <span>{item.label}</span>
          </label>
        ))}
        {state.scope === 'selected' ? (
          <button
            type="button"
            className="export-pick-row"
            data-testid="export-open-picker"
            onClick={() => send({ type: 'open-picker' })}
          >
            <strong>{EXPORT_PICK_CHAPTERS}</strong>
            <small data-testid="export-selection-summary">{exportSelectionSummary(chapters, scenes)}</small>
          </button>
        ) : null}
      </fieldset>
      <p className="export-status" aria-live="polite" data-testid="export-status">
        {state.busy ? EXPORT_WORKING : state.prepared ? EXPORT_READY_HINT : ''}
      </p>
      {message && message !== 'empty-selection' ? (
        <p
          className={`export-message${message === 'device-fail' ? ' is-error' : ''}`}
          role={message === 'device-fail' ? 'alert' : 'status'}
          data-testid="export-message"
        >
          {MESSAGE_TEXT[message]}
        </p>
      ) : null}
    </div>
  );
}

function ExportPicker({
  state,
  nodes,
  titleRef,
  send,
}: {
  state: ExportDialogState;
  nodes: readonly ChapterNode[];
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  send: Send;
}) {
  const rows = pickerRows(nodes, state.collapsed);
  const { chapters, scenes } = countSelected(nodes, state.draft);
  return (
    <div className="export-dialog-body" data-testid="export-picker-body">
      <h2 id="export-dialog-title" ref={titleRef} tabIndex={-1}>
        {EXPORT_PICKER_TITLE}
      </h2>
      <div className="export-picker-tools">
        <button type="button" className="button secondary" data-testid="export-select-all" onClick={() => send({ type: 'select-all', nodes })}>
          {EXPORT_SELECT_ALL}
        </button>
        <button type="button" className="button secondary" data-testid="export-select-none" onClick={() => send({ type: 'select-none' })}>
          {EXPORT_SELECT_NONE}
        </button>
      </div>
      <p className="export-message" role="status" data-testid="export-picker-summary">
        {exportSelectionSummary(chapters, scenes)}
      </p>
      <ul className="export-tree" data-testid="export-tree">
        {rows.map(({ node, depth, hasChildren, expanded }) => {
          const check = checkStateOf(node, state.draft);
          const typeLabel = nodeTypeLabel(node.type);
          const ariaChecked = check === 'checked' ? 'true' : check === 'partial' ? 'mixed' : 'false';
          return (
            <li
              key={node.id}
              className={`export-tree-row is-${node.type}`}
              style={{ paddingInlineStart: `${depth * 20}px` }}
              data-testid={`export-row-${node.id}`}
              data-check={check}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={ariaChecked}
                className={`export-check is-${check}`}
                data-testid={`export-check-${node.id}`}
                aria-label={`${typeLabel}　${node.title}${check === 'partial' ? `，${EXPORT_PARTIAL_LABEL}` : ''}`}
                onClick={() => send({ type: 'toggle-node', node })}
              >
                <span className="export-check-box" aria-hidden="true">
                  {check === 'checked' ? '✓' : check === 'partial' ? '－' : ''}
                </span>
                <span className="export-type-tag" aria-hidden="true">
                  {typeLabel}
                </span>
                <span className="export-node-title" aria-hidden="true">
                  {node.title}
                </span>
              </button>
              {hasChildren ? (
                <button
                  type="button"
                  className="export-expand"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? EXPORT_COLLAPSE : EXPORT_EXPAND}　${node.title}`}
                  data-testid={`export-expand-${node.id}`}
                  onClick={() => send({ type: 'toggle-expand', id: node.id })}
                >
                  <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
