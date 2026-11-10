/*
 * Enemy squad: spawns, per-enemy state, damage intake, death, and the
 * bridge between the AI controller and the world (movement, LOS, firing).
 *
 * Enemies are simple kinematic agents (not full Rapier bodies) so a squad of
 * 12+ stays cheap; they collide with the world via the navmesh and a
 * capsule-vs-collider push-out.
 */

import * as THREE from 'three';
import type { CharacterData, WeaponData } from '../data/schema';
import { AiController } from '../ai/ai';
import { buildCharacterMesh, disposeCharacterMesh, type CharacterMesh } from '../characters/character-builder';
import { clamp } from '../core/math';

export interface EnemySpawn {
  character: CharacterData;
  weapon: WeaponData;
  pos: THREE.Vector3;
  faction: number;
}

export interface EnemyHooks {
  terrainY: (x: number, z: number) => number;
  blocked: (x: number, z: number, r: number) => boolean;
  findPath: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3[];
  hasLineOfSight: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
  onFire: (enemy: Enemy, dir: THREE.Vector3) => void;
  onDeath: (enemy: Enemy) => void;
  onEvent: (msg: string) => void;
}

export class Enemy {
  readonly mesh: CharacterMesh;
  pos: THREE.Vector3;
  yaw = 0;
  health: number;
  alive = true;
  ai: AiController;
  readonly character: CharacterData;
  readonly weapon: WeaponData;
  readonly faction: number;
  private fireCooldown = 0;
  private moveTarget: THREE.Vector3 | null = null;
  private hooks: EnemyHooks;
  private deathT = 0;

  constructor(spawn: EnemySpawn, hooks: EnemyHooks) {
    this.character = spawn.character;
    this.weapon = spawn.weapon;
    this.faction = spawn.faction;
    this.hooks = hooks;
    this.pos = spawn.pos.clone();
    this.health = spawn.character.health;
    this.mesh = buildCharacterMesh(spawn.character);
    this.mesh.group.position.copy(this.pos);

    this.ai = new AiController({
      character: spawn.character,
      seek: (t) => { this.moveTarget = t; },
      stand: () => {},
      cut: () => {},
      lay: () => {},
      fireAt: (dir) => this.fire(dir),
      stopFiring: () => {},
      lookAt: (dir) => { this.yaw = Math.atan2(dir.x, dir.z); },
      getPlayerPos: () => this.playerPos(),
      getMyPos: () => this.pos.clone(),
      canShootPlayer: () => this.canSeePlayer(),
      tryTakeCover: () => null,
      findPath: (to) => this.hooks.findPath(this.pos, to),
      onEvent: hooks.onEvent,
    });
  }

  private playerPosRef: THREE.Vector3 = new THREE.Vector3();
  setPlayerPos(p: THREE.Vector3): void {
    this.playerPosRef.copy(p);
  }
  private playerPos(): THREE.Vector3 {
    return this.playerPosRef.clone();
  }

  private canSeePlayer(): boolean {
    const eye = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const target = this.playerPosRef.clone().add(new THREE.Vector3(0, 1.2, 0));
    const dist = eye.distanceTo(target);
    if (dist > this.weapon.damage.farRange * 1.4) return false;
    return this.hooks.hasLineOfSight(eye, target);
  }

  private fire(dir: THREE.Vector3): void {
    if (this.fireCooldown > 0 || !this.alive) return;
    this.fireCooldown = 60 / Math.max(this.weapon.rpm, 30) * 3;
    this.hooks.onFire(this, dir);
  }

  update(dt: number): void {
    if (!this.alive) {
      this.deathT += dt;
      // sink into the ground
      this.mesh.group.position.y = Math.max(
        this.hooks.terrainY(this.pos.x, this.pos.z) - 0.6,
        this.mesh.group.position.y - dt * 0.4,
      );
      this.mesh.group.rotation.z = Math.min(Math.PI / 2, this.mesh.group.rotation.z + dt * 1.2);
      return;
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.ai.update(dt);

    // movement toward moveTarget
    if (this.moveTarget) {
      const to = new THREE.Vector3(this.moveTarget.x - this.pos.x, 0, this.moveTarget.z - this.pos.z);
      const d = to.length();
      if (d < 0.8) {
        this.moveTarget = null;
      } else {
        to.normalize();
        const speed = this.character.speeds.walk;
        const nx = this.pos.x + to.x * speed * dt;
        const nz = this.pos.z + to.z * speed * dt;
        if (!this.hooks.blocked(nx, nz, 0.4)) {
          this.pos.x = nx;
          this.pos.z = nz;
        } else {
          this.moveTarget = null;
        }
        this.yaw = Math.atan2(to.x, to.z);
      }
    }

    const groundY = this.hooks.terrainY(this.pos.x, this.pos.z);
    this.mesh.group.position.set(this.pos.x, groundY, this.pos.z);
    this.mesh.group.rotation.y = this.yaw;
  }

  takeDamage(amount: number, zone: string): boolean {
    if (!this.alive) return false;
    const mul = zone === 'head' ? 3.2 : zone === 'chest' ? 1 : zone === 'stomach' ? 1.1 : 0.7;
    this.health -= amount * mul;
    if (this.health <= 0) {
      this.alive = false;
      this.hooks.onDeath(this);
      return true;
    }
    return false;
  }

  get isDead(): boolean {
    return !this.alive;
  }

  get deathTime(): number {
    return this.deathT;
  }

  dispose(): void {
    disposeCharacterMesh(this.mesh);
  }
}

export class EnemySquad {
  readonly enemies: Enemy[] = [];
  private hooks: EnemyHooks;

  constructor(hooks: EnemyHooks) {
    this.hooks = hooks;
  }

  spawn(spawns: EnemySpawn[]): void {
    for (const s of spawns) {
      const e = new Enemy(s, this.hooks);
      this.enemies.push(e);
    }
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    for (const e of this.enemies) {
      e.setPlayerPos(playerPos);
      e.update(dt);
    }
  }

  get aliveCount(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  get totalCount(): number {
    return this.enemies.length;
  }

  /** Nearest alive enemy to a point, within maxDist. */
  nearestAlive(point: THREE.Vector3, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Segment test against enemy capsules; returns the closest hit. */
  raycastSegment(from: THREE.Vector3, to: THREE.Vector3): { enemy: Enemy; t: number; point: THREE.Vector3 } | null {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-4) return null;
    dir.divideScalar(len);
    let best: { enemy: Enemy; t: number; point: THREE.Vector3 } | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const center = e.pos.clone().add(new THREE.Vector3(0, 0.95, 0));
      const radius = 0.42;
      const oc = from.clone().sub(center);
      const b = oc.dot(dir);
      const c = oc.dot(oc) - radius * radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > len) continue;
      if (!best || t < best.t) {
        best = { enemy: e, t, point: from.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }

  dispose(): void {
    for (const e of this.enemies) e.dispose();
archived: void 0;
  }
}
