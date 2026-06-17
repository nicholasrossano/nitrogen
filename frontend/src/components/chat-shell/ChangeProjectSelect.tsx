'use client';

import { useMemo } from 'react';
import type { Project } from '@/lib/api';
import { CustomDropdown } from '@/components/ui/CustomDropdown';

interface ChangeProjectSelectProps {
  projects: Project[];
  value: string | null;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  /** Classes on the outer wrapper (e.g. ml-auto on the files header). */
  rootClassName?: string;
  /** Classes on the trigger button (overrides size preset). */
  className?: string;
  placeholder?: string;
  size?: 'compact' | 'default';
}

const COMPACT_TRIGGER_CLASS =
  'h-7 min-w-[8rem] max-w-[11rem] inline-flex items-center justify-between gap-1.5 rounded-md border border-stroke-subtle bg-white px-2 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60';

const DEFAULT_TRIGGER_CLASS =
  'h-8 min-w-[10rem] max-w-[14rem] inline-flex items-center justify-between gap-2 rounded-md border border-stroke-subtle bg-white px-2.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60';

const MENU_CLASS =
  'absolute left-0 top-full z-50 mt-1 min-w-full max-w-[16rem] rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg';

const ITEM_CLASS =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors';

export function ChangeProjectSelect({
  projects,
  value,
  onChange,
  disabled = false,
  rootClassName,
  className,
  placeholder = 'Change project',
  size = 'compact',
}: ChangeProjectSelectProps) {
  const options = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );

  const triggerClassName = className ?? (size === 'default' ? DEFAULT_TRIGGER_CLASS : COMPACT_TRIGGER_CLASS);

  return (
    <div className={rootClassName}>
      <CustomDropdown
        value={value ?? ''}
        onChange={onChange}
        options={options}
        disabled={disabled || projects.length === 0}
        placeholder={placeholder}
        ariaLabel="Change project"
        className={triggerClassName}
        menuClassName={MENU_CLASS}
        itemClassName={ITEM_CLASS}
      />
    </div>
  );
}

export function resolveDefaultProjectId(
  projects: Project[],
  ...preferredIds: Array<string | null | undefined>
): string | null {
  for (const id of preferredIds) {
    if (id && projects.some((project) => project.id === id)) {
      return id;
    }
  }
  return projects[0]?.id ?? null;
}
