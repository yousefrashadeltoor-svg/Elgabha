/*
 * First-person viewmodel: a procedural rig (ADR-005).
 * A spring-damper system drives recoil impulse, sway, bob, ADS blend, bolt
 * cycle and muzzle flash. No baked animation clips are used or needed.
 */

import * as THREE from 'three';
import type { ViewmodelData } from '../data/schema';
import { damp, lerp, TAU } from '../core/math';

class Spring {
  pos = 0;
  vel = 0;
  constructor(private k = 220, private c = 18) {}
  impulse(v: number): void {
    this.vel += v;
  }
  /**
   * Semi-implicit Euler with sub-stepping.
   *
   * A single explicit step is unstable when dt is large: at 4 fps (dt = 0.25 s)
   * the term -k*pos*dt^2 exceeds 1 and the spring diverges to infinity, which
   * threw the viewmodel millions of units off screen. Clamping the sub-step to
   * 1/120 s keeps the integrator stable at any frame rate.
   */
  step(dt: number): void {
    const MAX_SUB = 1 / 120;
    let remaining = Math.min(dt, 0.25);
    while (remaining > 0) {
      const h = Math.min(MAX_SUB, remaining);
      const a = -this.k * this.pos - this.c * this.vel;
      this.vel += a * h;
      this.pos += this.vel * h;
      remaining -= h;
    }
    // Hard safety clamp: a spring should never travel more than a few units.
    if (!Number.isFinite(this.pos) || Math.abs(this.pos) > 10) {
      this.pos = 0;
      this.vel = 0;
    }
  }
}

export class ViewmodelRig {
  /** Layer the viewmodel and its dedicated lights live on. */
  static readonly LAYER = 1;
  readonly group = new THREE.Group();
  readonly weaponGroup = new THREE.Group();
  private idle = new Spring(60, 9);
  private recoilPitch = new Spring(90, 16);
  private recoilYaw = new Spring(90, 16);
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private bobAmp = 0;
  private bolt = 0;          // 0..1 progress of the bolt cycle
  private boltActive = false;
  private mag = 0;
  private magActive = false;
  private ads = 0;
  private muzzleLight: THREE.PointLight;
  private muzzleMesh: THREE.Sprite;
  private flashT = 0;

  constructor() {
    // The viewmodel lives on its own layer, and in Three.js a light only
    // illuminates objects that share one of its layers. The scene lights are on
    // layer 0, so without dedicated lights here the weapon renders pure black.
    const key = new THREE.DirectionalLight(0xfff2dd, 2.1);
    key.position.set(0.6, 1.0, 0.4);
    const fill = new THREE.DirectionalLight(0x9fb4d0, 0.7);
    fill.position.set(-0.7, 0.2, 0.5);
    const ambient = new THREE.HemisphereLight(0xbfd0e0, 0x3a3226, 1.1);
    for (const l of [key, fill, ambient]) {
      l.layers.set(ViewmodelRig.LAYER);
      this.group.add(l);
    }

    this.muzzleLight = new THREE.PointLight(0xffb45e, 0, 8, 2);
    this.muzzleLight.position.set(0, 0.02, -0.9);
    this.muzzleLight.layers.set(ViewmodelRig.LAYER);
    this.weaponGroup.add(this.muzzleLight);

    const flashTex = makeFlashTexture();
    this.muzzleMesh = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.muzzleMesh.scale.setScalar(0.28);
    this.muzzleMesh.position.set(0, 0.02, -0.85);
    this.muzzleMesh.layers.set(ViewmodelRig.LAYER);
    this.weaponGroup.add(this.muzzleMesh);

    this.group.add(this.weaponGroup);
  }

  /** Attach the weapon mesh (built by MeshFactory) at the grip. */
  attachWeapon(mesh: THREE.Object3D): void {
    this.weaponGroup.add(mesh);
  }

  setViewmodelData(v: ViewmodelData): void {
    this.weaponGroup.scale.setScalar(v.scale);
    this.weaponGroup.position.set(v.offset[0], v.offset[1], v.offset[2]);
    this.weaponGroup.rotation.set(v.rot[0], v.rot[1], v.rot[2]);
    this.cfg = v;
  }

