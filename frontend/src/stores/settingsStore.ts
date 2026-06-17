import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  // -- Developer --
  devMode: boolean;

  // -- Actions --
  setDevMode: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Developer
      devMode: false,

      setDevMode: (value) => set({ devMode: value }),
    }),
    { name: 'nitrogen-settings' },
  ),
);
