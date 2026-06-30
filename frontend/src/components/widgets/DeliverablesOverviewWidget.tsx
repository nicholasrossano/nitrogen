'use client';

import { useState } from 'react';
import { FileText, Target, MapPin, Globe } from 'lucide-react';
import { PanelHeader } from '@/components/ui';
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
  data: Record<string, any>;
  projectId: string;
  isActive?: boolean;
  onSendMessage?: (content: string) => Promise<void> | void;
}

export function DeliverablesOverviewWidget({
  data,
  isActive = true,
  onSendMessage,
}: DeliverablesOverviewWidgetProps) {
  const [modifying, setModifying] = useState(false);

  const handleModifyTools = async () => {
    setModifying(true);
    try {
      if (onSendMessage) {
        await onSendMessage("I'd like to change my tool selection.");
        return;
      }
      window.dispatchEvent(new CustomEvent('nitrogen:draft', {
        detail: {
          text: "I'd like to change my tool selection.",
          label: null,
        },
      }));
    } catch (error) {
      console.error('[DeliverablesOverviewWidget] failed to request tool changes:', error);
    } finally {
      setModifying(false);
    }
  };

  const summary = data?.project_summary || {};
  const selectedTools = (data?.selected_tools || []) as ToolInfo[];
  const sdg = (data?.tool_inputs?.sdg || summary?.tool_inputs?.sdg) as SDGInfo | undefined;

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={FileText}
        title="Project Overview"
        subtitle="Review your project details and assessments"
      />

      <div className="p-5 space-y-4 bg-white border-b border-divider">
        <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">
          Project Details
        </h4>

        <div className="space-y-3">
          {summary.title && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Target className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-sm text-text-tertiary uppercase tracking-wide">Project</p>
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
                <p className="text-sm text-text-tertiary uppercase tracking-wide">Location</p>
                <p className="text-sm font-medium text-text-primary">{summary.geography}</p>
              </div>
            </div>
          )}

          {sdg && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Globe className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-sm text-text-tertiary uppercase tracking-wide">Focus area</p>
                <p className="text-sm font-medium text-text-primary">{sdg.display}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4 bg-white">
        <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">
          Selected assessments
        </h4>

        <div className="flex flex-wrap items-center gap-2">
          {selectedTools.map((tool) => {
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

      {isActive && (
        <div className="px-5 py-4 bg-surface-header border-t border-divider">
          <button
            onClick={handleModifyTools}
            disabled={modifying}
            className="btn-secondary px-4 py-3 rounded-none w-full"
          >
            Change assessments
          </button>
        </div>
      )}
    </div>
  );
}
