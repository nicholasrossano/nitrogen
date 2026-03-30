'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import type { ModuleWorkflowState, BuildItem } from '@/lib/api';
import { api } from '@/lib/api';
import { SetupStage } from './SetupStage';
import { BuildStage } from './BuildStage';
import { OutputStage } from './OutputStage';

type Stage = 'setup' | 'build' | 'output';

const STAGE_LABELS: Record<Stage, string> = {
  setup:  'Setup',
  build:  'Build',
  output: 'Output',
};

function StageToggle({
  current,
  setupConfirmed,
  outputUnlocked,
  onChange,
}: {
  current: Stage;
  setupConfirmed: boolean;
  outputUnlocked: boolean;
  onChange: (s: Stage) => void;
}) {
  const stages: Stage[] = ['setup', 'build', 'output'];
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
        if (data.workflow_state?.current_stage) {
          setActiveStage(data.workflow_state.current_stage as Stage);
        }
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
          const setupConfirmed = ws.setup.confirmed;
          const outputComplete = ws.output?.status === 'complete';
          const outputUnlocked = buildCompleted || outputComplete;

          return (
            <div className="max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
              {/* Stage toggle — compact, centered */}
              <StageToggle
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
                  setupFields={mod.setup_fields}
                  onConfirmed={() => {
                    fetchState();
                    setActiveStage('build');
                  }}
                />
              )}
              {activeStage === 'build' && (
                <BuildStage
                  instanceId={instanceId}
                  build={ws.build}
                  layerDefs={mod.build_layers}
                  readOnly={outputComplete}
                  onStateUpdated={fetchState}
                  onProceedToOutput={() => { setBuildCompleted(true); setActiveStage('output'); }}
                  onAddToChat={onAddToChat ? handleAddToChat : undefined}
                />
              )}
              {activeStage === 'output' && (
                <OutputStage
                  instanceId={instanceId}
                  output={ws.output}
                  build={ws.build}
                  layerDefs={mod.build_layers}
                  onStateUpdated={fetchState}
                />
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
