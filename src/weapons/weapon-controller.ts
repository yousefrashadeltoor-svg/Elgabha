/*
 * Weapon controller: the per-weapon state machine (ADR-004 data driven).
 *
 * States: idle | firing | bolt | reload | empty | overheated | swapping
 * Reads every tunable from WeaponData: fireModes, rpm, capacity, reload
 * timings, recoil pattern, spread accumulation, bipod, heat, scope.
 */

import type { AmmoData, AttachmentData, WeaponData } from '../data/schema';
import { clamp } from '../core/math';

export type WeaponPhase = 'idle' | 'firing' | 'bolt' | 'reload' | 'empty' | 'overheated' | 'swapping';

export class WeaponController {
  readonly data: WeaponData;
  phase: WeaponPhase = 'idle';
  phaseT = 0;
  magazineLeft: number;
  reserve: number;
  shotsInBurst = 0;
  burstCooldown = 0;
  heat = 0;                 // 0..1
  bipodDeployed = false;
  jammed = false;
  roundsFired = 0;
  roundsHit = 0;
  spreadAccum = 0;
  attachments: AttachmentData[] = [];
  currentAmmo: AmmoData;

  private triggerHeld = false;
  private cycleT = 0;
  private shotIndex = 0;

  constructor(data: WeaponData, reserve: number, ammo: AmmoData) {
    this.data = data;
    this.magazineLeft = data.capacity;
    this.reserve = reserve;
    this.currentAmmo = ammo;
  }

  get isReloading(): boolean {
    return this.phase === 'reload';
  }

  get isEmpty(): boolean {
    return this.magazineLeft <= 0;
  }

  get fireMode(): 'single' | 'auto' | 'burst' {
    return this.data.fireModes[0] ?? 'single';
  }

  get hasBipod(): boolean {
    return this.data.bipod !== undefined;
  }

  get isSingleFeed(): boolean {
    return this.data.feed === 'internal' || this.data.feed === 'single' || this.data.feed === 'stripper';
  }

  get boltCycleTime(): number {
    return this.data.viewmodel.boltCycle;
  }

  /** Effective cone half-angle in degrees for the current stance/motion. */
  currentSpread(speedRatio: number, crouched: boolean, prone: boolean, ads: number): number {
    const s = this.data.spread;
    let base = s.hip + (s.ads - s.hip) * ads;
    base += clamp(speedRatio, 0, 1) * s.move;
    if (crouched) base *= s.crouch;
    if (prone) base *= s.prone;
    if (this.bipodDeployed && this.data.bipod) base *= this.data.bipod.spreadMul;
    base += this.spreadAccum;
    return Math.min(base, s.max);
  }

  /**
   * Advance the state machine. Returns true if a shot left the barrel this
   * frame (caller spawns the bullet and plays audio).
   */
  update(dt: number, trigger: boolean, ads: number, speedRatio: number, crouched: boolean, prone: boolean): boolean {
    this.phaseT += dt;
    let shotThisFrame = false;
    const interval = 60 / Math.max(this.data.rpm, 1);

    switch (this.phase) {
      case 'reload':
        if (this.phaseT >= this.reloadDuration()) this.finishReload();
        return false;
      case 'bolt':
        if (this.phaseT >= this.boltCycleTime) this.phase = 'idle';
        return false;
      case 'overheated':
        if (this.phaseT >= 2.5) {
          this.phase = 'idle';
          this.heat = 0;
        }
        return false;
      case 'swapping':
        if (this.phaseT >= 0.7) this.phase = 'idle';
        return false;
      default:
        break;
    }

    // Heat recovery
    if (this.data.heat) {
      this.heat = clamp(this.heat - dt * this.data.heat.coolRate, 0, 1);
      if (this.heat >= this.data.heat.jamAt) {
        this.jammed = true;
        this.phase = 'overheated';
        this.onEvent?.('jammed - change barrel');
        return false;
      }
    }
    // Spread recovery
    this.spreadAccum = Math.max(0, this.spreadAccum - dt * this.data.spread.perShot * 2.2);

    if (this.burstCooldown > 0) this.burstCooldown -= dt;
    const wantsFire = trigger && !this.jammed && this.burstCooldown <= 0;

    if (wantsFire && this.isEmpty) {
      if (this.phase !== 'empty') {
        this.phase = 'empty';
        this.onEmpty?.();
      }
      return false;
    }

    let firing = false;
    const mode = this.fireMode;
    if (wantsFire) {
      if (mode === 'auto') firing = true;
      // Semi-auto: one shot per trigger pull. `triggerHeld` is the state at the
      // END of the previous frame, so a fresh press is `!triggerHeld`. The
      // previous code also required the rate-of-fire interval to have elapsed
      // before the FIRST shot, which meant a bolt-action rifle with a 4.3 s
      // interval never fired at all on a short press.
      else if (mode === 'single') firing = !this.triggerHeld || this.cycleT >= interval;
      else {
        if (this.shotsInBurst < 3) firing = true;
        else {
          this.shotsInBurst = 0;
          this.burstCooldown = 0.32;
        }
      }
    } else {
      this.shotsInBurst = 0;
    }

    if (firing) {
      this.cycleT += dt;
      // The first shot of a trigger pull fires immediately; subsequent shots
      // wait for the weapon's cyclic rate.
      const ready = this.cycleT >= interval || !this.triggerHeld;
      if (ready) {
        this.cycleT = 0;
        this.fire();
        shotThisFrame = true;
        this.shotsInBurst++;
      }
      if (this.phase === 'idle') this.phase = 'firing';
    } else {
      this.cycleT = 0;
      if (this.phase === 'firing') this.phase = 'idle';
    }

    this.triggerHeld = trigger;
    return shotThisFrame;
  }

