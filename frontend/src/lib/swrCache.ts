/**
 * Tiny in-memory stale-while-revalidate cache for client fetches.
 * Prefer painting cached data immediately; only treat as "loading" on miss.
 */

type CacheEntry<T> = {
  data: T;
  updatedAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export const DEFAULT_STALE_MS = 45_000;

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  return entry?.data;
}

export function isFresh(key: string, staleTimeMs = DEFAULT_STALE_MS): boolean {
  const entry = store.get(key);
  if (!entry) return false;
  return Date.now() - entry.updatedAt < staleTimeMs;
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data, updatedAt: Date.now() });
}

export function invalidate(key: string): void {
  store.delete(key);
  inflight.delete(key);
}

export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

export function clearSwrCache(): void {
  store.clear();
  inflight.clear();
}

/**
 * Return cached data immediately when present; always refresh when stale
 * (or when force). Dedupes concurrent fetches for the same key.
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { staleTimeMs?: number; force?: boolean },
): Promise<{ data: T; fromCache: boolean }> {
  const staleTimeMs = options?.staleTimeMs ?? DEFAULT_STALE_MS;
  const cached = getCached<T>(key);
  const fresh = isFresh(key, staleTimeMs);

  if (cached !== undefined && fresh && !options?.force) {
    return { data: cached, fromCache: true };
  }

  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = fetcher()
      .then((data) => {
        setCached(key, data);
        return data;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }

  // Stale-while-revalidate: kick off refresh but return cache immediately.
  if (cached !== undefined && !options?.force) {
    void pending.catch(() => undefined);
    return { data: cached, fromCache: true };
  }

  const data = await pending;
  return { data, fromCache: false };
}

/** Cache keys used across workbench panels. */
export const swrKeys = {
  project: (id: string) => `project:${id}`,
  materials: (id: string) => `materials:${id}`,
  status: (id: string) => `status:${id}`,
  shares: (id: string) => `shares:${id}`,
  variables: (id: string) => `variables:${id}`,
  instances: (id: string) => `instances:${id}`,
  health: (id: string) => `health:${id}`,
} as const;
