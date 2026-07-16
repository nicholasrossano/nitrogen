import {
  clearSwrCache,
  getCached,
  invalidate,
  invalidatePrefix,
  isFresh,
  setCached,
  swrFetch,
} from '@/lib/swrCache';

describe('swrCache', () => {
  beforeEach(() => {
    clearSwrCache();
  });

  it('stores and reads cached values', () => {
    setCached('k', { n: 1 });
    expect(getCached<{ n: number }>('k')).toEqual({ n: 1 });
    expect(isFresh('k')).toBe(true);
  });

  it('returns cache hit without calling fetcher when fresh', async () => {
    setCached('fresh', 'warm');
    const fetcher = jest.fn(async () => 'cold');
    const result = await swrFetch('fresh', fetcher);
    expect(result).toEqual({ data: 'warm', fromCache: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('dedupes concurrent fetches for the same key', async () => {
    let resolveFetch!: (value: string) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = swrFetch('dup', fetcher);
    const b = swrFetch('dup', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch('ok');
    await expect(Promise.all([a, b])).resolves.toEqual([
      { data: 'ok', fromCache: false },
      { data: 'ok', fromCache: false },
    ]);
  });

  it('returns stale cache immediately while refreshing', async () => {
    setCached('stale', 'old');
    let resolveFetch!: (value: string) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const resultPromise = swrFetch('stale', fetcher, { staleTimeMs: 0 });
    const result = await resultPromise;
    expect(result).toEqual({ data: 'old', fromCache: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch('new');
    await Promise.resolve();
    await Promise.resolve();
    expect(getCached<string>('stale')).toBe('new');
  });

  it('force waits for network even when cached', async () => {
    setCached('forced', 'old');
    const fetcher = jest.fn(async () => 'new');
    const result = await swrFetch('forced', fetcher, { force: true });
    expect(result).toEqual({ data: 'new', fromCache: false });
  });

  it('invalidate and invalidatePrefix remove entries', () => {
    setCached('assumptions:p1', [1]);
    setCached('assumptions:p1:validated', [2]);
    setCached('other', 3);
    invalidate('other');
    expect(getCached('other')).toBeUndefined();
    invalidatePrefix('assumptions:p1');
    expect(getCached('assumptions:p1')).toBeUndefined();
    expect(getCached('assumptions:p1:validated')).toBeUndefined();
  });
});
