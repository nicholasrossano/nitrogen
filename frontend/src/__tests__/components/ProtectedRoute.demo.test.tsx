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
      expect(push).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalledWith('/demo');
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
