'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function InitiativePage() {
  const params = useParams();
  const initiativeId = params.id as string;
  
  const { 
    initiative, 
    loading, 
    error, 
    loadInitiative, 
    loadChatHistory 
  } = useInitiativeStore();

  useEffect(() => {
    if (initiativeId) {
      loadInitiative(initiativeId);
      loadChatHistory(initiativeId);
    }
  }, [initiativeId, loadInitiative, loadChatHistory]);

  if (loading && !initiative) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <span className="text-sm text-text-secondary">Loading initiative...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-white">
        <div className="card p-8 text-center max-w-md">
          <p className="text-indicator-orange mb-4">{error}</p>
          <Link 
            href="/" 
            className="btn-secondary inline-flex"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header - Clean white with subtle border */}
      <header className="flex-shrink-0 border-b border-divider bg-white">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              href="/" 
              className="p-2 hover:bg-surface-subtle rounded transition-colors duration-150"
            >
              <ArrowLeft className="w-5 h-5 text-text-secondary" />
            </Link>
            <div>
              <h1 className="font-semibold text-text-primary">
                {initiative?.title || 'New Initiative'}
              </h1>
              <p className="text-sm text-text-tertiary capitalize">
                Stage: {initiative?.stage || 'intake'}
              </p>
            </div>
          </div>
          
          {/* Stage indicator */}
          <div className="flex items-center gap-2">
            <StageIndicator 
              stage={initiative?.stage || 'intake'} 
              stage1Complete={initiative?.stage_1_complete || false}
              evidenceReady={initiative?.evidence_ready || false}
            />
          </div>
        </div>
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-hidden">
        <ChatContainer initiativeId={initiativeId} />
      </main>
    </div>
  );
}

function StageIndicator({ 
  stage, 
  stage1Complete, 
  evidenceReady 
}: { 
  stage: string;
  stage1Complete: boolean;
  evidenceReady: boolean;
}) {
  // Map stage to progress
  const stageOrder = ['describe', 'select_tools', 'gather_inputs', 'review', 'generate', 'complete'];
  const currentIndex = stageOrder.indexOf(stage);
  
  // For backward compatibility, also check legacy stages
  const legacyMap: Record<string, number> = {
    'intake': 0,
    'evidence': 2,
  };
  const effectiveIndex = currentIndex >= 0 ? currentIndex : (legacyMap[stage] ?? 0);
  
  const stages = [
    { id: 'describe', label: 'Describe' },
    { id: 'gather_inputs', label: 'Inputs' },
    { id: 'generate', label: 'Generate' },
  ];

  return (
    <div className="flex items-center">
      {stages.map((s, i) => {
        // Calculate if this stage is complete or current
        const stageIdx = s.id === 'describe' ? 0 : s.id === 'gather_inputs' ? 2 : 4;
        const isComplete = effectiveIndex > stageIdx || stage === 'complete';
        const isCurrent = effectiveIndex >= stageIdx && effectiveIndex <= (s.id === 'generate' ? 5 : stageIdx + 1) && !isComplete;
        
        return (
          <div key={s.id} className="flex items-center">
            <div 
              className={`
                px-3 py-1.5 rounded-sm text-xs font-medium transition-colors duration-150
                ${isComplete 
                  ? 'bg-indicator-green/10 text-indicator-green' 
                  : isCurrent 
                    ? 'bg-accent-wash text-accent-anchor' 
                    : 'bg-surface-subtle text-text-tertiary'
                }
              `}
            >
              {s.label}
            </div>
            {i < stages.length - 1 && (
              <div className={`w-4 h-0.5 transition-colors duration-150 ${isComplete ? 'bg-indicator-green/30' : 'bg-divider'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
