import type { Project, ProjectShare } from '@/lib/api';

export interface CollaboratorEntry {
  id: string;
  label: string;
  roleLabel: string;
  isOwner?: boolean;
}

export function buildCollaborators(project: Project, shares: ProjectShare[]): CollaboratorEntry[] {
  const ownerEmail = project.owner_email?.trim() || null;
  const owner: CollaboratorEntry = {
    id: 'owner',
    label: ownerEmail || project.created_by,
    roleLabel: 'Owner',
    isOwner: true,
  };
  const others = shares
    .filter((share) => !ownerEmail || share.user_email !== ownerEmail)
    .map((share) => ({
      id: share.id,
      label: share.user_email || share.user_id || 'Invited',
      roleLabel: share.role === 'editor' ? 'Editor' : 'Viewer',
    }));
  return [owner, ...others];
}

export function CollaboratorRow({ label, roleLabel, isOwner = false }: CollaboratorEntry) {
  const initials = (label || '?')[0].toUpperCase();

  return (
    <li className="flex items-center gap-2 py-1 min-h-[1.75rem]">
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
          isOwner ? 'bg-accent/10' : 'bg-surface-subtle'
        }`}
      >
        <span className={`text-[9px] font-semibold ${isOwner ? 'text-accent' : 'text-text-secondary'}`}>
          {initials}
        </span>
      </div>
      <span className="min-w-0 flex-1 text-[11px] text-text-primary truncate">{label}</span>
      <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-wide shrink-0">
        {roleLabel}
      </span>
    </li>
  );
}
