const DEFAULT_ACCENT_ANCHOR = '#00758c';

export function resolveCssColorValue(input?: string, fallback = DEFAULT_ACCENT_ANCHOR): string {
  const raw = input?.trim();
  if (!raw) return fallback;

  if (typeof window === 'undefined') {
    return raw.startsWith('var(') ? fallback : raw;
  }

  const varMatch = raw.match(/^var\((--[^),\s]+)(?:,\s*([^)]+))?\)$/);
  if (!varMatch) return raw;

  const [, token, nestedFallback] = varMatch;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (resolved) return resolved;

  return nestedFallback ? resolveCssColorValue(nestedFallback.trim(), fallback) : fallback;
}
