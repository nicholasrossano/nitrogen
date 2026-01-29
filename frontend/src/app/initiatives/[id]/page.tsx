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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-600">{error}</p>
        <Link 
          href="/" 
          className="text-primary-600 hover:underline flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              href="/" 
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div>
              <h1 className="font-semibold text-gray-900">
                {initiative?.title || 'New Initiative'}
              </h1>
              <p className="text-sm text-gray-500 capitalize">
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
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div 
            className={`
              px-3 py-1 rounded-full text-xs font-medium transition-colors
              ${s.complete 
                ? 'bg-green-100 text-green-700' 
                : stage === s.id 
                  ? 'bg-primary-100 text-primary-700' 
                  : 'bg-gray-100 text-gray-500'
              }
            `}
          >
            {s.label}
          </div>
          {i < stages.length - 1 && (
            <div className={`w-4 h-0.5 ${s.complete ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
