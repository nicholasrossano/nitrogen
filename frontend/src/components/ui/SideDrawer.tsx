'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { LayoutGrid, LogOut, Map, Home, Layers3, ListChecks, FileUp, FolderOpen, Loader2, Settings, HardDriveDownload, Unlink, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { UploadToast, UploadItem } from './UploadToast';
import { DuplicateFileDialog, DuplicateEntry } from './DuplicateFileDialog';
import { ShellNavContext } from './ShellContext';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { useBillingStore } from '@/stores/billingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuth } from '@/lib/auth';
import { api, type EvidenceDoc, type ProjectMaterial } from '@/lib/api';
import { extractFilesFromDrop, filterSupportedFiles, checkDuplicates, SUPPORTED_EXTENSIONS } from '@/lib/fileUtils';
import { openGooglePicker } from '@/lib/googlePicker';
import { UploadActionButton, UploadDropzone } from '@/components/upload/UploadControls';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

export type NavItem = 'portfolio' | 'trash' | 'plan' | 'assumptions' | 'files' | 'chat' | 'research' | 'workspace';

interface NavItemConfig {
  key: NavItem;
  label: string;
  Icon: LucideIcon;
}

interface NavRenderConfig extends NavItemConfig {
  disabled?: boolean;
  disabledReason?: string;
}

const GLOBAL_ITEMS: NavItemConfig[] = [
  { key: 'portfolio', label: 'Portfolio', Icon: LayoutGrid },
];

const PROJECT_ITEMS: NavItemConfig[] = [
  { key: 'research', label: 'Overview', Icon: Home },
  { key: 'plan', label: 'Framework', Icon: Map },
  { key: 'workspace', label: 'Modules', Icon: Layers3 },
  { key: 'assumptions', label: 'Assumptions', Icon: ListChecks },
];

const INITIATIVE_RE = /^\/initiatives\/([^/]+)/;

