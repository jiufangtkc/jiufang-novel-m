import { useEffect, useRef } from 'react';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { AppNav, showsLandscapeRail } from '../components/AppNav';
import { useLayout } from '../layout';
import { IMPORT_RECORD_NOT_SAVED_NOTICE } from '../copy/userFacing';
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
    // WO-102：匯入後「次數沒記下」的提示是在導向新稿子之後才要被看到，不在這次換頁時清掉
    if (state.toast != null) {
      if (state.toast !== IMPORT_RECORD_NOT_SAVED_NOTICE) actions.toast(null);
    }
    // pathname 變更時才讀當輪的 state.toast 與 actions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
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