  private cfg: ViewmodelData = { scale: 1, offset: [0.16, -0.19, -0.42], rot: [0, 0, 0], boltCycle: 0, magTravel: 0 };

  fire(recoilPunch: number): void {
    this.recoilPitch.impulse(recoilPunch * 0.14);
    this.recoilYaw.impulse((Math.random() - 0.5) * recoilPunch * 0.06);
    this.flashT = 1;
  }

  boltCycle(): void {
    if (this.cfg.boltCycle > 0) {
      this.bolt = 0.0001;
      this.boltActive = true;
    }
  }

  magTravel(): void {
    if (this.cfg.magTravel > 0) {
      this.mag = 0.0001;
      this.magActive = true;
    }
  }

  setAds(target: number): void {
    this.ads = target;
  }

  update(dt: number, speedRatio: number, moveX: number, moveY: number, sprinting: boolean, ads: number): void {
    const t = performance.now() / 1000;
    this.bobT += dt * (1.1 + Math.abs(moveY) * 2.2 + Math.abs(moveX) * 1.4) * speedRatio;
    this.bobAmp = damp(this.bobAmp, sprinting ? 0.045 : 0.02, 2, dt);

    this.idle.step(dt);
    this.recoilPitch.step(dt);
    this.recoilYaw.step(dt);

    // Bolt cycle state machine
    if (this.boltActive) {
      this.bolt += dt / this.cfg.boltCycle;
      if (this.bolt >= 1) {
        this.bolt = 1;
        this.boltActive = false;
      }
    } else if (this.bolt > 0) {
      this.bolt = Math.max(0, this.bolt - dt * 3); // settle
    }
    if (this.magActive) {
      this.mag += dt / Math.max(0.001, this.cfg.magTravel);
      if (this.mag >= 1) this.magActive = false;
    } else if (this.mag > 0) {
      this.mag = Math.max(0, this.mag - dt * 2.5);
    }

    const bobX = Math.sin(this.bobT * TAU) * this.bobAmp;
    const bobY = Math.abs(Math.cos(this.bobT * TAU)) * this.bobAmp * 0.7;
    this.swayX = damp(this.swayX, moveX * 0.014 + (Math.random() - 0.5) * 0.0015, 4, dt);
    this.swayY = damp(this.swayY, -moveY * 0.01, 4, dt);

    this.flashT = Math.max(0, this.flashT - dt * 14);

    const adsBlend = ads;
    const aimPitch = -this.recoilPitch.pos;
    const aimYaw = this.recoilYaw.pos;
    const recoilX = lerp(0, aimPitch * 0.6, adsBlend);
    const recoilY = lerp(0, aimYaw * 0.5, adsBlend);

    this.group.position.set(
      lerp(0, 0.02, adsBlend) + bobX + this.swayX,
      lerp(0, -0.012, adsBlend) + bobY + this.swayY + this.idle.pos * 0.02,
      lerp(0, -0.03, adsBlend),
    );
    this.group.rotation.set(
      recoilX * 0.4 + (Math.sin(t * 1.7) * 0.002 + this.swayY * 1.2),
      recoilY * 0.4,
      -bobX * 0.8 + this.swayX * 1.5,
    );

    // Weapon-local animation: recoil pitch on the weapon group, bolt kick, mag drop.
    // The Z offset must stay negative (in front of the camera) or the weapon sits
    // exactly on the near plane and is clipped away entirely.
    const baseX = this.cfg.offset[0];
    const baseY = this.cfg.offset[1];
    const baseZ = this.cfg.offset[2];
    this.weaponGroup.position.set(
      lerp(baseX, baseX * 0.15, adsBlend),
      lerp(baseY, baseY * 0.35, adsBlend),
      baseZ + recoilX * 0.08,
    );
    this.weaponGroup.rotation.x = -recoilX * 0.9 + this.bolt * 0.12;
    this.weaponGroup.rotation.z = recoilY * 0.5 + this.mag * 0.18;

    this.muzzleLight.intensity = this.flashT * 6;
    const ms = this.muzzleMesh.material as THREE.SpriteMaterial;
    ms.opacity = this.flashT * 0.9;
    this.muzzleMesh.visible = this.flashT > 0.02;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}

function makeFlashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,240,200,1)');
  g.addColorStop(0.4, 'rgba(255,180,80,0.8)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
