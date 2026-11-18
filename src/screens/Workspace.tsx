import { useEffect, useRef } from 'react';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { AppNav, showsLandscapeRail } from '../components/AppNav';
import { useLayout } from '../layout';
import { useProject, useSample } from '../state/sampleStore';
import { createSaveShortcutHandler, hasOpenDialog } from './saveShortcuts';

export function Workspace() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const { state, actions } = useSample();
  const { pathname } = useLocation();
  const previousPathnameRef = useRef(pathname);
  const { mode, sidePanels } = useLayout();
  // WO-68：手機橫拿在目錄抽屜左邊與其他分頁顯示直排分頁
  const landscapeRail = mode === 'phone-landscape' && showsLandscapeRail(pathname, sidePanels.left);
  useEffect(() => {
    if (project) actions.focusProject(project.id);
  }, [project, actions]);

  // WO-93：路徑真的變了且畫面上還有提示時才清掉；不依賴 actions，避免每輪 state 更新重跑
  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (state.toast != null) {
      actions.toast(null);
    }
    // pathname 變更時才讀當輪的 state.toast 與 actions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  // WO-114：Ctrl/Cmd+S 儲存、Ctrl/Cmd+Shift+S 另存（capture，正文與卡片輸入框內也收得到）
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    if (!project) return;
    const handler = createSaveShortcutHandler({
      getActions: () => actionsRef.current,
      isDialogOpen: () => hasOpenDialog(),
    });
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [project?.id]);
  if (!project) {
    return (
      <div className="page">
        <ManuscriptNotFound />
      </div>
    );
  }
  return (
    <div className="workspace" data-landscape-rail={landscapeRail ? 'show' : undefined}>
      <AppNav projectId={project.id} variant="rail" />
      <div className="workspace-body">
        <Outlet />
      </div>
      <AppNav projectId={project.id} variant="bottom" />
    </div>
  );
}
