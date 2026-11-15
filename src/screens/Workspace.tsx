import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { MANUSCRIPT_NOT_FOUND } from '../copy/userFacing';
import { AppNav, showsLandscapeRail } from '../components/AppNav';
import { useLayout } from '../layout';
import { useProject, useSample } from '../state/sampleStore';

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
  if (!project) {
    return (
      <div className="page">
        <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>
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
