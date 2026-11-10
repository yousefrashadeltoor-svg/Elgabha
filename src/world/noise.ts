/*
 * Deterministic value noise + fBm (fractal Brownian motion).
 * The terrain heightfield and any other procedural placement derive from an
 * Rng-seeded lattice, so the same map seed always produces the same world.
 */

import { Rng } from '../core/rng';
import { TAU } from '../core/math';

export class ValueNoise2D {
  private perm: Uint32Array;
  private size = 256;

  constructor(seed: number) {
    const rng = new Rng(seed);
    const values = new Float32Array(this.size * this.size);
    for (let i = 0; i < values.length; i++) values[i] = rng.next() * 2 - 1;
    this.perm = new Uint32Array(this.size * 2);
    for (let i = 0; i < this.size; i++) this.perm[i] = i;
    // Fisher-Yates
    for (let i = this.size - 1; i > 0; i--) {
      const j = rng.int(0, i + 1);
      const t = this.perm[i];
      this.perm[i] = this.perm[j];
      this.perm[j] = t;
    }
    for (let i = 0; i < this.size; i++) {
      this.perm[this.size + i] = this.perm[i];
    }
    this.values = values;
  }

  private values: Float32Array;
  private used = 0;

  /** Value noise in [0,1]. */
  noise(x: number, y: number): number {
    const xi = Math.floor(x) & (this.size - 1);
    const yi = Math.floor(y) & (this.size - 1);
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = smooth(xf);
    const v = smooth(yf);
    const a = this.at(xi, yi);
    const b = this.at(xi + 1, yi);
    const c = this.at(xi, yi + 1);
    const d = this.at(xi + 1, yi + 1);
    return lerp2(u, v, a, b, c, d) * 0.5 + 0.5;
  }

  /** fBm sum of `octaves` octaves, in [0,1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.55): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  private at(x: number, y: number): number {
    const i = x & (this.size - 1);
    const j = (y & (this.size - 1)) + this.size;
    return this.values[(this.perm[i] + j) & (this.size * 2 - 1)];
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp2(u: number, v: number, a: number, b: number, c: number, d: number): number {
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

/** Cheap deterministic 2D vector hash for wind / grass driven by time. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function radialMask(dist: number, inner: number, outer: number): number {
  if (dist <= inner) return 1;
  if (dist >= outer) return 0;
  const t = (dist - inner) / (outer - inner);
  return 0.5 - 0.5 * Math.cos(t * Math.PI);
}

export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}
