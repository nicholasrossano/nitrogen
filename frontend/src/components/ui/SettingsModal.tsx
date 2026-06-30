'use client';

import { X, FlaskConical, CreditCard, Loader2, ExternalLink, UserPlus, Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBillingStore } from '@/stores/billingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { api, type Project, type ProjectShare } from '@/lib/api';
import { ModalShell } from '@/components/ui/ModalShell';
import { Tooltip } from '@/components/ui/Tooltip';
import { BillingOptionsPanel } from '@/components/ui/BillingOptionsPanel';
import { UsageDashboard } from '@/components/ui/UsageDashboard';
import { AccessMemberRow } from '@/components/sharing/AccessMemberRow';
import { EmailAddressField } from '@/components/sharing/EmailAddressField';
import { RoleDropdown } from '@/components/sharing/RoleDropdown';
import { SettingsEntityHeader } from '@/components/ui/SettingsEntityHeader';
import { AccentIconBadge } from '@/components/ui/AccentIconBadge';
import { resolveDefaultProjectId } from '@/components/chat-shell/ChangeProjectSelect';
import { useChatShell } from '@/components/chat-shell/ChatShellContext';
import {
  buildChatPath,
  resolveActiveProjectId,
  writeLastProjectId,
} from '@/components/chat-shell/ChatShellProvider';

interface SettingsModalProps {
  onClose: () => void;
}

