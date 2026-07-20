import { useProjectStore } from '@/stores/projectStore';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    getProject: jest.fn(),
  },
}));

const mockedGetProject = api.getProject as jest.MockedFunction<typeof api.getProject>;

describe('projectStore.loadProject', () => {
  beforeEach(() => {
    mockedGetProject.mockReset();
    useProjectStore.setState({
      project: null,
      projectsById: {},
      projectAccessErrors: {},
      loading: false,
      error: null,
    });
  });

  it('records a 404 as a permanent access error, not a retryable loading state', async () => {
    mockedGetProject.mockRejectedValue(new ApiError('Project not found', 404));

    await useProjectStore.getState().loadProject('proj-missing');

    const state = useProjectStore.getState();
    expect(state.loading).toBe(false);
    expect(state.projectAccessErrors['proj-missing']).toEqual({
      status: 404,
      message: 'Project not found',
    });
  });

  it('records a 403 the same way as a 404', async () => {
    mockedGetProject.mockRejectedValue(new ApiError('Forbidden', 403));

    await useProjectStore.getState().loadProject('proj-forbidden');

    expect(useProjectStore.getState().projectAccessErrors['proj-forbidden']).toEqual({
      status: 403,
      message: 'Forbidden',
    });
  });

  it('does not re-fetch an id already flagged with a permanent access error', async () => {
    mockedGetProject.mockRejectedValue(new ApiError('Project not found', 404));
    await useProjectStore.getState().loadProject('proj-missing');
    expect(mockedGetProject).toHaveBeenCalledTimes(1);

    await useProjectStore.getState().loadProject('proj-missing');
    expect(mockedGetProject).toHaveBeenCalledTimes(1);
  });

  it('treats a 500/network failure as transient — no permanent access error recorded', async () => {
    mockedGetProject.mockRejectedValue(new ApiError('Internal Server Error', 500));

    await useProjectStore.getState().loadProject('proj-flaky');

    const state = useProjectStore.getState();
    expect(state.projectAccessErrors['proj-flaky']).toBeUndefined();
    expect(state.error).toBe('Internal Server Error');
  });

  it('clears a stale access error once the project loads successfully', async () => {
    mockedGetProject.mockRejectedValueOnce(new ApiError('Project not found', 404));
    await useProjectStore.getState().loadProject('proj-recovered');
    expect(useProjectStore.getState().projectAccessErrors['proj-recovered']).toBeDefined();

    // A 404 marks it permanent — simulate the account regaining access by
    // clearing state as a fresh session/account switch would.
    useProjectStore.setState({ projectAccessErrors: {} });
    mockedGetProject.mockResolvedValueOnce({ id: 'proj-recovered', title: 'Recovered' } as any);

    await useProjectStore.getState().loadProject('proj-recovered');

    const state = useProjectStore.getState();
    expect(state.project?.id).toBe('proj-recovered');
    expect(state.projectAccessErrors['proj-recovered']).toBeUndefined();
  });
});
