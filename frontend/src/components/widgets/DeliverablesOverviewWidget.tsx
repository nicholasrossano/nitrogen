'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Sparkles, Loader2, FileText, Target, MapPin, Globe } from 'lucide-react';
import { getIconByName } from '@/lib/icons';

interface ToolInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  output_type: string;
}

interface SDGInfo {
  sdg: string;
  sdg_name: string;
  target: string;
  target_name: string;
  display: string;
}

interface DeliverablesOverviewWidgetProps {
  data: {
    project_summary: {
      title?: string;
      project_description?: string;
      geography?: string;
      target_population?: string;
      goal?: string;
      budget_range?: string;
      timeline?: string;
      tool_inputs?: {
        sdg?: SDGInfo;
      };
    };
    selected_tools: ToolInfo[];
    tool_inputs: Record<string, any>;
  };
  initiativeId: string;
  isActive?: boolean;
}

export function DeliverablesOverviewWidget({ data, initiativeId, isActive = true }: DeliverablesOverviewWidgetProps) {
  const [loading, setLoading] = useState(false);
  const { generateAllDeliverables } = useInitiativeStore();

  const handleGenerate = async () => {
    setLoading(true);
    try {
      await generateAllDeliverables(initiativeId);
    } finally {
      setLoading(false);
    }
  };

  const summary = data.project_summary;
  const sdg = data.tool_inputs?.sdg || summary.tool_inputs?.sdg;

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-subtle border-b border-divider">
        <h3 className="font-semibold text-text-primary">Project Overview</h3>
        <p className="text-sm text-text-secondary">
          Review your project details and deliverables
        </p>
      </div>

      {/* Project Summary */}
      <div className="p-5 space-y-4 bg-white border-b border-divider">
        <h4 className="text-sm font-semibold text-text-tertiary uppercase tracking-wide">
          Project Details
        </h4>
        
        <div className="space-y-3">
          {summary.title && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Target className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-xs text-text-tertiary uppercase tracking-wide">Project</p>
                <p className="text-sm font-medium text-text-primary">{summary.title}</p>
              </div>
            </div>
          )}
          
          {summary.geography && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-xs text-text-tertiary uppercase tracking-wide">Location</p>
                <p className="text-sm text-text-primary">{summary.geography}</p>
              </div>
            </div>
          )}
          
          {sdg && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Globe className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-xs text-text-tertiary uppercase tracking-wide">Sustainable Development Goal</p>
                <p className="text-sm font-medium text-text-primary">{sdg.display}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deliverables */}
      <div className="p-5 space-y-4 bg-white">
        <h4 className="text-sm font-semibold text-text-tertiary uppercase tracking-wide">
          What We'll Generate
        </h4>
        
        <div className="flex flex-wrap gap-2">
          {data.selected_tools.map((tool) => {
            const Icon = getIconByName(tool.icon);
            return (
              <div
                key={tool.id}
                className="flex items-center gap-2 px-3 py-2 bg-surface-subtle rounded border border-stroke-subtle"
              >
                <Icon className="w-4 h-4 text-accent" />
                <span className="text-sm font-medium text-text-primary">{tool.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Generate button - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-surface-subtle border-t border-divider">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full px-6 py-3 bg-accent text-white rounded font-medium hover:bg-accent-anchor transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating deliverables...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate All Deliverables
              </>
            )}
          </button>
          
          {loading && (
            <p className="text-xs text-center text-text-tertiary mt-2">
              This may take a minute or two...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
