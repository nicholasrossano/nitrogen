export function sanitizeHref(href: string | undefined): string | undefined {
  if (!href) return href;
  const trimmed = href.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
    return undefined;
  }
  return href;
}
