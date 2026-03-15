import { Minus, Check, FileCheck2, Calculator } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem } from '@/lib/api';
import { Tooltip } from '@/components/ui/Tooltip';

interface PlanSubItemProps {
  item: ProjectPlanItem;
  isLast: boolean;
  deepDiveResult?: DeepDiveResult | null;
  onDeepDive?: (item: ProjectPlanItem) => void;
  onDelete?: () => void;
  onDeleteElement?: (elementIndex: number) => void;
  isComplete?: boolean;
  onToggleComplete?: (id: string) => void;
  /** When true, hide the branch gutter (T lines) — used in phase view where vertical line comes from parent */
  hideBranchGutter?: boolean;
  /** When true, card stretches to full width of container */
  fullWidth?: boolean;
}

type ItemType = 'deliverable' | 'assessment';

const ITEM_TYPE_STYLES: Record<ItemType, {
  badge: string;
  tooltip: string;
  Icon: typeof FileCheck2;
}> = {
  deliverable: {
    badge: 'bg-accent-secondary-wash text-accent-secondary',
    tooltip: 'Deliverable',
    Icon: FileCheck2,
  },
  assessment: {
    badge: 'bg-indicator-green/10 text-indicator-green',
    tooltip: 'Assessment',
    Icon: Calculator,
  },
};


export function PlanSubItem({ item, isLast, onDeepDive, onDelete, isComplete = false, onToggleComplete, hideBranchGutter = false, fullWidth = false }: PlanSubItemProps) {
  const itemType: ItemType = (item.item_type as ItemType) ?? 'deliverable';
  const typeStyle = ITEM_TYPE_STYLES[itemType];
  const isClickable = Boolean(onDeepDive);

  return (
    <div className="flex items-stretch relative group/item">
      {/* Branch gutter — all absolute lines, guaranteed connected (hidden in phase view) */}
      {!hideBranchGutter && (
        <div className="w-8 flex-shrink-0 relative">
          {/* Vertical line: top-0 to center for last, full height for others */}
          <div className={`absolute left-1/2 top-0 w-px bg-stroke-subtle ${isLast ? 'h-1/2' : 'h-full'}`} />
          {/* Horizontal line: center to right edge */}
          <div className="absolute top-1/2 left-1/2 right-0 h-px bg-stroke-subtle" />
          {/* Dot + delete button at intersection */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <div className="relative w-2 h-2">
              <div className={`w-2 h-2 rounded-full transition-opacity duration-200 ${onDelete ? 'group-hover/item:opacity-0' : ''} bg-stroke-muted`} />
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 opacity-0 scale-50 group-hover/item:opacity-100 group-hover/item:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out"
                  aria-label="Delete item"
                >
                  <Minus className="w-2.5 h-2.5 text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Node card */}
      <div className={`flex-1 min-w-0 py-1.5 ${hideBranchGutter ? 'pl-0 pr-2' : 'pr-2'}`}>
        <div
          className={`px-3 py-2 rounded-md shadow-card flex items-center gap-2 transition-colors ${fullWidth ? 'w-full' : ''} ${
            isComplete
              ? 'bg-green-50/30 border border-green-200/50'
              : `bg-surface border border-transparent ${isClickable ? 'plan-item-lift cursor-pointer' : ''}`
          }`}
          onClick={isClickable && !isComplete ? () => onDeepDive!(item) : undefined}
          role={isClickable && !isComplete ? 'button' : undefined}
          tabIndex={isClickable && !isComplete ? 0 : undefined}
          onKeyDown={isClickable && !isComplete ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDeepDive!(item); } } : undefined}
          aria-label={isClickable ? `Deep dive: ${item.title}` : undefined}
        >
          {/* Item type badge — leading */}
          <Tooltip content={typeStyle.tooltip}>
            <span className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-opacity ${
              isComplete ? 'opacity-40' : ''
            } ${typeStyle.badge}`}>
              <typeStyle.Icon className="w-3 h-3" />
            </span>
          </Tooltip>

          {/* Title */}
          <span className={`flex-1 text-sm font-medium leading-snug transition-colors ${
            isComplete ? 'text-text-tertiary' : 'text-text-primary'
          }`}>
            {item.title}
          </span>

          {/* Checkbox — trailing */}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleComplete?.(item.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={isComplete ? 'Mark incomplete' : 'Mark complete'}
            className={`p-2 -m-2 flex items-center justify-center flex-shrink-0 group/check`}
          >
            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150 pointer-events-none ${
              isComplete
                ? 'bg-green-500 border-green-500'
                : 'border-stroke-muted group-hover/check:border-green-400 bg-transparent'
            }`}>
              {isComplete && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
