import type { CacheStore } from 'baileys'

/**
 * A small in-memory cache with a per-entry lifetime and a size bound (oldest entry out first). It
 * satisfies Baileys' CacheStore, so one instance can outlive the sockets of a session — Baileys' own
 * default caches die with every reconnect.
 */
export class TtlCache<V = unknown> implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expires: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get<T = V>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set<T = V>(key: string, value: T, ttlMs: number = this.ttlMs): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: Date.now() + ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  del(key: string): void {
    this.entries.delete(key)
  }

  flushAll(): void {
    this.entries.clear()
  }
}
