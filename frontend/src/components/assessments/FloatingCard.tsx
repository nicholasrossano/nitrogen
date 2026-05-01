import type { ReactNode } from 'react';

/**
 * Shared floating card shell used across all assessment workflow stages
 * (Setup, Build, Output). Consistent chrome: tinted header + footer,
 * white body — matching bg-surface-subtle / bg-white contrast.
 */
export function FloatingCard({
  title,
  children,
  footer,
  className = '',
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-elevated overflow-hidden mb-3 ${className}`}>
      <div className="px-4 py-2.5 border-b border-divider bg-surface-subtle">
        <p className="text-sm font-medium text-text-primary">{title}</p>
      </div>
      <div className="bg-white px-1 py-1">{children}</div>
      {footer && (
        <div className="px-5 py-3 bg-surface-subtle border-t border-divider flex justify-center">
          {footer}
        </div>
      )}
    </div>
  );
}
