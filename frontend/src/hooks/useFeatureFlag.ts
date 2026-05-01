'use client';

import { useMemo } from 'react';

import {
  buildFeatureFlagContext,
  filterVisibleModules,
  isFeatureFlagEnabled,
  type FeatureFlagContext,
  type FeatureFlagKey,
} from '@/lib/featureFlags';
import { type ModuleOption } from '@/first-party/moduleCatalog';
import { useSettingsStore } from '@/stores/settingsStore';

export function useFeatureFlagContext(): FeatureFlagContext {
  const devMode = useSettingsStore((s) => s.devMode);
  return useMemo(() => buildFeatureFlagContext(devMode), [devMode]);
}

export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  const context = useFeatureFlagContext();
  return useMemo(() => isFeatureFlagEnabled(flag, context), [flag, context]);
}

export function useVisibleModules<T extends ModuleOption>(modules: readonly T[]): T[] {
  const context = useFeatureFlagContext();
  return useMemo(() => filterVisibleModules(modules, context), [modules, context]);
}
