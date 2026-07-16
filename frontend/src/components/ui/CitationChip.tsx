import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

type CitationChipSize = 'chat' | 'compact';

interface CitationChipProps {
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
  href?: string | null;
  selected?: boolean;
  size?: CitationChipSize;
  className?: string;
  onActivate?: (() => void) | null;
  onLinkClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | null;
}

function classesForChip({
  selected,
  size,
  className,
}: {
  selected: boolean;
  size: CitationChipSize;
  className?: string;
}): string {
  return [
    // min-w-0 + max-w-full so chips shrink inside table/flex columns instead of overflowing.
    'inline-flex min-w-0 max-w-full items-center gap-1 rounded border text-[10px] font-medium leading-none transition-colors select-none',
    size === 'chat' ? 'px-1.5 py-0.5 mx-0.5 align-[0.1em]' : 'px-1.5 py-0.5',
    selected
      ? 'bg-accent/[0.12] border-accent/40 text-accent'
      : 'bg-surface-subtle border-stroke-subtle text-text-secondary hover:bg-accent/[0.07] hover:border-accent/30 hover:text-accent',
    className ?? '',
  ].join(' ');
}

export function CitationChip({
  label,
  icon,
  title,
  href = null,
  selected = false,
  size = 'chat',
  className,
  onActivate = null,
  onLinkClick = null,
}: CitationChipProps) {
  const chip = (
    <span title={title} className={classesForChip({ selected, size, className })}>
      {icon != null ? <span className="inline-flex shrink-0">{icon}</span> : null}
      {typeof label === 'string' || typeof label === 'number' ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : (
        label
      )}
    </span>
  );

  if (onActivate) {
    const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      onActivate();
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }
    };
    return (
      <span
        role="button"
        tabIndex={0}
        className="inline-flex min-w-0 max-w-full no-underline cursor-pointer"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {chip}
      </span>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 max-w-full no-underline"
        onClick={onLinkClick ?? undefined}
      >
        {chip}
      </a>
    );
  }

  return chip;
}
