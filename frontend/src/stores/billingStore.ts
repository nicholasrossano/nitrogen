import { create } from 'zustand';
import { api, BillingStatus } from '@/lib/api';

interface BillingState {
  tier: BillingStatus['tier'] | null;
  status: string;
  usedUsd: number;
  limitUsd: number;
  usagePercent: number;
  trialMessagesRemaining: number | null;
  accessCodeRedeemed: boolean;
  accessCodeAvailable: boolean;
  showPaywall: boolean;
  paywallContext: Record<string, unknown> | null;
  loading: boolean;
  loaded: boolean;

  fetchBillingStatus: () => Promise<void>;
  redeemAccessCode: (code: string) => Promise<{ success: boolean; error?: string }>;
  triggerPaywall: (context?: Record<string, unknown>) => void;
  dismissPaywall: () => void;
}

export const useBillingStore = create<BillingState>()((set, get) => ({
  tier: null,
  status: '',
  usedUsd: 0,
  limitUsd: 0,
  usagePercent: 0,
  trialMessagesRemaining: null,
  accessCodeRedeemed: false,
  accessCodeAvailable: false,
  showPaywall: false,
  paywallContext: null,
  loading: false,
  loaded: false,

  fetchBillingStatus: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const data = await api.getBillingStatus();
      const limitUsd = data.limit_usd || 0;
      const usedUsd = data.used_usd || 0;
      set({
        tier: data.tier,
        status: data.status || 'active',
        usedUsd,
        limitUsd,
        usagePercent: limitUsd > 0 ? Math.min(100, (usedUsd / limitUsd) * 100) : 0,
        trialMessagesRemaining: data.trial_messages_remaining ?? null,
        accessCodeRedeemed: data.access_code_redeemed ?? false,
        accessCodeAvailable: data.access_code_available ?? false,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  redeemAccessCode: async (code: string) => {
    try {
      const result = await api.redeemAccessCode(code);
      if (result.success) {
        await get().fetchBillingStatus();
        set({ showPaywall: false });
      }
      return { success: result.success, error: result.error };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to redeem code';
      return { success: false, error: msg };
    }
  },

  triggerPaywall: (context) => set({ showPaywall: true, paywallContext: context ?? null }),
  dismissPaywall: () => set({ showPaywall: false, paywallContext: null }),
}));
