import { create } from 'zustand';
import { api } from '@/lib/api';

interface GoogleDriveState {
  connected: boolean;
  email: string | null;
  statusChecked: boolean;

  checkStatus: () => Promise<void>;
  connect: (initiativeId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  getAccessToken: () => Promise<string>;
}

export const useGoogleDriveStore = create<GoogleDriveState>((set) => ({
  connected: false,
  email: null,
  statusChecked: false,

  checkStatus: async () => {
    try {
      const status = await api.getGoogleDriveStatus();
      set({ connected: status.connected, email: status.email ?? null, statusChecked: true });
    } catch {
      set({ statusChecked: true });
    }
  },

  connect: async (initiativeId: string) => {
    const { auth_url } = await api.getGoogleAuthUrl(initiativeId);
    window.location.href = auth_url;
  },

  disconnect: async () => {
    await api.disconnectGoogleDrive();
    set({ connected: false, email: null });
  },

  getAccessToken: async () => {
    const { access_token } = await api.getGoogleDriveAccessToken();
    return access_token;
  },
}));
