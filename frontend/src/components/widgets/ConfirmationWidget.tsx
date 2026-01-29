'use client';

import { useInitiativeStore } from '@/stores/initiativeStore';
import { Check, Edit2, Loader2, MapPin, Users, Target, DollarSign, Clock, AlertCircle } from 'lucide-react';

interface ConfirmationWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
}

export function ConfirmationWidget({ data, initiativeId }: ConfirmationWidgetProps) {
  const { confirmIntake, sendMessage, loading } = useInitiativeStore();

  const handleConfirm = async () => {
    await confirmIntake(initiativeId);
  };

  const handleEdit = async () => {
    await sendMessage(initiativeId, "I'd like to make some changes to the initiative details.");
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-primary-50 to-primary-100 border-b border-primary-200">
        <h3 className="font-semibold text-primary-900">Initiative Summary</h3>
        <p className="text-sm text-primary-700">Please review and confirm</p>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title */}
        {data.title && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4 text-gray-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Title</p>
              <p className="text-sm font-medium text-gray-900">{data.title}</p>
            </div>
          </div>
        )}

        {/* Sector & Geography */}
        <div className="grid grid-cols-2 gap-3">
          {data.sector && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <span className="text-sm">🍳</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Sector</p>
                <p className="text-sm text-gray-900 capitalize">{data.sector.replace('_', ' ')}</p>
              </div>
            </div>
          )}

          {data.geography && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-gray-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Geography</p>
                <p className="text-sm text-gray-900">{data.geography}</p>
              </div>
            </div>
          )}
        </div>

        {/* Target Population */}
        {data.target_population && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-gray-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Target Population</p>
              <p className="text-sm text-gray-900">{data.target_population}</p>
            </div>
          </div>
        )}

        {/* Goal */}
        {data.goal && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4 text-gray-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Goal</p>
              <p className="text-sm text-gray-900">{data.goal}</p>
            </div>
          </div>
        )}

        {/* Budget & Timeline (optional) */}
        {(data.budget_range || data.timeline) && (
          <div className="grid grid-cols-2 gap-3">
            {data.budget_range && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Budget</p>
                  <p className="text-sm text-gray-900">{data.budget_range}</p>
                </div>
              </div>
            )}

            {data.timeline && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Timeline</p>
                  <p className="text-sm text-gray-900">{data.timeline}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Constraints */}
        {data.constraints && data.constraints.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-gray-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Constraints</p>
              <ul className="text-sm text-gray-900 list-disc list-inside">
                {data.constraints.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-3">
        <button
          onClick={handleEdit}
          disabled={loading}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          <Edit2 className="w-4 h-4 inline mr-2" />
          Edit
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-primary-600 rounded-lg text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
    </div>
  );
}