// Sectioned layout — add new sections via <SettingsSection>. Wire toggles through useSettingsStore.

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
        {title}
      </p>
      <div className="rounded-xl border border-stroke-subtle divide-y divide-stroke-subtle overflow-visible">
        {children}
      </div>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 hover:bg-surface-subtle/60 cursor-pointer select-none">
      {Icon && <AccentIconBadge icon={Icon} size="md" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && (
          <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
          checked ? 'bg-accent' : 'bg-surface-subtle border border-stroke-subtle'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

const TIER_LABELS: Record<string, string> = {
  trial: 'Free Trial',
  individual: 'Individual',
  starter: 'Starter',
  pro: 'Pro',
  byok: 'BYOK',
  none: 'No Plan',
  unlimited: 'Unlimited',
};

function PlanBillingSection() {
  const { tier, usedUsd, limitUsd, usagePercent, trialMessagesRemaining, loaded } = useBillingStore();

  const [portalLoading, setPortalLoading] = useState(false);
  const [showManageOptions, setShowManageOptions] = useState(false);

  if (!loaded) return null;

  const isStripeManagedTier =
    tier === 'individual' || tier === 'starter' || tier === 'pro';

  const handleManageSubscription = async () => {
    if (!isStripeManagedTier) {
      setShowManageOptions((open) => !open);
      return;
    }
    setPortalLoading(true);
    try {
      const { url } = await api.createPortalSession(window.location.href);
      window.location.href = url;
    } catch {
      setPortalLoading(false);
    }
  };

  const barColor = usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-accent';

  return (
    <>
      <SettingsSection title="Manage Plan">
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{TIER_LABELS[tier ?? 'none'] ?? tier}</span>
              {tier === 'trial' && trialMessagesRemaining != null && (
                <span className="text-[10px] font-medium bg-surface-subtle text-text-secondary px-1.5 py-0.5 rounded-full">
                  {trialMessagesRemaining} msgs left
                </span>
              )}
            </div>
            <button
              onClick={handleManageSubscription}
              disabled={isStripeManagedTier && portalLoading}
              className="text-[11px] text-accent enabled:hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {isStripeManagedTier ? (
                portalLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />
              ) : (
                <CreditCard className="w-3 h-3" />
              )}
              Manage
            </button>
          </div>

          {limitUsd > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-text-tertiary mb-1">
                <span>${usedUsd.toFixed(2)} used</span>
                <span>${limitUsd.toFixed(2)} limit</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, usagePercent)}%` }} />
              </div>
            </div>
          )}

          {showManageOptions && <BillingOptionsPanel />}
        </div>
      </SettingsSection>

      <SettingsSection title="Usage">
        <UsageDashboard />
      </SettingsSection>
    </>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatShell = useChatShell();
  const { devMode, setDevMode } = useSettingsStore();
  const showBillingFeatures = useFeatureFlag('billing_features');
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceDetail,
    loading: workspaceLoading,
    loadWorkspaces,
    setActiveWorkspace,
    createWorkspace,
    updateActiveWorkspace,
    deleteActiveWorkspace,
    addMember,
    removeMember,
  } = useWorkspaceStore();
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceIcon, setWorkspaceIcon] = useState('Building2');
  const [workspaceNameSaving, setWorkspaceNameSaving] = useState(false);
  const [workspaceIconSaving, setWorkspaceIconSaving] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceDeleting, setWorkspaceDeleting] = useState(false);
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [projectWorkspaceId, setProjectWorkspaceId] = useState('');
  const [initialProjectWorkspaceId, setInitialProjectWorkspaceId] = useState('');
  const [projectSettingsLoading, setProjectSettingsLoading] = useState(false);
  const [projectSettingsLoadedForId, setProjectSettingsLoadedForId] = useState<string | null>(null);
  const [projectWorkspaceSaving, setProjectWorkspaceSaving] = useState(false);
  const [projectShares, setProjectShares] = useState<ProjectShare[]>([]);
  const [projectRole, setProjectRole] = useState<'owner' | 'editor' | 'viewer'>('owner');
  const [projectOwnerEmail, setProjectOwnerEmail] = useState<string | null>(null);
  const [projectShareEmail, setProjectShareEmail] = useState('');
  const [projectShareRole, setProjectShareRole] = useState<'editor' | 'viewer'>('editor');
  const [projectShareSaving, setProjectShareSaving] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectIcon, setProjectIcon] = useState('FolderOpen');
  const [projectNameSaving, setProjectNameSaving] = useState(false);
  const [projectIconSaving, setProjectIconSaving] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'workspace' | 'project' | 'billing' | 'developer'>('workspace');
  const [projectWorkspaceDropdownOpen, setProjectWorkspaceDropdownOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [projectDeleting, setProjectDeleting] = useState(false);
  const projectWorkspaceDropdownRef = useRef<HTMLDivElement>(null);
  const prevWorkspaceIdRef = useRef<string | null>(null);

  const routeProjectId = searchParams.get('project');
  const activeProjectId = useMemo(
    () => resolveActiveProjectId(pathname, routeProjectId, projects),
    [pathname, projects, routeProjectId],
  );

  useEffect(() => {
    if (workspaceLoading || activeWorkspace || workspaces.length > 0) return;
    loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces, workspaceLoading, workspaces.length]);

  useEffect(() => {
    setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? '');
    setWorkspaceIcon(activeWorkspaceDetail?.icon ?? activeWorkspace?.icon ?? 'Building2');
  }, [activeWorkspace, activeWorkspaceDetail]);

  useEffect(() => {
    if (!projectWorkspaceDropdownOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!projectWorkspaceDropdownRef.current?.contains(event.target as Node)) {
        setProjectWorkspaceDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [projectWorkspaceDropdownOpen]);

  useEffect(() => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) {
      setProjects([]);
      prevWorkspaceIdRef.current = null;
      return;
    }

    const workspaceChanged =
      prevWorkspaceIdRef.current !== null && prevWorkspaceIdRef.current !== workspaceId;
    prevWorkspaceIdRef.current = workspaceId;

    if (workspaceChanged) {
      setProjects([]);
      setProjectSettingsLoadedForId(null);
    }

    let cancelled = false;
    api.listProjects(100, 0, false, workspaceId)
      .then((nextProjects) => {
        if (cancelled) return;
        setProjects(nextProjects);

        if (!workspaceChanged) return;

        const nextProjectId = resolveDefaultProjectId(nextProjects);
        setSettingsProjectId(nextProjectId);
        if (nextProjectId) {
          writeLastProjectId(nextProjectId);
          if (pathname.startsWith('/chat') || pathname === '/') {
            router.replace(buildChatPath(pathname, searchParams, nextProjectId));
          } else if (/^\/initiatives\/[^/]+/.test(pathname)) {
            router.replace(`/projects/${nextProjectId}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`);
          }
          return;
        }

        writeLastProjectId(null);
        if (pathname.startsWith('/chat') || pathname === '/' || /^\/initiatives\/[^/]+/.test(pathname)) {
          router.replace('/chat');
        }
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, pathname, router, searchParams]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (projects.length > 0 && !projects.some((project) => project.id === activeProjectId)) return;
    setSettingsProjectId(activeProjectId);
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!settingsProjectId) return;
    const fromList = projects.find((project) => project.id === settingsProjectId);
    if (!fromList || projectSettingsLoadedForId === settingsProjectId) return;
    setProjectName(fromList.name);
    setProjectIcon(fromList.icon ?? 'FolderOpen');
  }, [projectSettingsLoadedForId, projects, settingsProjectId]);

  useEffect(() => {
    if (!showBillingFeatures && activeSettingsTab === 'billing') {
      setActiveSettingsTab('workspace');
    }
  }, [showBillingFeatures, activeSettingsTab]);

  useEffect(() => {
    if (activeSettingsTab !== 'project' || !settingsProjectId) return;
    if (projectSettingsLoadedForId === settingsProjectId) return;
    let cancelled = false;
    setProjectSettingsLoading(true);
    setProjectError('');
    Promise.all([api.getProject(settingsProjectId), api.getShares(settingsProjectId)])
      .then(([project, shares]) => {
        if (cancelled) return;
        setProjectWorkspaceId(project.workspace_id);
        setInitialProjectWorkspaceId(project.workspace_id);
        setProjectRole((project.shared_role as 'editor' | 'viewer' | null) ?? 'owner');
        setProjectOwnerEmail(project.owner_email ?? null);
        setProjectShares(shares);
        const listedProject = projects.find((project) => project.id === settingsProjectId);
        setProjectName(project.title ?? listedProject?.name ?? 'Project');
        setProjectIcon(project.icon ?? listedProject?.icon ?? 'FolderOpen');
        setProjectSettingsLoadedForId(settingsProjectId);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectError(error instanceof Error ? error.message : 'Failed to load project settings');
      })
      .finally(() => {
        if (cancelled) return;
        setProjectSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSettingsTab, projectSettingsLoadedForId, projects, settingsProjectId]);

  const isWorkspaceOwner = activeWorkspaceDetail?.current_user_role === 'owner';
  const isProjectOwner = projectRole === 'owner';
  const isTeamWorkspace =
    (activeWorkspaceDetail?.workspace_type ?? activeWorkspace?.workspace_type) === 'team';
  const workspaceOptions = (workspaces.length > 0 ? workspaces : (activeWorkspace ? [activeWorkspace] : []))
    .filter((workspace, index, arr) => arr.findIndex((w) => w.id === workspace.id) === index);
  const selectedProjectWorkspace = workspaceOptions.find((workspace) => workspace.id === projectWorkspaceId) ?? null;

  const handleSaveWorkspaceName = async (trimmed: string) => {
    if (!isWorkspaceOwner) return;
    if (!trimmed) {
      setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? 'Workspace');
      return;
    }
    setWorkspaceNameSaving(true);
    setWorkspaceError('');
    try {
      await updateActiveWorkspace({
        name: trimmed,
      });
      setWorkspaceName(trimmed);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to update workspace');
      setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? trimmed);
    } finally {
      setWorkspaceNameSaving(false);
    }
  };

  const handleWorkspaceIconPick = async (iconName: string) => {
    if (!isWorkspaceOwner) return;
    const previous = workspaceIcon;
    setWorkspaceIcon(iconName);
    setWorkspaceIconSaving(true);
    setWorkspaceError('');
    try {
      await updateActiveWorkspace({ icon: iconName });
    } catch (error) {
      setWorkspaceIcon(previous);
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to update workspace icon');
    } finally {
      setWorkspaceIconSaving(false);
    }
  };

  const handleSaveProjectName = async (trimmed: string) => {
    if (!settingsProjectId || !isProjectOwner) return;
    if (!trimmed) return;
    setProjectNameSaving(true);
    setProjectError('');
    try {
      await api.updateProject(settingsProjectId, { title: trimmed });
      setProjectName(trimmed);
      setProjects((prev) => prev.map((project) => (
        project.id === settingsProjectId ? { ...project, name: trimmed } : project
      )));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to update project name');
    } finally {
      setProjectNameSaving(false);
    }
  };

  const handleProjectIconPick = async (iconName: string) => {
    if (!settingsProjectId || !isProjectOwner) return;
    const previous = projectIcon;
    setProjectIcon(iconName);
    setProjectIconSaving(true);
    setProjectError('');
    try {
      await api.updateProject(settingsProjectId, { icon: iconName });
      setProjects((prev) => prev.map((project) => (
        project.id === settingsProjectId ? { ...project, icon: iconName } : project
      )));
    } catch (error) {
      setProjectIcon(previous);
      setProjectError(error instanceof Error ? error.message : 'Failed to update project icon');
    } finally {
      setProjectIconSaving(false);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setWorkspaceSaving(true);
    setWorkspaceError('');
    try {
      await createWorkspace(newWorkspaceName.trim());
      setNewWorkspaceName('');
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to create workspace');
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail.trim()) return;
    setWorkspaceSaving(true);
    setWorkspaceError('');
    try {
      await addMember(newMemberEmail.trim());
      setNewMemberEmail('');
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to add member');
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const handleWorkspaceSwitch = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspace?.id) return;
    setWorkspaceSwitching(true);
    setWorkspaceError('');
    setProjectSettingsLoadedForId(null);
    try {
      await setActiveWorkspace(workspaceId);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to switch workspace');
    } finally {
      setWorkspaceSwitching(false);
    }
  };

  const handleProjectSwitch = (projectId: string) => {
    if (!projectId || projectId === settingsProjectId) return;
    setProjectSwitching(true);
    setProjectError('');
    setSettingsProjectId(projectId);
    setProjectSettingsLoadedForId(null);
    writeLastProjectId(projectId);
    if (pathname.startsWith('/chat') || pathname === '/') {
      router.replace(buildChatPath(pathname, searchParams, projectId));
    } else if (/^\/initiatives\/[^/]+/.test(pathname)) {
      router.replace(`/projects/${projectId}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`);
    }
    setProjectSwitching(false);
  };

  const handleDeleteWorkspace = async () => {
    if (!activeWorkspaceDetail || activeWorkspaceDetail.workspace_type !== 'team' || !isWorkspaceOwner) return;
    const confirmed = window.confirm(
      `Delete workspace "${activeWorkspaceDetail.name}"? This will permanently delete its projects and files.`,
    );
    if (!confirmed) return;

    setWorkspaceDeleting(true);
    setWorkspaceError('');
    try {
      await deleteActiveWorkspace();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to delete workspace');
    } finally {
      setWorkspaceDeleting(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!settingsProjectId || !isProjectOwner) return;
    const confirmed = window.confirm(
      `Delete project "${projectName || 'Project'}"? This will archive the project and remove it from your workspace.`,
    );
    if (!confirmed) return;

    const deletedProjectId = settingsProjectId;
    setProjectDeleting(true);
    setProjectError('');
    try {
      await api.deleteProject(deletedProjectId);
      const remaining = projects.filter((project) => project.id !== deletedProjectId);
      setProjects(remaining);
      setProjectSettingsLoadedForId(null);

      const nextProjectId = resolveDefaultProjectId(remaining);
      if (nextProjectId) {
        setSettingsProjectId(nextProjectId);
        writeLastProjectId(nextProjectId);
        router.replace(`/chat?project=${nextProjectId}`);
      } else {
        setSettingsProjectId(null);
        writeLastProjectId(null);
        router.replace('/chat');
      }
      chatShell?.refreshDrawer();
      onClose();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to delete project');
    } finally {
      setProjectDeleting(false);
    }
  };

  const handleMoveProjectWorkspace = async () => {
    if (!settingsProjectId || !projectWorkspaceId) return;
    setProjectWorkspaceSaving(true);
    setProjectError('');
    try {
      await api.updateProject(settingsProjectId, { workspace_id: projectWorkspaceId });
      setInitialProjectWorkspaceId(projectWorkspaceId);
      if (activeWorkspace?.id !== projectWorkspaceId) {
        await setActiveWorkspace(projectWorkspaceId);
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to move project workspace');
    } finally {
      setProjectWorkspaceSaving(false);
    }
  };

  const handleProjectShare = async () => {
    if (!settingsProjectId || !projectShareEmail.trim()) return;
    setProjectShareSaving(true);
    setProjectError('');
    try {
      const share = await api.createShare(settingsProjectId, projectShareEmail.trim(), projectShareRole);
      setProjectShares((prev) => [...prev, share]);
      setProjectShareEmail('');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to share project');
    } finally {
      setProjectShareSaving(false);
    }
  };

  const handleProjectShareRoleChange = async (shareId: string, role: 'editor' | 'viewer') => {
    if (!settingsProjectId) return;
    setProjectError('');
    try {
      const updated = await api.updateShare(settingsProjectId, shareId, role);
      setProjectShares((prev) => prev.map((share) => (share.id === shareId ? updated : share)));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to update share role');
    }
  };

  const handleProjectShareRemove = async (shareId: string) => {
    if (!settingsProjectId) return;
    setProjectError('');
    try {
      await api.deleteShare(settingsProjectId, shareId);
      setProjectShares((prev) => prev.filter((share) => share.id !== shareId));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to remove access');
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" className="flex flex-col h-[min(640px,80vh)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle flex-shrink-0">
        <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-40 shrink-0 border-r border-stroke-subtle px-3 py-4 overflow-y-auto">
          {([
            { id: 'workspace' as const, label: 'Workspace', disabled: false, disabledReason: '' },
            { id: 'project' as const, label: 'Project', disabled: false, disabledReason: '' },
            ...(showBillingFeatures ? [{ id: 'billing' as const, label: 'Billing', disabled: false, disabledReason: '' }] : []),
            { id: 'developer' as const, label: 'Developer', disabled: false, disabledReason: '' },
          ]).map((item) => {
            const button = (
              <button
                onClick={() => {
                  if (item.disabled) return;
                  setActiveSettingsTab(item.id);
                }}
                aria-disabled={item.disabled}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  item.disabled
                    ? 'text-text-tertiary/70 cursor-not-allowed'
                    : activeSettingsTab === item.id
                      ? 'bg-surface-subtle text-text-primary'
                      : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                }`}
              >
                {item.label}
              </button>
            );

            if (!item.disabled) {
              return (
                <div key={item.id}>
                  {button}
                </div>
              );
            }

            return (
              <Tooltip key={item.id} content={item.disabledReason} fitContent>
                {button}
              </Tooltip>
            );
          })}
        </aside>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1 min-h-0">
            {activeSettingsTab === 'workspace' ? (
              <>
              <SettingsSection title="Workspace">
                <div className="px-4 py-3 space-y-3">
                  <SettingsEntityHeader
                    iconName={workspaceIcon}
                    onIconPick={handleWorkspaceIconPick}
                    iconPickerDisabled={!isWorkspaceOwner}
                    iconSaving={workspaceIconSaving}
                    name={workspaceName}
                    nameEditable={isWorkspaceOwner}
                    onSaveName={handleSaveWorkspaceName}
                    nameSaving={workspaceNameSaving}
                    nameFallback="Workspace"
                    subtitle={
                      activeWorkspaceDetail?.workspace_type === 'team'
                        ? `Team workspace${activeWorkspaceDetail?.current_user_role && activeWorkspaceDetail.current_user_role !== 'owner'
                          ? ` · ${activeWorkspaceDetail.current_user_role}`
                          : ''}`
                        : 'Personal workspace'
                    }
                    switchOptions={workspaceOptions.map((workspace) => ({
                      id: workspace.id,
                      label: workspace.name,
                      iconName: workspace.icon,
                    }))}
                    selectedSwitchId={activeWorkspace?.id ?? null}
                    onSwitch={(workspaceId) => void handleWorkspaceSwitch(workspaceId)}
                    switchDisabled={workspaceLoading || workspaceSwitching}
                    switchAriaLabel="Switch workspace"
                  />

                  {workspaceError && <p className="text-[10px] text-red-500">{workspaceError}</p>}
                </div>
              </SettingsSection>

              {isTeamWorkspace && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
                    Add Team Members
                  </p>
                  <p className="text-xs text-text-tertiary px-1 pb-1">
                    Adding a team member gives them access to all workspace projects and allows them to upload workspace-level materials.
                    You can add an email before they create an account; they will join automatically when they sign up with that address.
                  </p>
                  <div className="space-y-4 pt-3">
                    {isWorkspaceOwner && (
                      <div className="flex gap-1.5">
                        <EmailAddressField
                          value={newMemberEmail}
                          onChange={setNewMemberEmail}
                          placeholder="Add member by email"
                        />
                        <button
                          onClick={handleAddMember}
                          disabled={workspaceSaving || !newMemberEmail.trim()}
                          className="btn-secondary !px-3 !py-1.5 !text-xs !rounded-lg"
                        >
                          <UserPlus className="w-3 h-3" />
                          Add
                        </button>
                      </div>
                    )}
                    <div className="border border-stroke-subtle rounded-lg divide-y divide-stroke-subtle">
                      {(activeWorkspaceDetail?.members ?? []).map((member) => {
                        const primaryLabel = member.user_email ?? member.user_display_name ?? member.user_id ?? 'Invited';
                        const secondaryLabel = member.pending
                          ? 'Invited — no account yet'
                          : member.user_email && member.user_display_name
                            ? member.user_display_name
                            : null;
                        return (
                          <AccessMemberRow
                            key={member.id}
                            emailOrId={primaryLabel}
                            displayName={secondaryLabel}
                            roleLabel={member.role}
                            accentAvatar={member.role === 'owner'}
                            onRemove={isWorkspaceOwner && member.role !== 'owner' ? () => removeMember(member.id) : undefined}
                            removeTitle={member.pending ? 'Cancel invitation' : 'Remove member'}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
                  Create New Workspace
                </p>
                <div className="flex gap-1.5">
                  <input
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      void handleCreateWorkspace();
                    }}
                    placeholder="Workspace name"
                    className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-stroke-subtle bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={handleCreateWorkspace}
                    disabled={workspaceSaving || !newWorkspaceName.trim()}
                    className="btn-primary !px-3 !py-1.5 !text-xs !rounded-lg"
                  >
                    Create
                  </button>
                </div>
              </div>

              {isWorkspaceOwner && activeWorkspaceDetail?.workspace_type === 'team' && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => void handleDeleteWorkspace()}
                    disabled={workspaceDeleting || workspaceSaving || workspaceLoading}
                    className="btn-danger !px-4 !py-1.5 !text-xs !rounded-lg"
                  >
                    {workspaceDeleting ? 'Deleting...' : 'Delete Workspace'}
                  </button>
                </div>
              )}

              </>
            ) : activeSettingsTab === 'project' ? (
              <>
                {!settingsProjectId ? (
                  <div className="px-1 py-6 text-center">
                    <p className="text-sm text-text-secondary">No projects available yet.</p>
                  </div>
                ) : (
                  <>
                <SettingsSection title="Project">
                  <div className="px-4 py-3 space-y-3">
                    <SettingsEntityHeader
                      iconName={projectIcon}
                      onIconPick={handleProjectIconPick}
                      iconPickerDisabled={!isProjectOwner}
                      iconSaving={projectIconSaving}
                      name={projectName}
                      nameEditable={isProjectOwner}
                      onSaveName={handleSaveProjectName}
                      nameSaving={projectNameSaving}
                      nameFallback="Project"
                      subtitle={projectRole === 'owner' ? 'Owner' : projectRole === 'editor' ? 'Editor' : 'Viewer'}
                      switchOptions={projects.map((project) => ({
                        id: project.id,
                        label: project.name,
                        iconName: project.icon,
                      }))}
                      selectedSwitchId={settingsProjectId}
                      onSwitch={handleProjectSwitch}
                      switchDisabled={projectSettingsLoading || projectSwitching}
                      switchAriaLabel="Switch project"
                    />
                  </div>
                </SettingsSection>

                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
                    Workspace
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex gap-1.5">
                      <div ref={projectWorkspaceDropdownRef} className="relative flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (projectSettingsLoading || projectWorkspaceSaving || workspaceOptions.length === 0) return;
                            setProjectWorkspaceDropdownOpen((open) => !open);
                          }}
                          disabled={projectSettingsLoading || projectWorkspaceSaving || workspaceOptions.length === 0}
                          className="w-full h-8 flex items-center justify-between gap-2 px-2 rounded-lg border border-stroke-subtle bg-white text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                          aria-label="Select workspace"
                          aria-expanded={projectWorkspaceDropdownOpen}
                        >
                          <span className="truncate">
                            {selectedProjectWorkspace?.name
                              ? `${selectedProjectWorkspace.name} · ${
                                selectedProjectWorkspace.workspace_type === 'personal'
                                  ? 'Personal'
                                  : 'Team'
                              }`
                              : 'Select workspace'}
                          </span>
                          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                        </button>
                        {projectWorkspaceDropdownOpen && (
                          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg">
                            {workspaceOptions.map((workspace) => {
                              const selected = workspace.id === projectWorkspaceId;
                              return (
                                <button
                                  key={workspace.id}
                                  type="button"
                                  onClick={() => {
                                    setProjectWorkspaceId(workspace.id);
                                    setProjectWorkspaceDropdownOpen(false);
                                  }}
                                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors ${
                                    selected
                                      ? 'bg-surface-subtle text-text-primary'
                                      : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                                  }`}
                                >
                                  <span className="w-3.5 shrink-0">
                                    {selected ? <Check className="w-3.5 h-3.5" /> : null}
                                  </span>
                                  <span className="truncate">
                                    {workspace.name} · {workspace.workspace_type === 'personal' ? 'Personal' : 'Team'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => void handleMoveProjectWorkspace()}
                        disabled={
                          projectSettingsLoading
                          || projectWorkspaceSaving
                          || !projectWorkspaceId
                          || projectWorkspaceId === initialProjectWorkspaceId
                        }
                        className="btn-primary !px-3 !py-1.5 !text-xs !rounded-lg"
                      >
                        {projectWorkspaceSaving ? 'Saving...' : 'Move'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
                    Add Collaborators
                  </p>
                  <p className="text-xs text-text-tertiary px-1 pb-1">
                    Adding a collaborator gives them access to this project and allows them to view or make changes.
                    You can invite an email before they create an account; they will get access automatically when they sign up with that address.
                  </p>
                  <div className="space-y-4 pt-3">
                    {(projectRole === 'owner' || projectRole === 'editor') && (
                      <div className="flex gap-1.5">
                        <EmailAddressField
                          value={projectShareEmail}
                          onChange={setProjectShareEmail}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            void handleProjectShare();
                          }}
                        />
                        <RoleDropdown
                          value={projectShareRole}
                          onChange={(value) => setProjectShareRole(value as 'editor' | 'viewer')}
                          options={[
                            { value: 'editor', label: 'Editor' },
                            { value: 'viewer', label: 'Viewer' },
                          ]}
                          disabled={projectShareSaving}
                        />
                        <button
                          onClick={() => void handleProjectShare()}
                          disabled={projectShareSaving || !projectShareEmail.trim()}
                          className="btn-primary !px-3 !py-1.5 !text-xs !rounded-lg"
                        >
                          {projectShareSaving ? 'Sharing...' : 'Share'}
                        </button>
                      </div>
                    )}

                    <div className="border border-stroke-subtle rounded-lg divide-y divide-stroke-subtle">
                      <AccessMemberRow
                        emailOrId={projectOwnerEmail || 'Owner'}
                        roleLabel="Owner"
                        accentAvatar={true}
                      />
                      {projectSettingsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
                        </div>
                      ) : projectShares.filter((share) => share.user_email !== projectOwnerEmail).length === 0 ? (
                        <div className="px-3 py-4 text-center">
                          <p className="text-xs text-text-tertiary">No one else has access yet</p>
                        </div>
                      ) : (
                        projectShares
                          .filter((share) => share.user_email !== projectOwnerEmail)
                          .map((share) => (
                            <AccessMemberRow
                              key={share.id}
                              emailOrId={share.user_email || share.user_id || 'Invited'}
                              displayName={share.pending ? 'Invited — no account yet' : share.user_display_name}
                              roleValue={projectRole === 'owner' ? share.role : undefined}
                              roleLabel={projectRole === 'owner' ? undefined : share.role}
                              roleOptions={projectRole === 'owner' ? [
                                { value: 'editor', label: 'Editor' },
                                { value: 'viewer', label: 'Viewer' },
                              ] : undefined}
                              onRoleChange={projectRole === 'owner'
                                ? (value) => void handleProjectShareRoleChange(share.id, value as 'editor' | 'viewer')
                                : undefined}
                              onRemove={projectRole === 'owner' ? () => void handleProjectShareRemove(share.id) : undefined}
                              removeTitle={share.pending ? 'Cancel invitation' : 'Remove access'}
                            />
                          ))
                      )}
                    </div>
                  </div>
                </div>

                {projectError && <p className="text-[10px] text-red-500">{projectError}</p>}

                {isProjectOwner && (
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => void handleDeleteProject()}
                      disabled={projectDeleting || projectSettingsLoading || projectShareSaving || projectWorkspaceSaving}
                      className="btn-danger !px-4 !py-1.5 !text-xs !rounded-lg"
                    >
                      {projectDeleting ? 'Deleting...' : 'Delete Project'}
                    </button>
                  </div>
                )}
                  </>
                )}
              </>
            ) : activeSettingsTab === 'billing' ? (
              <>
                {showBillingFeatures && <PlanBillingSection />}
              </>
            ) : (
              <>
                <SettingsSection title="Developer">
                  <SettingsRow
                    icon={FlaskConical}
                    label="Developer Mode"
                    description="Enables billing, usage tracking, and other features under development."
                    checked={devMode}
                    onChange={setDevMode}
                  />
                </SettingsSection>
              </>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
