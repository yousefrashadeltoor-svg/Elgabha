/*
 * Effect system: pooled GPU/points particles for muzzle, impacts, debris,
 * tracers, rain, snow — plus decals (impact scorch) and the 3D audio bus.
 *
 * Particles are pooled THREE.Points with a single dynamic buffer:
 * position + velocity + life + size + color. Decals are small planes that
 * fade after a duration; count is clamped by the quality decal budget.
 */

import * as THREE from 'three';
import type { QualityTable } from '../settings/settings';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
}

export interface EffectBus {
  spawnImpact(point: THREE.Vector3, normal: THREE.Vector3, material: string, count?: number): void;
  spawnMuzzle(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void;
  spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void;
  spawnDebris(point: THREE.Vector3, count?: number): void;
  spawnExplosion(center: THREE.Vector3, radius: number): void;
  spawnSmokePuff(point: THREE.Vector3, dir?: THREE.Vector3): void;
  setWeather(type: 'rain' | 'snow' | null): void;
}

export class EffectSystem implements EffectBus {
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private particles: Particle[] = [];
  private capacity = 4096;
  private cursor = 0;
  private scene: THREE.Scene;
  private q: QualityTable;
  private decals: { mesh: THREE.Mesh; until: number }[] = [];
  private decalMax = 16;
  private weather: 'rain' | 'snow' | null = null;
  private weatherTimer = 0;

