import '@testing-library/jest-dom';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Mock Firebase auth so tests don't need real credentials
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  getAuthToken: jest.fn().mockResolvedValue(null),
}));

// @vercel/analytics is ESM-only; Jest's CJS runtime cannot parse it.
// Demo tracking is asserted via the mocked `track` in demoBoundary tests.
jest.mock('@vercel/analytics', () => ({
  track: jest.fn(),
}));
jest.mock('@vercel/analytics/react', () => ({
  Analytics: () => null,
}));

// Mock window.matchMedia (not implemented in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock ResizeObserver (not implemented in jsdom)
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
