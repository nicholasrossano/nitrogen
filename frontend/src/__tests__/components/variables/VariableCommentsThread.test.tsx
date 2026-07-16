import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { VariableCommentsThread } from '@/components/variables/VariableCommentsThread';

const listVariableComments = jest.fn();
const createVariableComment = jest.fn();

jest.mock('@/lib/api', () => ({
  api: {
    listVariableComments: (...args: unknown[]) => listVariableComments(...args),
    createVariableComment: (...args: unknown[]) => createVariableComment(...args),
  },
}));

jest.mock('@/stores/projectStore', () => ({
  useProjectStore: (selector: (state: { project: { shared_role: string } | null }) => unknown) =>
    selector({ project: { shared_role: 'editor' } }),
}));

jest.mock('@/components/sharing/AccessMemberRow', () => ({
  AccessMemberRow: ({ emailOrId, roleLabel }: { emailOrId: string; roleLabel: string }) => (
    <div>
      {emailOrId} · {roleLabel}
    </div>
  ),
}));

describe('VariableCommentsThread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows empty state after a successful empty load', async () => {
    listVariableComments.mockResolvedValueOnce([]);

    render(<VariableCommentsThread variableId="var-1" />);

    expect(screen.getByText('Loading comments...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
  });

  it('shows error with retry and does not claim there are no comments', async () => {
    listVariableComments.mockRejectedValueOnce(new Error('Internal server error'));

    render(<VariableCommentsThread variableId="var-1" />);

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
    expect(screen.queryByText('No comments yet.')).not.toBeInTheDocument();

    listVariableComments.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
  });
});
