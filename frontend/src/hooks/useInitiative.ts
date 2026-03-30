import { useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useShallow } from 'zustand/react/shallow';

export function useInitiative(initiativeId: string | null) {
  const { initiative, messages, stageStatus, memo, loading, error } =
    useInitiativeStore(useShallow((s) => ({
      initiative: s.initiative,
      messages: s.messages,
      stageStatus: s.stageStatus,
      memo: s.memo,
      loading: s.loading,
      error: s.error,
    })));

  const loadInitiative = useInitiativeStore((s) => s.loadInitiative);
  const loadChatHistory = useInitiativeStore((s) => s.loadChatHistory);

  useEffect(() => {
    if (initiativeId) {
      loadInitiative(initiativeId);
      loadChatHistory(initiativeId);
    }
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
