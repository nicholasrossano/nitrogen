/** Strip the creator-handle suffix from a serialized assessment display name. */
export function stripCreatorHandleFromTitle(
  title: string,
  creatorHandle?: string | null,
): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;

  if (creatorHandle?.trim()) {
    const suffix = ` · @${creatorHandle.trim()}`;
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length).trim();
    }
  }

  return trimmed.replace(/\s*·\s*@[\w.-]+$/i, '').trim();
}

export function assessmentHeaderTitle(
  title: string | null | undefined,
  fallback: string,
  creatorHandle?: string | null,
): string {
  const trimmed = title?.trim();
  if (!trimmed) return fallback;
  return stripCreatorHandleFromTitle(trimmed, creatorHandle);
}
