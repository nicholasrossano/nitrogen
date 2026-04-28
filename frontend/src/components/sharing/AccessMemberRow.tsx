'use client';

import { Trash2 } from 'lucide-react';
import { RoleDropdown } from './RoleDropdown';

interface AccessMemberRowProps {
  emailOrId: string;
  displayName?: string | null;
  roleLabel?: string;
  roleValue?: string;
  roleOptions?: Array<{ value: string; label: string }>;
  onRoleChange?: (value: string) => void;
  onRemove?: () => void;
  removeTitle?: string;
  accentAvatar?: boolean;
}

export function AccessMemberRow({
  emailOrId,
  displayName,
  roleLabel,
  roleValue,
  roleOptions,
  onRoleChange,
  onRemove,
  removeTitle = 'Remove access',
  accentAvatar = false,
}: AccessMemberRowProps) {
  const initials = (emailOrId || '?')[0].toUpperCase();
  const hasRoleSelect = Boolean(roleOptions && roleOptions.length > 0 && roleValue && onRoleChange);
  const resolvedRoleLabel = roleLabel ?? roleValue ?? '';

  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${accentAvatar ? 'bg-accent/10' : 'bg-surface-subtle'}`}>
          <span className={`text-[10px] font-semibold ${accentAvatar ? 'text-accent' : 'text-text-secondary'}`}>
            {initials}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-xs text-text-primary truncate block">
            {emailOrId}
          </span>
          {displayName && (
            <span className="text-[10px] text-text-tertiary truncate block">
              {displayName}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {hasRoleSelect ? (
          <RoleDropdown
            value={roleValue!}
            onChange={onRoleChange!}
            options={roleOptions!}
            buttonClassName="h-6 inline-flex items-center gap-1 px-2 rounded border border-stroke-subtle bg-surface text-[10px] text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
            menuClassName="absolute right-0 top-full z-50 mt-1 min-w-[112px] rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg"
            itemClassName="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors"
          />
        ) : (
          <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">
            {resolvedRoleLabel}
          </span>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="p-1 rounded text-text-tertiary hover:text-indicator-orange transition-colors"
            title={removeTitle}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
