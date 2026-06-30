import {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  triggerBlobDownload,
  workflowVersionHeaders,
} from './client';
import type {
  BillingStatus,
} from './types';



export const billingApi = {
  getBillingStatus: () =>
    fetchApi<BillingStatus>('/api/v1/billing/status'),
  createCheckout: (priceId: string, successUrl: string, cancelUrl: string) =>
    fetchApi<{ url: string }>('/api/v1/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ price_id: priceId, success_url: successUrl, cancel_url: cancelUrl }),
    }),
  createPortalSession: (returnUrl: string) =>
    fetchApi<{ url: string }>('/api/v1/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ return_url: returnUrl }),
    }),
  redeemAccessCode: (code: string) =>
    fetchApi<{ success: boolean; error?: string } & Partial<BillingStatus>>(
      '/api/v1/billing/redeem-code',
      { method: 'POST', body: JSON.stringify({ code }) }
    ),

  // ── API Keys (BYOK) ─────────────────────────────────────────────,
  listApiKeys: () =>
    fetchApi<{ provider: string; masked_key: string; created_at: string }[]>(
      '/api/v1/settings/api-keys'
    ),
  storeApiKey: (apiKey: string, provider: string = 'openai') =>
    fetchApi<{ provider: string; masked_key: string; created_at: string }>(
      '/api/v1/settings/api-keys',
      { method: 'POST', body: JSON.stringify({ api_key: apiKey, provider }) }
    ),
  deleteApiKey: (provider: string = 'openai') =>
    fetchApi<{ success: boolean }>(
      `/api/v1/settings/api-keys/${provider}`,
      { method: 'DELETE' }
    ),
};
