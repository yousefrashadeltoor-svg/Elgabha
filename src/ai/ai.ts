/*
 * Opponent AI: finite-state machine with a visual threat system (VTS).
 *
 * States: IDLE | MOVING | INVESTIGATE | COVER | ENGAGE | RETREAT
 * Transitions are driven by sight/perception, noise, suppression, and a
 * lightweight morale model. Pathing uses the world navmesh (A*).
 */

import * as THREE from 'three';
import type { CharacterData } from '../data/schema';
import { clamp } from '../core/math';

export type AiState = 'idle' | 'moving' | 'investigate' | 'cover' | 'engage' | 'retreat';

/** Engagement envelope and base accuracy for AI riflemen (tunable). */
const AI_WEAPON_RANGE = 300;
const AI_ACCURACY = 0.55;

export interface AiPerception {
  canSeePlayer: boolean;
  lastSeenAt: number;
  lastSeenPos: THREE.Vector3;
  heardNoise: boolean;
  noisePos: THREE.Vector3;
  suppressed: number; // 0..1 timer
}

export interface AiControllerOptions {
  character: CharacterData;
  seek: (target: THREE.Vector3) => void;      // navigator
  stand: () => void; cut: () => void; lay: () => void;
  fireAt: (dir: THREE.Vector3) => void; stopFiring: () => void;
  lookAt: (dir: THREE.Vector3) => void;
  getPlayerPos: () => THREE.Vector3;
  getMyPos: () => THREE.Vector3;
  canShootPlayer: () => boolean;      // LOS check
  tryTakeCover: () => THREE.Vector3 | null; // returns cover pos or null
  findPath: (to: THREE.Vector3) => THREE.Vector3[];
  onEvent: (msg: string) => void;
}

export class AiController {
  state: AiState = 'idle';
  perception: AiPerception = {
    canSeePlayer: false,
    lastSeenAt: -1,
    lastSeenPos: new THREE.Vector3(),
    heardNoise: false,
    noisePos: new THREE.Vector3(),
    suppressed: 0,
  };
  private stateT = 0;
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private aimJitter = 0;
  private fireTimer = 0;
  private decisionTimer = 1;
  private loseTimer = 0;
  private visibility = 0; // 0..1 smoothing

  constructor(private opts: AiControllerOptions) {
    this.opts = opts;
  }

  update(dt: number): void {
    const o = this.opts;
    this.stateT += dt;
    this.decisionTimer -= dt;
    this.perception.suppressed = Math.max(0, this.perception.suppressed - dt * 0.12);

    // Perceptual smoothing for vision
    const see = o.canShootPlayer();
    this.visibility += ((see ? 1 : 0) - this.visibility) * Math.min(1, dt * 6);
    this.perception.canSeePlayer = this.visibility > 0.5;
    if (this.perception.canSeePlayer) {
      this.perception.lastSeenAt = performance.now();
      this.perception.lastSeenPos.copy(o.getPlayerPos());
      this.loseTimer = 2.2;
    } else {
      this.loseTimer -= dt;
    }

    // Decision cadence ~3 Hz; cheap per-tick steering between decisions.
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.33;
      this.decide();
    }

    // Behaviour per state
    switch (this.state) {
      case 'engage':
        this.updateEngage(dt);
        break;
      case 'moving':
      case 'investigate':
      case 'cover':
      case 'retreat':
        this.updateTravel(dt);
        break;
      case 'idle':
        break;
    }
  }

  private decide(): void {
    const o = this.opts;
    const p = this.perception;
    const myPos = o.getMyPos();
    const playerPos = o.getPlayerPos();
    const dist = myPos.distanceTo(playerPos);

    if (p.canSeePlayer) {
      if (dist < 8 && Math.random() < 0.45) {
        this.setState('retreat');
        o.onEvent('AI: falling back');
      } else if (dist > AI_WEAPON_RANGE * 0.85) {
        this.setState('moving');
      } else {
        this.setState('engage');
      }
      return;
    }
    if (p.suppressed > 0.4 || p.heardNoise) {
      this.setState('investigate');
      return;
    }
    if (this.state === 'engage') {
      this.setState('cover');
      return;
    }
    if (this.state === 'investigate' && this.stateT > 6) {
      this.setState('idle');
      return;
    }
    if (this.state === 'idle' && Math.random() < 0.25) {
      const r = 24;
      const target = new THREE.Vector3(myPos.x + (Math.random() - 0.5) * r, 0, myPos.z + (Math.random() - 0.5) * r);
      this.startMove(target);
      o.onEvent('AI: patrolling');
    }
  }

  private updateEngage(dt: number): void {
    const o = this.opts;
    const playerPos = o.getPlayerPos();
    const myPos = o.getMyPos();
    const toPlayer = playerPos.clone().sub(myPos);
    const dist = toPlayer.length();
    toPlayer.normalize();
    const heightMul = clamp(1 - (myPos.y - playerPos.y) * 0.04, 0.4, 1.2);
    const aim = toPlayer.clone();
    aim.y += heightMul * -0.05 + (Math.random() - 0.5) * 0.004;
    o.lookAt(aim);

    this.aimJitter = clamp(this.aimJitter + dt * 0.3, 0, 1);
    this.fireTimer -= dt;
    const burstRate = AI_ACCURACY;
    const fireChance = (1 - this.aimJitter * 0.3) * burstRate * (this.perception.suppressed > 0.5 ? 0.3 : 1);
    if (dist < AI_WEAPON_RANGE * 1.2 && Math.random() < fireChance * dt * 3 && this.fireTimer <= 0) {
      o.fireAt(aim.clone().multiplyScalar(1400));
      this.fireTimer = 0.62;
      o.onEvent('AI: engaging');
    } else if (this.fireTimer <= 0) {
      o.stopFiring();
    }
  }

  private updateTravel(dt: number): void {
    const o = this.opts;
    if (this.pathIdx >= this.path.length) {
      // arrived
      if (this.state === 'investigate') {
        this.setState('idle');
      } else if (this.state === 'retreat' || this.state === 'cover') {
        this.setState('idle');
      }
      return;
    }
    void dt;
    const target = this.path[this.pathIdx];
    const myPos = o.getMyPos();
    const to = new THREE.Vector3(target.x - myPos.x, 0, target.z - myPos.z);
    if (to.length() < 1.2) {
      this.pathIdx++;
      return;
    }
    o.seek(new THREE.Vector3(target.x, 0, target.z));
  }

  private startMove(target: THREE.Vector3): void {
    this.path = this.opts.findPath(target);
    this.pathIdx = 0;
    this.setState(target === null ? 'idle' : 'moving');
  }

  private setState(s: AiState): void {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
      if (s === 'engage') this.aimJitter = 0;
    }
  }

  getStateLabel(): string {
    return this.state;
  }
}
