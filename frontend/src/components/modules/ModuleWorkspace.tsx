'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import type { ModuleWorkflowState, BuildItem } from '@/lib/api';
import { api } from '@/lib/api';
import { SetupStage } from './SetupStage';
import { BuildStage } from './BuildStage';
import { OutputStage } from './OutputStage';
import { AlignmentWidget } from '@/components/widgets/AlignmentWidget';
import { LCOEModelWidget } from '@/components/widgets/LCOEModelWidget';
import { CarbonModelWidget } from '@/components/widgets/CarbonModelWidget';
import { SolarEstimateWidget } from '@/components/widgets/SolarEstimateWidget';
import { MemoViewerWidget } from '@/components/widgets/MemoViewerWidget';
import { ChecklistViewerWidget } from '@/components/widgets/ChecklistViewerWidget';
import { DocumentViewerWidget } from '@/components/widgets/DocumentViewerWidget';

type Stage = 'setup' | 'build' | 'output';

const STAGE_LABELS: Record<Stage, string> = {
  setup:  'Setup',
  build:  'Build',
  output: 'Output',
};

function StageToggle({
  stages,
  current,
  setupConfirmed,
  outputUnlocked,
  onChange,
}: {
  stages: Stage[];
  current: Stage;
  setupConfirmed: boolean;
  outputUnlocked: boolean;
  onChange: (s: Stage) => void;
}) {
  const accessible: Record<Stage, boolean> = {
    setup: true,
    build: setupConfirmed,
    output: outputUnlocked,
  };

  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-1 p-1 bg-surface-subtle rounded-lg w-44">
        {stages.map((stage) => (
          <button
            key={stage}
            onClick={() => accessible[stage] && onChange(stage)}
            disabled={!accessible[stage]}
            className={`flex-1 py-1 text-xs font-medium rounded transition-colors ${
              current === stage
                ? 'bg-surface text-text-primary shadow-sm'
                : accessible[stage]
                ? 'text-text-secondary hover:text-text-primary'
                : 'text-text-tertiary cursor-not-allowed opacity-50'
            }`}
          >
            {STAGE_LABELS[stage]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ModuleWorkspaceProps {
  instanceId: string;
  moduleId: string;
  initiativeId?: string;
  onAddToChat?: (text: string) => void;
  onBack?: () => void;
}

export function ModuleWorkspace({ instanceId, moduleId, initiativeId, onAddToChat, onBack }: ModuleWorkspaceProps) {
  const [state, setState] = useState<ModuleWorkflowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<Stage>('setup');
  const [buildCompleted, setBuildCompleted] = useState(false);
  // Only auto-navigate on the very first load; subsequent fetchState calls
  // (triggered by edits) must NOT override the user's manual tab choice.
  const hasInitialized = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const data = await api.getModuleWorkflowState(instanceId);
      setState(data);
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        setActiveStage('setup');
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load module state');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const handleAddToChat = useCallback(
    (item: BuildItem) => {
      if (!onAddToChat) return;
      const name = item.content.name ?? item.content.title ?? 'Item';
      const details = Object.entries(item.content)
        .filter(([k]) => k !== 'name' && k !== 'title')
        .map(([k, v]) => `**${k.replace(/_/g, ' ')}**: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');
      onAddToChat(`${name}\n${details}`);
    },
    [onAddToChat]
  );

  const moduleName = state?.module_definition.name ?? null;

  const renderWidget = useCallback(
    (
      type: string | null | undefined,
      data: Record<string, any> | null | undefined,
      stageView: 'build' | 'output' = 'output',
    ) => {
      if (!type || !data) {
        return (
          <div className="card p-6 text-sm text-text-secondary">
            This stage does not have content yet.
          </div>
        );
      }

      switch (type) {
        case 'lcoe_inputs':
        case 'lcoe_output':
          return (
            <LCOEModelWidget
              data={data}
              initiativeId={initiativeId ?? ''}
              instanceId={instanceId}
              onWorkflowUpdated={fetchState}
              workspaceView={stageView}
              isActive
            />
          );
        case 'carbon_inputs':
        case 'carbon_output':
          return (
            <CarbonModelWidget
              data={data}
              initiativeId={initiativeId ?? ''}
              instanceId={instanceId}
              onWorkflowUpdated={fetchState}
              workspaceView={stageView}
              isActive
            />
          );
        case 'solar_inputs':
        case 'solar_output':
          return (
            <SolarEstimateWidget
              data={data}
              initiativeId={initiativeId ?? ''}
              instanceId={instanceId}
              onWorkflowUpdated={fetchState}
              workspaceView={stageView}
              isActive
            />
          );
        case 'alignment':
          return (
            <AlignmentWidget
              data={data}
              initiativeId={initiativeId ?? ''}
              instanceId={instanceId}
              onWorkflowUpdated={fetchState}
              isActive
            />
          );
        case 'memo_viewer':
          return <MemoViewerWidget data={data} initiativeId={initiativeId ?? ''} isActive />;
        case 'checklist_viewer':
          return <ChecklistViewerWidget data={data} initiativeId={initiativeId ?? ''} isActive />;
        case 'document_viewer':
          return <DocumentViewerWidget data={data} initiativeId={initiativeId ?? ''} isActive />;
        default:
          return (
            <div className="card p-6 text-sm text-text-secondary">
              Unsupported workflow widget: <code>{type}</code>
            </div>
          );
      }
    },
    [fetchState, initiativeId, instanceId]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header — back arrow + centered module name */}
      <div className="relative flex items-center px-4 py-3 border-b border-divider flex-shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-surface-subtle transition-colors text-text-tertiary hover:text-text-secondary flex-shrink-0"
            title="Close module"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <h3 className="absolute inset-x-0 text-center text-sm font-medium text-text-primary truncate px-10 pointer-events-none">
          {moduleName ?? '…'}
        </h3>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        ) : error || !state ? (
          <div className="flex items-start gap-2 p-4 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error ?? 'Module not found'}</span>
          </div>
        ) : (() => {
          const { workflow_state: ws, module_definition: mod } = state;
          const hasLayeredBuild = (mod.build_layers?.length ?? 0) > 0;
          const hasSetupForm = ws.setup.mode === 'form' && (mod.setup_fields?.length ?? 0) > 0;
          const stages: Stage[] = ['setup', 'build', 'output'];
          const setupConfirmed = ws.setup.confirmed;
          const outputComplete = ws.output?.status === 'complete';
          const buildReadyForOutput = ['complete', 'confirmed'].includes(ws.build?.status ?? '');
          const outputUnlocked =
            buildCompleted ||
            buildReadyForOutput ||
            outputComplete ||
            Boolean(ws.output?.widget_data) ||
            Boolean(ws.output?.content);

          return (
            <div className="max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
              {/* Stage toggle — compact, centered */}
              <StageToggle
                stages={stages}
                current={activeStage}
                setupConfirmed={setupConfirmed}
                outputUnlocked={outputUnlocked}
                onChange={setActiveStage}
              />

              {/* Stage content */}
              {activeStage === 'setup' && (
                <SetupStage
                  instanceId={instanceId}
                  setup={ws.setup}
                  setupFields={mod.setup_fields ?? []}
                  autoGenerateDefaults={hasLayeredBuild && hasSetupForm}
                  onConfirmed={() => {
                    fetchState();
                    setActiveStage('build');
                  }}
                />
              )}

              {activeStage === 'build' &&
                (hasLayeredBuild ? (
                  <BuildStage
                    instanceId={instanceId}
                    build={ws.build}
                    layerDefs={mod.build_layers ?? []}
                    readOnly={outputComplete}
                    onStateUpdated={fetchState}
                    onProceedToOutput={() => {
                      setBuildCompleted(true);
                      setActiveStage('output');
                    }}
                    onAddToChat={onAddToChat ? handleAddToChat : undefined}
                  />
                ) : (
                  renderWidget(ws.build.widget_type, ws.build.widget_data, 'build')
                ))}

              {activeStage === 'output' &&
                (hasLayeredBuild ? (
                  <OutputStage
                    instanceId={instanceId}
                    output={ws.output}
                    build={ws.build}
                    layerDefs={mod.build_layers ?? []}
                    onStateUpdated={fetchState}
                  />
                ) : ws.output.widget_data || ws.output.content ? (
                  renderWidget(ws.output.widget_type, ws.output.widget_data ?? ws.output.content, 'output')
                ) : (
                  <div className="card p-6 text-sm text-text-secondary">
                    Complete the build stage to generate the final output for this module.
                  </div>
                ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
