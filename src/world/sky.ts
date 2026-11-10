/*
 * Sky, sun, moon and weather system.
 * Supports clear / overcast / snow / rain / fog. Day-night via a directional
 * light that orbits the terrain; deterministic per map timeOfDay.
 */

import * as THREE from 'three';
import type { MapData } from '../data/schema';
import { clamp, lerp } from '../core/math';

export interface WeatherState {
  cloudCover: number;   // 0..1
  precipitation: 'none' | 'rain' | 'snow';
  fogDensity: number;
  wind: number;
}

export class SkySystem {
  readonly sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
  readonly hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a4a36, 0.9);
  /** Ambient fill so nothing in the world can render as a pure black silhouette. */
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.55);
  readonly group = new THREE.Group();
  private stars: THREE.Points;
  private cloudSprites: THREE.Sprite[] = [];
  private time = 8; // hours
  private weather: WeatherState = { cloudCover: 0.3, precipitation: 'none', fogDensity: 0.001, wind: 2 };
  private fog: THREE.Fog | THREE.FogExp2 | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -90;
    this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90;
    this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun);
    scene.add(this.hemi);
    scene.add(this.ambient);
    scene.add(this.group);

    // Stars: static points, only visible at night
    const starGeo = new THREE.BufferGeometry();
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const rng = mulberry(1234);
    for (let i = 0; i < n; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(rng() * 2 - 1);
      const r = 1500;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const b = 0.5 + rng() * 0.5;
      col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b + 0.1;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ size: 2, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, fog: false }),
    );
    this.group.add(this.stars);

    // Clouds: layered sprites
    const cloudTex = makeCloudTexture();
    for (let i = 0; i < 14; i++) {
      const m = new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, opacity: 0.45, depthWrite: false,
        color: new THREE.Color(0xcfd4da), fog: false,
      });
      const s = new THREE.Sprite(m);
      const a = (i / 14) * Math.PI * 2 + rng() * 0.5;
      const rad = 700 + rng() * 250;
      s.position.set(Math.cos(a) * rad, 320 + rng() * 160, Math.sin(a) * rad);
      const sc = 260 + rng() * 380;
      s.scale.set(sc, sc * 0.32, 1);
      this.cloudSprites.push(s);
      this.group.add(s);
    }
  }

  setTime(hours: number): void {
    this.time = clamp(hours, 0, 24);
  }

  getTemperatureFriendly(): string {
    return this.weather.precipitation;
  }

  setMapWeather(map: MapData): void {
    switch (map.weather) {
      case 'clear':
        this.weather = { cloudCover: 0.15, precipitation: 'none', fogDensity: 0.00015, wind: 1.5 };
        break;
      case 'overcast':
        this.weather = { cloudCover: 0.72, precipitation: 'none', fogDensity: 0.0004, wind: 3 };
        break;
      case 'snow':
        this.weather = { cloudCover: 0.9, precipitation: 'snow', fogDensity: 0.0008, wind: 4 };
        break;
      case 'rain':
        this.weather = { cloudCover: 0.95, precipitation: 'rain', fogDensity: 0.0005, wind: 6 };
        break;
      case 'fog':
        this.weather = { cloudCover: 0.85, precipitation: 'none', fogDensity: 0.004, wind: 1 };
        break;
    }
    this.setTime(map.timeOfDay);
  }

  applyTo(scene: THREE.Scene): void {
    const t = this.time / 24;
    const angle = t * Math.PI * 2 - Math.PI / 2;
    const sunH = Math.sin(angle);
    const night = clamp(-sunH * 1.6, 0, 1);
    const day = 1 - night;
    const sunPos = new THREE.Vector3(Math.cos(angle) * 220, sunH * 220, Math.sin(angle) * 120);
    this.sun.position.copy(sunPos);

    const skyCol = new THREE.Color()
      .setHex(day > 0.5 ? 0x8fb4d9 : 0x1a2233)
      .lerp(new THREE.Color(0x585c66), this.weather.cloudCover * 0.8);
    (scene.background as THREE.Color).copy(skyCol);

    this.sun.intensity = lerp(0.05, 2.8, day) * (1 - this.weather.cloudCover * 0.55);
    this.hemi.intensity = lerp(0.25, 1.0, day) * (1 - this.weather.cloudCover * 0.3);

    const fogCol = skyCol.clone().lerp(new THREE.Color(0x9aa0a6), 0.5);
    if (this.weather.fogDensity > 0.0015) {
      if (!(scene.fog instanceof THREE.FogExp2)) {
        scene.fog = new THREE.FogExp2(fogCol.getHex(), this.weather.fogDensity);
      } else {
        (scene.fog as THREE.FogExp2).color.copy(fogCol);
        (scene.fog as THREE.FogExp2).density = this.weather.fogDensity;
      }
    } else if (scene.fog instanceof THREE.Fog) {
      (scene.fog as THREE.Fog).color.copy(fogCol);
    }
    this.fog = scene.fog;

    (this.stars.material as THREE.PointsMaterial).opacity = night;
    for (const c of this.cloudSprites) {
      const m = c.material as THREE.SpriteMaterial;
      m.opacity = 0.45 * (0.3 + this.weather.cloudCover * 0.7) * day;
    }
  }

  update(dt: number, windDrift: number): void {
    for (const c of this.cloudSprites) {
      c.position.x += dt * this.weather.wind * windDrift + dt * 2;
      const rad = Math.sqrt(c.position.x ** 2 + c.position.z ** 2);
      if (rad > 1200) {
        const a = Math.atan2(c.position.z, c.position.x);
        c.position.x = Math.cos(a) * 600;
        c.position.z = Math.sin(a) * 600;
      }
    }
  }

  isPrecipitating(): boolean {
    return this.weather.precipitation !== 'none';
  }

  particleType(): 'rain' | 'snow' | null {
    if (this.weather.precipitation === 'rain') return 'rain';
    if (this.weather.precipitation === 'snow') return 'snow';
    return null;
  }
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 64);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 128;
    const y = 20 + Math.random() * 28;
    const r = 6 + Math.random() * 14;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
  }
  return new THREE.CanvasTexture(c);
}
