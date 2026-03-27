'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LayoutGrid, Trash2, LogOut, Map, Zap, FileUp, FolderOpen, Loader2, FlaskConical, Scale, Settings, HardDriveDownload, RefreshCw, Unlink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { UploadToast, UploadItem } from './UploadToast';
import { DuplicateFileDialog, DuplicateEntry } from './DuplicateFileDialog';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { useBillingStore } from '@/stores/billingStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { extractFilesFromDrop, filterSupportedFiles, checkDuplicates, SUPPORTED_EXTENSIONS } from '@/lib/fileUtils';
import { openGooglePicker } from '@/lib/googlePicker';

export type NavItem = 'home' | 'compare' | 'trash' | 'plan' | 'files' | 'chat' | 'evaluate';
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
  initiativeId?: string;
}

const HOME_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Projects', Icon: LayoutGrid },
  { key: 'compare', label: 'Compare', Icon: Scale },
  { key: 'trash', label: 'Trash', Icon: Trash2 },
];

const PROJECT_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Projects', Icon: LayoutGrid },
  { key: 'plan', label: 'Plan', Icon: Map },
  { key: 'evaluate', label: 'Evaluate', Icon: FlaskConical },
  { key: 'chat', label: 'Generate', Icon: Zap },
];

function UsagePill() {
  const devMode = useSettingsStore((s) => s.devMode);
  const { tier, usagePercent, trialMessagesRemaining, loaded } = useBillingStore();
  if (!devMode || !loaded || tier === 'unlimited' || tier === 'byok' || tier === 'none' || !tier) return null;

  const barColor = usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-accent';

  if (tier === 'trial' && trialMessagesRemaining != null) {
    return (
      <div className="w-full px-1.5 opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 transition-opacity duration-150">
        <div className="text-[9px] text-text-tertiary text-center whitespace-nowrap">
          {trialMessagesRemaining} free msg{trialMessagesRemaining !== 1 ? 's' : ''} left
        </div>
      </div>
    );
  }

  if (tier === 'starter' || tier === 'pro') {
    return (
      <div className="w-full px-1.5 opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 transition-opacity duration-150">
        <div className="h-1 rounded-full bg-surface-subtle overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, usagePercent)}%` }} />
        </div>
        <div className="text-[9px] text-text-tertiary text-center mt-0.5 whitespace-nowrap">
          {Math.round(usagePercent)}% used
        </div>
      </div>
    );
  }

  return null;
}

