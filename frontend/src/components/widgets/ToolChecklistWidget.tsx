'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Check, Loader2 } from 'lucide-react';
import { getIconByName } from '@/lib/icons';

interface ToolRecommendation {
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

interface ToolChecklistWidgetProps {
  data: {
    recommendations: ToolRecommendation[];
    project_type: string | null;
  };
  initiativeId: string;
  isActive?: boolean;
}

export function ToolChecklistWidget({ data, initiativeId, isActive = true }: ToolChecklistWidgetProps) {
  // Defensive: ensure recommendations is an array
  const recommendations = data?.recommendations || [];
  
  const [selectedTools, setSelectedTools] = useState<Set<string>>(() => 
    new Set(recommendations.filter(r => r.recommended).map(r => r.tool.id))
  );
  const [loading, setLoading] = useState(false);
  const { selectTools } = useInitiativeStore();
  
  // Don't render if no recommendations
  if (!recommendations.length) {
    return <div className="text-text-tertiary text-sm">No tools available</div>;
  }

  const toggleTool = (toolId: string) => {
    const newSelected = new Set(selectedTools);
    if (newSelected.has(toolId)) {
      newSelected.delete(toolId);
    } else {
      newSelected.add(toolId);
    }
    setSelectedTools(newSelected);
  };

  const handleConfirm = async () => {
    if (selectedTools.size === 0) return;
    
    setLoading(true);
    try {
      await selectTools(initiativeId, Array.from(selectedTools));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-subtle border-b border-divider">
        <h3 className="font-semibold text-text-primary">Available Tools</h3>
        <p className="text-sm text-text-secondary">
          Select the deliverables you'd like to prepare
        </p>
      </div>

      {/* Tool list */}
      <div className="p-5 space-y-3 bg-white">
        {recommendations.map((rec) => {
          const isSelected = selectedTools.has(rec.tool.id);
          const Icon = getIconByName(rec.tool.icon);
          
          return (
            <label
              key={rec.tool.id}
              className={`
                flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors duration-150
                ${isSelected 
                  ? 'border-accent bg-accent-wash/30' 
                  : 'border-stroke-subtle hover:border-accent-tint hover:bg-surface-subtle'
                }
                ${!isActive ? 'pointer-events-none opacity-60' : ''}
              `}
            >
              <div className={`
                w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors
                ${isSelected 
                  ? 'border-accent bg-accent' 
                  : 'border-stroke-subtle'
                }
              `}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
              
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleTool(rec.tool.id)}
                className="sr-only"
                disabled={!isActive}
              />
              
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Icon className="w-4 h-4 text-accent" />
                  <span className="font-medium text-text-primary text-sm">{rec.tool.name}</span>
                  {rec.confidence > 0.5 && (
                    <span className="badge-accent text-xs">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {rec.tool.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Actions - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-surface-subtle border-t border-divider">
          <button
            onClick={handleConfirm}
            disabled={loading || selectedTools.size === 0}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                Continue with {selectedTools.size} tool{selectedTools.size !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
