import { resolveApiUrlForHost } from '@/lib/api/client';

describe('resolveApiUrlForHost', () => {
  it('keeps the configured URL on localhost', () => {
    expect(resolveApiUrlForHost('localhost', 'http://localhost:8000')).toBe(
      'http://localhost:8000',
    );
    expect(resolveApiUrlForHost('127.0.0.1', 'http://localhost:8000')).toBe(
      'http://localhost:8000',
    );
  });

  it('uses same-origin on LAN hosts so Next can rewrite', () => {
    expect(resolveApiUrlForHost('192.168.1.194', 'http://localhost:8000')).toBe('');
    expect(resolveApiUrlForHost('nitrogen.local', 'http://localhost:8000')).toBe('');
  });

  it('falls back to configured URL when hostname is unavailable', () => {
    expect(resolveApiUrlForHost(undefined, 'http://localhost:8000')).toBe(
      'http://localhost:8000',
    );
  });
});
