'use client';

import { useMemo } from 'react';

import {
  buildFeatureFlagContext,
  filterVisibleAssessments,
  isFeatureFlagEnabled,
  type FeatureFlagContext,
  type FeatureFlagKey,
} from '@/lib/featureFlags';
import { type AssessmentOption } from '@/first-party/assessmentCatalog';
import { useSettingsStore } from '@/stores/settingsStore';

export function useFeatureFlagContext(): FeatureFlagContext {
  const devMode = useSettingsStore((s) => s.devMode);
  return useMemo(() => buildFeatureFlagContext(devMode), [devMode]);
}

export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  const context = useFeatureFlagContext();
  return useMemo(() => isFeatureFlagEnabled(flag, context), [flag, context]);
}

export function useVisibleAssessments<T extends AssessmentOption>(assessments: readonly T[]): T[] {
  const context = useFeatureFlagContext();
  return useMemo(() => filterVisibleAssessments(assessments, context), [assessments, context]);
}
