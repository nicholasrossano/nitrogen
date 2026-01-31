'use client';

import { useEffect, useRef } from 'react';
import { X, FolderOpen, Trash2 } from 'lucide-react';

export type NavItem = 'projects' | 'trash';

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeItem: NavItem;
  onItemSelect: (item: NavItem) => void;
}

export function SideDrawer({ isOpen, onClose, activeItem, onItemSelect }: SideDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Handle escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const handleItemClick = (item: NavItem) => {
    onItemSelect(item);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 left-0 h-full w-64 bg-surface border-r border-stroke-subtle z-50 shadow-lg transform transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="px-4 py-4 flex items-center justify-between border-b border-divider">
          <span className="text-sm font-medium text-text-primary">Navigation</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation items */}
        <nav className="p-3">
          <button
            onClick={() => handleItemClick('projects')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-left transition-colors ${
              activeItem === 'projects'
                ? 'bg-accent-wash text-accent-anchor'
                : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
            }`}
          >
            <FolderOpen className="w-5 h-5" />
            <span className="font-medium">Projects</span>
          </button>

          <button
            onClick={() => handleItemClick('trash')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-left transition-colors mt-1 ${
              activeItem === 'trash'
                ? 'bg-accent-wash text-accent-anchor'
                : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
            }`}
          >
            <Trash2 className="w-5 h-5" />
            <span className="font-medium">Trash</span>
          </button>
        </nav>
      </div>
    </>
  );
}
