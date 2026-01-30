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
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          <span className="text-sm text-brown/60">Loading initiative...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <div className="card-elevated p-8 text-center max-w-md">
          <p className="text-primary-600 mb-4">{error}</p>
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
    <div className="flex flex-col h-screen bg-background">
      {/* Header - Glass effect with warm tones */}
      <header className="flex-shrink-0 border-b border-beige/50 bg-cream/90 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              href="/" 
              className="p-2.5 hover:bg-blush rounded-pill transition-all duration-200"
            >
              <ArrowLeft className="w-5 h-5 text-brown/70" />
            </Link>
            <div>
              <h1 className="font-semibold text-brown">
                {initiative?.title || 'New Initiative'}
              </h1>
              <p className="text-sm text-brown/50 capitalize">
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
  const stages = [
    { id: 'intake', label: 'Define', complete: stage1Complete },
    { id: 'evidence', label: 'Evidence', complete: evidenceReady },
    { id: 'generate', label: 'Generate', complete: stage === 'complete' },
  ];

  return (
    <div className="flex items-center">
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div 
            className={`
              px-3 py-1.5 rounded-pill text-xs font-semibold transition-all duration-200
              ${s.complete 
                ? 'bg-forest/15 text-forest' 
                : stage === s.id 
                  ? 'bg-primary-100 text-primary-700' 
                  : 'bg-beige/50 text-brown/50'
              }
            `}
          >
            {s.label}
          </div>
          {i < stages.length - 1 && (
            <div className={`w-4 h-0.5 transition-colors duration-200 ${s.complete ? 'bg-forest/40' : 'bg-beige'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
