'use client';

import { ProjectPlanItem } from '@/lib/api';

interface PlanSubItemProps {
  item: ProjectPlanItem;
  isLast: boolean;
}

type Classification = 'required' | 'optional' | 'unknown';

const CLASSIFICATION_STYLES: Record<Classification, {
  dot: string;
  card: string;
  badge: string;
  label: string;
}> = {
  required: {
    dot: 'bg-accent',
    card: 'border-accent/30 bg-accent-wash/20',
    badge: 'bg-accent/10 text-accent',
    label: 'REQ',
  },
  optional: {
    dot: 'bg-stroke-subtle',
    card: 'border-stroke-subtle bg-white',
    badge: 'bg-surface-subtle text-text-tertiary',
    label: 'OPT',
  },
  unknown: {
    dot: 'bg-indicator-orange/60',
    card: 'border-indicator-orange/20 bg-indicator-orange/5',
    badge: 'bg-indicator-orange/10 text-indicator-orange',
    label: 'UNK',
  },
};

export function PlanSubItem({ item, isLast }: PlanSubItemProps) {
  const cls = (item.classification as Classification) ?? 'optional';
  const styles = CLASSIFICATION_STYLES[cls] ?? CLASSIFICATION_STYLES.optional;

  return (
    <div className="flex items-stretch">
      {/* Branch gutter — dot centered on the vertical line */}
      <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
        <div className="w-px bg-stroke-subtle flex-1" />
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
        {!isLast ? <div className="w-px bg-stroke-subtle flex-1" /> : <div className="flex-1" />}
        {/* Horizontal arm from dot's right edge to gutter edge */}
        <div className="absolute top-1/2 right-0 w-[calc(50%-4px)] h-px bg-stroke-subtle -translate-y-[0.5px]" />
      </div>

      {/* Node card */}
      <div className="flex-1 min-w-0 py-1.5 pr-0">
        <div className={`px-3 py-2.5 border transition-colors ${styles.card}`}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary leading-snug flex-1 min-w-0">
              {item.title}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-sm font-semibold uppercase tracking-wide leading-none flex-shrink-0 ${styles.badge}`}
            >
              {styles.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