function UsagePill() {
  const showBillingFeatures = useFeatureFlag('billing_features');
  const { tier, usagePercent, trialMessagesRemaining, loaded } = useBillingStore();
  if (!showBillingFeatures || !loaded || tier === 'unlimited' || tier === 'byok' || tier === 'none' || !tier) return null;

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

export function SideDrawer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { navHandlerRef } = useContext(ShellNavContext);
  const { user, signOut } = useAuth();

  const initiativeId = useMemo(() => {
    const m = INITIATIVE_RE.exec(pathname);
    return m ? m[1] : undefined;
  }, [pathname]);

  const activeItem: NavItem = useMemo(() => {
    if (!initiativeId) return searchParams.get('view') === 'files' ? 'files' : 'portfolio';
    const view = searchParams.get('view');
    if (view === 'research' || view === 'explore') return 'research';
    if (view === 'plan' || view === 'framework') return 'plan';
    if (view === 'assumptions') return 'assumptions';
    if (view === 'workspace' || view === 'modules') return 'workspace';
    if (view === 'files') return 'files';
    return 'research';
  }, [initiativeId, searchParams]);

  const hasProject = !!initiativeId;
  const initiative = useInitiativeStore((s) => s.initiative);
  const projectPlan = useInitiativeStore((s) => s.projectPlan);
  const isViewer = initiative?.shared_role === 'viewer';
  const hasFrameworkSelection = Boolean(
    (initiative?.selected_tools?.length ?? 0) > 0 || projectPlan || initiative?.project_plan,
  );
  const isOnboarding = Boolean(hasProject && initiative && !hasFrameworkSelection && !isViewer);
  const uploadMaterial = useInitiativeStore((s) => s.uploadMaterial);
  const {
    activeWorkspace,
    loadWorkspaces,
  } = useWorkspaceStore();

  const showMaterials = hasProject && !isViewer;
  const fileScope = hasProject ? 'project' : 'workspace';
  const fileScopeLabel = fileScope === 'workspace' ? 'Workspace files' : 'Project files';

  const projectItems: NavRenderConfig[] = (
    isViewer
      ? PROJECT_ITEMS.filter(i => !(['research', 'assumptions', 'workspace'] as NavItem[]).includes(i.key))
      : PROJECT_ITEMS
  ).map((item) => {
    const lockedDuringOnboarding = isOnboarding && item.key !== 'research';
    return {
      ...item,
      disabled: lockedDuringOnboarding,
      disabledReason: lockedDuringOnboarding ? 'Complete onboarding to unlock this area' : undefined,
    };
  });

  const filesDisabled = isOnboarding;
  const filesDisabledReason = filesDisabled ? 'Complete onboarding to unlock this area' : undefined;

  const longestLabelLength = useMemo(() => {
    const labels = GLOBAL_ITEMS.map((item) => item.label);
    projectItems.forEach((item) => labels.push(item.label));
    labels.push('Files');
    labels.push('Help');
    labels.push('Settings');
    labels.push('Log out');
    return Math.max(0, ...labels.map((label) => label.length));
  }, [projectItems]);

  const drawerStyle = {
    '--side-drawer-expanded-width': `calc(${longestLabelLength}ch + 3.75rem)`,
  } as CSSProperties;

  const handleNav = useCallback((item: NavItem) => {
    if (navHandlerRef.current?.(item)) return;
    if (item === 'files' && !hasProject) {
      router.push('/?view=files');
      return;
    }
    if (item === 'files' && hasProject && initiativeId) {
      router.replace(`/initiatives/${initiativeId}?view=files`);
      return;
    }
    if (item === 'portfolio') {
      router.push('/');
      return;
    }
  }, [hasProject, initiativeId, navHandlerRef, router]);

  const renderNavButton = useCallback(({ key, label, Icon, disabled, disabledReason }: NavRenderConfig) => (
    <button
      key={key}
      onClick={() => {
        if (disabled) return;
        handleNav(key);
      }}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled || undefined}
      className={`nav-row w-full ${activeItem === key ? 'nav-row-active' : ''} ${disabled ? 'opacity-50 cursor-not-allowed hover:text-text-secondary' : ''}`}
    >
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${activeItem === key ? '[&_*]:fill-current' : ''}`}
      />
      <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
        {label}
      </span>
    </button>
  ), [activeItem, handleNav]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.push('/');
  }, [signOut, router]);

  // --- Upload / materials logic (self-contained) ---
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
  const [workspaceMaterials, setWorkspaceMaterials] = useState<ProjectMaterial[]>([]);
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

  const evidenceToMaterial = useCallback((doc: EvidenceDoc): ProjectMaterial => ({
    id: doc.id,
    filename: doc.filename ?? 'Untitled',
    file_type: doc.file_type ?? 'unknown',
    file_size: doc.file_size ?? null,
    created_at: doc.created_at,
    source: 'evidence',
    processing_status: doc.processing_status,
    processing_error: doc.processing_error,
  }), []);

  const loadWorkspaceFiles = useCallback(async () => {
    if (!activeWorkspace) return;
    const docs = await api.getWorkspaceEvidence(activeWorkspace.id);
    setWorkspaceMaterials(docs.map(evidenceToMaterial));
  }, [activeWorkspace, evidenceToMaterial]);

  useEffect(() => {
    if (!activeWorkspace) {
      loadWorkspaces();
    }
  }, [activeWorkspace, loadWorkspaces]);

  useEffect(() => {
    if (showMaterials && !driveStatusChecked) {
      checkDriveStatus();
    }
  }, [showMaterials, driveStatusChecked, checkDriveStatus]);

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
    if (fileScope === 'project' && !initiativeId) return;
    if (fileScope === 'workspace' && !activeWorkspace) return;

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
        if (fileScope === 'workspace' && activeWorkspace) {
          const response = await api.uploadWorkspaceEvidence(activeWorkspace.id, file);
          setWorkspaceMaterials((prev) => [evidenceToMaterial(response.document), ...prev]);
        } else if (initiativeId) {
          await uploadMaterial(initiativeId, file);
        }
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
    if (fileScope === 'workspace') {
      setTimeout(() => {
        loadWorkspaceFiles().catch(() => {});
      }, 1500);
    }
  }, [activeWorkspace, evidenceToMaterial, fileScope, initiativeId, loadWorkspaceFiles, uploadMaterial]);

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    if (fileScope === 'project' && !initiativeId) return;
    if (fileScope === 'workspace' && !activeWorkspace) return;
    const fileArray = Array.from(files);
    const existingNames = (fileScope === 'workspace' ? workspaceMaterials : projectMaterials)
      .map((m) => m.filename);
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
  }, [activeWorkspace, doUpload, fileScope, initiativeId, projectMaterials, workspaceMaterials]);

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

  const gridCollapse = 'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out';
  const gridOpen = 'grid-rows-[1fr] opacity-100';
  const gridClosed = 'grid-rows-[0fr] opacity-0 pointer-events-none';

  return (
    <aside
      data-open={isGlobalDragging || undefined}
      className="group w-12 hover:w-[var(--side-drawer-expanded-width)] data-[open]:w-[var(--side-drawer-expanded-width)] max-w-[16rem] h-full flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out pb-2"
      style={drawerStyle}
    >
      {/* Spacer matches the shell header slot in the content column */}
      <div className="shrink-0 h-12" />
      <nav className="flex-1 pt-1">
        {GLOBAL_ITEMS.map((item) => renderNavButton(item))}

        {/* Project nav — always in the DOM, collapses/expands via CSS grid */}
        <div className={`${gridCollapse} ${hasProject ? gridOpen : gridClosed}`}>
          <div className="overflow-hidden">
            {/* Original header — made relative so the collapsed divider can overlay it
                without affecting layout. pt-3 pb-1 are the original values. */}
            <div className="relative px-3 pt-3 pb-1">
              {/* Collapsed-only divider — absolute, zero layout impact */}
              <div className="absolute bottom-3 left-2 right-2 h-px bg-black/[0.16] opacity-100 group-hover:opacity-0 group-data-[open]:opacity-0 transition-opacity duration-150" />
              <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
                Current Project
              </span>
            </div>
            {projectItems.map((item) => renderNavButton(item))}
          </div>
        </div>
      </nav>

      {/* Upload materials — conditionally rendered (absolute-positioned
          children are incompatible with the grid-rows collapse technique) */}
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
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error webkitdirectory is non-standard
            webkitdirectory=""
            multiple
            onChange={handleFileChange}
          />

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

          <div
            className="absolute bottom-2 left-2 right-2 flex flex-col gap-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:pointer-events-auto group-data-[open]:pointer-events-auto group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1">
              {fileScopeLabel}
            </span>

            <UploadDropzone
              isDragging={isDragging}
              uploading={uploading}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={handleFileSelect}
              dragLabel={`Drop ${fileScope} files or folder`}
              idleLabel={`Upload ${fileScope} files`}
              className="min-h-[140px] px-2"
            />
            <UploadActionButton
              onClick={handleFolderSelect}
              disabled={uploading}
              icon={<FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />}
              label="Select folder"
            />

            {fileScope === 'project' && process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
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

      {/* Files button — collapses with project items */}
      <div className={`${gridCollapse} ${(hasProject || activeWorkspace) ? gridOpen : gridClosed}`}>
        <div className="overflow-hidden">
          <button
            onClick={() => {
              if (filesDisabled) return;
              handleNav('files');
            }}
            disabled={filesDisabled}
            title={filesDisabled ? filesDisabledReason : undefined}
            aria-disabled={filesDisabled || undefined}
            className={`nav-row w-full ${activeItem === 'files' ? 'nav-row-active' : ''} ${filesDisabled ? 'opacity-50 cursor-not-allowed hover:text-text-secondary' : ''}`}
          >
            <FolderOpen
              className={`w-4 h-4 flex-shrink-0 ${activeItem === 'files' ? '[&_*]:fill-current' : ''}`}
            />
            <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
              Files
            </span>
          </button>
        </div>
      </div>

      {/* Spacer + divider below the files icon.
          h-6 creates the visual gap; top-1/2 -translate-y-1/2 centers the line
          inside that gap. Percentage insets make the divider scale proportionally
          as the drawer expands. */}
      {showMaterials && (
        <div className="relative h-6">
          <div className="absolute left-[10%] right-[10%] top-1/2 -translate-y-1/2 h-px bg-black/[0.16]" />
        </div>
      )}

      <UsagePill />

      <a
        href="https://nitrogenai.mintlify.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="nav-row w-full"
        title="Help"
      >
        <HelpCircle className="w-4 h-4 flex-shrink-0" />
        <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
          Help
        </span>
      </a>

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

      <button
        onClick={handleSignOut}
        className="nav-row w-full"
        title={user?.email || 'Log out'}
      >
        <LogOut className="w-4 h-4 flex-shrink-0" />
        <span className="opacity-0 group-hover:opacity-100 group-data-[open]:opacity-100 group-hover:delay-[200ms] group-data-[open]:delay-[200ms] transition-opacity duration-150 whitespace-nowrap">
          Log out
        </span>
      </button>

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
