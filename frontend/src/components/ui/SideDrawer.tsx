'use client';

import { LayoutGrid, Trash2, LogOut, Map, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = 'home' | 'trash' | 'plan' | 'chat';
export type SideDrawerVariant = 'home' | 'project';

interface NavItemConfig {
  key: NavItem;
  label: string;
  Icon: LucideIcon;
}

interface SideDrawerProps {
  variant: SideDrawerVariant;
  activeItem: NavItem;
  onItemSelect: (item: NavItem) => void;
  onSignOut?: () => void;
  userEmail?: string | null;
}

const HOME_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Projects', Icon: LayoutGrid },
  { key: 'trash', label: 'Trash', Icon: Trash2 },
];

const PROJECT_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Projects', Icon: LayoutGrid },
  { key: 'plan', label: 'Plan', Icon: Map },
  { key: 'chat', label: 'Chat', Icon: MessageSquare },
];

export function SideDrawer({ variant, activeItem, onItemSelect, onSignOut, userEmail }: SideDrawerProps) {
  const items = variant === 'home' ? HOME_ITEMS : PROJECT_ITEMS;

  return (
    <aside className="group w-12 hover:w-44 h-full flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out">
      <nav className="flex-1 pt-1">
        {items.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => onItemSelect(key)}
            className={`nav-row w-full ${activeItem === key ? 'nav-row-active' : ''}`}
          >
            <Icon
              className="w-4 h-4 flex-shrink-0"
              {...(activeItem === key && { fill: 'currentColor' })}
            />
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
              {label}
            </span>
          </button>
        ))}

        {onSignOut && (
          <button
            onClick={onSignOut}
            className="nav-row w-full"
            title={userEmail || 'Log out'}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
              Log out
            </span>
          </button>
        )}
      </nav>
    </aside>
  );
}
