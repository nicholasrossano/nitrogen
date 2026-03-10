'use client';

import { useState, useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { 
  Check, 
  Loader2, 
  ChevronDown, 
  ChevronRight,
  Search,
  FileText,
  Save,
} from 'lucide-react';
import { getIconByName } from '@/lib/icons';
import type { AlignmentSection, ToolAlignment } from '@/lib/api';

interface ToolInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  output_type: string;
}

interface AlignmentWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

const GENERATION_STEPS = [
  { label: 'Confirming outline', icon: Check, duration: 3 },
  { label: 'Retrieving project evidence', icon: Search, duration: 18 },
  { label: 'Writing deliverables', icon: FileText, duration: 75 },
  { label: 'Saving results', icon: Save, duration: 30 },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`;
}

function GeneratingProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  let accumulated = 0;
  let currentStep = GENERATION_STEPS.length - 1;
  for (let i = 0; i < GENERATION_STEPS.length; i++) {
    if (elapsed < accumulated + GENERATION_STEPS[i].duration) {
      currentStep = i;
      break;
    }
    accumulated += GENERATION_STEPS[i].duration;
  }

  const totalExpected = GENERATION_STEPS.reduce((s, step) => s + step.duration, 0);
  const progress = Math.min(94, (elapsed / totalExpected) * 94);

  const StepIcon = GENERATION_STEPS[currentStep].icon;

  return (
    <div className="px-5 py-10 flex flex-col items-center gap-5">
      <div className="relative flex items-center justify-center w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
        <div
          className="absolute inset-0 rounded-full border-2 border-accent border-t-transparent animate-spin"
          style={{ animationDuration: '1.2s' }}
        />
        <StepIcon className="w-4.5 h-4.5 text-accent" />
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-text-primary">
          {GENERATION_STEPS[currentStep].label}...
        </p>
        <p className="text-xs text-text-tertiary mt-1">
          This usually takes 2-3 minutes
        </p>
      </div>

      <div className="w-full max-w-[240px]">
        <div className="h-1 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-6">
        {GENERATION_STEPS.map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                i < currentStep
                  ? 'bg-accent'
                  : i === currentStep
                    ? 'bg-accent animate-pulse'
                    : 'bg-zinc-200'
              }`}
            />
            <span
              className={`text-[10px] transition-colors duration-300 ${
                i <= currentStep ? 'text-text-secondary' : 'text-text-tertiary'
              }`}
            >
              {step.label.split(' ').slice(0, 2).join(' ')}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-text-tertiary">
        {formatElapsed(elapsed)} elapsed
      </p>
    </div>
  );
}

export function AlignmentWidget({ data, initiativeId, isActive = true }: AlignmentWidgetProps) {
  const { confirmAlignment, alignmentLoading, generating, error: storeError } = useInitiativeStore();
  
  const alignment = data?.alignment as ToolAlignment | undefined;
  const tool = data?.tool as ToolInfo | undefined;
  const pendingTools = (data?.pending_tools || []) as ToolInfo[];
  const sections = (alignment?.sections || []) as AlignmentSection[];
  
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [localSections, setLocalSections] = useState<AlignmentSection[]>(sections);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  
  // Reset hasConfirmed when loading finishes (success or error) so the
  // button isn't stuck on "Confirming..."
  useEffect(() => {
    if (hasConfirmed && !alignmentLoading && !generating) {
      setHasConfirmed(false);
    }
  }, [hasConfirmed, alignmentLoading, generating]);

  // Surface store errors as local error when this widget triggered the action
  useEffect(() => {
    if (hasConfirmed && storeError) {
      setLocalError(storeError);
      setHasConfirmed(false);
    }
  }, [hasConfirmed, storeError]);
  
  const isGenerating = hasConfirmed && (alignmentLoading || generating) && pendingTools.length === 0;

  if (!alignment || !tool) {
    return (
      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
        Loading alignment...
      </div>
    );
  }
  
  const ToolIcon = getIconByName(tool.icon);
  
  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };
  
  const toggleInclude = (sectionId: string) => {
    setLocalSections(prev => 
      prev.map(s => s.id === sectionId ? { ...s, include: !s.include } : s)
    );
  };
  
  const handleConfirm = async () => {
    setLocalError(null);
    setHasConfirmed(true);
    const sectionsModified = JSON.stringify(localSections) !== JSON.stringify(data.alignment.sections);
    
    try {
      await confirmAlignment(
        initiativeId, 
        alignment.tool_id,
        sectionsModified ? localSections : undefined,
        undefined
      );
    } catch {
      setLocalError('Something went wrong during generation. Please try again.');
      setHasConfirmed(false);
    }
  };
  
  const includedCount = localSections.filter(s => s.include).length;
  
  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <div className="flex items-center gap-2 mb-1">
          <ToolIcon className="w-5 h-5 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">{alignment.title}</h3>
        </div>
        {!isGenerating && (
          <p className="text-sm text-text-secondary">
            {alignment.description}
          </p>
        )}
      </div>

      {isGenerating ? (
        <GeneratingProgress />
      ) : (
        <>
          {/* Sections */}
          <div className="bg-white">
            <div className="divide-y divide-divider">
              {localSections.map((section) => {
                const isExpanded = expandedSections.has(section.id);
                
                return (
                  <div key={section.id} className={`${!section.include ? 'opacity-50' : ''}`}>
                    <div 
                      className="px-5 py-3 flex items-center gap-3 cursor-pointer"
                      onClick={() => toggleSection(section.id)}
                    >
                      <input
                        type="checkbox"
                        checked={section.include}
                        disabled={!isActive}
                        onChange={() => toggleInclude(section.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3 h-3 rounded accent-[#004d91] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-text-primary text-sm">
                          {section.title}
                        </span>
                      </div>
                      
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-text-tertiary" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-tertiary" />
                      )}
                    </div>
                    
                    {isExpanded && section.key_points.length > 0 && (
                      <div className="pb-3 pl-16 pr-5">
                        <ul className="list-disc list-outside space-y-1 pl-5 text-text-secondary">
                          {section.key_points.map((point, idx) => (
                            <li key={idx} className="text-sm">
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error banner */}
          {localError && (
            <div className="px-5 py-3 bg-red-50 border-t border-red-100 flex items-center justify-between gap-3">
              <p className="text-xs text-red-700 flex-1">{localError}</p>
              <button
                onClick={() => setLocalError(null)}
                className="text-xs text-red-500 hover:text-red-700 font-medium flex-shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Actions */}
          {isActive && (
            <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
              <p className="text-[10px] text-text-tertiary">
                Uncheck sections to exclude them &middot; Request changes via the chat
              </p>
              <button
                onClick={handleConfirm}
                disabled={alignmentLoading || includedCount === 0}
                className="btn-primary !text-xs !px-4 !py-1.5"
              >
                {alignmentLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    {pendingTools.length === 0 ? (localError ? 'Retry' : 'Confirm & Generate') : 'Confirm Outline'}
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
