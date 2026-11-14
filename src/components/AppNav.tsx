import { Link, useLocation } from 'react-router-dom';
import { CardsIcon, ChartIcon, FolderIcon, GearIcon, PenIcon } from './Icons';
import { useLayout } from '../layout';

const TABS = [
  { id: 'write', label: '寫作', icon: PenIcon },
  { id: 'cards', label: '資料集', icon: CardsIcon },
  { id: 'files', label: '檔案', icon: FolderIcon },
  { id: 'stats', label: '統計', icon: ChartIcon },
  { id: 'settings', label: '設定', icon: GearIcon },
] as const;

export function isTabActive(tab: string, pathname: string): boolean {
  if (tab === 'write') return pathname.includes('/write');
  if (tab === 'stats') return pathname.includes('/stats') || pathname.includes('/logs');
  if (tab === 'settings') return pathname.includes('/settings') || pathname.includes('/font-license');
  return pathname.includes(`/${tab}`);
}

/**
 * WO-68：手機橫拿何時顯示左側直排分頁。
 * 寫作頁只在目錄頁（尚未進章）或目錄抽屜打開時顯示，打字時仍只留正文；
 * 資料集、檔案、統計、紀錄、設定等其他分頁一律顯示，確保回得了寫作或目錄。
 */
export function showsLandscapeRail(pathname: string, chapterTreeOpen: boolean): boolean {
  const match = /\/p\/[^/]+\/write(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return true;
  const inChapter = Boolean(match[1]);
  return !inChapter || chapterTreeOpen;
}

export function AppNav({ projectId, variant }: { projectId: string; variant: 'bottom' | 'rail' }) {
  const { pathname } = useLocation();
  const { focusMode } = useLayout();

  if (focusMode) return null;

  return (
    <nav className={variant === 'bottom' ? 'bottom-nav' : 'nav-rail'} aria-label="主要導覽" data-testid={variant === 'bottom' ? 'bottom-nav' : 'nav-rail'}>
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = isTabActive(tab.id, pathname);
        return (
          <Link
            key={tab.id}
            to={`/p/${projectId}/${tab.id}`}
            aria-current={active ? 'page' : undefined}
            data-nav-active={active ? 'true' : undefined}
            data-testid={`nav-${tab.id}`}
          >
            <span className="nav-icon">
              <Icon />
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
