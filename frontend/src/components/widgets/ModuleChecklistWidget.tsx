'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Loader2, Wrench } from 'lucide-react';
import { PanelHeader } from '@/components/ui';
import { getIconByName } from '@/lib/icons';

interface ModuleRecommendation {
  tool: {
    id: string;
    name: string;
    description: string;
    icon: string;
    output_type: string;
    category: string;
  };
  confidence: number;
  recommended: boolean;
}

interface ModuleChecklistWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function ModuleChecklistWidget({ data, initiativeId, isActive = true }: ModuleChecklistWidgetProps) {
  const recommendations = (data?.recommendations || []) as ModuleRecommendation[];

  console.log('ModuleChecklistWidget render:', {
    recommendationsCount: recommendations.length,
    isActive,
    dataKeys: Object.keys(data || {})
  });

  const [selectedModules, setSelectedModules] = useState<Set<string>>(() => {
    const ids = recommendations
      .filter(r => r?.recommended)
      .map(r => r?.tool?.id)
      .filter((id): id is string => typeof id === 'string');
    const initial = new Set<string>(ids);
    console.log('ModuleChecklistWidget: initial selectedModules', Array.from(initial));
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const { selectTools } = useInitiativeStore();

  if (!recommendations.length) {
    console.log('ModuleChecklistWidget: no recommendations, showing fallback');
    return <div className="text-text-tertiary text-sm">No modules available</div>;
  }

  const toggleModule = (moduleId: string) => {
    console.log('ModuleChecklistWidget toggleModule:', moduleId);
    try {
      const newSelected = new Set(selectedModules);
      if (newSelected.has(moduleId)) {
        newSelected.delete(moduleId);
      } else {
        newSelected.add(moduleId);
      }
      console.log('ModuleChecklistWidget: new selection', Array.from(newSelected));
      setSelectedModules(newSelected);
    } catch (error) {
      console.error('ModuleChecklistWidget toggleModule error:', error);
    }
  };

  const handleConfirm = async () => {
    if (selectedModules.size === 0) return;

    setLoading(true);
    try {
      await selectTools(initiativeId, Array.from(selectedModules));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={Wrench}
        title="Available Modules"
        subtitle="Select the deliverables you'd like to prepare"
      />

      {/* Module list */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-3 bg-white">
        {recommendations.map((rec, index) => {
          if (!rec?.tool?.id) {
            console.warn('ModuleChecklistWidget: skipping invalid recommendation at index', index, rec);
            return null;
          }

          const moduleId = rec.tool.id;
          const isSelected = selectedModules.has(moduleId);
          const Icon = getIconByName(rec.tool.icon || 'FileText');

          return (
            <button
              key={moduleId}
              type="button"
              onClick={() => isActive && toggleModule(moduleId)}
              disabled={!isActive}
              className={`
                selectable-item flex items-start gap-3 p-3 text-left w-full
                ${isSelected ? 'selected' : 'border-stroke-subtle'}
                ${!isActive ? 'pointer-events-none opacity-60' : ''}
              `}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Icon className="w-4 h-4 text-accent" />
                  <span className="font-medium text-text-primary text-sm">{rec.tool.name || 'Unknown Module'}</span>
                  {(rec.confidence || 0) > 0.5 && (
                    <span className="badge-accent text-sm">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {rec.tool.description || 'No description available'}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Actions - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-surface-header border-t border-divider">
          <button
            onClick={handleConfirm}
            disabled={loading || selectedModules.size === 0}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                Continue with {selectedModules.size} module{selectedModules.size !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
