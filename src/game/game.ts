/*
 * Game orchestrator. Owns every subsystem and runs the fixed-step simulation.
 *
 * Fixed update order (deterministic):
 *   input -> player -> weapons -> bullets -> enemies -> throwables -> effects
 * Render: camera pose, viewmodel, sky, effects, HUD snapshot.
 *
 * The React layer only reads `hud` and calls the public methods; it never
 * touches Three.js or the simulation directly.
 */

import * as THREE from 'three';
import { Renderer } from '../render/renderer';
import { ViewmodelRig } from '../render/viewmodel';
import { EffectSystem } from '../render/effects';
import { AutoQuality } from '../render/auto-quality';
import { PhysicsWorld, COL, RAY_MASK_WORLD_PLAYERS } from '../physics/physics';
import { TerrainSystem } from '../world/terrain';
import { WorldBuilder } from '../world/world';
import { SkySystem } from '../world/sky';
import { Player } from '../player/player';
import { WeaponController } from '../weapons/weapon-controller';
import { buildWeaponMesh, disposeWeaponMesh } from '../weapons/mesh-factory';
import { stepBallistic, damageForWeapon, hitZoneFromHeight, type BallisticState, type SegmentHit } from '../weapons/ballistics';
import { ThrowableManager, type ExplosionResult } from '../weapons/throwables';
import { EnemySquad, type Enemy, type EnemySpawn } from '../ai/enemies';
import { AudioSystem } from '../audio/audio';
import { InputManager, emptyIntent, type Intent } from '../input/input';
import { loadGameData } from '../data';
import type { GameData, MissionData, MapData, WeaponData } from '../data/schema';
import type { Settings } from '../settings/settings';
import { QUALITY_TABLE } from '../settings/settings';
import { clamp } from '../core/math';

export interface HudState {
  health: number;
  stamina: number;
  ammoInMag: number;
  ammoReserve: number;
  weaponName: string;
  weaponClass: string;
  fireMode: string;
  reloading: boolean;
  jammed: boolean;
  bipod: boolean;
  ads: number;
  stance: string;
  spread: number;
  enemiesAlive: number;
  enemiesTotal: number;
  kills: number;
  objectiveText: string;
  objectiveProgress: string;
  missionName: string;
  timeLeft: number;
  paused: boolean;
  dead: boolean;
  hitMarker: number;
  damageFlash: number;
  killFeed: string[];
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  bulletsInFlight: number;
  entities: number;
  audioVoices: number;
  renderer: string;
  quality: string;
  renderScale: number;
  pointerLocked: boolean;
  showFps: boolean;
  showProfiler: boolean;
  crosshairStyle: string;
  hudScale: number;
  language: string;
  subtitles: boolean;
  message: string;
}

export interface GameOptions {
  container: HTMLElement;
  settings: Settings;
  mission: MissionData;
  map: MapData;
  onHud: (h: HudState) => void;
  onEvent: (msg: string) => void;
  onPauseRequest: () => void;
}

interface Bullet extends BallisticState {
  weapon: WeaponData;
  tracer: boolean;
}

export class Game {
  private renderer: Renderer;
  private viewmodel = new ViewmodelRig();
  private effects: EffectSystem;
  private autoQuality: AutoQuality;
  private physics = new PhysicsWorld();
  private terrain: TerrainSystem;
  private world: WorldBuilder;
  private sky: SkySystem;
  private player: Player;
  private input = new InputManager();
  private audio: AudioSystem;
  private data: GameData;
  private squad: EnemySquad;
  private throwables: ThrowableManager;
  private bullets: Bullet[] = [];
  private weapon: WeaponController;
  private weaponMesh: THREE.Group | null = null;
  private opts: GameOptions;
  private settings: Settings;
  private running = false;
  private paused = false;
  private tick = 0;
  private missionTime = 0;
  private kills = 0;
  private hitMarkerT = 0;
  private damageFlashT = 0;
  private killFeed: string[] = [];
  private message = '';
  private messageT = 0;
  private objectivesDone = new Set<string>();
  private lastFrameMs = 16.7;
  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private readonly DT = 1 / 60;
  private disposed = false;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.settings = opts.settings;
    this.data = loadGameData();

