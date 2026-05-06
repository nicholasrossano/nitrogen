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
    'inline-flex items-center gap-1 rounded border text-[10px] font-medium leading-none transition-colors select-none',
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
      {icon}
      {label}
    </span>
  );

  if (onActivate) {
    const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    };
    return (
      <span role="button" tabIndex={0} className="no-underline cursor-pointer" onClick={onActivate} onKeyDown={handleKeyDown}>
        {chip}
      </span>
    );
  }

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex no-underline" onClick={onLinkClick ?? undefined}>
        {chip}
      </a>
    );
  }

  return chip;
}
