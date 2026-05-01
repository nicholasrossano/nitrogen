/**
 * Assessment workflow content from the API is loosely typed; LLM / provenance data
 * may embed citation-shaped objects where the UI expects strings.
 * Use these helpers so we never pass raw objects as React children.
 */

export function isCitationLike(x: unknown): boolean {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return 'source_title' in o && 'source_type' in o;
}

/** Flatten unknown values (including citation objects) to displayable text. */
export function coerceDisplayString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isCitationLike(v)) {
    const c = v as Record<string, unknown>;
    const title =
      typeof c.source_title === 'string' ? c.source_title : coerceDisplayString(c.source_title);
    const pub =
      typeof c.publisher === 'string' ? c.publisher : coerceDisplayString(c.publisher);
    const parts = [title, pub].filter(Boolean);
    return parts.join(' — ');
  }
  if (Array.isArray(v)) {
    return v.map(coerceDisplayString).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.title === 'string') return o.title;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.body === 'string') return o.body;
    if (typeof o.excerpt === 'string') return o.excerpt;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}
