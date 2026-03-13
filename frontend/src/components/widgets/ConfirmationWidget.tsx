'use client';

import { useInitiativeStore } from '@/stores/initiativeStore';
import { Check, Edit2, Loader2, MapPin, Users, Target, DollarSign, Clock, AlertCircle, Flame, ClipboardList } from 'lucide-react';
import { PanelHeader } from '@/components/ui';

interface ConfirmationWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function ConfirmationWidget({ data, initiativeId, isActive = true }: ConfirmationWidgetProps) {
  const { confirmIntake, sendMessage, loading } = useInitiativeStore();

  const handleConfirm = async () => {
    await confirmIntake(initiativeId);
  };

  const handleEdit = async () => {
    await sendMessage(initiativeId, "I'd like to make some changes to the initiative details.");
  };

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={ClipboardList}
        title="Initiative Summary"
        subtitle="Please review and confirm"
      />

      {/* Content */}
      <div className="p-5 space-y-4 bg-white">
        {/* Title */}
        {data.title && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Title</p>
              <p className="text-sm font-medium text-text-primary">{data.title}</p>
            </div>
          </div>
        )}

        {/* Sector & Geography */}
        <div className="grid grid-cols-2 gap-4">
          {data.sector && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Flame className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Sector</p>
                <p className="text-sm text-text-primary capitalize">{data.sector.replace('_', ' ')}</p>
              </div>
            </div>
          )}

          {data.geography && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Geography</p>
                <p className="text-sm text-text-primary">{data.geography}</p>
              </div>
            </div>
          )}
        </div>

        {/* Target Population */}
        {data.target_population && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Target Population</p>
              <p className="text-sm text-text-primary">{data.target_population}</p>
            </div>
          </div>
        )}

        {/* Goal */}
        {data.goal && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Goal</p>
              <p className="text-sm text-text-primary">{data.goal}</p>
            </div>
          </div>
        )}

        {/* Budget & Timeline (optional) */}
        {(data.budget_range || data.timeline) && (
          <div className="grid grid-cols-2 gap-4">
            {data.budget_range && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Budget</p>
                  <p className="text-sm text-text-primary">{data.budget_range}</p>
                </div>
              </div>
            )}

            {data.timeline && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Timeline</p>
                  <p className="text-sm text-text-primary">{data.timeline}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Constraints */}
        {data.constraints && data.constraints.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded bg-indicator-orange/10 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-indicator-orange" />
            </div>
            <div>
              <p className="text-sm text-text-tertiary uppercase tracking-wide font-medium">Constraints</p>
              <ul className="text-sm text-text-primary list-disc list-inside">
                {data.constraints.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Actions - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-surface-header border-t border-divider flex gap-3">
          <button
            onClick={handleEdit}
            disabled={loading}
            className="btn-secondary flex-1 py-2.5"
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="btn-primary flex-1 py-2.5"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                Confirm
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