  private fire(): void {
    this.magazineLeft--;
    this.roundsFired++;
    this.spreadAccum = Math.min(this.data.spread.max, this.spreadAccum + this.data.spread.perShot);
    if (this.data.heat) {
      this.heat = clamp(this.heat + this.data.heat.perShot, 0, 1);
    }
    if (this.isSingleFeed && this.boltCycleTime > 0) {
      this.phase = 'bolt';
      this.phaseT = 0;
    }
    if (this.magazineLeft <= 0 && this.reserve <= 0 && !this.isSingleFeed) {
      this.phase = 'empty';
    }
    this.onFire?.(this);
  }

  private reloadDuration(): number {
    const d = this.data;
    let dur = this.isEmpty ? d.reloadEmpty : d.reloadTactical;
    if (this.isSingleFeed && this.magazineLeft > 0) {
      dur = d.reloadPerRound * (d.capacity - this.magazineLeft);
    }
    return Math.max(0.2, dur);
  }

  finishReload(): void {
    const need = this.data.capacity - this.magazineLeft;
    const take = Math.min(need, this.reserve);
    this.magazineLeft += take;
    this.reserve -= take;
    this.phase = 'idle';
    this.onReloadComplete?.(this);
  }

  startReload(): boolean {
    if (this.phase === 'reload' || this.phase === 'swapping' || this.jammed) return false;
    if (this.magazineLeft >= this.data.capacity || this.reserve <= 0) return false;
    this.phase = 'reload';
    this.phaseT = 0;
    return true;
  }

  toggleBipod(): boolean {
    if (!this.hasBipod) return false;
    this.bipodDeployed = !this.bipodDeployed;
    return true;
  }

  changeBarrel(): void {
    if (!this.data.heat) return;
    this.jammed = false;
    this.heat = 0;
    this.phase = 'reload';
    this.phaseT = 0;
  }

  cancelAction(): void {
    this.phase = 'swapping';
    this.phaseT = 0;
    this.shotsInBurst = 0;
    this.triggerHeld = false;
  }

  /** Recoil kick for the viewmodel, in [0..1]. */
  recoilPunch(): number {
    const r = this.data.recoil;
    let p = r.punch;
    if (this.bipodDeployed && this.data.bipod) p *= this.data.bipod.recoilMul;
    return p;
  }

  /** Deterministic horizontal drift for the current shot index. */
  nextRecoilPattern(): number {
    const pat = this.data.recoil.pattern;
    const v = pat[this.shotIndex % pat.length] ?? 0;
    this.shotIndex++;
    return v;
  }

  resetPattern(): void {
    this.shotIndex = 0;
  }

  canReach(distance: number): boolean {
    return distance <= this.data.damage.farRange * 1.5;
  }

  onFire: ((w: WeaponController) => void) | null = null;
  onEmpty: (() => void) | null = null;
  onReloadComplete: ((w: WeaponController) => void) | null = null;
  onEvent: ((msg: string) => void) | null = null;
}
