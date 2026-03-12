'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LayoutGrid, Trash2, LogOut, Map, Zap, FileUp, FolderOpen, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { UploadToast, UploadItem } from './UploadToast';

export type NavItem = 'home' | 'trash' | 'plan' | 'files' | 'chat';
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
  onUploadMaterial?: (file: File) => Promise<void>;
  hiddenItems?: NavItem[];
}

const HOME_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Projects', Icon: LayoutGrid },
  { key: 'trash', label: 'Trash', Icon: Trash2 },
];

const PROJECT_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Projects', Icon: LayoutGrid },
  { key: 'plan', label: 'Plan', Icon: Map },
  { key: 'chat', label: 'Generate', Icon: Zap },
];

export function SideDrawer({
  variant,
  activeItem,
  onItemSelect,
  onSignOut,
  userEmail,
  onUploadMaterial,
  hiddenItems,
}: SideDrawerProps) {
  const allItems = variant === 'home' ? HOME_ITEMS : PROJECT_ITEMS;
  const items = hiddenItems ? allItems.filter(i => !hiddenItems.includes(i.key)) : allItems;
  const showMaterials = variant === 'project' && !!onUploadMaterial;
  const showFilesButton = variant === 'project';
  const longestLabelLength = useMemo(() => {
    const labels = items.map((item) => item.label);
    if (showFilesButton) labels.push('Files');
    if (onSignOut) labels.push('Log out');
    return Math.max(0, ...labels.map((label) => label.length));
  }, [items, showFilesButton, onSignOut]);
  const drawerStyle = {
    '--side-drawer-expanded-width': `calc(${longestLabelLength}ch + 3.75rem)`,
  } as CSSProperties;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [toastItems, setToastItems] = useState<UploadItem[]>([]);
  const [showToast, setShowToast] = useState(false);
  const dragCounter = useRef(0);
  const globalDragCounter = useRef(0);

  useEffect(() => {
    if (!showMaterials) return;

    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        globalDragCounter.current += 1;
        setIsGlobalDragging(true);
      }
    };
    const onDragLeave = () => {
      globalDragCounter.current -= 1;
      if (globalDragCounter.current <= 0) {
        globalDragCounter.current = 0;
        setIsGlobalDragging(false);
      }
    };
    const onReset = () => {
      globalDragCounter.current = 0;
      setIsGlobalDragging(false);
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onReset);
    document.addEventListener('dragend', onReset);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onReset);
      document.removeEventListener('dragend', onReset);
    };
  }, [showMaterials]);

  const uploading = toastItems.some((i) => i.status === 'uploading');

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    if (!onUploadMaterial) return;

    const fileArray = Array.from(files);
    const initial: UploadItem[] = fileArray.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      filename: f.name,
      status: 'uploading',
    }));
    setToastItems(initial);
    setShowToast(true);

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const item = initial[i];
      try {
        await onUploadMaterial(file);
        setToastItems((prev) =>
          prev.map((t) => t.id === item.id ? { ...t, status: 'done' } : t)
        );
      } catch (err) {
        setToastItems((prev) =>
          prev.map((t) =>
            t.id === item.id
              ? { ...t, status: 'error', errorMessage: err instanceof Error ? err.message : 'Upload failed' }
              : t
          )
        );
      }
    }
  }, [onUploadMaterial]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files);
      e.target.value = '';
    }
  }, [handleUpload]);

  return (
    <aside
      data-open={isGlobalDragging || undefined}
      className="group w-12 hover:w-[var(--side-drawer-expanded-width)] data-[open]:w-[var(--side-drawer-expanded-width)] max-w-[16rem] h-full flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out pb-2"
      style={drawerStyle}
    >
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
            <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
              {label}
            </span>
          </button>
        ))}
      </nav>

      {showMaterials && (
        <div className="relative px-2 pb-0">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={handleFileChange}
          />

          {/* Collapsed: icon pinned at bottom-left, fades out when expanded */}
          <button
            onClick={handleFileSelect}
            className="group-hover:opacity-0 group-data-[open]:opacity-0 group-hover:pointer-events-none group-data-[open]:pointer-events-none transition-opacity duration-150 flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:bg-white/40"
            title="Upload files"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileUp className="w-4 h-4" />
            )}
          </button>

          {/* Expanded: absolutely positioned so it doesn't push the icon up when invisible */}
          <div
            className="absolute bottom-2 left-2 right-2 flex flex-col gap-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:pointer-events-auto group-data-[open]:pointer-events-auto group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150"
          >
            {/* Upload header */}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1">Upload Files</span>

            {/* Drop zone */}
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={handleFileSelect}
              className={`
                flex flex-col items-center justify-center gap-2 min-h-[180px] px-2 rounded-lg cursor-pointer
                border border-dashed transition-colors duration-150
                ${isDragging
                  ? 'border-accent/60 bg-accent-wash/60 text-accent'
                  : 'border-[#c8c4be] bg-black/[0.04] hover:border-[#aaa69f] hover:bg-black/[0.07]'
                }
              `}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 text-text-secondary animate-spin" />
              ) : (
                <FileUp className={`w-4 h-4 ${isDragging ? 'text-accent' : 'text-text-secondary'}`} />
              )}
              <span className={`text-[11px] text-center leading-tight ${isDragging ? 'text-accent' : 'text-text-secondary'}`}>
                {isDragging ? 'Drop files' : 'Upload files'}
              </span>
            </div>
          </div>
        </div>
      )}
      {showFilesButton && (
        <button
          onClick={() => onItemSelect('files')}
          className={`nav-row w-full ${activeItem === 'files' ? 'nav-row-active' : ''}`}
        >
          <FolderOpen
            className="w-4 h-4 flex-shrink-0"
            {...(activeItem === 'files' && { fill: 'currentColor' })}
          />
          <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
            Files
          </span>
        </button>
      )}

      {onSignOut && (
        <button
          onClick={onSignOut}
          className="nav-row w-full"
          title={userEmail || 'Log out'}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
            Log out
          </span>
        </button>
      )}

      {showToast && (
        <UploadToast
          items={toastItems}
          onDismiss={() => {
            setShowToast(false);
            setToastItems([]);
          }}
        />
      )}
    </aside>
  );
}