  constructor(scene: THREE.Scene, q: QualityTable) {
    this.scene = scene;
    this.q = q;
    this.decalMax = q.decals;
    this.capacity = Math.floor(4096 * q.particleMul);

    const positions = new Float32Array(this.capacity * 3);
    const colors = new Float32Array(this.capacity * 4);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.colAttr = new THREE.BufferAttribute(colors, 4);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);

    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    this.particles = Array.from({ length: this.capacity }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0, maxLife: 1, size: 0.1,
      color: new THREE.Color(0xffffff),
      gravity: 0, drag: 0,
    }));
  }

  private emit(p: Omit<Particle, 'alive'>): void {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const part = this.particles[idx];
    part.alive = true;
    part.pos.copy(p.pos);
    part.vel.copy(p.vel);
    part.life = p.life;
    part.maxLife = p.maxLife;
    part.size = p.size;
    part.color.copy(p.color);
    part.gravity = p.gravity;
    part.drag = p.drag;
  }

  spawnImpact(point: THREE.Vector3, normal: THREE.Vector3, material: string, count = 6): void {
    const n = Math.floor(count * this.q.particleMul);
    const col = impactColor(material);
    const dir = normal.clone().multiplyScalar(-1).add(new THREE.Vector3(0, 0.4, 0)).normalize();
    for (let i = 0; i < n; i++) {
      const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.emit({
        pos: point.clone(),
        vel: dir.clone().multiplyScalar(2 + Math.random() * 5).add(spread),
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.8,
        size: 0.05 + Math.random() * 0.09,
        color: col,
        gravity: 6,
        drag: 1.5,
      });
    }
    this.addDecal(point, normal, material);
  }

  spawnMuzzle(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    const col = new THREE.Color(color);
    for (let i = 0; i < 5; i++) {
      this.emit({
        pos: pos.clone(),
        vel: dir.clone().multiplyScalar(4 + Math.random() * 3),
        life: 0.08 + Math.random() * 0.1,
        maxLife: 0.18,
        size: 0.06 + Math.random() * 0.1,
        color: col,
        gravity: 0,
        drag: 3,
      });
    }
  }

  spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    // cheap tracer: 3 sparks along the segment
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      const pos = new THREE.Vector3().lerpVectors(from, to, t);
      this.emit({
        pos,
        vel: new THREE.Vector3(0, 0, 0),
        life: 0.05,
        maxLife: 0.05,
        size: 0.02,
        color: new THREE.Color(0xffd9a0),
        gravity: 0,
        drag: 0,
      });
    }
  }

  spawnDebris(point: THREE.Vector3, count = 8): void {
    for (let i = 0; i < count; i++) {
      this.emit({
        pos: point.clone(),
        vel: new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.4, Math.random() - 0.5).multiplyScalar(4),
        life: 0.7 + Math.random() * 0.8,
        maxLife: 1.4,
        size: 0.05 + Math.random() * 0.1,
        color: new THREE.Color(0x5a5344),
        gravity: 9,
        drag: 0.4,
      });
    }
  }

  spawnExplosion(center: THREE.Vector3, radius: number): void {
    const n = Math.floor(22 * this.q.particleMul);
    const fire = new THREE.Color(0xffb45e);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 6 + Math.random() * 9;
      this.emit({
        pos: center.clone(),
        vel: new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.abs(Math.cos(phi)) * speed * 0.7,
          Math.sin(phi) * Math.sin(theta) * speed,
        ),
        life: 0.5 + Math.random() * 0.7,
        maxLife: 1.2,
        size: 0.22 + Math.random() * 0.3,
        color: i % 3 === 0 ? new THREE.Color(0x4a3a2c) : fire,
        gravity: -1,
        drag: 1.8,
      });
    }
    // smoke ring
    for (let i = 0; i < n / 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * radius * 0.4;
      this.emit({
        pos: new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.4, center.z + Math.sin(a) * r),
        vel: new THREE.Vector3(0, 1.4, 0),
        life: 1.6 + Math.random(),
        maxLife: 2.6,
        size: 0.5 + Math.random() * 0.5,
        color: new THREE.Color(0x6a655c),
        gravity: -0.6,
        drag: 0.3,
      });
    }
  }

  spawnSmokePuff(point: THREE.Vector3, dir?: THREE.Vector3): void {
    this.emit({
      pos: point.clone(),
      vel: (dir ?? new THREE.Vector3(0, 1, 0)).clone().multiplyScalar(1 + Math.random()),
      life: 1.9 + Math.random() * 1.4,
      maxLife: 3,
      size: 0.4 + Math.random() * 0.6,
      color: new THREE.Color(0x6a665e),
      gravity: -0.8,
      drag: 0.5,
    });
  }

  setWeather(type: 'rain' | 'snow' | null): void {
    this.weather = type;
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3, material: string): void {
    if (this.decals.length >= this.decalMax) {
      const old = this.decals.shift();
      old?.mesh.removeFromParent();
    }
    const col = impactColor(material);
    const size = 0.2 + Math.random() * 0.18;
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.position.copy(point).addScaledVector(normal, 0.012);
    mesh.lookAt(point.clone().add(normal));
    mesh.rotation.z = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.decals.push({ mesh, until: performance.now() + 8000 });
  }

  update(dt: number): void {
    const now = performance.now();
    // weather ambient particles
    if (this.weather) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        this.weatherTimer = 0.045;
        for (let i = 0; i < 3; i++) {
          const origin = new THREE.Vector3(
            (Math.random() - 0.5) * 70,
            18 + Math.random() * 8,
            (Math.random() - 0.5) * 70,
          );
          this.emit({
            pos: origin,
            vel: this.weather === 'snow'
              ? new THREE.Vector3((Math.random() - 0.5), -1.2, (Math.random() - 0.5))
              : new THREE.Vector3((Math.random() - 0.5) * 11, -13, (Math.random() - 0.5) * 11),
            life: 1.6,
            maxLife: 1.6,
            size: this.weather === 'snow' ? 0.09 : 0.05,
            color: this.weather === 'snow' ? new THREE.Color(0xd8dde2) : new THREE.Color(0x8a93a0),
            gravity: 0,
            drag: 0,
          });
        }
      }
    }

    // decal fade
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      if (now > d.until) {
        d.mesh.removeFromParent();
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.decals.splice(i, 1);
      } else {
        const t = (d.until - now) / 8000;
        (d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, t * 2);
      }
    }

    // write particle buffers
    let idx = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vel.y -= p.gravity * 0.016;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * 0.016));
      p.pos.addScaledVector(p.vel, dt);
      this.posAttr.setXYZ(idx, p.pos.x, p.pos.y, p.pos.z);
      const a = Math.min(1, p.life / (p.maxLife * 0.6));
      this.colAttr.setXYZW(idx, p.color.r, p.color.g, p.color.b, a);
      idx++;
    }
    this.geo.setDrawRange(0, idx);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.points.visible = idx > 0;
    (this.points.material as THREE.PointsMaterial).size = this.q.particleMul > 0.5 ? 0.14 : 0.1;
  }

  setQuality(q: QualityTable): void {
    this.q = q;
    this.decalMax = q.decals;
  }
}

function impactColor(material: string): THREE.Color {
  switch (material) {
    case 'wood': return new THREE.Color(0x8a6b3a);
    case 'brick': return new THREE.Color(0x9a4a3a);
    case 'concrete': return new THREE.Color(0x8f8a82);
    case 'metal': return new THREE.Color(0x7a7a74);
    case 'sand': return new THREE.Color(0x9c8f6a);
    case 'dirt': return new THREE.Color(0x6a5c3e);
    case 'flesh': return new THREE.Color(0x6d3b30);
    default: return new THREE.Color(0x777777);
  }
}
