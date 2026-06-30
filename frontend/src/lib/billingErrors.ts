import { useBillingStore } from '@/stores/billingStore';

export const BILLING_LIMIT_MESSAGE =
  "You've reached your usage limit. Subscribe or add an OpenAI/OpenRouter API key to continue.";

export function handleBillingHttpError(status: number, detail: unknown): boolean {
  if (status !== 402) return false;
  const payload =
    detail && typeof detail === 'object' && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : { message: String(detail ?? BILLING_LIMIT_MESSAGE) };
  useBillingStore.getState().triggerPaywall(payload);
  return true;
}

export function billingErrorMessage(detail: unknown): string {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.detail === 'string') return record.detail;
  }
  if (typeof detail === 'string') return detail;
  return BILLING_LIMIT_MESSAGE;
}
