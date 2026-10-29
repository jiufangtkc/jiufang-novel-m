import { NavLink, useLocation } from 'react-router-dom';
import { CardsIcon, ChartIcon, FolderIcon, GearIcon, PenIcon } from './Icons';

const TABS = [
  { id: 'write', label: '寫作', icon: PenIcon },
  { id: 'cards', label: '資料集', icon: CardsIcon },
  { id: 'files', label: '檔案', icon: FolderIcon },
  { id: 'stats', label: '統計', icon: ChartIcon },
  { id: 'settings', label: '設定', icon: GearIcon },
] as const;

function isTabActive(tab: string, pathname: string): boolean {
  if (tab === 'write') return pathname.includes('/write');
  if (tab === 'stats') return pathname.includes('/stats') || pathname.includes('/logs');
  return pathname.includes(`/${tab}`);
}

export function AppNav({ projectId, variant }: { projectId: string; variant: 'bottom' | 'rail' }) {
  const { pathname } = useLocation();
  return (
    <nav className={variant === 'bottom' ? 'bottom-nav' : 'nav-rail'} aria-label="主要導覽" data-testid={variant === 'bottom' ? 'bottom-nav' : 'nav-rail'}>
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = isTabActive(tab.id, pathname);
        return (
          <NavLink
            key={tab.id}
            to={`/p/${projectId}/${tab.id}`}
            aria-current={active ? 'page' : undefined}
            data-testid={`nav-${tab.id}`}
          >
            <span className="nav-icon">
              <Icon />
            </span>
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
