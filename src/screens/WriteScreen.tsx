import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FilePlusIcon, FolderPlusIcon } from '../components/Icons';
import { findNode } from '../data/demo';
import { NODE_TYPE_LABELS, PROGRESS_ORDER, progressLabel } from '../domain/labels';
import { useProject, useSample } from '../state/sampleStore';
import { ChapterTree } from './ChapterTree';
import { EditorPane } from './EditorPane';

export function WriteScreen() {
  const { projectId = '', chapterId } = useParams();
  const project = useProject(projectId);
  const { actions } = useSample();
  const [menuId, setMenuId] = useState<string | null>(null);
  if (!project) return <p className="empty-note">找不到這個專案。</p>;
  const menuNode = menuId ? findNode(project.nodes, menuId) : null;
  const chapter = chapterId ? findNode(project.nodes, chapterId) : null;

  return (
    <div className={chapterId ? 'write-layout has-chapter' : 'write-layout'} data-testid="write-screen">
      <section className="tree-pane" data-testid="chapter-tree">
        <header className="topbar">
          <h1>{project.title}</h1>
          <button
            type="button"
            className="icon-button"
            aria-label="新增卷"
            onClick={() => actions.toast('新增卷會在下一階段開放')}
          >
            <FolderPlusIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="新增章"
            onClick={() => actions.toast('新增章會在下一階段開放')}
          >
            <FilePlusIcon />
          </button>
        </header>
        <div className="scroll-pane">
          <ChapterTree
            projectId={project.id}
            nodes={project.nodes}
            depth={0}
            selectedId={chapterId}
            onToggle={(id) => actions.toggleNode(project.id, id)}
            onMore={setMenuId}
          />
        </div>
      </section>
      <section className="editor-pane">
        {chapter ? (
          <EditorPane projectId={project.id} chapter={chapter} />
        ) : chapterId ? (
          <div className="editor-empty">
            <p>找不到這一章。</p>
          </div>
        ) : (
          <div className="editor-empty wide-hint">
            <p>點左邊的章或幕開始寫作。</p>
          </div>
        )}
      </section>
      {menuNode && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setMenuId(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-labelledby="node-menu-title"
            data-testid="node-menu"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="node-menu-title">{menuNode.title}</h2>
            <p className="hint">型別：{NODE_TYPE_LABELS[menuNode.type]}</p>
            {menuNode.type !== 'folder' && (
              <div className="menu-list">
                {PROGRESS_ORDER.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={menuNode.progress === code ? 'menu-item is-current' : 'menu-item'}
                    onClick={() => {
                      actions.setProgress(project.id, menuNode.id, code);
                      setMenuId(null);
                    }}
                  >
                    {progressLabel(code)}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                actions.toast(
                  menuNode.type === 'file' ? '在此章新增幕會在下一階段開放' : '調整目錄結構會在下一階段開放',
                );
                setMenuId(null);
              }}
            >
              {menuNode.type === 'file' ? '在此章新增幕' : '調整目錄結構'}
            </button>
            <p className="hint">進度標記依九方定案顯示。存檔時仍使用原本的英文代碼。</p>
          </div>
        </div>
      )}
    </div>
  );
}
