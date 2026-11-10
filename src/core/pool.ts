/*
 * Object pools. The hot path must not allocate: bullets, decals, particles and
 * one-shot audio voices all come from pre-sized pools.
 */

export class Pool<T> {
  private free: T[] = [];
  private live = new Set<T>();

  constructor(private factory: () => T, private reset: (item: T) => void, prealloc = 0) {
    for (let i = 0; i < prealloc; i++) this.free.push(factory());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    this.live.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.live.delete(item)) return;
    this.reset(item);
    this.free.push(item);
  }

  get liveCount(): number {
    return this.live.size;
  }

  get freeCount(): number {
    return this.free.length;
  }

  forEachLive(fn: (item: T) => void): void {
    for (const item of this.live) fn(item);
  }

  clear(): void {
    for (const item of this.live) {
      this.reset(item);
      this.free.push(item);
    }
    this.live.clear();
  }
}

/** Ring buffer for fixed-size history (recoil patterns, hit logs, telemetry). */
export class RingBuffer<T> {
  private buf: T[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number, fill: () => T) {
    this.buf = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.buf[i] = fill();
  }

  push(v: T): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** 0 = most recent. */
  at(i: number): T {
    const idx = (this.head - 1 - i + this.capacity * 2) % this.capacity;
    return this.buf[idx];
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.at(i));
    return out;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
