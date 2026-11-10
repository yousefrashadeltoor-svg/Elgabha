/*
 * Deterministic PRNG. The simulation must be reproducible from (seed, intents)
 * so that G4 netcode can run the same systems on the server.
 *
 * mulberry32: small, fast, good enough distribution for gameplay randomness.
 */

export class Rng {
  private s: number;

  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(loInclusive: number, hiExclusive: number): number {
    return loInclusive + Math.floor(this.next() * (hiExclusive - loInclusive));
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Signed value in [-m, m]. */
  sym(m: number): number {
    return (this.next() * 2 - 1) * m;
  }

  /** Approximately normal via the sum of 3 uniforms (Bates distribution). */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }
}

/** Shared non-deterministic RNG for presentation-only effects (particles, audio). */
export const fxRng = new Rng((Math.random() * 0xffffffff) >>> 0);
