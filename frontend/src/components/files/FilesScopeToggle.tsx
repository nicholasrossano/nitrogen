'use client';

export type FilesScope = 'workspace' | 'project';

interface FilesScopeToggleProps {
  value: FilesScope;
  onChange: (scope: FilesScope) => void;
  className?: string;
}

/** Compact segmented control for workspace vs project files. */
export function FilesScopeToggle({ value, onChange, className = '' }: FilesScopeToggleProps) {
  return (
    <div
      className={`flex items-center rounded-lg bg-black/[0.04] p-0.5 ring-1 ring-inset ring-black/[0.08] ${className}`.trim()}
      role="group"
      aria-label="Files scope"
    >
      {(
        [
          { id: 'workspace', label: 'Workspace' },
          { id: 'project', label: 'Project' },
        ] as const
      ).map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            value === option.id
              ? 'bg-white text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
