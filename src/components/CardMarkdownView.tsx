import React from 'react';
import './cardMarkdown.css';
import {
  EMPTY_CARD_CONTENT_MESSAGE,
  parseCardMarkdown,
  renderCardMarkdownToNodes,
} from './cardMarkdown';

export interface CardMarkdownViewProps {
  /** 卡片文字內容 */
  content: string;
  /** 外層容器額外樣式類別 */
  className?: string;
}

/**
 * 卡片排版預覽元件（WO-47）
 * 將卡片內容解析排版為易於閱讀的格式，同時以語法樹轉譯方式杜絕惡意腳本執行。
 * 畫面上絕不出現「Markdown」字樣。
 */
export const CardMarkdownView: React.FC<CardMarkdownViewProps> = ({
  content,
  className,
}) => {
  const trimmed = typeof content === 'string' ? content.trim() : '';

  if (!trimmed) {
    return (
      <div
        className={`card-md-view card-md-empty ${className || ''}`.trim()}
        data-empty-view="true"
      >
        <span className="card-md-empty-text">{EMPTY_CARD_CONTENT_MESSAGE}</span>
      </div>
    );
  }

  const tokens = parseCardMarkdown(content);
  const renderedNodes = renderCardMarkdownToNodes(tokens);

  return (
    <div className={`card-md-view ${className || ''}`.trim()}>
      {renderedNodes}
    </div>
  );
};

export default CardMarkdownView;
