import { api, type AssessmentInstance } from '@/lib/api';

function stageDataHasContent(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  const items = record.items;
  if (Array.isArray(items) && items.length > 0) return true;
  const records = record.records;
  if (records && typeof records === 'object' && Object.keys(records).length > 0) return true;
  const widgetData = record.widget_data;
  if (widgetData && typeof widgetData === 'object' && Object.keys(widgetData).length > 0) return true;
  return Object.keys(record).length > 0;
}

export function hasMeaningfulAssessmentProgress(
  workflowState?: Record<string, unknown> | null,
): boolean {
  const stages = workflowState?.stages;
  if (!stages || typeof stages !== 'object') return false;

  return Object.values(stages).some((stage) => {
    if (!stage || typeof stage !== 'object') return false;
    const stageRecord = stage as Record<string, unknown>;
    const status = stageRecord.status;
    if (status === 'confirmed' || status === 'validated' || status === 'draft' || status === 'error') {
      return true;
    }
    return stageDataHasContent(stageRecord.data);
  });
}

export function isAssessmentUserEngaged(instance: AssessmentInstance): boolean {
  if (instance.is_plan_complete === true) return true;
  if (instance.workflow_state?.user_engaged === true) return true;
  return hasMeaningfulAssessmentProgress(instance.workflow_state);
}

export async function discardEphemeralAssessmentInstance(
  initiativeId: string,
  instanceId: string,
): Promise<void> {
  try {
    await api.permanentlyDeleteAssessmentInstance(initiativeId, instanceId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nitrogen:assessment-workflow-updated'));
    }
  } catch {
    // Best effort cleanup for untouched assessment previews.
  }
}
