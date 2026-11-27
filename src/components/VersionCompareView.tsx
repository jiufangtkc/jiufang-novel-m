import {
  VERSION_COMPARE_COMPOSING_TOAST,
  VERSION_COMPARE_CONTENT_ARIA,
  VERSION_COMPARE_LEGEND_ADDED,
  VERSION_COMPARE_LEGEND_REMOVED,
  VERSION_COMPARE_NO_DIFF_HINT,
  VERSION_COMPARE_READONLY_HINT,
  versionCompareCollapsedLabel,
  versionCompareMetaLabel,
  versionCompareSummary,
} from '../copy/manuscriptVersionCopy';
import type { ManuscriptVersion } from '../domain/manuscriptVersions';
import type { CompareParagraph, VersionCompareResult } from '../domain/versionCompare';

export type OpenCompareAttempt =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string };

/** 檢查按下「比較」時是否正在輸入法組字中；組字中不開啟比較頁並提示先打完字。 */
export function resolveOpenCompareAttempt(isComposing: () => boolean): OpenCompareAttempt {
  if (isComposing()) {
    return { allowed: false, message: VERSION_COMPARE_COMPOSING_TOAST };
  }
  return { allowed: true };
}

export interface VersionCompareViewProps {
  version: ManuscriptVersion;
  versionTimeLabel: string;
  diff: VersionCompareResult;
  expandedBlockIds: ReadonlySet<string>;
  onExpandBlock: (blockId: string) => void;
}

function renderParagraph(paragraph: CompareParagraph) {
  const classes = [
    'version-compare-para',
    paragraph.isBlank ? 'is-blank' : '',
    paragraph.kind !== 'unchanged' ? `is-${paragraph.kind}` : 'is-unchanged',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <p
      key={paragraph.id}
      className={classes}
      data-testid={`version-compare-para-${paragraph.id}`}
      data-diff-kind={paragraph.kind}
    >
      {paragraph.segments.length === 0 ? (
        '\u00A0'
      ) : (
        paragraph.segments.map((seg, idx) => {
          if (seg.kind === 'remove') {
            return (
              <del key={`${paragraph.id}-seg-${idx}`} className="version-compare-del">
                {seg.text}
              </del>
            );
          }
          if (seg.kind === 'add') {
            return (
              <ins key={`${paragraph.id}-seg-${idx}`} className="version-compare-ins">
                {seg.text}
              </ins>
            );
          }
          return <span key={`${paragraph.id}-seg-${idx}`}>{seg.text}</span>;
        })
      )}
    </p>
  );
}

/**
 * WO-141 新舊版比較唯讀檢視：
 * - 單欄對照：舊版有、現在沒有的字以灰色加劃線標示；現在有、舊版沒有的字以主題色加底色標示。
 * - 頁面上方顯示「多了／少了／改了段數」小結。
 * - 連續未改段落收合為「中間 N 段沒改，點一下展開」，點一下即可展開原文。
 */
export function VersionCompareView({
  version,
  versionTimeLabel,
  diff,
  expandedBlockIds,
  onExpandBlock,
}: VersionCompareViewProps) {
  return (
    <div className="version-compare-pane" data-testid="version-compare-pane">
      <div className="version-compare-meta" data-testid="version-compare-meta">
        {versionCompareMetaLabel(versionTimeLabel, version.note)}
      </div>

      <p className="version-compare-summary" data-testid="version-compare-summary">
        {versionCompareSummary(diff.addedWords, diff.removedWords, diff.changedParagraphs)}
      </p>

      <div className="version-compare-legend" data-testid="version-compare-legend">
        <span className="version-compare-legend-items">
          <del className="version-compare-del">{VERSION_COMPARE_LEGEND_REMOVED}</del>
          <ins className="version-compare-ins">{VERSION_COMPARE_LEGEND_ADDED}</ins>
        </span>
        <span className="hint version-compare-readonly-hint">{VERSION_COMPARE_READONLY_HINT}</span>
      </div>

      {!diff.hasChanges ? (
        <p className="version-compare-no-diff" data-testid="version-compare-no-diff">
          {VERSION_COMPARE_NO_DIFF_HINT}
        </p>
      ) : null}

      <div
        className="version-compare-body"
        role="region"
        aria-label={VERSION_COMPARE_CONTENT_ARIA}
        data-testid="version-compare-body"
      >
        {diff.displayItems.map((item) => {
          if (item.type === 'collapsed') {
            if (expandedBlockIds.has(item.id)) {
              return (
                <div
                  key={item.id}
                  className="version-compare-expanded-group"
                  data-testid={`version-compare-expanded-${item.id}`}
                >
                  {item.paragraphs.map((para) => renderParagraph(para))}
                </div>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                className="version-compare-collapse-btn"
                aria-expanded="false"
                data-testid={`version-compare-collapsed-${item.id}`}
                onClick={() => onExpandBlock(item.id)}
              >
                {versionCompareCollapsedLabel(item.hiddenParagraphCount)}
              </button>
            );
          }
          return renderParagraph(item.paragraph);
        })}
      </div>
    </div>
  );
}
