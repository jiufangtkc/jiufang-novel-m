import React from 'react';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { EMPTY_CARD_CONTENT_MESSAGE } from '../copy/userFacing';

export { EMPTY_CARD_CONTENT_MESSAGE };

/**
 * 檢查連結網址是否為允許的安全通訊協定（http:、https:、mailto:）。
 * 嚴格阻絕 javascript:、data:、vbscript:、file: 等不安全協定，
 * 且依工單規格僅允許 http:、https:、mailto:，排除相對路徑以防止非預期跳轉。
 */
export function isSafeUrl(rawUrl: string | undefined | null): boolean {
  if (!rawUrl) return false;

  // 移除前後空白與所有不可見控制字元，防止以控制字元混淆協定名稱
  const cleaned = rawUrl.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, '');
  if (!cleaned) return false;

  // 檢查是否以允許的通訊協定開頭（不分大小寫）
  const match = cleaned.match(/^([a-zA-Z0-9+.-]+):/);
  if (!match) {
    return false;
  }

  const protocol = match[1].toLowerCase();
  if (protocol !== 'http' && protocol !== 'https' && protocol !== 'mailto') {
    return false;
  }

  // 嘗試以標準 URL 建構子驗證格式
  try {
    const parsed = new URL(cleaned);
    const parsedProto = parsed.protocol.toLowerCase();
    return parsedProto === 'http:' || parsedProto === 'https:' || parsedProto === 'mailto:';
  } catch {
    // 若為 mailto: 且符合基礎格式，允許通過
    if (protocol === 'mailto' && /^mailto:[^\s@]+@[^\s@]+(\?[^\s]*)?$/i.test(cleaned)) {
      return true;
    }
    return false;
  }
}

/**
 * 將輸入的卡片文字解析為語法節點清單（Tokens）。
 * 啟用 GFM（支援表格、刪除線等）與換行（breaks）。
 */
export function parseCardMarkdown(content: string): Token[] {
  if (!content) return [];
  return marked.lexer(content, {
    gfm: true,
    breaks: true,
  });
}

/**
 * 將語法節點（Tokens）安全地遞迴轉為 React 元素。
 * 完全不使用 dangerouslySetInnerHTML，原始 HTML 一律作為純文字節點呈現。
 * 圖片語法不輸出 <img> 標籤，僅輸出替代文字（Alt text）。
 * 使用 React.createElement 以確保純 .ts 環境亦能免 JSX 語法錯誤執行。
 */
