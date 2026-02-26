'use client';

import { useEffect, useRef } from 'react';
import { Loader2, LayoutGrid } from 'lucide-react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { PillarColumn } from './PillarColumn';

interface ProjectPlanViewProps {
  initiativeId: string;
}

export function ProjectPlanView({ initiativeId }: ProjectPlanViewProps) {
  const {
    projectPlan,
    projectPlanLoading,
    error,
    loadProjectPlan,
    generateProjectPlan,
  } = useInitiativeStore();

  const hasTriggeredGenerate = useRef(false);

  useEffect(() => {
    loadProjectPlan(initiativeId);
  }, [initiativeId, loadProjectPlan]);

  // Auto-generate when opened and no plan exists
  useEffect(() => {
    if (!projectPlanLoading && !projectPlan && !hasTriggeredGenerate.current) {
      hasTriggeredGenerate.current = true;
      generateProjectPlan(initiativeId);
    }
  }, [projectPlan, projectPlanLoading, initiativeId, generateProjectPlan]);

  // Loading state during generation
  if (projectPlanLoading && !projectPlan) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-white">
        <Loader2 className="w-6 h-6 animate-spin text-accent mb-3" />
        <p className="text-sm text-text-secondary">Analyzing project...</p>
        <p className="text-xs text-text-tertiary mt-1">
          Building your project needs map
        </p>
      </div>
    );
  }

  // Error state with no plan to show
  if (!projectPlan && error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-white">
        <div className="w-14 h-14 bg-surface-subtle rounded flex items-center justify-center mb-4">
          <LayoutGrid className="w-7 h-7 text-text-tertiary" />
        </div>
        <p className="text-sm text-text-secondary mb-1">
          Couldn&apos;t generate the project plan
        </p>
        <p className="text-xs text-indicator-orange">{error}</p>
        <button
          onClick={() => generateProjectPlan(initiativeId)}
          className="btn-secondary text-xs mt-4"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!projectPlan) return null;

  const pillars = projectPlan.pillars || [];

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Updating indicator */}
      {projectPlanLoading && (
        <div className="flex items-center justify-center gap-1.5 py-2 flex-shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <span className="text-xs text-accent">Updating...</span>
        </div>
      )}

      {/* 3-column pillar tree */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {pillars.map(pillar => (
            <PillarColumn key={pillar.id} pillar={pillar} />
          ))}
        </div>
      </div>
    </div>
  );
}
