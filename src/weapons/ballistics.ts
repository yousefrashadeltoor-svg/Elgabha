/*
 * Ballistics: a custom integrator (ADR-002).
 *
 * Bullets are not Rapier bodies. Each round is advanced analytically per step
 * using linear drag + gravity, and raycasts segment-by-segment against the
 * physics world. Penetration follows a material table; hit zones scale damage.
 */

import * as THREE from 'three';
import type { AmmoData, WeaponData } from '../data/schema';
import { clamp } from '../core/math';

export type HitZone = 'head' | 'chest' | 'stomach' | 'limb' | 'vehicle' | 'structure';

export interface HitResult {
  hit: boolean;
  zone: HitZone;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  killed: boolean;
  entityId: number | null;
  penetration: number; // mm of RHA defeated along the path
}

export interface MaterialDef {
  label: string;
  /** Multipliers per zone, ordered head/chest/stomach/limb. */
  zoneMul: [number, number, number, number];
  /** Millimetres of RHA equivalent per metre of this material. */
  armorPerMeter: number;
  ricochetChance: number;
  visual: number; // impact colour id
}

const MATERIALS: Record<string, MaterialDef> = {
  wood: { label: 'wood', zoneMul: [1, 1, 1, 1], armorPerMeter: 18, ricochetChance: 0.02, visual: 0x8a6b3a },
  plaster: { label: 'plaster', zoneMul: [1, 1, 1, 1], armorPerMeter: 6, ricochetChance: 0, visual: 0xb0a590 },
  brick: { label: 'brick', zoneMul: [1, 1, 1, 1], armorPerMeter: 70, ricochetChance: 0.05, visual: 0x9a4a3a },
  concrete: { label: 'concrete', zoneMul: [1, 1, 1, 1], armorPerMeter: 240, ricochetChance: 0.1, visual: 0x8f8a82 },
  metal: { label: 'metal', zoneMul: [1, 1, 1, 1], armorPerMeter: 400, ricochetChance: 0.25, visual: 0x7a7a74 },
  flesh: { label: 'flesh', zoneMul: [4, 1, 1.2, 0.6], armorPerMeter: 0, ricochetChance: 0, visual: 0x6d3b30 },
  vehicleArmor: { label: 'vehicle', zoneMul: [1, 1, 1, 1], armorPerMeter: 900, ricochetChance: 0.3, visual: 0x5c5c56 },
  sand: { label: 'sand', zoneMul: [1, 1, 1, 1], armorPerMeter: 10, ricochetChance: 0, visual: 0x9c8f6a },
  dirt: { label: 'dirt', zoneMul: [1, 1, 1, 1], armorPerMeter: 12, ricochetChance: 0, visual: 0x6a5c3e },
  stone: { label: 'stone', zoneMul: [1, 1, 1, 1], armorPerMeter: 220, ricochetChance: 0.12, visual: 0x777066 },
  wire: { label: 'wire', zoneMul: [1, 1, 1, 1], armorPerMeter: 5, ricochetChance: 0, visual: 0x6a6a64 },
  default: { label: 'default', zoneMul: [1, 1, 1, 1], armorPerMeter: 14, ricochetChance: 0, visual: 0x777777 },
};

export function materialDef(key: string): MaterialDef {
  return MATERIALS[key] ?? MATERIALS.default;
}

export interface BallisticState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  travelled: number;
  alive: boolean;
  remainingPenetration: number;
  weaponId: string;
  shooterId: number | null;
  firedTick: number;
}

/**
 * Advance a bullet one fixed step of size `dt`. `raycastFn` resolves a segment
 * against the world and returns a hit descriptor; it receives the segment
 * endpoints and returns a material key + optional entity id.
 */
export interface SegmentHit {
  t: number;           // 0..1 along the segment
  material: string;
  entityId: number | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface BallisticCallbacks {
  raycastSegment(from: THREE.Vector3, to: THREE.Vector3, shooterFaction: number): SegmentHit | null;
  onWallImpact?(hit: { point: THREE.Vector3; normal: THREE.Vector3; material: string }): void;
}

export function stepBallistic(
  b: BallisticState,
  weapon: WeaponData,
  ammo: AmmoData,
  dt: number,
  cb: BallisticCallbacks,
  gravity = 9.81,
): void {
  if (!b.alive) return;
  const prev = b.pos.clone();
  // Velocity update with linear drag
  const drag = weapon.dragK;
  if (drag <= 1e-6) {
    b.vel.y -= gravity * weapon.gravityScale * dt;
  } else {
    const factor = Math.exp(-drag * dt);
    b.vel.multiplyScalar(factor);
    b.vel.y -= gravity * weapon.gravityScale * dt;
  }
  b.pos.addScaledVector(b.vel, dt);
  b.travelled += prev.distanceTo(b.pos);
  if (b.travelled > 2400 || b.pos.y < -40) {
    b.alive = false;
    return;
  }
  const hit = cb.raycastSegment(prev, b.pos, 1);
  if (hit) {
    const def = materialDef(hit.material);
    const armorAlong = def.armorPerMeter * (b.remainingPenetration > 0 ? 0.15 : 1) * hit.t * prev.distanceTo(b.pos);
    if (armorAlong > 0 && b.remainingPenetration > 0) {
      b.remainingPenetration -= armorAlong;
    }
    if (b.remainingPenetration <= 0 || def.armorPerMeter > 300) {
      // Stopped. Ricochet check for glancing impacts on hard surfaces.
      const ricochet = def.ricochetChance > 0 && Math.random() < def.ricochetChance;
      if (ricochet) {
        const n = hit.normal;
        const vn = b.vel.dot(n);
        b.vel.addScaledVector(n, -2 * vn).multiplyScalar(0.82);
      } else {
        b.alive = false;
      }
      cb.onWallImpact?.({ point: hit.point, normal: hit.normal, material: hit.material });
    }
    // Hit marker event is emitted by the caller with the entity id.
  }
}

export function damageForWeapon(weapon: WeaponData, distance: number): number {
  const d = weapon.damage;
  if (distance <= d.nearRange) return d.near;
  if (distance >= d.farRange) return d.far;
  const t = (distance - d.nearRange) / (d.farRange - d.nearRange);
  return d.near + (d.far - d.near) * t;
}

export function lethalRange(weapon: WeaponData, health: number): number {
  const d = weapon.damage;
  if (d.near >= health) return d.nearRange;
  if (d.far >= health) {
    const t = (health - d.far) / (d.near - d.far);
    return d.nearRange + t * (d.farRange - d.nearRange);
  }
  return 0;
}

export function travelTime(weapon: WeaponData, distance: number): number {
  const v = weapon.muzzleVelocity;
  const k = weapon.dragK;
  if (k <= 1e-6) return distance / v;
  const x = 1 - (k * distance) / v;
  if (x <= 0) return 10;
  return -Math.log(x) / k;
}

export function hitZoneFromHeight(relHeight: number, height: number): HitZone {
  // relHeight: impact height above the entity's root; height: total entity height.
  const r = relHeight / height;
  if (r > 0.78) return 'head';
  if (r > 0.5) return 'chest';
  if (r > 0.3) return 'stomach';
  return 'limb';
}

export function clampSpeed(v: number): number {
  return clamp(v, 0, 1200);
}
