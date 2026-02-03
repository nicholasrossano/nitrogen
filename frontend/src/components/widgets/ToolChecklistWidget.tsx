'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Loader2 } from 'lucide-react';
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
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function ToolChecklistWidget({ data, initiativeId, isActive = true }: ToolChecklistWidgetProps) {
  // Defensive: ensure recommendations is an array
  const recommendations = (data?.recommendations || []) as ToolRecommendation[];
  
  // Debug logging
  console.log('ToolChecklistWidget render:', { 
    recommendationsCount: recommendations.length,
    isActive,
    dataKeys: Object.keys(data || {})
  });
  
  const [selectedTools, setSelectedTools] = useState<Set<string>>(() => {
    const ids = recommendations
      .filter(r => r?.recommended)
      .map(r => r?.tool?.id)
      .filter((id): id is string => typeof id === 'string');
    const initial = new Set<string>(ids);
    console.log('ToolChecklistWidget: initial selectedTools', Array.from(initial));
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const { selectTools } = useInitiativeStore();
  
  // Don't render if no recommendations
  if (!recommendations.length) {
    console.log('ToolChecklistWidget: no recommendations, showing fallback');
    return <div className="text-text-tertiary text-sm">No tools available</div>;
  }

  const toggleTool = (toolId: string) => {
    console.log('ToolChecklistWidget toggleTool:', toolId);
    try {
      const newSelected = new Set(selectedTools);
      if (newSelected.has(toolId)) {
        newSelected.delete(toolId);
      } else {
        newSelected.add(toolId);
      }
      console.log('ToolChecklistWidget: new selection', Array.from(newSelected));
      setSelectedTools(newSelected);
    } catch (error) {
      console.error('ToolChecklistWidget toggleTool error:', error);
    }
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
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <h3 className="text-sm font-semibold text-text-primary">Available Tools</h3>
        <p className="text-sm text-text-secondary">
          Select the deliverables you'd like to prepare
        </p>
      </div>

      {/* Tool list */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-3 bg-white">
        {recommendations.map((rec, index) => {
          // Defensive: skip invalid recommendations
          if (!rec?.tool?.id) {
            console.warn('ToolChecklistWidget: skipping invalid recommendation at index', index, rec);
            return null;
          }
          
          const toolId = rec.tool.id;
          const isSelected = selectedTools.has(toolId);
          const Icon = getIconByName(rec.tool.icon || 'FileText');
          
          return (
            <button
              key={toolId}
              type="button"
              onClick={() => isActive && toggleTool(toolId)}
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
                  <span className="font-medium text-text-primary text-sm">{rec.tool.name || 'Unknown Tool'}</span>
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
