/*
 * Sparse-set ECS (ADR-003).
 *
 * Design goals:
 *  - zero allocation in the hot path (no per-entity objects)
 *  - cache-friendly dense iteration per component
 *  - stale-handle detection via generation counters
 *
 * Entity handle = (index << 8) | generation, packed into a number.
 */

export type Entity = number;

export const MAX_GENERATIONS = 256;

export function makeEntity(index: number, generation: number): Entity {
  return (index << 8) | (generation & 0xff);
}

export function entityIndex(e: Entity): number {
  return e >>> 8;
}

export function entityGeneration(e: Entity): number {
  return e & 0xff;
}

/** A component store: dense arrays plus a sparse index map. */
export class ComponentStore<T> {
  readonly dense: T[] = [];
  readonly entities: Entity[] = [];
  private sparse: Int32Array;
  private capacity: number;

  constructor(capacity: number, private factory: () => T) {
    this.capacity = capacity;
    this.sparse = new Int32Array(capacity).fill(-1);
  }

  private grow(index: number): void {
    if (index < this.capacity) return;
    let cap = this.capacity;
    while (cap <= index) cap *= 2;
    const next = new Int32Array(cap).fill(-1);
    next.set(this.sparse);
    this.sparse = next;
    this.capacity = cap;
  }

  has(e: Entity): boolean {
    const i = entityIndex(e);
    if (i >= this.capacity) return false;
    const d = this.sparse[i];
    return d >= 0 && this.entities[d] === e;
  }

  add(e: Entity): T {
    const i = entityIndex(e);
    this.grow(i);
    const existing = this.sparse[i];
    if (existing >= 0 && this.entities[existing] === e) return this.dense[existing];
    const value = this.factory();
    this.sparse[i] = this.dense.length;
    this.dense.push(value);
    this.entities.push(e);
    return value;
  }

  get(e: Entity): T | undefined {
    const i = entityIndex(e);
    if (i >= this.capacity) return undefined;
    const d = this.sparse[i];
    if (d < 0 || this.entities[d] !== e) return undefined;
    return this.dense[d];
  }

  /** Throws if absent — use in systems that already queried the component. */
  must(e: Entity): T {
    const v = this.get(e);
    if (v === undefined) throw new Error(`component missing for entity ${e}`);
    return v;
  }

  remove(e: Entity): void {
    const i = entityIndex(e);
    if (i >= this.capacity) return;
    const d = this.sparse[i];
    if (d < 0 || this.entities[d] !== e) return;
    const last = this.dense.length - 1;
    if (d !== last) {
      this.dense[d] = this.dense[last];
      const movedEntity = this.entities[last];
      this.entities[d] = movedEntity;
      this.sparse[entityIndex(movedEntity)] = d;
    }
    this.dense.pop();
    this.entities.pop();
    this.sparse[i] = -1;
  }

  get size(): number {
    return this.dense.length;
  }

  clear(): void {
    this.dense.length = 0;
    this.entities.length = 0;
    this.sparse.fill(-1);
  }
}

export class World {
  private generations: Uint8Array;
  private alive: Uint8Array;
  private freeList: number[] = [];
  private nextIndex = 0;
  private capacity: number;
  private stores = new Map<string, ComponentStore<unknown>>();

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.generations = new Uint8Array(capacity);
    this.alive = new Uint8Array(capacity);
  }

  create(): Entity {
    let index: number;
    if (this.freeList.length > 0) {
      index = this.freeList.pop() as number;
    } else {
      index = this.nextIndex++;
      if (index >= this.capacity) this.growCapacity(index + 1);
    }
    this.alive[index] = 1;
    return makeEntity(index, this.generations[index]);
  }

  destroy(e: Entity): void {
    const i = entityIndex(e);
    if (i >= this.capacity || !this.alive[i]) return;
    if (this.generations[i] !== entityGeneration(e)) return;
    for (const store of this.stores.values()) store.remove(e);
    this.alive[i] = 0;
    this.generations[i] = (this.generations[i] + 1) % MAX_GENERATIONS;
    this.freeList.push(i);
  }

  isAlive(e: Entity): boolean {
    const i = entityIndex(e);
    return i < this.capacity && this.alive[i] === 1 && this.generations[i] === entityGeneration(e);
  }

  private growCapacity(needed: number): void {
    let cap = this.capacity;
    while (cap < needed) cap *= 2;
    const g = new Uint8Array(cap);
    g.set(this.generations);
    const a = new Uint8Array(cap);
    a.set(this.alive);
    this.generations = g;
    this.alive = a;
    this.capacity = cap;
  }

  /** Register (or fetch) a component store. */
  store<T>(name: string, factory: () => T): ComponentStore<T> {
    let s = this.stores.get(name) as ComponentStore<T> | undefined;
    if (!s) {
      s = new ComponentStore<T>(this.capacity, factory);
      this.stores.set(name, s as ComponentStore<unknown>);
    }
    return s;
  }

  get entityCount(): number {
    return this.nextIndex - this.freeList.length;
  }

  clear(): void {
    for (const s of this.stores.values()) s.clear();
    this.generations.fill(0);
    this.alive.fill(0);
    this.freeList.length = 0;
    this.nextIndex = 0;
  }
}
