export class WsSessionLifecycle<K, V> {
  private readonly sessions = new Map<K, V>();
  register(key: K, value: V): void { this.sessions.set(key, value); }
  get(key: K): V | undefined { return this.sessions.get(key); }
  remove(key: K): V | undefined { const value = this.sessions.get(key); this.sessions.delete(key); return value; }
  entries(): IterableIterator<[K, V]> { return this.sessions.entries(); }
  values(): IterableIterator<V> { return this.sessions.values(); }
  get size(): number { return this.sessions.size; }
  clear(): void { this.sessions.clear(); }
}