export function SideDrawer({
  variant,
  activeItem,
  onItemSelect,
  onSignOut,
  userEmail,
  onUploadMaterial,
  hiddenItems,
  initiativeId,
}: SideDrawerProps) {
  const allItems = variant === 'home' ? HOME_ITEMS : PROJECT_ITEMS;
  const items = hiddenItems ? allItems.filter(i => !hiddenItems.includes(i.key)) : allItems;
  const showMaterials = variant === 'project' && !!onUploadMaterial;
  const showFilesButton = variant === 'project';
  const longestLabelLength = useMemo(() => {
    const labels = items.map((item) => item.label);
    if (showFilesButton) labels.push('Files');
    labels.push('Settings');
    if (onSignOut) labels.push('Log out');
    return Math.max(0, ...labels.map((label) => label.length));
  }, [items, showFilesButton, onSignOut]);
  const drawerStyle = {
    '--side-drawer-expanded-width': `calc(${longestLabelLength}ch + 3.75rem)`,
  } as CSSProperties;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [toastItems, setToastItems] = useState<UploadItem[]>([]);
  const [showToast, setShowToast] = useState(false);
  const dragCounter = useRef(0);
  const globalDragCounter = useRef(0);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const projectMaterials = useInitiativeStore((s) => s.projectMaterials);
  const importFromDrive = useInitiativeStore((s) => s.importFromDrive);

  const driveConnected = useGoogleDriveStore((s) => s.connected);
  const driveEmail = useGoogleDriveStore((s) => s.email);
  const driveStatusChecked = useGoogleDriveStore((s) => s.statusChecked);
  const checkDriveStatus = useGoogleDriveStore((s) => s.checkStatus);
  const connectDrive = useGoogleDriveStore((s) => s.connect);
  const disconnectDrive = useGoogleDriveStore((s) => s.disconnect);
  const getDriveAccessToken = useGoogleDriveStore((s) => s.getAccessToken);

  const [driveImporting, setDriveImporting] = useState(false);
  const [driveImportError, setDriveImportError] = useState<string | null>(null);

  // Check Drive status on mount (only for project variant with upload enabled)
  useEffect(() => {
    if (showMaterials && !driveStatusChecked) {
      checkDriveStatus();
    }
  }, [showMaterials, driveStatusChecked, checkDriveStatus]);

  // Detect OAuth callback redirect (?drive_connected=true) and refresh status
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.search.includes('drive_connected=true')) {
      checkDriveStatus();
      const clean = window.location.pathname + window.location.search
        .replace(/[?&]drive_connected=true/, '')
        .replace(/^&/, '?');
      window.history.replaceState(null, '', clean);
    }
  }, [checkDriveStatus]);

  const handleDriveConnect = useCallback(() => {
    if (!initiativeId) return;
    connectDrive(initiativeId);
  }, [initiativeId, connectDrive]);

  const handleDriveImport = useCallback(async () => {
    if (!initiativeId) return;
    setDriveImportError(null);
    try {
      const accessToken = await getDriveAccessToken();
      openGooglePicker(
        accessToken,
        async (files) => {
          if (files.length === 0) return;
          setDriveImporting(true);
          try {
            const fileIds = files.map((f) => f.id);
            await importFromDrive(initiativeId, fileIds);
          } catch (err) {
            setDriveImportError(err instanceof Error ? err.message : 'Import failed');
          } finally {
            setDriveImporting(false);
          }
        },
      );
    } catch (err) {
      setDriveImportError(err instanceof Error ? err.message : 'Could not open Drive picker');
    }
  }, [initiativeId, getDriveAccessToken, importFromDrive]);

  const [pendingDuplicates, setPendingDuplicates] = useState<{
    entries: DuplicateEntry[];
    filesToUpload: File[];
    cleanCount: number;
  } | null>(null);

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

  const doUpload = useCallback(async (filesToUpload: File[]) => {
    if (!onUploadMaterial) return;

    const initial: UploadItem[] = filesToUpload.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      filename: f.name,
      status: 'uploading',
    }));
    setToastItems(initial);
    setShowToast(true);

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
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

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    if (!onUploadMaterial) return;
    const fileArray = Array.from(files);
    const existingNames = projectMaterials.map((m) => m.filename);
    const results = checkDuplicates(fileArray, existingNames);

    const duplicates = results.filter((r) => r.isDuplicate);
    const clean = results.filter((r) => !r.isDuplicate).map((r) => r.file);

    if (duplicates.length > 0) {
      const renamedDuplicates = duplicates.map(
        (r) => new File([r.file], r.newName, { type: r.file.type }),
      );
      setPendingDuplicates({
        entries: duplicates.map((d) => ({ original: d.file.name, renamed: d.newName })),
        filesToUpload: renamedDuplicates,
        cleanCount: clean.length,
      });
      if (clean.length > 0) doUpload(clean);
    } else {
      doUpload(fileArray);
    }
  }, [onUploadMaterial, projectMaterials, doUpload]);

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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const all = await extractFilesFromDrop(e.dataTransfer);
    const { accepted, rejected } = filterSupportedFiles(all);
    if (rejected.length > 0) {
      console.warn('Skipped unsupported files:', rejected.join(', '));
    }
    if (accepted.length > 0) {
      handleUpload(accepted);
    }
  }, [handleUpload]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFolderSelect = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const { accepted, rejected } = filterSupportedFiles(Array.from(e.target.files));
      if (rejected.length > 0) {
        console.warn('Skipped unsupported files:', rejected.join(', '));
      }
      if (accepted.length > 0) {
        handleUpload(accepted);
      }
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
            accept={SUPPORTED_EXTENSIONS}
            multiple
            onChange={handleFileChange}
          />
          {/* Folder picker — webkitdirectory is non-standard but widely supported */}
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error webkitdirectory is non-standard
            webkitdirectory=""
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
                flex flex-col items-center justify-center gap-2 min-h-[140px] px-2 rounded-lg cursor-pointer
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
                {isDragging ? 'Drop files or folder' : 'Upload files'}
              </span>
            </div>
            <button
              onClick={handleFolderSelect}
              disabled={uploading}
              className="flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-[11px] text-text-secondary bg-black/[0.04] enabled:hover:bg-black/[0.07] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
              Select folder
            </button>

            {/* Google Drive section */}
            {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1">
                  Google Drive
                </span>

                {driveConnected ? (
                  <>
                    <button
                      onClick={handleDriveImport}
                      disabled={driveImporting}
                      className="flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-[11px] text-text-secondary bg-black/[0.04] enabled:hover:bg-black/[0.07] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {driveImporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                      ) : (
                        <HardDriveDownload className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                      {driveImporting ? 'Importing…' : 'Import'}
                    </button>
                    {driveImportError && (
                      <p className="text-[10px] text-red-400 px-1 leading-tight">{driveImportError}</p>
                    )}
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] text-text-tertiary truncate max-w-[120px]" title={driveEmail ?? ''}>
                        {driveEmail ?? 'Connected'}
                      </span>
                      <button
                        onClick={() => disconnectDrive()}
                        className="text-[10px] text-text-tertiary enabled:hover:text-red-400 transition-colors flex items-center gap-0.5"
                        title="Disconnect Google Drive"
                      >
                        <Unlink className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={handleDriveConnect}
                    disabled={!initiativeId}
                    className="flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-[11px] text-text-secondary bg-black/[0.04] enabled:hover:bg-black/[0.07] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5 flex-shrink-0" />
                    Connect
                  </button>
                )}
              </div>
            )}
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

      <UsagePill />

      <button
        onClick={() => setSettingsOpen(true)}
        className="nav-row w-full"
        title="Settings"
      >
        <Settings className="w-4 h-4 flex-shrink-0" />
        <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
          Settings
        </span>
      </button>

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

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {showToast && (
        <UploadToast
          items={toastItems}
          onDismiss={() => {
            setShowToast(false);
            setToastItems([]);
          }}
        />
      )}

      {pendingDuplicates && (
        <DuplicateFileDialog
          duplicates={pendingDuplicates.entries}
          cleanCount={pendingDuplicates.cleanCount}
          onConfirm={(selectedOriginals) => {
            const selected = new Set(selectedOriginals);
            const files = pendingDuplicates.filesToUpload.filter((_, i) =>
              selected.has(pendingDuplicates.entries[i].original),
            );
            setPendingDuplicates(null);
            if (files.length > 0) doUpload(files);
          }}
          onCancel={() => setPendingDuplicates(null)}
        />
      )}
    </aside>
  );
}
