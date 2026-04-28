'use client';

import { X, FlaskConical, CreditCard, Loader2, ExternalLink, UserPlus, Pencil, Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBillingStore } from '@/stores/billingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { api, ProjectShare } from '@/lib/api';
import { ModalShell } from '@/components/ui/ModalShell';
import { Tooltip } from '@/components/ui/Tooltip';
import { BillingOptionsPanel } from '@/components/ui/BillingOptionsPanel';
import { IconPickerButton } from '@/components/ui/IconPickerButton';
import { AccessMemberRow } from '@/components/sharing/AccessMemberRow';
import { EmailAddressField } from '@/components/sharing/EmailAddressField';
import { RoleDropdown } from '@/components/sharing/RoleDropdown';

interface SettingsModalProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------
// Sectioned layout — add new sections by appending <SettingsSection> blocks.
// Each toggle/input should read from and write to useSettingsStore.
// ---------------------------------------------------------------------------

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
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 hover:bg-surface-subtle/60 cursor-pointer select-none">
      {Icon && (
        <div className="w-7 h-7 rounded-lg bg-surface-subtle flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-text-secondary" />
        </div>
      )}
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

  const isStripeManagedTier = tier === 'starter' || tier === 'pro';

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
    </>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const pathname = usePathname();
  const { devMode, setDevMode } = useSettingsStore();
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
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false);
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
  const [activeSettingsTab, setActiveSettingsTab] = useState<'workspace' | 'project' | 'billing' | 'developer'>('workspace');
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [projectWorkspaceDropdownOpen, setProjectWorkspaceDropdownOpen] = useState(false);
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);
  const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
  const projectWorkspaceDropdownRef = useRef<HTMLDivElement>(null);
  const initiativeId = useMemo(() => {
    const match = /^\/initiatives\/([^/]+)/.exec(pathname);
    return match ? match[1] : null;
  }, [pathname]);
  const isInProjectContext = !!initiativeId;

  useEffect(() => {
    if (workspaceLoading || activeWorkspace || workspaces.length > 0) return;
    loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces, workspaceLoading, workspaces.length]);

  useEffect(() => {
    setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? '');
    setWorkspaceIcon(activeWorkspaceDetail?.icon ?? activeWorkspace?.icon ?? 'Building2');
    setIsEditingWorkspaceName(false);
  }, [activeWorkspace, activeWorkspaceDetail]);

  useEffect(() => {
    if (isEditingWorkspaceName && workspaceNameInputRef.current) {
      workspaceNameInputRef.current.focus();
      workspaceNameInputRef.current.select();
    }
  }, [isEditingWorkspaceName]);

  useEffect(() => {
    if (!workspaceSwitcherOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!workspaceSwitcherRef.current?.contains(event.target as Node)) {
        setWorkspaceSwitcherOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [workspaceSwitcherOpen]);

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
    if (activeSettingsTab === 'project' && !isInProjectContext) {
      setActiveSettingsTab('workspace');
    }
  }, [activeSettingsTab, isInProjectContext]);

  useEffect(() => {
    if (!devMode && activeSettingsTab === 'billing') {
      setActiveSettingsTab('workspace');
    }
  }, [devMode, activeSettingsTab]);

  useEffect(() => {
    if (activeSettingsTab !== 'project' || !initiativeId) return;
    if (projectSettingsLoadedForId === initiativeId) return;
    let cancelled = false;
    setProjectSettingsLoading(true);
    setProjectError('');
    Promise.all([api.getInitiative(initiativeId), api.getShares(initiativeId)])
      .then(([initiative, shares]) => {
        if (cancelled) return;
        setProjectWorkspaceId(initiative.workspace_id);
        setInitialProjectWorkspaceId(initiative.workspace_id);
        setProjectRole((initiative.shared_role as 'editor' | 'viewer' | null) ?? 'owner');
        setProjectOwnerEmail(initiative.owner_email ?? null);
        setProjectShares(shares);
        setProjectSettingsLoadedForId(initiativeId);
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
  }, [activeSettingsTab, initiativeId, projectSettingsLoadedForId]);

  const isWorkspaceOwner = activeWorkspaceDetail?.current_user_role === 'owner';
  const isTeamWorkspace =
    (activeWorkspaceDetail?.workspace_type ?? activeWorkspace?.workspace_type) === 'team';
  const workspaceOptions = (workspaces.length > 0 ? workspaces : (activeWorkspace ? [activeWorkspace] : []))
    .filter((workspace, index, arr) => arr.findIndex((w) => w.id === workspace.id) === index);
  const selectedProjectWorkspace = workspaceOptions.find((workspace) => workspace.id === projectWorkspaceId) ?? null;

  const handleSaveWorkspaceName = async () => {
    if (!isWorkspaceOwner) return;
    const trimmed = workspaceName.trim();
    if (!trimmed) {
      setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? 'Workspace');
      setIsEditingWorkspaceName(false);
      return;
    }
    setWorkspaceNameSaving(true);
    setWorkspaceError('');
    try {
      await updateActiveWorkspace({
        name: trimmed,
      });
      setIsEditingWorkspaceName(false);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to update workspace');
      setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? trimmed);
    } finally {
      setWorkspaceNameSaving(false);
    }
  };

  const handleCancelWorkspaceName = () => {
    setWorkspaceName(activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? 'Workspace');
    setIsEditingWorkspaceName(false);
  };

  const handleWorkspaceNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSaveWorkspaceName();
    } else if (e.key === 'Escape') {
      handleCancelWorkspaceName();
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
    try {
      await setActiveWorkspace(workspaceId);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to switch workspace');
    } finally {
      setWorkspaceSwitching(false);
    }
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

  const handleMoveProjectWorkspace = async () => {
    if (!initiativeId || !projectWorkspaceId) return;
    setProjectWorkspaceSaving(true);
    setProjectError('');
    try {
      await api.updateInitiative(initiativeId, { workspace_id: projectWorkspaceId });
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
    if (!initiativeId || !projectShareEmail.trim()) return;
    setProjectShareSaving(true);
    setProjectError('');
    try {
      const share = await api.createShare(initiativeId, projectShareEmail.trim(), projectShareRole);
      setProjectShares((prev) => [...prev, share]);
      setProjectShareEmail('');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to share project');
    } finally {
      setProjectShareSaving(false);
    }
  };

  const handleProjectShareRoleChange = async (shareId: string, role: 'editor' | 'viewer') => {
    if (!initiativeId) return;
    setProjectError('');
    try {
      const updated = await api.updateShare(initiativeId, shareId, role);
      setProjectShares((prev) => prev.map((share) => (share.id === shareId ? updated : share)));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to update share role');
    }
  };

  const handleProjectShareRemove = async (shareId: string) => {
    if (!initiativeId) return;
    setProjectError('');
    try {
      await api.deleteShare(initiativeId, shareId);
      setProjectShares((prev) => prev.filter((share) => share.id !== shareId));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to remove access');
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-3xl" className="flex flex-col min-h-[520px] max-h-[80vh]">
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

      <div className="flex flex-1 min-h-0">
        <aside className="w-40 shrink-0 border-r border-stroke-subtle px-3 py-4">
          {([
            { id: 'workspace' as const, label: 'Workspace', disabled: false, disabledReason: '' },
            {
              id: 'project' as const,
              label: 'Project',
              disabled: !isInProjectContext,
              disabledReason: 'Navigate to a specific project to manage its settings.',
            },
            ...(devMode ? [{ id: 'billing' as const, label: 'Billing', disabled: false, disabledReason: '' }] : []),
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-shrink-0">
                      <IconPickerButton
                        iconName={workspaceIcon}
                        onPick={handleWorkspaceIconPick}
                        disabled={!isWorkspaceOwner || workspaceIconSaving}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      {isEditingWorkspaceName && isWorkspaceOwner ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={workspaceNameInputRef}
                            type="text"
                            value={workspaceName}
                            onChange={(e) => setWorkspaceName(e.target.value)}
                            onKeyDown={handleWorkspaceNameKeyDown}
                            style={{ width: `${Math.max(workspaceName.length + 2, 10)}ch` }}
                            className="min-w-0 px-0 py-0.5 text-sm font-medium text-text-primary bg-transparent border-0 border-b border-accent rounded-none focus:outline-none focus:ring-0"
                            disabled={workspaceNameSaving}
                          />
                          <button
                            onClick={() => void handleSaveWorkspaceName()}
                            disabled={workspaceNameSaving}
                            className="icon-btn icon-btn-success p-1 text-indicator-green flex-shrink-0"
                          >
                            {workspaceNameSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={handleCancelWorkspaceName}
                            disabled={workspaceNameSaving}
                            className="icon-btn p-1 text-text-tertiary flex-shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group">
                          <p className="text-sm font-medium text-text-primary">
                            {activeWorkspaceDetail?.name ?? activeWorkspace?.name ?? 'Workspace'}
                          </p>
                          {isWorkspaceOwner && (
                            <button
                              onClick={() => setIsEditingWorkspaceName(true)}
                              className="icon-btn p-1 opacity-0 group-hover:opacity-100 text-text-tertiary"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-text-tertiary mt-0.5">
                        {activeWorkspaceDetail?.workspace_type === 'team'
                          ? `Team workspace${activeWorkspaceDetail?.current_user_role && activeWorkspaceDetail.current_user_role !== 'owner'
                            ? ` · ${activeWorkspaceDetail.current_user_role}`
                            : ''}`
                          : 'Personal workspace'}
                      </p>
                    </div>
                    {workspaceOptions.length > 0 && (
                      <div ref={workspaceSwitcherRef} className="relative flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (workspaceLoading || workspaceSwitching || workspaceOptions.length < 2) return;
                            setWorkspaceSwitcherOpen((open) => !open);
                          }}
                          disabled={workspaceLoading || workspaceSwitching || workspaceOptions.length < 2}
                          className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 flex items-center shrink-0"
                          aria-label="Switch workspace"
                          aria-expanded={workspaceSwitcherOpen}
                        >
                          Switch
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </button>
                        {workspaceSwitcherOpen && (
                          <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-divider bg-white py-1 shadow-lg">
                            {workspaceOptions.map((workspace) => {
                              const selected = workspace.id === activeWorkspace?.id;
                              return (
                                <button
                                  key={workspace.id}
                                  type="button"
                                  onClick={() => {
                                    setWorkspaceSwitcherOpen(false);
                                    void handleWorkspaceSwitch(workspace.id);
                                  }}
                                  className={`flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                                    selected
                                      ? 'bg-surface-subtle text-text-primary'
                                      : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary'
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
                    )}
                  </div>

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
                        const primaryLabel = member.user_email ?? member.user_display_name ?? member.user_id;
                        const secondaryLabel = member.user_email && member.user_display_name
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
                            removeTitle="Remove member"
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

              </>
            ) : activeSettingsTab === 'project' ? (
              <>
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
                              emailOrId={share.user_email || share.user_id}
                              displayName={share.user_display_name}
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
                              removeTitle="Remove access"
                            />
                          ))
                      )}
                    </div>
                  </div>
                </div>

                {projectError && <p className="text-[10px] text-red-500">{projectError}</p>}
              </>
            ) : activeSettingsTab === 'billing' ? (
              <>
                {devMode && <PlanBillingSection />}
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

          {activeSettingsTab === 'workspace' && isWorkspaceOwner && activeWorkspaceDetail?.workspace_type === 'team' && (
            <div className="shrink-0 px-5 pb-4 pt-2 flex justify-center">
              <button
                onClick={() => void handleDeleteWorkspace()}
                disabled={workspaceDeleting || workspaceSaving || workspaceLoading}
                className="btn-danger !px-4 !py-1.5 !text-xs !rounded-lg"
              >
                {workspaceDeleting ? 'Deleting...' : 'Delete Workspace'}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
