/**
 * @jest-environment jsdom
 */
import {
  clearLastProjectPreference,
  getSafeReturnUrl,
  isProjectResumePath,
  resolvePostAuthDestination,
} from '@/lib/authReturnUrl';

const LAST_PROJECT_KEY = 'nitrogen-last-project-id';

describe('authReturnUrl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rejects open redirects and non-relative paths', () => {
    expect(getSafeReturnUrl(null)).toBe('/');
    expect(getSafeReturnUrl('https://evil.example/phish')).toBe('/');
    expect(getSafeReturnUrl('//evil.example')).toBe('/');
    expect(getSafeReturnUrl('projects/x')).toBe('/');
  });

  it('strips demo and real project resume paths', () => {
    expect(isProjectResumePath('/projects')).toBe(true);
    expect(isProjectResumePath('/projects/abc')).toBe(true);
    expect(isProjectResumePath('/projects/abc?panel=files')).toBe(true);
    expect(isProjectResumePath('/chat')).toBe(false);

    expect(getSafeReturnUrl('/projects/demo-rift-valley-solar')).toBe('/');
    expect(getSafeReturnUrl('/projects/29fac4ff-3549-44b6-b80e-991b3b123f94')).toBe('/');
    expect(getSafeReturnUrl('/projects/x?panel=files')).toBe('/');
  });

  it('keeps non-project same-origin paths', () => {
    expect(getSafeReturnUrl('/settings')).toBe('/settings');
    expect(getSafeReturnUrl('/art-lab')).toBe('/art-lab');
  });

  it('resolvePostAuthDestination lands on /chat and clears last-project for project resumes', () => {
    localStorage.setItem(LAST_PROJECT_KEY, 'stale-project');
    expect(resolvePostAuthDestination('/projects/stale-project')).toBe('/chat');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();

    localStorage.setItem(LAST_PROJECT_KEY, 'keep-for-settings');
    expect(resolvePostAuthDestination('/settings')).toBe('/settings');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe('keep-for-settings');
  });

  it('clearLastProjectPreference removes the key', () => {
    localStorage.setItem(LAST_PROJECT_KEY, 'x');
    clearLastProjectPreference();
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
  });
});
