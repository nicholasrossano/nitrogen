'use client';

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LayoutGrid, Trash2, LogOut, Map, Zap, FileUp, X, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProjectMaterial } from '@/lib/api';

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
  materials?: ProjectMaterial[];
  onUploadMaterial?: (file: File) => Promise<void>;
  onDeleteMaterial?: (materialId: string) => Promise<void>;
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

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  csv: 'CSV',
  xlsx: 'XLSX',
  xls: 'XLS',
  png: 'PNG',
  jpg: 'JPG',
};

export function SideDrawer({
  variant,
  activeItem,
  onItemSelect,
  onSignOut,
  userEmail,
  materials = [],
  onUploadMaterial,
  onDeleteMaterial,
}: SideDrawerProps) {
  const items = variant === 'home' ? HOME_ITEMS : PROJECT_ITEMS;
  const showMaterials = variant === 'project' && !!onUploadMaterial;
  const longestLabelLength = useMemo(() => {
    const labels = items.map((item) => item.label);
    if (onSignOut) labels.push('Log out');
    return Math.max(0, ...labels.map((label) => label.length));
  }, [items, onSignOut]);
  const drawerStyle = {
    '--side-drawer-expanded-width': `calc(${longestLabelLength}ch + 3.75rem)`,
  } as CSSProperties;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    if (!onUploadMaterial) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await onUploadMaterial(file);
      }
    } finally {
      setUploading(false);
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
      className="group w-12 hover:w-[var(--side-drawer-expanded-width)] max-w-[16rem] h-full flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
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
            <span className="opacity-0 group-hover:opacity-100 group-hover:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
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
            className="group-hover:opacity-0 group-hover:pointer-events-none transition-opacity duration-150 flex items-center justify-center w-8 h-8 rounded text-text-tertiary hover:text-text-secondary hover:bg-white/40"
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
            className="absolute bottom-2 left-2 right-2 flex flex-col gap-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-hover:delay-[200ms] transition-opacity duration-150"
          >
            {/* Uploaded file list */}
            {materials.length > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
                {materials.map((mat) => (
                  <div
                    key={mat.id}
                    className="group/file flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-white/40 transition-colors duration-100"
                  >
                    <span className="text-[10px] font-medium text-text-tertiary uppercase flex-shrink-0 w-6 text-center whitespace-nowrap">
                      {FILE_TYPE_LABELS[mat.file_type] || mat.file_type}
                    </span>
                    <span className="flex-1 text-xs text-text-secondary truncate" title={mat.filename}>
                      {mat.filename}
                    </span>
                    {onDeleteMaterial && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteMaterial(mat.id); }}
                        className="flex-shrink-0 p-0.5 rounded text-text-tertiary hover:text-red-400 opacity-0 group-hover/file:opacity-100 transition-all duration-100"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

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
                {isDragging ? 'Drop files' : 'Drop files or click'}
              </span>
            </div>
          </div>
        </div>
      )}
      {onSignOut && (
        <div className="pb-1">
          <button
            onClick={onSignOut}
            className="nav-row w-full"
            title={userEmail || 'Log out'}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className="opacity-0 group-hover:opacity-100 group-hover:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
              Log out
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
