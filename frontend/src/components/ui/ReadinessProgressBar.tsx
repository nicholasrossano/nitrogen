'use client';

import { Tooltip } from './Tooltip';

export interface ReadinessProgressSegment {
  id: string;
  label: string;
  color: string;
  completed: number;
  total: number;
}

export interface ReadinessProgressData {
  completed: number;
  total: number;
  percentage: number;
  segments: ReadinessProgressSegment[];
}

interface ReadinessProgressBarProps {
  progress: ReadinessProgressData;
  className?: string;
  showSegmentTooltips?: boolean;
}

const DEFAULT_CONTAINER_CLASS =
  'flex-shrink-0 px-4 pt-3 pb-2.5 border-b border-divider bg-surface-header';

export function ReadinessProgressBar({
  progress,
  className,
  showSegmentTooltips = false,
}: ReadinessProgressBarProps) {
  const containerClass = className ?? DEFAULT_CONTAINER_CLASS;

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-text-tertiary">
          <span className="uppercase tracking-[0.08em] text-text-secondary">Readiness</span>
          {' '}• <span className="font-medium text-text-secondary">{progress.completed}</span>
          {' '}of {progress.total} complete
        </span>
        <span className="text-[11px] font-medium text-text-secondary tabular-nums">
          {progress.percentage}%
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-surface-subtle w-full">
        <div className="h-full w-full flex">
          {progress.segments.map((segment, idx) => {
            const widthPct = progress.total > 0 ? (segment.completed / progress.total) * 100 : 0;
            const hasLaterFilledSegment = progress.segments.slice(idx + 1).some((next) => next.completed > 0);

            const segmentNode = (
              <div
                className="h-full transition-[width] duration-300 ease-out flex-shrink-0"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: widthPct > 0 ? segment.color : 'transparent',
                  borderRadius: !hasLaterFilledSegment ? '0 9999px 9999px 0' : undefined,
                }}
              />
            );

            if (!showSegmentTooltips) {
              return (
                <div key={segment.id} className="contents">
                  {segmentNode}
                </div>
              );
            }

            return (
              <Tooltip
                key={segment.id}
                content={`${segment.label}: ${segment.completed} / ${segment.total}`}
                className="contents"
              >
                {segmentNode}
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
