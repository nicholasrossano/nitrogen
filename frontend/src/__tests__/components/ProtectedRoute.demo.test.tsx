/**
 * @jest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const replace = jest.fn();
const push = jest.fn();
let pathname = '/projects/demo-rift-valley-solar';
let authState: {
  user: { uid: string; emailVerified?: boolean } | null;
  loading: boolean;
};
let demoActive = false;
let leavingForAuth = false;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => pathname,
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => authState,
  needsEmailVerification: (user: { emailVerified?: boolean } | null) =>
    Boolean(user && user.emailVerified === false),
}));

jest.mock('@/lib/demo/demoSession', () => ({
  DEMO_PROJECT_ID: 'demo-rift-valley-solar',
  DEMO_SESSION_EVENT: 'nitrogen:demo-session',
  isDemoActive: () => demoActive,
  isDemoProjectPath: (path: string | null) =>
    Boolean(path && path.includes('demo-rift-valley-solar')),
  isLeavingDemoForAuth: () => leavingForAuth,
}));

describe('ProtectedRoute demo edges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pathname = '/projects/demo-rift-valley-solar';
    authState = { user: null, loading: false };
    demoActive = false;
    leavingForAuth = false;
  });

  it('sends orphan demo project URLs to /demo instead of login', async () => {
    render(
      <ProtectedRoute>
        <div>secret</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/demo');
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('does not re-bootstrap /demo while leaving demo for signup', async () => {
    leavingForAuth = true;
    render(
      <ProtectedRoute>
        <div>secret</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
    expect(replace).not.toHaveBeenCalledWith('/demo');
  });

  it('does not attach project returnUrl when sending logged-out users to login', async () => {
    pathname = '/projects/29fac4ff-3549-44b6-b80e-991b3b123f94';
    render(
      <ProtectedRoute>
        <div>secret</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('returnUrl'));
  });

  it('preserves non-project returnUrl when sending logged-out users to login', async () => {
    pathname = '/settings';
    // settings may not be wrapped by ProtectedRoute in prod, but loginRedirect should keep it
    render(
      <ProtectedRoute>
        <div>secret</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login?returnUrl=%2Fsettings');
    });
  });

  it('allows the demo project through when the demo session flag is active', async () => {
    demoActive = true;
    const { getByText } = render(
      <ProtectedRoute>
        <div>demo-ok</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(getByText('demo-ok')).toBeInTheDocument();
    });
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
