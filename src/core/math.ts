/* Deterministic math helpers. No allocation in hot paths. */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing. `rate` = fraction remaining per second.
 *
 * The blend factor is clamped to [0,1]. Without the clamp, a large dt makes
 * `rate^dt` exceed 2 and the factor goes negative, so the value extrapolates
 * past its target and diverges on the next call. That is exactly what happened
 * at 4 fps: the viewmodel sway ran away to -116 units.
 */
export function damp(a: number, b: number, rate: number, dt: number): number {
  const t = 1 - Math.pow(rate, Math.min(dt, 0.25));
  return lerp(a, b, clamp01(t));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function moveTowards(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

/** Shortest signed angular difference in radians, result in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/**
 * Solve the launch elevation needed to hit a target at horizontal distance `d`
 * and height difference `h`, with speed `v` and gravity `g`.
 * Returns the low-arc solution in radians, or NaN if out of range.
 */
export function ballisticElevation(d: number, h: number, v: number, g: number): number {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return NaN;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

/**
 * Time of flight for a projectile with drag coefficient `k` (1/s) over distance `d`
 * at initial speed `v`. Uses the closed form for linear drag.
 */
export function timeOfFlightDrag(d: number, v: number, k: number): number {
  if (k <= 1e-6) return d / v;
  const x = 1 - (k * d) / v;
  if (x <= 0) return Infinity;
  return -Math.log(x) / k;
}

/** Speed remaining after travelling `d` with linear drag `k` from `v`. */
export function speedAfterDrag(d: number, v: number, k: number): number {
  if (k <= 1e-6) return v;
  return Math.max(0, v - k * d);
}

/**
 * Vertical drop (metres) of a projectile over horizontal distance `d` fired at
 * speed `v` with gravity `g`, ignoring drag. Used for scope zeroing tables.
 */
export function dropOverDistance(d: number, v: number, g: number): number {
  const t = d / v;
  return 0.5 * g * t * t;
}

/** Convert a linear volume 0..1 to decibels for Web Audio gain. */
export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(1e-6, g));
}

/** Inverse-square-ish distance attenuation with a near-field floor. */
export function distanceGain(dist: number, refDist: number, rolloff: number): number {
  const d = Math.max(dist, refDist);
  return clamp01(refDist / (refDist + rolloff * (d - refDist)));
}

export function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}
