'use client';

import { LayoutGrid, Trash2 } from 'lucide-react';

export type NavItem = 'projects' | 'trash';

interface SideDrawerProps {
  activeItem: NavItem;
  onItemSelect: (item: NavItem) => void;
}

export function SideDrawer({ activeItem, onItemSelect }: SideDrawerProps) {
  return (
    <aside className="w-56 bg-white border-r border-accent min-h-screen flex flex-col flex-shrink-0">
      {/* Account - top left, bottom-aligned within header cell */}
      <div className="h-[72px] px-4 pb-2 flex items-end border-b border-accent shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-accent-wash border border-accent-tint flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-medium text-accent-anchor">A</span>
          </div>
          <span className="text-sm text-text-secondary">Account</span>
        </div>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 bg-white">
        <button
          onClick={() => onItemSelect('projects')}
          className={`nav-row w-full ${activeItem === 'projects' ? 'nav-row-active' : ''}`}
        >
          <LayoutGrid className="w-4 h-4 flex-shrink-0" />
          <span>Projects</span>
        </button>

        <button
          onClick={() => onItemSelect('trash')}
          className={`nav-row w-full ${activeItem === 'trash' ? 'nav-row-active' : ''}`}
        >
          <Trash2 className="w-4 h-4 flex-shrink-0" />
          <span>Trash</span>
        </button>
      </nav>
    </aside>
  );
}
