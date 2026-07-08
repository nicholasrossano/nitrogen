import type { Project } from '@/lib/api';

type ProjectNameSource = Pick<Project, 'title' | 'name'> | null | undefined;

/** API returns `title`; older clients used `name`. Prefer whichever is set. */
export function projectDisplayName(
  project: ProjectNameSource,
  fallback = 'Untitled project',
): string {
  if (!project) return fallback;
  const label = project.title?.trim() || project.name?.trim();
  return label || fallback;
}
