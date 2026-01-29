import { useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';

export function useInitiative(initiativeId: string | null) {
  const { 
    initiative, 
    messages,
    stageStatus,
    memo,
    loading,
    error,
    loadInitiative,
    loadChatHistory,
    reset,
  } = useInitiativeStore();

  useEffect(() => {
    if (initiativeId) {
      loadInitiative(initiativeId);
      loadChatHistory(initiativeId);
    }

    return () => {
      // Optionally reset on unmount
      // reset();
    };
  }, [initiativeId, loadInitiative, loadChatHistory]);

  return {
    initiative,
    messages,
    stageStatus,
    memo,
    loading,
    error,
    isIntakeComplete: stageStatus?.stage_1_complete ?? false,
    isEvidenceReady: stageStatus?.evidence_ready ?? false,
    currentStage: stageStatus?.stage ?? 'intake',
  };
}
