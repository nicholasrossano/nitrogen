'use client';

import { useMemo } from 'react';
import type { Workspace } from '@/lib/api';
import { CustomDropdown } from '@/components/ui/CustomDropdown';

interface ChangeWorkspaceSelectProps {
  workspaces: Workspace[];
  value: string | null;
  onChange: (workspaceId: string) => void;
  disabled?: boolean;
  rootClassName?: string;
  className?: string;
  size?: 'compact' | 'default';
}

const COMPACT_TRIGGER_CLASS =
  'h-7 min-w-[6rem] max-w-[9rem] inline-flex items-center justify-between gap-1.5 rounded-md border border-stroke-subtle bg-white px-2 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60';

const DEFAULT_TRIGGER_CLASS =
  'h-8 min-w-[8rem] max-w-[12rem] inline-flex items-center justify-between gap-2 rounded-md border border-stroke-subtle bg-white px-2.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60';

const MENU_CLASS =
  'absolute right-0 top-full z-50 mt-1 min-w-full max-w-[16rem] rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg';

const ITEM_CLASS =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors';

export function ChangeWorkspaceSelect({
  workspaces,
  value,
  onChange,
  disabled = false,
  rootClassName,
  className,
  size = 'compact',
}: ChangeWorkspaceSelectProps) {
  const options = useMemo(
    () =>
      workspaces.map((workspace) => ({
        value: workspace.id,
        label: workspace.name,
      })),
    [workspaces],
  );

  const triggerClassName = className ?? (size === 'default' ? DEFAULT_TRIGGER_CLASS : COMPACT_TRIGGER_CLASS);

  return (
    <div className={rootClassName}>
      <CustomDropdown
        value={value ?? ''}
        onChange={onChange}
        options={options}
        disabled={disabled || workspaces.length === 0}
        placeholder="Workspace"
        ariaLabel="Change workspace"
        className={triggerClassName}
        menuClassName={MENU_CLASS}
        itemClassName={ITEM_CLASS}
      />
    </div>
  );
}
