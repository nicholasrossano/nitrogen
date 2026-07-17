import { resolveActiveProjectId, writeLastProjectId } from '@/components/chat-shell/ChatShellProvider';
import type { Project } from '@/lib/api';

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    slug: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as Project;
}

describe('resolveActiveProjectId', () => {
  beforeEach(() => {
    writeLastProjectId(null);
  });

  it('keeps a project id from the URL when it exists in the loaded list', () => {
    const projects = [makeProject('proj-a', 'Alpha'), makeProject('proj-b', 'Beta')];
    expect(resolveActiveProjectId('/chat', 'proj-b', projects)).toBe('proj-b');
  });

  it('falls back when the URL project is not in the current workspace list', () => {
    writeLastProjectId('stale-other-workspace');
    const projects = [makeProject('proj-a', 'Alpha'), makeProject('proj-b', 'Beta')];
    expect(resolveActiveProjectId('/chat', 'stale-other-workspace', projects)).toBe('proj-a');
  });

  it('prefers lastProjectId when it is still valid for the loaded workspace', () => {
    writeLastProjectId('proj-b');
    const projects = [makeProject('proj-a', 'Alpha'), makeProject('proj-b', 'Beta')];
    expect(resolveActiveProjectId('/chat', 'missing-from-list', projects)).toBe('proj-b');
  });

  it('ignores an orphaned demo project route when demo mode is off', () => {
    writeLastProjectId('proj-a');
    const projects = [makeProject('proj-a', 'Alpha'), makeProject('proj-b', 'Beta')];
    expect(
      resolveActiveProjectId('/projects/demo-rift-valley-solar', null, projects),
    ).toBe('proj-a');
  });
});
