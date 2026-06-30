/**
 * Focused URL-path coverage for project API helpers.
 */

import { TextDecoder, TextEncoder } from 'util';

global.TextEncoder = TextEncoder as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
}));

jest.mock('@/lib/firebase', () => ({
  app: {},
}));

function mockOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('api project paths', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.resetModules();
  });

  it('getProject calls /api/v1/projects/:id', async () => {
    mockFetch.mockResolvedValueOnce(mockOk({ id: 'proj-1', title: 'Deal' }));
    const { projectsApi } = await import('@/lib/api/projects');

    await projectsApi.getProject('proj-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/proj-1'),
      expect.any(Object),
    );
  });

  it('listProjects calls /api/v1/projects with query params', async () => {
    mockFetch.mockResolvedValueOnce(mockOk([]));
    const { projectsApi } = await import('@/lib/api/projects');

    await projectsApi.listProjects(25, 5, false, 'workspace-1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/projects?');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=5');
    expect(url).toContain('archived=false');
    expect(url).toContain('workspace_id=workspace-1');
  });
});
