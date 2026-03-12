'use client';

import { ClipboardList, ArrowRight } from 'lucide-react';
import type { ReviewQueueItem } from '@/lib/api';

interface ReviewQueueProps {
  items: ReviewQueueItem[];
}

export function ReviewQueue({ items }: ReviewQueueProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-violet-600" />
        <h3 className="text-sm font-semibold text-text-primary">
          Human Review Queue
        </h3>
        <span className="text-xs text-text-tertiary">({items.length} items)</span>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="border border-violet-200 bg-violet-50/50 rounded-lg px-4 py-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{item.summary}</p>
                <p className="text-xs text-text-secondary mt-0.5">{item.framework_location}</p>
              </div>
            </div>

            {item.why_unresolved && (
              <p className="text-xs text-text-secondary">
                <span className="font-medium">Why unresolved:</span> {item.why_unresolved}
              </p>
            )}

            {item.missing_fact && (
              <p className="text-xs text-text-secondary">
                <span className="font-medium">Missing:</span> {item.missing_fact}
              </p>
            )}

            <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
              <ArrowRight className="w-3 h-3" />
              {item.suggested_next_step}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
