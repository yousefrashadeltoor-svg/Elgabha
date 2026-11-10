/*
 * Player controller: movement, stance, stamina, health, damage intake,
 * and aim stability. The simulation-facing API stays deterministic —
 * external effects (sound, VFX) are emitted through callbacks so the core
 * never touches DOM/audio directly (ADR-005).
 */

import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { Intent } from '../input/input';

export type Stance = 'stand' | 'crouch' | 'prone';

export interface PlayerState {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  stance: Stance;
  health: number;
  stamina: number;
  speed: number;
  ads: number;
  alive: boolean;
}

export interface PlayerCallbacks {
  onLand?: (impact: number) => void;
  onFootstep?: (loud: boolean) => void;
  onDamage?: (amount: number, source: string) => void;
  onEvent?: (msg: string) => void;
}

const STAND_H = 1.78;
const CROUCH_H = 1.05;
const PRONE_H = 0.5;
const EYE = 1.62;

// Movement speeds (m/s)
const WALK = 2.1;
const RUN = 4.4;
const SPRINT = 6.2;
const CROUCH_SPEED = 1.5;
const PRONE_SPEED = 0.6;

export class Player {
  pos = new THREE.Vector3();
  m = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance: Stance = 'stand';
  health = 100;
  stamina = 100;
  speed = 0;
  ads = 0;
  alive = true;
  onGround = true;
  private vy = 0;
  private st = 0;
  private breathTime = 0;
  private breath = 0;
  private lastY = 0;
  private cb: PlayerCallbacks;

  constructor(cb: PlayerCallbacks = {}) {
    this.cb = cb;
  }

  get eyeHeight(): number {
    switch (this.stance) {
      case 'stand': return EYE;
      case 'crouch': return EYE * 0.62;
      case 'prone': return 0.4;
    }
  }

  get height(): number {
    switch (this.stance) {
      case 'stand': return STAND_H;
      case 'crouch': return CROUCH_H;
      case 'prone': return PRONE_H;
    }
  }

  get halfHeight(): number {
    return this.height / 2;
  }

  canSprint(): boolean {
    return this.stance === 'stand' && this.stamina > 5;
  }

  update(
    dt: number,
    intent: Intent,
    terrainY: (x: number, z: number) => number,
    blocked: (x: number, z: number, r: number) => boolean,
  ): void {
    if (!this.alive) return;

    // Stance transitions
    if (intent.crouch && this.stance === 'stand') {
      this.stance = 'crouch';
      this.cb.onEvent?.('crouched');
    } else if (intent.prone && this.stance !== 'prone') {
      this.stance = 'prone';
    } else if (!intent.crouch && !intent.prone && this.stance === 'crouch') {
      this.stance = 'stand';
    }

    const sprinting = intent.sprint && this.canSprint() && intent.moveY > 0.3;
    const moving = Math.abs(intent.moveX) > 0.05 || Math.abs(intent.moveY) > 0.05;
    let targetSpeed = 0;
    if (moving) {
      targetSpeed = sprinting ? SPRINT : intent.walk ? WALK : this.stance === 'stand' ? RUN : this.stance === 'crouch' ? CROUCH_SPEED : PRONE_SPEED;
    }
    this.speed = damp(this.speed, targetSpeed, sprinting ? 3 : 8, dt);

    // breath (breath-hold for scopes)
    this.breathTime += dt;
    this.breath = intent.holdBreath
      ? clamp(this.breath + dt * 1.6, 0, 1)
      : clamp(this.breath - dt * 1.1, 0, 1);
    if (this.breath >= 1) {
      // out of breath
      this.breath = 0;
      this.cb.onEvent?.('out of breath');
    }

    // stamina
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 14);
      if (this.stamina <= 0) this.cb.onEvent?.('winded');
    } else {
      this.stamina = Math.min(100, this.stamina + dt * (this.stance === 'prone' ? 16 : 10));
    }

    // Orientation
    const sens = 0.0026;
    this.yaw -= intent.lookX * sens;
    this.pitch -= intent.lookY * sens * 0.9;
    this.pitch = clamp(this.pitch, -1.45, 1.45);

    // Movement in world space
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = 0, dz = 0;
    if (moving) {
      // forward is -z in our world convention
      const fx = -sin, fz = -cos;
      const rx = cos, rz = -sin;
      dx = fx * intent.moveY + rx * intent.moveX;
      dz = fz * intent.moveY + rz * intent.moveX;
      const len = Math.hypot(dx, dz) || 1;
      dx = (dx / len) * this.speed;
      dz = (dz / len) * this.speed;
    }

    const nextX = this.pos.x + dx * dt;
    const nextZ = this.pos.z + dz * dt;
    const groundY = terrainY(nextX, nextZ);
    if (!blocked(nextX, nextZ, 0.5)) {
      this.pos.x = nextX;
      this.pos.z = nextZ;
    }

    // Vertical: gravity + jump (simple floor follow since we have terrain height)
    this.vy -= 20 * dt;
    const targetY = groundY + this.eyeHeight;
    if (this.pos.y <= targetY + 0.01 && this.vy <= 0) {
      if (!this.onGround && this.pos.y - this.lastY < -3) {
        this.cb.onLand?.(Math.min(1, (this.lastY - this.pos.y) / 8));
      }
      this.pos.y = targetY;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.pos.y += this.vy * dt;
      this.onGround = false;
    }

    // jump
    if (intent.jumpPressed && this.onGround && this.stance === 'stand') {
      this.vy = 6.4;
      this.onGround = false;
      this.cb.onEvent?.('jumped');
    }
    this.lastY = this.pos.y;

    // ADS smoothing
    this.ads = clamp(this.ads + (intent.aim ? dt * 8 : -dt * 9), 0, 1);

    this.m.set(dx, this.vy, dz);

    // footsteps (light: only when moving stand)
    if (moving && Math.random() < dt * 9 && this.stance === 'stand') {
      this.cb.onFootstep?.(sprinting);
    }
  }

  takeDamage(amount: number, source: string): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.cb.onDamage?.(amount, source);
    if (this.health <= 0) {
      this.alive = false;
      this.cb.onEvent?.('killed');
    }
  }

  heal(amount: number): void {
    if (!this.alive) return;
    this.health = Math.min(100, this.health + amount);
  }

  getPos(): THREE.Vector3 {
    return this.pos.clone();
  }

  aimStability(): number {
    // 1 = rock steady, 0 = wobbling hard
    const moving = this.speed > 0.3;
    const stanceMul = this.stance === 'prone' ? 1 : this.stance === 'crouch' ? 0.8 : 0.55;
    const moveMul = moving ? 0.55 : 1;
    const breathMul = 1 - this.breath * 0.35;
    return clamp(stanceMul * moveMul * breathMul, 0.1, 1);
  }

  /** Add small positional sway when aiming for immersion. */
  swayOffset(): THREE.Vector3 {
    const t = this.breathTime;
    return new THREE.Vector3(
      Math.sin(t * 1.3) * 0.002 * (1 - this.aimStability()),
      Math.cos(t * 1.7) * 0.002 * (1 - this.aimStability()),
      0,
    );
  }
}
