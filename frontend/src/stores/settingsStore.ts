import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Settings store
// ---------------------------------------------------------------------------
// Add new settings here. Each field is automatically persisted to localStorage.
// Group related settings under a descriptive comment so sections are easy to
// find when wiring them into the SettingsModal.
// ---------------------------------------------------------------------------

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
