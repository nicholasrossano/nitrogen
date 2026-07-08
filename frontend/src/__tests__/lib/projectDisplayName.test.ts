import { projectDisplayName } from '@/lib/projectDisplayName';

describe('projectDisplayName', () => {
  it('prefers title when present', () => {
    expect(projectDisplayName({ title: 'Solar Farm', name: 'ignored' })).toBe('Solar Farm');
  });

  it('falls back to name when title is missing', () => {
    expect(projectDisplayName({ title: null, name: 'Backup Name' })).toBe('Backup Name');
  });

  it('returns fallback when both are empty', () => {
    expect(projectDisplayName({ title: null, name: '' }, 'Untitled project')).toBe('Untitled project');
  });
});
