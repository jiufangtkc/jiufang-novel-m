import { useNavigate } from 'react-router-dom';
import { BookmarkIcon, ChevronIcon, FileIcon, FolderIcon, MoreIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import type { ChapterNode } from '../data/demo';

export function ChapterTree({
  projectId,
  nodes,
  depth,
  selectedId,
  onToggle,
  onMore,
}: {
  projectId: string;
  nodes: readonly ChapterNode[];
  depth: number;
  selectedId?: string;
  onToggle: (id: string) => void;
  onMore: (id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        const hasChildren = Boolean(node.children?.length);
        return (
          <li key={node.id}>
            <div
              className={node.id === selectedId ? 'tree-row is-selected' : 'tree-row'}
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              <button
                type="button"
                className="tree-main"
                onClick={() => {
                  if (node.type === 'folder') onToggle(node.id);
                  else navigate(`/p/${projectId}/write/${node.id}`);
                }}
              >
                {hasChildren ? (
                  <ChevronIcon expanded={Boolean(node.expanded)} />
                ) : (
                  <span className="chevron-spacer" />
                )}
                <span className={`tree-icon type-${node.type}`}>
                  {node.type === 'folder' ? (
                    <FolderIcon size={20} />
                  ) : node.type === 'scene' ? (
                    <BookmarkIcon size={20} />
                  ) : (
                    <FileIcon size={20} />
                  )}
                </span>
                <span className={node.type === 'folder' ? 'folder-name' : 'node-name'}>{node.title}</span>
              </button>
              {node.progress && <StatusBadge code={node.progress} />}
              <button
                type="button"
                className="icon-button"
                aria-label={`${node.title}的更多操作`}
                onClick={() => onMore(node.id)}
              >
                <MoreIcon size={18} />
              </button>
            </div>
            {hasChildren && node.expanded && (
              <ChapterTree
                projectId={projectId}
                nodes={node.children ?? []}
                depth={depth + 1}
                selectedId={selectedId}
                onToggle={onToggle}
                onMore={onMore}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