    const q = QUALITY_TABLE[opts.settings.graphics.preset];
    this.renderer = new Renderer(opts.container, opts.settings.graphics, opts.onEvent);
    this.renderer.applyQuality(q, opts.settings.graphics);
    this.renderer.setFov(opts.settings.graphics.fov);

    this.effects = new EffectSystem(this.renderer.scene, q);
    this.autoQuality = new AutoQuality(opts.settings, opts.onEvent);
    this.audio = new AudioSystem(opts.settings.audio);

    this.terrain = new TerrainSystem(this.renderer.scene, opts.map, opts.onEvent);
    this.world = new WorldBuilder(this.terrain, opts.onEvent);
    this.world.build(this.renderer.scene, opts.map);
    this.sky = new SkySystem(this.renderer.scene);
    this.sky.setMapWeather(opts.map);
    this.sky.applyTo(this.renderer.scene);
    this.effects.setWeather(this.sky.particleType());

    this.player = new Player({
      onFootstep: (loud) => this.audio.footstep(this.player.pos, loud),
      onDamage: () => { this.damageFlashT = 1; },
      onEvent: (m) => this.setMessage(m),
    });
    const spawn = opts.map.spawns.find((s) => s.faction === opts.mission.faction) ?? opts.map.spawns[0];
    // Spawn at the point closest to the first objective so the player starts in the fight.
    const obj = opts.map.objectives[0];
    const pts = spawn?.points ?? [[0, 0]];
    let sp = pts[0];
    if (obj) {
      let best = Infinity;
      for (const p of pts) {
        const d = (p[0] - obj.x) ** 2 + (p[1] - obj.z) ** 2;
        if (d < best) { best = d; sp = p; }
      }
    }
    this.player.pos.set(sp[0], this.terrain.heightAt(sp[0], sp[1]) + this.player.eyeHeight, sp[1]);
    // Face the first objective so the player starts looking at the fight rather
    // than at empty terrain.
    if (obj) {
      this.player.yaw = Math.atan2(-(obj.x - sp[0]), -(obj.z - sp[1]));
      this.player.pitch = -0.04;
    }

    // Primary weapon from the mission faction's first character loadout.
    const char = [...this.data.characters.values()].find((c) => c.faction === opts.mission.faction);
    const weaponId = char?.loadout[0] ?? [...this.data.weapons.keys()][0];
    const weaponData = this.data.weapons.get(weaponId)!;
    const ammo = this.data.ammo.get(weaponData.ammoType)!;
    this.weapon = new WeaponController(weaponData, weaponData.capacity * 6, ammo);
    this.weapon.onFire = () => this.onPlayerFire();
    this.weapon.onEvent = (m) => this.setMessage(m);
    this.weaponMesh = buildWeaponMesh(weaponData);
    this.viewmodel.attachWeapon(this.weaponMesh);
    this.viewmodel.setViewmodelData(weaponData.viewmodel);
    // The viewmodel lives on its own layer, rendered by the dedicated view camera.
    this.viewmodel.group.traverse((o) => o.layers.set(Renderer.VIEWMODEL_LAYER));
    // The viewmodel camera is NOT added to the scene: a camera that is a scene
    // child gets rendered as part of the graph, and its own pass would then
    // clear the frame back to the sky colour. It only needs to exist as an
    // object to render with.
    this.renderer.viewCamera.add(this.viewmodel.group);

    this.squad = new EnemySquad({
      terrainY: (x, z) => this.terrain.heightAt(x, z),
      blocked: (x, z, r) => this.isBlocked(x, z, r),
      findPath: (from, to) => this.world.findPath(from.x, from.z, to.x, to.z).map((p) => new THREE.Vector3(p.x, 0, p.z)),
      hasLineOfSight: (from, to) => this.hasLineOfSight(from, to),
      onFire: (enemy, dir) => this.onEnemyFire(enemy, dir),
      onDeath: (enemy) => this.onEnemyDeath(enemy),
      onEvent: (m) => this.setMessage(m),
    });
    this.spawnEnemies();

