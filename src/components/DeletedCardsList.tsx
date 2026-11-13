import { BackIcon } from './Icons';
import {
  DELETED_CARDS_EMPTY,
  DELETED_CARDS_TITLE,
  deletedCardsListHint,
  PUT_BACK_ORIGINAL_BUTTON,
} from '../copy/cardEditCopy';
import { BACK_TO_CATEGORIES_ARIA, displayCardTitle } from '../copy/userFacing';
import type { DeletedCardRecord } from '../domain/cardArchive';
import type { LayoutMode } from '../layout/layoutMode';
import './deletedCardsList.css';

export interface DeletedCardsListProps {
  deletedCards: readonly DeletedCardRecord[];
  categories: readonly { id: string; name: string }[];
  onRestore: (record: DeletedCardRecord) => void;
  onBack: () => void;
  device?: string | boolean;
  layoutMode?: LayoutMode;
}

export function DeletedCardsList({
  deletedCards,
  categories,
  onRestore,
  onBack,
  device = '這支手機',
  layoutMode = 'phone-portrait',
}: DeletedCardsListProps) {
  const getCategoryName = (catId: string) => {
    return categories.find((c) => c.id === catId)?.name ?? '未知分類';
  };

  const formatDeletedTime = (timestamp?: number) => {
    if (!timestamp) return '剛剛';
    const diffMs = Date.now() - timestamp;
    if (diffMs < 60000) return '剛剛';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins} 分鐘前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小時前`;
    return '幾天前';
  };

  return (
    <div
      className="deleted-cards-pane"
      data-testid="deleted-cards-pane"
      data-layout={layoutMode}
    >
      <header className="deleted-cards-header">
        <button
          type="button"
          className="icon-button"
          aria-label={BACK_TO_CATEGORIES_ARIA}
          onClick={onBack}
          data-testid="deleted-cards-back-btn"
        >
          <BackIcon />
        </button>
        <h2 className="deleted-cards-title">{DELETED_CARDS_TITLE}</h2>
      </header>

      <div className="deleted-cards-body">
        <p className="deleted-cards-hint" data-testid="deleted-cards-hint">
          {deletedCardsListHint(device)}
        </p>

        {deletedCards.length === 0 ? (
          <p className="empty-note" data-testid="deleted-cards-empty">
            {DELETED_CARDS_EMPTY}
          </p>
        ) : (
          <ul className="deleted-cards-list" data-testid="deleted-cards-list">
            {deletedCards.map((record) => {
              const subcardCount = Math.max(0, (record.cards?.length ?? 1) - 1);
              const catName = getCategoryName(record.category);
              const timeText = formatDeletedTime(record.deletedAt);

              return (
                <li
                  key={record.id}
                  className="deleted-card-item"
                  data-testid={`deleted-card-item-${record.id}`}
                >
                  <div className="deleted-card-info">
                    <span className="deleted-card-title">
                      {displayCardTitle(record.title)}
                    </span>
                    <div className="deleted-card-meta">
                      <span>{catName}</span>
                      {subcardCount > 0 && <span>· 含 {subcardCount} 張子卡片</span>}
                      <span>· {timeText}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="deleted-card-restore-btn"
                    onClick={() => onRestore(record)}
                    data-testid={`restore-card-btn-${record.id}`}
                  >
                    <span>↺</span>
                    <span>{PUT_BACK_ORIGINAL_BUTTON}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
