import { Minus } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem } from '@/lib/api';

interface PlanSubItemProps {
  item: ProjectPlanItem;
  isLast: boolean;
  deepDiveResult?: DeepDiveResult | null;
  onDeepDive?: (item: ProjectPlanItem) => void;
  onDelete?: () => void;
  onDeleteElement?: (elementIndex: number) => void;
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
    card: 'bg-surface',
    badge: 'bg-accent/10 text-accent',
    label: 'REQ',
  },
  optional: {
    dot: 'bg-accent',
    card: 'bg-surface',
    badge: 'bg-surface-subtle text-text-tertiary',
    label: 'OPT',
  },
  unknown: {
    dot: 'bg-accent',
    card: 'bg-surface',
    badge: 'bg-indicator-orange/10 text-indicator-orange',
    label: 'UNK',
  },
};


export function PlanSubItem({ item, isLast, onDeepDive, onDelete }: PlanSubItemProps) {
  const cls = (item.classification as Classification) ?? 'optional';
  const styles = CLASSIFICATION_STYLES[cls] ?? CLASSIFICATION_STYLES.optional;
  const isClickable = Boolean(onDeepDive);

  return (
    <div className="flex items-stretch relative group/item">
      {/* Branch gutter */}
      <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
        <div className="w-px bg-stroke-subtle flex-1" />
        <div className="relative flex-shrink-0 w-2 h-2">
          <div className={`w-2 h-2 rounded-full transition-opacity duration-200 ease-in-out ${onDelete ? 'group-hover/item:opacity-0' : ''} ${styles.dot}`} />
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 opacity-0 scale-50 group-hover/item:opacity-100 group-hover/item:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out z-20"
              aria-label="Delete item"
            >
              <Minus className="w-2.5 h-2.5 text-white" />
            </button>
          )}
        </div>
        {!isLast
          ? <div className="w-px bg-stroke-subtle flex-1" />
          : <div className="flex-1" />}
        <div className="absolute top-1/2 right-0 w-[calc(50%-4px)] h-px bg-stroke-subtle -translate-y-[0.5px]" />
      </div>

      {/* Node card */}
      <div className="flex-1 min-w-0 py-1.5 pr-2">
        <div
          className={`px-3 py-2.5 rounded-md shadow-card ${styles.card} ${isClickable ? 'plan-item-lift cursor-pointer' : ''} relative`}
          onClick={isClickable ? () => onDeepDive!(item) : undefined}
          role={isClickable ? 'button' : undefined}
          tabIndex={isClickable ? 0 : undefined}
          onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDeepDive!(item); } } : undefined}
          aria-label={isClickable ? `Deep dive: ${item.title}` : undefined}
        >
          <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-sm font-semibold uppercase tracking-wide leading-none ${styles.badge}`}>
            {styles.label}
          </span>
          <span className="text-sm font-medium text-text-primary leading-snug block pr-10">
            {item.title}
          </span>
        </div>
      </div>
    </div>
  );
}
