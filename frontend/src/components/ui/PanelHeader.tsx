import type { ComponentType, ReactNode } from 'react';

interface PanelHeaderProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** Optional secondary line below the title */
  subtitle?: ReactNode;
  /** Optional right-side content: close/delete buttons, date labels, etc. */
  action?: ReactNode;
}

export function PanelHeader({ icon: Icon, title, subtitle, action }: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-divider flex-shrink-0 bg-surface-header">
      <Icon className="w-4 h-4 text-text-tertiary flex-shrink-0" />
      {subtitle != null ? (
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary truncate">{title}</h3>
          <div className="text-xs text-text-tertiary">{subtitle}</div>
        </div>
      ) : (
        <h3 className="text-sm font-medium text-text-primary truncate flex-1">{title}</h3>
      )}
      {action}
    </div>
  );
}
