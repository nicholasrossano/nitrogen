import { SHORT_DILIGENCE_DISCLAIMER } from '@/lib/legalCopy';

/**
 * Small, muted caveat placed near AI-generated recommendation content
 * (status rubric, assessment exports). Intentionally not a global banner —
 * scope this to specific surfaces where AI renders a conclusion, not site-wide chrome.
 */
export function DiligenceNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[10px] leading-snug text-text-tertiary ${className}`}>
      {SHORT_DILIGENCE_DISCLAIMER}
    </p>
  );
}
