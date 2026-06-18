'use client';

import type { LucideIcon } from 'lucide-react';
import { getIconByName } from '@/lib/icons';

export type AccentIconBadgeSize = 'sm' | 'md';

const SIZE_CLASSES: Record<AccentIconBadgeSize, { container: string; icon: string }> = {
  sm: {
    container: 'h-5 w-5 rounded',
    icon: 'w-3 h-3',
  },
  md: {
    container: 'w-10 h-10 rounded',
    icon: 'w-5 h-5',
  },
};

export function accentIconBadgeClasses(size: AccentIconBadgeSize = 'md') {
  const { container, icon } = SIZE_CLASSES[size];
  return {
    container: `flex shrink-0 items-center justify-center bg-accent-wash text-accent ${container}`,
    icon,
  };
}

interface AccentIconBadgeProps {
  icon?: LucideIcon;
  iconName?: string | null;
  size?: AccentIconBadgeSize;
  className?: string;
  iconClassName?: string;
}

export function AccentIconBadge({
  icon,
  iconName,
  size = 'md',
  className,
  iconClassName,
}: AccentIconBadgeProps) {
  const Icon = icon ?? getIconByName(iconName);
  const classes = accentIconBadgeClasses(size);

  return (
    <div className={`${classes.container} ${className ?? ''}`}>
      <Icon className={`${classes.icon} ${iconClassName ?? ''}`} />
    </div>
  );
}
