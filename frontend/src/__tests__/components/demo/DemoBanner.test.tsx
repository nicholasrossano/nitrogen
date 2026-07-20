/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { DemoBanner } from '@/components/demo/DemoBanner';

const leaveDemoForSignup = jest.fn();

jest.mock('@/hooks/useDemoMode', () => ({
  useDemoMode: () => ({ isDemo: true }),
}));

jest.mock('@/lib/demo/demoBoundary', () => ({
  leaveDemoForSignup: (...args: unknown[]) => leaveDemoForSignup(...args),
}));

describe('DemoBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Sign up leaves demo via leaveDemoForSignup (not back into /demo)', () => {
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(leaveDemoForSignup).toHaveBeenCalledTimes(1);
  });
});