export function renderCardMarkdownToNodes(
  tokens: Token[],
  keyPrefix = 'card-md',
): React.ReactNode[] {
  if (!tokens || tokens.length === 0) return [];

  const nodes: React.ReactNode[] = [];

  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (token.type) {
      case 'heading': {
        const headingToken = token as Tokens.Heading;
        const children = headingToken.tokens
          ? renderCardMarkdownToNodes(headingToken.tokens, `${key}-h`)
          : headingToken.text;

        const tag =
          headingToken.depth === 1
            ? 'h1'
            : headingToken.depth === 2
              ? 'h2'
              : 'h3';
        const className =
          headingToken.depth === 1
            ? 'card-md-h1'
            : headingToken.depth === 2
              ? 'card-md-h2'
              : 'card-md-h3';

        nodes.push(
          React.createElement(tag, { key, className }, children),
        );
        break;
      }

      case 'paragraph': {
        const paragraphToken = token as Tokens.Paragraph;
        const children = paragraphToken.tokens
          ? renderCardMarkdownToNodes(paragraphToken.tokens, `${key}-p`)
          : paragraphToken.text;
        nodes.push(
          React.createElement('p', { key, className: 'card-md-p' }, children),
        );
        break;
      }

      case 'blockquote': {
        const blockquoteToken = token as Tokens.Blockquote;
        const children = blockquoteToken.tokens
          ? renderCardMarkdownToNodes(blockquoteToken.tokens, `${key}-bq`)
          : blockquoteToken.text;
        nodes.push(
          React.createElement('blockquote', { key, className: 'card-md-blockquote' }, children),
        );
        break;
      }

      case 'list': {
        const listToken = token as Tokens.List;
        const listItems = listToken.items.map((item, itemIdx) => {
          const itemKey = `${key}-li-${itemIdx}`;
          const itemChildren =
            item.tokens && item.tokens.length > 0
              ? renderCardMarkdownToNodes(item.tokens, `${itemKey}-c`)
              : item.text;

          const itemContents: React.ReactNode[] = [];
          if (item.task) {
            itemContents.push(
              React.createElement('input', {
                key: `${itemKey}-chk`,
                type: 'checkbox',
                checked: Boolean(item.checked),
                disabled: true,
                readOnly: true,
                'aria-hidden': 'true',
                className: 'card-md-checkbox',
              }),
            );
          }
          itemContents.push(itemChildren);

          return React.createElement(
            'li',
            { key: itemKey, className: 'card-md-li' },
            itemContents,
          );
        });

        const listTag = listToken.ordered ? 'ol' : 'ul';
        const listClass = listToken.ordered ? 'card-md-ol' : 'card-md-ul';
        const startNum =
          listToken.ordered &&
          typeof listToken.start === 'number' &&
          listToken.start !== 1
            ? listToken.start
            : undefined;

        nodes.push(
          React.createElement(
            listTag,
            { key, start: startNum, className: listClass },
            listItems,
          ),
        );
        break;
      }

      case 'code': {
        const codeToken = token as Tokens.Code;
        const codeElement = React.createElement(
          'code',
          { className: codeToken.lang ? `language-${codeToken.lang}` : undefined },
          codeToken.text,
        );
        nodes.push(
          React.createElement('pre', { key, className: 'card-md-code-block' }, codeElement),
        );
        break;
      }

      case 'table': {
        const tableToken = token as Tokens.Table;
        const thElements = tableToken.header.map((cell, cIdx) => {
          const cellChildren =
            cell.tokens && cell.tokens.length > 0
              ? renderCardMarkdownToNodes(cell.tokens, `${key}-th-${cIdx}`)
              : cell.text;
          return React.createElement(
            'th',
            {
              key: `${key}-th-${cIdx}`,
              style: cell.align ? { textAlign: cell.align } : undefined,
              className: 'card-md-th',
            },
            cellChildren,
          );
        });

        const trElements = tableToken.rows.map((row, rIdx) => {
          const tdElements = row.map((cell, cIdx) => {
            const cellChildren =
              cell.tokens && cell.tokens.length > 0
                ? renderCardMarkdownToNodes(cell.tokens, `${key}-td-${rIdx}-${cIdx}`)
                : cell.text;
            return React.createElement(
              'td',
              {
                key: `${key}-td-${rIdx}-${cIdx}`,
                style: cell.align ? { textAlign: cell.align } : undefined,
                className: 'card-md-td',
              },
              cellChildren,
            );
          });
          return React.createElement(
            'tr',
            { key: `${key}-tr-${rIdx}`, className: 'card-md-tr' },
            tdElements,
          );
        });

        const thead = React.createElement(
          'thead',
          null,
          React.createElement('tr', null, thElements),
        );
        const tbody = React.createElement('tbody', null, trElements);
        const table = React.createElement(
          'table',
          { className: 'card-md-table' },
          thead,
          tbody,
        );

        nodes.push(
          React.createElement('div', { key, className: 'card-md-table-wrap' }, table),
        );
        break;
      }

      case 'hr': {
        nodes.push(React.createElement('hr', { key, className: 'card-md-hr' }));
        break;
      }

      case 'space': {
        // 區塊間空白不額外產生 DOM 節點
        break;
      }

      case 'html': {
        // 原始 HTML 安全處理：以純文字節點呈現，不插入真實 HTML 標籤
        const htmlToken = token as Tokens.HTML;
        nodes.push(
          React.createElement('span', { key, className: 'card-md-raw-html' }, htmlToken.text),
        );
        break;
      }

      case 'strong': {
        const strongToken = token as Tokens.Strong;
        const children = strongToken.tokens
          ? renderCardMarkdownToNodes(strongToken.tokens, `${key}-s`)
          : strongToken.text;
        nodes.push(
          React.createElement('strong', { key, className: 'card-md-strong' }, children),
        );
        break;
      }

      case 'em': {
        const emToken = token as Tokens.Em;
        const children = emToken.tokens
          ? renderCardMarkdownToNodes(emToken.tokens, `${key}-em`)
          : emToken.text;
        nodes.push(
          React.createElement('em', { key, className: 'card-md-em' }, children),
        );
        break;
      }

      case 'del': {
        const delToken = token as Tokens.Del;
        const children = delToken.tokens
          ? renderCardMarkdownToNodes(delToken.tokens, `${key}-del`)
          : delToken.text;
        nodes.push(
          React.createElement('del', { key, className: 'card-md-del' }, children),
        );
        break;
      }

      case 'codespan': {
        const codespanToken = token as Tokens.Codespan;
        nodes.push(
          React.createElement('code', { key, className: 'card-md-codespan' }, codespanToken.text),
        );
        break;
      }

      case 'link': {
        const linkToken = token as Tokens.Link;
        const children =
          linkToken.tokens && linkToken.tokens.length > 0
            ? renderCardMarkdownToNodes(linkToken.tokens, `${key}-link`)
            : linkToken.text;

        if (isSafeUrl(linkToken.href)) {
          nodes.push(
            React.createElement(
              'a',
              {
                key,
                href: linkToken.href,
                title: linkToken.title || undefined,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'card-md-link',
              },
              children,
            ),
          );
        } else {
          // 不安全連結（例如 javascript: 或相對路徑）不產生可點選 <a> 標籤
          nodes.push(
            React.createElement(
              'span',
              {
                key,
                className: 'card-md-unsafe-link',
                'data-unsafe-link': 'true',
                title: linkToken.title || undefined,
              },
              children,
            ),
          );
        }
        break;
      }

      case 'image': {
        // 依視覺設計意見：不顯示圖片，圖片語法改顯示替代文字
        const imageToken = token as Tokens.Image;
        const altText =
          imageToken.text ||
          (imageToken.tokens && imageToken.tokens.length > 0
            ? renderCardMarkdownToNodes(imageToken.tokens, `${key}-imgalt`)
            : '');
        nodes.push(
          React.createElement(
            'span',
            { key, className: 'card-md-image-alt', 'data-image-alt': 'true' },
            altText,
          ),
        );
        break;
      }

      case 'br': {
        nodes.push(React.createElement('br', { key, className: 'card-md-br' }));
        break;
      }

      case 'text': {
        const textToken = token as Tokens.Text;
        if (textToken.tokens && textToken.tokens.length > 0) {
          nodes.push(
            React.createElement(
              React.Fragment,
              { key },
              renderCardMarkdownToNodes(textToken.tokens, `${key}-t`),
            ),
          );
        } else {
          nodes.push(textToken.text);
        }
        break;
      }

      case 'escape': {
        const escapeToken = token as Tokens.Escape;
        nodes.push(escapeToken.text);
        break;
      }

      case 'def': {
        // 參考連結定義不直接輸出
        break;
      }

      default: {
        const genericToken = token as any;
        if (genericToken.tokens && genericToken.tokens.length > 0) {
          nodes.push(
            React.createElement(
              React.Fragment,
              { key },
              renderCardMarkdownToNodes(genericToken.tokens, `${key}-gen`),
            ),
          );
        } else if (typeof genericToken.text === 'string') {
          nodes.push(genericToken.text);
        }
        break;
      }
    }
  });

  return nodes;
}
