import type { VariableStatus } from '@/lib/api';
import { StatusCapsule } from '@/components/ui/StatusCapsule';

const STATUS_CLASS: Record<VariableStatus, string> = {
  validated: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  extracted: 'bg-sky-50 text-sky-700 border-sky-200',
  assumed: 'bg-amber-50 text-amber-700 border-amber-200',
  missing: 'bg-surface-subtle text-text-secondary border-stroke-subtle',
};

export const VARIABLE_STATUS_DEFINITIONS: Array<{
  status: VariableStatus;
  description: string;
}> = [
  { status: 'validated', description: 'Confirmed by a person and locked in as correct.' },
  { status: 'extracted', description: 'Pulled automatically from an uploaded document.' },
  { status: 'assumed', description: "A default or AI-suggested value that hasn't been confirmed." },
  { status: 'missing', description: 'No value has been provided yet.' },
];

/** Pill used in the Variables mini stack and full float table — keep in sync by sharing this. */
export function VariableStatusCapsule({
  status,
  className = '',
}: {
  status: VariableStatus;
  className?: string;
}) {
  return (
    <StatusCapsule className={`${STATUS_CLASS[status]} ${className}`.trim()}>
      {status}
    </StatusCapsule>
  );
}
