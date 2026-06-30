import type { AssessmentOption } from '@/domain/energy/assessmentCatalog';

export interface FeatureFlagContext {
  devMode: boolean;
}

const DEFAULT_FEATURE_FLAG_CONTEXT: FeatureFlagContext = {
  devMode: false,
};

const BILLING_ENABLED_IN_PROD =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_BILLING_ENABLED === 'true';

const FEATURE_FLAG_DEFINITIONS = {
  art_lab: {
    description: 'Access to the loading art lab page.',
    isEnabled: (context: FeatureFlagContext) => context.devMode,
  },
  beta_assessments: {
    description: 'Visibility for beta assessments in assessment surfaces.',
    isEnabled: (context: FeatureFlagContext) => context.devMode,
  },
  billing_features: {
    description: 'Billing surfaces and billing sync behavior.',
    isEnabled: (context: FeatureFlagContext) => BILLING_ENABLED_IN_PROD || context.devMode,
  },
  billing_test_headers: {
    description: 'Include billing test header in API requests.',
    isEnabled: (context: FeatureFlagContext) => context.devMode,
  },
  loading_art_variant: {
    description: 'Enable loading art variant in universal loaders.',
    isEnabled: (context: FeatureFlagContext) => context.devMode,
  },
  paywall_modal: {
    description: 'Render paywall modal in app providers.',
    isEnabled: (context: FeatureFlagContext) => BILLING_ENABLED_IN_PROD || context.devMode,
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFINITIONS;

export function buildFeatureFlagContext(devMode: boolean): FeatureFlagContext {
  return { devMode };
}

export function isFeatureFlagEnabled(
  flag: FeatureFlagKey,
  context: FeatureFlagContext,
): boolean {
  return FEATURE_FLAG_DEFINITIONS[flag].isEnabled(context);
}

export function getStoredFeatureFlagContext(): FeatureFlagContext {
  if (typeof window === 'undefined') return DEFAULT_FEATURE_FLAG_CONTEXT;
  try {
    const raw = localStorage.getItem('nitrogen-settings');
    if (!raw) return DEFAULT_FEATURE_FLAG_CONTEXT;
    const parsed = JSON.parse(raw) as { state?: { devMode?: boolean } };
    return buildFeatureFlagContext(parsed?.state?.devMode === true);
  } catch {
    return DEFAULT_FEATURE_FLAG_CONTEXT;
  }
}

export function isStoredFeatureFlagEnabled(flag: FeatureFlagKey): boolean {
  return isFeatureFlagEnabled(flag, getStoredFeatureFlagContext());
}

export function isAssessmentVisible(assessment: AssessmentOption, context: FeatureFlagContext): boolean {
  if (!assessment.beta) return true;
  return isFeatureFlagEnabled('beta_assessments', context);
}

export function filterVisibleAssessments<T extends AssessmentOption>(
  assessments: readonly T[],
  context: FeatureFlagContext,
): T[] {
  return assessments.filter((assessment) => isAssessmentVisible(assessment, context));
}
