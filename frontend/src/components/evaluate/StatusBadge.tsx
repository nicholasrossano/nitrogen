'use client';

import type { ComplianceFindingStatus } from '@/lib/api';

const STATUS_CONFIG: Record<ComplianceFindingStatus, { label: string; className: string }> = {
  supported: { label: 'Supported', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partially_supported: { label: 'Partially Supported', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  missing: { label: 'Missing', className: 'bg-red-50 text-red-700 border-red-200' },
  ambiguous: { label: 'Ambiguous', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  not_enough_info: { label: 'Not Enough Info', className: 'bg-gray-50 text-gray-600 border-gray-200' },
  human_review: { label: 'Human Review', className: 'bg-violet-50 text-violet-700 border-violet-200' },
};

interface StatusBadgeProps {
  status: ComplianceFindingStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_enough_info;
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium whitespace-nowrap ${config.className} ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {config.label}
    </span>
  );
}
