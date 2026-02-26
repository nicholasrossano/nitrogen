'use client';

import { LayoutGrid, Trash2, LogOut, MessageSquare } from 'lucide-react';

export type NavItem = 'chat' | 'projects' | 'trash';

interface SideDrawerProps {
  activeItem: NavItem;
  onItemSelect: (item: NavItem) => void;
  /** When false, header is rendered by parent for alignment; only nav is shown */
  includeHeader?: boolean;
  /** When true, adds a bottom accent border to the header cell only */
  headerBottomBorder?: boolean;
  onSignOut?: () => void;
  userEmail?: string | null;
}

/** Renders just the Account header cell for use in a shared header row */
export function SideDrawerHeader({ bottomBorder = false }: { bottomBorder?: boolean }) {
  return (
    <div className={`w-44 h-[72px] px-4 pb-2 flex items-end shrink-0 bg-white border-r-1 border-accent${bottomBorder ? ' border-b-1 border-b-accent' : ''}`}>
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-full bg-accent-wash border-1 border-accent-tint flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-medium text-accent-anchor">A</span>
        </div>
        <span className="text-sm text-text-secondary">Account</span>
      </div>
    </div>
  );
}

export function SideDrawer({ activeItem, onItemSelect, includeHeader = true, headerBottomBorder = false, onSignOut, userEmail }: SideDrawerProps) {
  return (
    <aside className="w-44 bg-white border-r-1 border-accent min-h-screen flex flex-col flex-shrink-0">
      {includeHeader && <SideDrawerHeader bottomBorder={headerBottomBorder} />}

      {/* Navigation items */}
      <nav className="flex-1 bg-white">
        <button
          onClick={() => onItemSelect('chat')}
          className={`nav-row w-full ${activeItem === 'chat' ? 'nav-row-active' : ''}`}
        >
          <MessageSquare
            className="w-4 h-4 flex-shrink-0"
            {...(activeItem === 'chat' && { fill: 'currentColor' })}
          />
          <span>Chat</span>
        </button>

        <button
          onClick={() => onItemSelect('projects')}
          className={`nav-row w-full ${activeItem === 'projects' ? 'nav-row-active' : ''}`}
        >
          <LayoutGrid
            className="w-4 h-4 flex-shrink-0"
            {...(activeItem === 'projects' && { fill: 'currentColor' })}
          />
          <span>Projects</span>
        </button>

        <button
          onClick={() => onItemSelect('trash')}
          className={`nav-row w-full ${activeItem === 'trash' ? 'nav-row-active' : ''}`}
        >
          <Trash2
            className="w-4 h-4 flex-shrink-0"
            {...(activeItem === 'trash' && { fill: 'currentColor' })}
          />
          <span>Trash</span>
        </button>

        {onSignOut && (
          <button
            onClick={onSignOut}
            className="nav-row w-full"
            title={userEmail || 'Log out'}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>Log out</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
