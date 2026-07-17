import type { ReactNode } from 'react';

const SIZE_CLASS = {
  sm: 'px-1.5 py-0.5 text-[9px]',
  md: 'px-2 py-1 text-[9px]',
} as const;

/** Shared status/confidence pill shell — keep all capsules on this base. */
export function StatusCapsule({
  children,
  className = '',
  size = 'sm',
}: {
  children: ReactNode;
  className?: string;
  /** `sm` matches Variables; `md` is taller for project status overview. */
  size?: keyof typeof SIZE_CLASS;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium uppercase tracking-wide leading-none ${SIZE_CLASS[size]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
