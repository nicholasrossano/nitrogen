'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Sparkles, Loader2, FileText, Target, MapPin, Globe } from 'lucide-react';

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
      <div className="px-5 py-4 bg-gradient-to-r from-forest/10 to-teal/10 border-b border-beige/50">
        <h3 className="font-semibold text-brown">Project Overview</h3>
        <p className="text-sm text-brown/60">
          Review your project details and deliverables
        </p>
      </div>

      {/* Project Summary */}
      <div className="p-5 space-y-4 bg-cream border-b border-beige/30">
        <h4 className="text-sm font-semibold text-brown/70 uppercase tracking-wide">
          Project Details
        </h4>
        
        <div className="space-y-3">
          {summary.title && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blush flex items-center justify-center flex-shrink-0">
                <Target className="w-4 h-4 text-brown/60" />
              </div>
              <div>
                <p className="text-xs text-brown/50 uppercase tracking-wide">Project</p>
                <p className="text-sm font-medium text-brown">{summary.title}</p>
              </div>
            </div>
          )}
          
          {summary.geography && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blush flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-brown/60" />
              </div>
              <div>
                <p className="text-xs text-brown/50 uppercase tracking-wide">Location</p>
                <p className="text-sm text-brown">{summary.geography}</p>
              </div>
            </div>
          )}
          
          {sdg && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Globe className="w-4 h-4 text-primary-600" />
              </div>
              <div>
                <p className="text-xs text-brown/50 uppercase tracking-wide">Sustainable Development Goal</p>
                <p className="text-sm font-medium text-brown">{sdg.display}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deliverables */}
      <div className="p-5 space-y-4 bg-cream">
        <h4 className="text-sm font-semibold text-brown/70 uppercase tracking-wide">
          What We'll Generate
        </h4>
        
        <div className="space-y-3">
          {data.selected_tools.map((tool) => (
            <div
              key={tool.id}
              className="flex items-center gap-3 p-3 bg-blush/50 rounded-widget border border-beige/30"
            >
              <span className="text-2xl">{tool.icon}</span>
              <div className="flex-1">
                <p className="font-medium text-brown">{tool.name}</p>
                <p className="text-xs text-brown/60">{tool.description}</p>
              </div>
              <FileText className="w-5 h-5 text-brown/40" />
            </div>
          ))}
        </div>
      </div>

      {/* Generate button - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-blush/50 border-t border-beige/50">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full px-6 py-4 bg-gradient-to-r from-primary-600 to-accent text-white rounded-pill font-semibold hover:from-primary-700 hover:to-accent/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lifted hover:shadow-heavy"
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
            <p className="text-xs text-center text-brown/50 mt-2">
              This may take a minute or two...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