    this.throwables = new ThrowableManager(
      this.renderer.scene, this.physics,
      (e) => this.onExplosion(e),
      (m) => this.setMessage(m),
    );

    this.input.attach(this.renderer.canvas);
  }

  private async initPhysics(): Promise<void> {
    await this.physics.init();
    for (const c of this.world.colliders) {
      if (c.type === 'box') this.physics.addStaticBox(c.pos, c.size, c.rotY, COL.WORLD);
      else this.physics.addStaticCylinder(c.pos, c.size[0], c.size[1], COL.WORLD);
    }
    this.opts.onEvent(`physics ready: ${this.physics.getCollidersCount()} colliders`);
  }

  private spawnEnemies(): void {
    const enemyFaction = this.opts.mission.faction === 'soviet' ? 'german' : 'soviet';
    const chars = [...this.data.characters.values()].filter((c) => c.faction === enemyFaction);
    const spawnGroup = this.opts.map.spawns.find((s) => s.faction === enemyFaction) ?? this.opts.map.spawns[0];
    const points = spawnGroup?.points ?? [[0, 0]];
    const spawns: EnemySpawn[] = [];
    const count = this.opts.mission.enemyCount;
    for (let i = 0; i < count; i++) {
      const c = chars[i % Math.max(1, chars.length)] ?? [...this.data.characters.values()][0];
      const w = this.data.weapons.get(c.loadout[0]) ?? [...this.data.weapons.values()][0];
      const p = points[i % points.length];
      const jitter = (i / points.length) * 3;
      spawns.push({
        character: c,
        weapon: w,
        pos: new THREE.Vector3(p[0] + jitter, this.terrain.heightAt(p[0] + jitter, p[1]), p[1] + jitter),
        faction: enemyFaction === 'soviet' ? 1 : 2,
      });
    }
    this.squad.spawn(spawns);
  }

  async start(): Promise<void> {
    await this.initPhysics();
    this.audio.init();
    // AudioContext.resume() only settles after a user gesture. Never block the
    // load on it: kick it off and let the first click/keypress unlock audio.
    void this.audio.resume().catch(() => undefined);
    this.audio.startAmbient();
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.setMessage('deployed');
  }

  private frame = (now: number): void => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDt > 0.25) frameDt = 0.25;
    this.lastFrameMs = frameDt * 1000;

    if (!this.paused) {
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= this.DT && steps < 5) {
        this.fixedUpdate(this.DT);
        this.acc -= this.DT;
        steps++;
      }
      if (this.acc >= this.DT) this.acc = this.DT * 0.5;
    }

    this.render(frameDt);
    this.emitHud();
  };

  private fixedUpdate(dt: number): void {
    this.tick++;
    this.missionTime += dt;
    const intent = this.input.consumeFrame(this.settings.controls, 1);

    if (intent.pausePressed) {
      this.opts.onPauseRequest();
      return;
    }

    // Player
    this.player.update(dt, intent, (x, z) => this.terrain.heightAt(x, z), (x, z, r) => this.isBlocked(x, z, r));

    // Weapon
    const speedRatio = this.player.speed / 6.2;
    const shot = this.weapon.update(
      dt, intent.fire, this.player.ads, speedRatio,
      this.player.stance === 'crouch', this.player.stance === 'prone',
    );
    if (intent.reloadPressed) this.weapon.startReload();
    if (intent.bipodPressed) {
      if (this.weapon.toggleBipod()) this.setMessage(this.weapon.bipodDeployed ? 'bipod deployed' : 'bipod stowed');
    }
    void shot;

    // Bullets
    this.updateBullets(dt);

    // Enemies
    this.squad.update(dt, this.player.pos);

    // Throwables
    this.throwables.update(dt);

    // Effects + sky
    this.effects.update(dt);
    this.sky.update(dt, 1);

    // Objectives
    this.updateObjectives(dt);

    // Timers
    this.hitMarkerT = Math.max(0, this.hitMarkerT - dt * 3);
    this.damageFlashT = Math.max(0, this.damageFlashT - dt * 1.6);
    this.messageT = Math.max(0, this.messageT - dt);
    if (this.messageT <= 0) this.message = '';
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      stepBallistic(b, b.weapon, this.data.ammo.get(b.weapon.ammoType)!, dt, {
        raycastSegment: (from, to, shooterFaction) => this.raycastSegment(from, to, shooterFaction),
        onWallImpact: (hit) => {
          this.effects.spawnImpact(hit.point, hit.normal, hit.material, 6);
        },
      });
      if (!b.alive) {
        this.bullets.splice(i, 1);
      }
    }
  }

  private raycastSegment(from: THREE.Vector3, to: THREE.Vector3, shooterFaction: number): SegmentHit | null {
    // Enemies first (cheap capsule test), then world.
    const len = Math.max(1e-4, from.distanceTo(to));
    const enemyHit = this.squad.raycastSegment(from, to);
    const worldHit = this.physics.raycastPoint(from, to, RAY_MASK_WORLD_PLAYERS);
    const enemyT = enemyHit ? enemyHit.t / len : Infinity;
    const worldT = worldHit ? worldHit.distance / len : Infinity;

    if (enemyHit && enemyT <= worldT) {
      // Only the player (faction 0) damages enemies; enemy bullets pass through
      // their own side (friendly fire is off in the vertical slice).
      if (shooterFaction === 0) {
        const relH = enemyHit.point.y - enemyHit.enemy.pos.y;
        const zone = hitZoneFromHeight(relH, 1.8);
        const dmg = damageForWeapon(this.currentBulletWeapon(), from.distanceTo(enemyHit.point));
        const killed = enemyHit.enemy.takeDamage(dmg, zone);
        this.hitMarkerT = 1;
        this.effects.spawnImpact(enemyHit.point, new THREE.Vector3(0, 1, 0), 'flesh', 5);
        if (killed) this.onEnemyDeath(enemyHit.enemy);
      }
      return { t: enemyT, material: 'flesh', entityId: null, point: enemyHit.point, normal: new THREE.Vector3(0, 1, 0) };
    }
    if (worldHit) {
      const material = this.materialAt(worldHit.point);
      return {
        t: worldT,
        material,
        entityId: null,
        point: new THREE.Vector3(worldHit.point.x, worldHit.point.y, worldHit.point.z),
        normal: new THREE.Vector3(worldHit.normal.x, worldHit.normal.y, worldHit.normal.z),
      };
    }
    return null;
  }

  private currentBulletWeapon(): WeaponData {
    return this.weapon.data;
  }

  private materialAt(_p: { x: number; y: number; z: number }): string {
    // Coarse material guess by height: low = dirt, mid = wood/plaster, high = stone.
    return 'dirt';
  }

  private onPlayerFire(): void {
    const w = this.weapon.data;
    const spread = this.weapon.currentSpread(this.player.speed / 6.2, this.player.stance === 'crouch', this.player.stance === 'prone', this.player.ads);
    const dir = this.cameraForward();
    const spreadRad = (spread * Math.PI) / 180;
    dir.x += (Math.random() - 0.5) * spreadRad;
    dir.y += (Math.random() - 0.5) * spreadRad;
    dir.z += (Math.random() - 0.5) * spreadRad;
    dir.normalize();

    const origin = this.player.pos.clone().addScaledVector(dir, 0.6);
    const ammo = this.data.ammo.get(w.ammoType)!;
    const tracer = w.tracerEvery > 0 && this.weapon.roundsFired % w.tracerEvery === 0;
    this.bullets.push({
      pos: origin,
      vel: dir.clone().multiplyScalar(w.muzzleVelocity),
      travelled: 0,
      alive: true,
      remainingPenetration: w.penetration,
      weaponId: w.id,
      shooterId: 0,
      firedTick: this.tick,
      weapon: w,
      tracer,
    });
    this.viewmodel.fire(this.weapon.recoilPunch());
    this.viewmodel.boltCycle();
    this.effects.spawnMuzzle(origin, dir, 0xffc070);
    this.audio.gunshot(this.player.pos, parseFloat(w.caliber) || 7.92);
    // recoil to camera
    this.applyRecoil(w);
  }

  private applyRecoil(w: WeaponData): void {
    const pattern = this.weapon.nextRecoilPattern();
    this.player.pitch += (w.recoil.vertical * Math.PI) / 180 * 0.35;
    this.player.yaw += (w.recoil.horizontal * pattern * Math.PI) / 180 * 0.35;
  }

  private onEnemyFire(enemy: Enemy, dir: THREE.Vector3): void {
    const w = enemy.weapon;
    const origin = enemy.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    const spreadRad = (w.spread.hip * Math.PI) / 180 * 1.6;
    dir.x += (Math.random() - 0.5) * spreadRad;
    dir.y += (Math.random() - 0.5) * spreadRad;
    dir.z += (Math.random() - 0.5) * spreadRad;
    dir.normalize();
    this.bullets.push({
      pos: origin,
      vel: dir.clone().multiplyScalar(w.muzzleVelocity),
      travelled: 0,
      alive: true,
      remainingPenetration: w.penetration,
      weaponId: w.id,
      shooterId: enemy.faction,
      firedTick: this.tick,
      weapon: w,
      tracer: false,
    });
    this.audio.gunshot(enemy.pos, parseFloat(w.caliber) || 7.92);
  }

  private onEnemyDeath(enemy: Enemy): void {
    this.kills++;
    this.killFeed.unshift(`Killed ${enemy.character.name.en}`);
    if (this.killFeed.length > 5) this.killFeed.pop();
    this.setMessage(`enemy down (${this.squad.aliveCount} left)`);
  }

  private onExplosion(e: ExplosionResult): void {
    this.effects.spawnExplosion(e.center, e.radius);
    this.audio.explosion(e.center, this.player.pos.distanceTo(e.center));
    // damage player
    const d = this.player.pos.distanceTo(e.center);
    if (d < e.radius) {
      const dmg = e.maxDamage * (1 - d / e.radius);
      this.player.takeDamage(dmg, 'explosion');
    }
    // damage enemies
    for (const en of this.squad.enemies) {
      if (!en.alive) continue;
      const de = en.pos.distanceTo(e.center);
      if (de < e.radius) en.takeDamage(e.maxDamage * (1 - de / e.radius), 'chest');
    }
  }

  private updateObjectives(dt: number): void {
    void dt;
    for (const o of this.opts.mission.objectives) {
      if (this.objectivesDone.has(o.id)) continue;
      if (o.type === 'eliminate') {
        if (this.kills >= o.count) this.objectivesDone.add(o.id);
      } else if (o.type === 'capture' || o.type === 'reach') {
        const target = this.opts.map.objectives.find((m) => m.id === o.target);
        if (target) {
          const d = Math.hypot(this.player.pos.x - target.x, this.player.pos.z - target.z);
          if (d <= target.radius) this.objectivesDone.add(o.id);
        }
      }
    }
  }

  private render(frameDt: number): void {
    // Camera pose from player
    const cam = this.renderer.camera;
    cam.position.copy(this.player.pos);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.player.pitch, this.player.yaw, 0);

    // Viewmodel
    this.viewmodel.setAds(this.player.ads);
    this.viewmodel.update(frameDt, this.player.speed / 6.2, 0, 0, false, this.player.ads);

    // Sky follows the player
    this.sky.sun.position.set(this.player.pos.x + 120, 200, this.player.pos.z + 60);
    this.sky.sun.target.position.copy(this.player.pos);
    this.sky.sun.target.updateMatrixWorld();

    // Audio listener
    const fwd = this.cameraForward();
    this.audio.setListener(this.player.pos, fwd, new THREE.Vector3(0, 1, 0));

    // Adaptive quality
    const scale = this.autoQuality.update(this.lastFrameMs);
    this.renderer.renderScale = scale;

    this.renderer.render();
  }

  private cameraForward(): THREE.Vector3 {
    const v = new THREE.Vector3(0, 0, -1);
    v.applyEuler(new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'));
    return v.normalize();
  }

  private isBlocked(x: number, z: number, r: number): boolean {
    for (const c of this.world.colliders) {
      if (c.type === 'box') {
        const dx = Math.abs(x - c.pos[0]);
        const dz = Math.abs(z - c.pos[2]);
        if (dx < c.size[0] + r && dz < c.size[2] + r) return true;
      } else {
        const d = Math.hypot(x - c.pos[0], z - c.pos[2]);
        if (d < c.size[0] + r) return true;
      }
    }
    return false;
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const hit = this.physics.raycastPoint(from, to, COL.WORLD);
    if (!hit) return true;
    return hit.distance >= from.distanceTo(to) - 0.5;
  }

  private setMessage(m: string): void {
    this.message = m;
    this.messageT = 2.5;
  }

  private emitHud(): void {
    const stats = this.renderer.getStats();
    const obj = this.opts.mission.objectives.find((o) => !this.objectivesDone.has(o.id)) ?? this.opts.mission.objectives[0];
    const progress = obj?.type === 'eliminate' ? `${Math.min(this.kills, obj.count)}/${obj.count}` : `${this.objectivesDone.size}/${this.opts.mission.objectives.length}`;
    this.opts.onHud({
      health: Math.round(this.player.health),
      stamina: Math.round(this.player.stamina),
      ammoInMag: this.weapon.magazineLeft,
      ammoReserve: this.weapon.reserve,
      weaponName: this.weapon.data.name[this.settings.interface.language],
      weaponClass: this.weapon.data.class,
      fireMode: this.weapon.fireMode,
      reloading: this.weapon.isReloading,
      jammed: this.weapon.jammed,
      bipod: this.weapon.bipodDeployed,
      ads: this.player.ads,
      stance: this.player.stance,
      spread: this.weapon.currentSpread(this.player.speed / 6.2, this.player.stance === 'crouch', this.player.stance === 'prone', this.player.ads),
      enemiesAlive: this.squad.aliveCount,
      enemiesTotal: this.squad.totalCount,
      kills: this.kills,
      objectiveText: obj?.text[this.settings.interface.language] ?? '',
      objectiveProgress: progress,
      missionName: this.opts.mission.name[this.settings.interface.language],
      timeLeft: Math.max(0, this.opts.mission.timeLimit - this.missionTime),
      paused: this.paused,
      dead: !this.player.alive,
      hitMarker: this.hitMarkerT,
      damageFlash: this.damageFlashT,
      killFeed: this.killFeed.slice(),
      fps: Math.round(1000 / Math.max(1, this.lastFrameMs)),
      frameMs: this.lastFrameMs,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      bulletsInFlight: this.bullets.length,
      entities: this.squad.totalCount + 1,
      audioVoices: this.audio.activeVoices,
      renderer: this.renderer.backend,
      quality: this.autoQuality.state.preset,
      renderScale: this.renderer.renderScale,
      pointerLocked: this.input.isPointerLocked,
      showFps: this.settings.interface.showFps,
      showProfiler: this.settings.interface.showProfiler,
      crosshairStyle: this.settings.interface.crosshairStyle,
      hudScale: this.settings.interface.hudScale,
      language: this.settings.interface.language,
      subtitles: this.settings.interface.subtitles,
      message: this.message,
    });
  }

  requestPointerLock(): void {
    this.input.requestPointerLock();
    this.audio.resume();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.input.exitPointerLock();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.audio.applySettings(s.audio);
    this.renderer.setFov(s.graphics.fov);
    this.renderer.applyQuality(QUALITY_TABLE[s.graphics.preset], s.graphics);
    this.effects.setQuality(QUALITY_TABLE[s.graphics.preset]);
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.dispose();
    this.squad.dispose();
    if (this.weaponMesh) disposeWeaponMesh(this.weaponMesh);
    this.viewmodel.dispose();
    this.renderer.dispose();
  }
}
