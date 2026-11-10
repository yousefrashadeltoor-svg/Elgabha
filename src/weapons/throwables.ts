/*
 * Throwable projectiles (grenades, smoke) and explosive projectiles.
 *
 * Throwables are WeaponData records with class 'throwable'. Fuse times are
 * derived from the weapon id (the schema has no fuse field) and blast damage
 * comes from the weapon's damage curve.
 */

import * as THREE from 'three';
import type { WeaponData } from '../data/schema';
import type { PhysicsWorld } from '../physics/physics';
import { COL } from '../physics/physics';

export type GrenadeType = 'frag' | 'smoke' | 'incendiary' | 'at';

export interface GrenadeState {
  id: number;
  type: GrenadeType;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  alive: boolean;
  data: WeaponData;
  bodyId: number | null;
  smokeUntil: number;
  ownerFaction: number;
  detonated: boolean;
}

export interface ExplosionResult {
  center: THREE.Vector3;
  radius: number;
  maxDamage: number;
  ownerFaction: number;
  impulse: number;
}

const FUSE_TABLE: Record<string, number> = {
  rgd33: 3.8, rg42: 3.5, f1: 4.0, m24: 4.5, m39: 4.0,
  smoke: 1.4, rdg1: 1.2, molotov: 0.0,
};

export class ThrowableManager {
  private states: GrenadeState[] = [];
  private nextId = 1;
  private smokeMesh: THREE.InstancedMesh | null = null;
  private smokeCount = 0;
  private smokeCapacity = 480;

  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld,
    private onExplode: (e: ExplosionResult) => void,
    private onEvent: (msg: string) => void,
  ) {}

  spawn(
    type: GrenadeType,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    throwPower: number,
    data: WeaponData,
    ownerFaction: number,
  ): GrenadeState {
    const fuse = FUSE_TABLE[data.id] ?? 4;
    const state: GrenadeState = {
      id: this.nextId++,
      type,
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(throwPower),
      fuse,
      alive: true,
      data,
      bodyId: null,
      smokeUntil: 0,
      ownerFaction,
      detonated: false,
    };
    this.states.push(state);
    if (type !== 'smoke') {
      try {
        state.bodyId = this.physics.spawnCapsule([origin.x, origin.y, origin.z], 0.06, 0.12, COL.PROJECTILE, true);
      } catch {
        state.bodyId = null;
      }
    }
    this.ensureSmokeMesh();
    return state;
  }

  private ensureSmokeMesh(): void {
    if (this.smokeMesh) return;
    const geo = new THREE.SphereGeometry(0.35, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9a9a94, transparent: true, opacity: 0.6, depthWrite: false });
    this.smokeMesh = new THREE.InstancedMesh(geo, mat, this.smokeCapacity);
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.visible = false;
    this.scene.add(this.smokeMesh);
  }

  update(dt: number): void {
    const dummy = new THREE.Object3D();
    let smokeIdx = 0;
    if (this.smokeMesh) this.smokeMesh.visible = this.smokeCount > 0;

    for (const s of this.states) {
      if (!s.alive) continue;
      s.fuse -= dt;

      if (s.type === 'smoke') {
        s.pos.y += dt * 1.4;
        if (s.fuse <= 0) s.smokeUntil = performance.now() + 14000;
        if (s.smokeUntil > 0) {
          if (s.smokeUntil - performance.now() <= 0) {
            s.alive = false;
            continue;
          }
          for (let k = 0; k < 2 && smokeIdx < this.smokeCapacity; k++) {
            dummy.position.copy(s.pos);
            dummy.position.x += (Math.random() - 0.5) * 1.4;
            dummy.position.z += (Math.random() - 0.5) * 1.4;
            dummy.position.y += Math.random() * 0.8;
            const scale = 1.1 + Math.random() * 1.6;
            dummy.scale.set(scale, scale * 1.4, scale);
            dummy.updateMatrix();
            this.smokeMesh!.setMatrixAt(smokeIdx++, dummy.matrix);
          }
        }
        continue;
      }

      s.vel.y -= 9.81 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.06 && s.vel.y < 0) {
        s.pos.y = 0.06;
        s.vel.y *= -0.35;
        s.vel.x *= 0.7;
        s.vel.z *= 0.7;
      }
      if (s.bodyId !== null) this.physics.setBodyTranslation(s.bodyId, s.pos);
      if (s.fuse <= 0 && !s.detonated) {
        s.detonated = true;
        this.detonate(s);
        s.alive = false;
      }
    }
    if (this.smokeMesh) {
      this.smokeMesh.count = smokeIdx;
      this.smokeCount = smokeIdx;
      this.smokeMesh.instanceMatrix.needsUpdate = true;
    }
    this.states = this.states.filter((s) => s.alive);
  }

  private detonate(s: GrenadeState): void {
    const d = s.data.damage;
    this.onExplode({
      center: s.pos.clone(),
      radius: d.farRange,
      maxDamage: d.near,
      ownerFaction: s.ownerFaction,
      impulse: d.near * 6,
    });
    this.onEvent(`grenade detonated (${s.type})`);
  }

  get count(): number {
    return this.states.length;
  }
}
