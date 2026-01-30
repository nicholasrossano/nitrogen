'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Check, Loader2 } from 'lucide-react';

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
    return <div className="text-brown/50 text-sm">No tools available</div>;
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
      <div className="px-5 py-4 bg-gradient-to-r from-primary-50 to-accent/10 border-b border-beige/50">
        <h3 className="font-semibold text-brown">Available Tools</h3>
        <p className="text-sm text-brown/60">
          Select the deliverables you'd like to prepare
        </p>
      </div>

      {/* Tool list */}
      <div className="p-5 space-y-3 bg-cream">
        {recommendations.map((rec) => {
          const isSelected = selectedTools.has(rec.tool.id);
          
          return (
            <label
              key={rec.tool.id}
              className={`
                flex items-start gap-4 p-4 rounded-widget border cursor-pointer transition-all duration-200
                ${isSelected 
                  ? 'border-primary-300 bg-primary-50' 
                  : 'border-beige hover:border-primary-200 hover:bg-blush/30'
                }
                ${!isActive ? 'pointer-events-none opacity-60' : ''}
              `}
            >
              <div className={`
                w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors
                ${isSelected 
                  ? 'border-primary-600 bg-primary-600' 
                  : 'border-beige'
                }
              `}>
                {isSelected && <Check className="w-4 h-4 text-white" />}
              </div>
              
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleTool(rec.tool.id)}
                className="sr-only"
                disabled={!isActive}
              />
              
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xl">{rec.tool.icon}</span>
                  <span className="font-medium text-brown">{rec.tool.name}</span>
                  {rec.confidence > 0.5 && (
                    <span className="text-xs px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full font-medium">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-sm text-brown/70 mt-1 leading-relaxed">
                  {rec.tool.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Actions - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-blush/50 border-t border-beige/50">
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
