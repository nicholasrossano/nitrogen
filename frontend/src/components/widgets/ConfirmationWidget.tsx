'use client';

import { useInitiativeStore } from '@/stores/initiativeStore';
import { Check, Edit2, Loader2, MapPin, Users, Target, DollarSign, Clock, AlertCircle } from 'lucide-react';

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
      {/* Header - Warm blush gradient */}
      <div className="px-5 py-4 bg-gradient-to-r from-blush to-beige/50 border-b border-beige/50">
        <h3 className="font-semibold text-brown">Initiative Summary</h3>
        <p className="text-sm text-brown/60">Please review and confirm</p>
      </div>

      {/* Content */}
      <div className="p-5 space-y-4 bg-cream">
        {/* Title */}
        {data.title && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4 text-brown/70" />
            </div>
            <div>
              <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Title</p>
              <p className="text-sm font-medium text-brown">{data.title}</p>
            </div>
          </div>
        )}

        {/* Sector & Geography */}
        <div className="grid grid-cols-2 gap-4">
          {data.sector && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
                <span className="text-sm">🍳</span>
              </div>
              <div>
                <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Sector</p>
                <p className="text-sm text-brown capitalize">{data.sector.replace('_', ' ')}</p>
              </div>
            </div>
          )}

          {data.geography && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-brown/70" />
              </div>
              <div>
                <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Geography</p>
                <p className="text-sm text-brown">{data.geography}</p>
              </div>
            </div>
          )}
        </div>

        {/* Target Population */}
        {data.target_population && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-brown/70" />
            </div>
            <div>
              <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Target Population</p>
              <p className="text-sm text-brown">{data.target_population}</p>
            </div>
          </div>
        )}

        {/* Goal */}
        {data.goal && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4 text-brown/70" />
            </div>
            <div>
              <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Goal</p>
              <p className="text-sm text-brown">{data.goal}</p>
            </div>
          </div>
        )}

        {/* Budget & Timeline (optional) */}
        {(data.budget_range || data.timeline) && (
          <div className="grid grid-cols-2 gap-4">
            {data.budget_range && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-brown/70" />
                </div>
                <div>
                  <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Budget</p>
                  <p className="text-sm text-brown">{data.budget_range}</p>
                </div>
              </div>
            )}

            {data.timeline && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-brown/70" />
                </div>
                <div>
                  <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Timeline</p>
                  <p className="text-sm text-brown">{data.timeline}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Constraints */}
        {data.constraints && data.constraints.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-pill bg-blush flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-brown/70" />
            </div>
            <div>
              <p className="text-xs text-brown/50 uppercase tracking-wide font-medium">Constraints</p>
              <ul className="text-sm text-brown list-disc list-inside">
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
        <div className="px-5 py-4 bg-blush/50 border-t border-beige/50 flex gap-3">
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
