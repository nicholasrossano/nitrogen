/**
 * @jest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react';
import DemoEntryPage from '@/app/demo/page';

const replace = jest.fn();
const startDemoSession = jest.fn();
const beginDemoEntry = jest.fn();
const endDemoEntry = jest.fn();
const enterDemo = jest.fn();

let authState: {
  user: { uid: string } | null;
  loading: boolean;
  signOut: jest.Mock;
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => authState,
}));

jest.mock('@/lib/demo/demoBoundary', () => ({
  startDemoSession: (...args: unknown[]) => startDemoSession(...args),
}));

jest.mock('@/lib/demo/demoSession', () => ({
  beginDemoEntry: (...args: unknown[]) => beginDemoEntry(...args),
  endDemoEntry: (...args: unknown[]) => endDemoEntry(...args),
  enterDemo: (...args: unknown[]) => enterDemo(...args),
  buildDemoProjectPath: () => '/projects/demo-rift-valley-solar',
}));

jest.mock('@/components/ui/PageLoader', () => ({
  UniversalLoadingIcon: () => <div data-testid="loading-icon" />,
}));

describe('DemoEntryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authState = {
      user: { uid: 'signed-in-user' },
      loading: false,
      signOut: jest.fn().mockResolvedValue(undefined),
    };
    startDemoSession.mockImplementation(async (opts?: { hasUser?: boolean; signOut?: () => Promise<void> }) => {
      if (opts?.hasUser && opts.signOut) {
        await opts.signOut();
      }
    });
  });

  it('navigates to the demo project even when sign-out clears the auth user mid-bootstrap', async () => {
    let finishSession!: () => void;
    startDemoSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSession = resolve;
        }),
    );

    const { rerender } = render(<DemoEntryPage />);

    await waitFor(() => {
      expect(startDemoSession).toHaveBeenCalledWith(
        expect.objectContaining({ hasUser: true }),
      );
    });

    // Simulate Firebase emitting null after our sign-out — previously this
    // re-ran the effect, cancelled router.replace, and hung on "Opening demo…".
    authState = { ...authState, user: null };
    rerender(<DemoEntryPage />);

    expect(replace).not.toHaveBeenCalled();
    finishSession();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/projects/demo-rift-valley-solar');
    });
    expect(startDemoSession).toHaveBeenCalledTimes(1);
  });

  it('waits for auth loading before starting the session', async () => {
    authState = { ...authState, loading: true, user: null };
    const { rerender } = render(<DemoEntryPage />);

    expect(startDemoSession).not.toHaveBeenCalled();
    expect(beginDemoEntry).toHaveBeenCalled();
    expect(enterDemo).toHaveBeenCalled();

    authState = { ...authState, loading: false };
    await act(async () => {
      rerender(<DemoEntryPage />);
    });

    await waitFor(() => {
      expect(startDemoSession).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('/projects/demo-rift-valley-solar');
    });
  });
});
