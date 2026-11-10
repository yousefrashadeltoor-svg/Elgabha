/*
 * Terrain system: deterministic heightfield from ValueNoise2D + fBm, with
 * texture splatting across the CC0 PBR set (Poly Haven, CC0). A CPU-side
 * height lookup is kept so physics/AI can query ground height without raycasts.
 */

import * as THREE from 'three';
import type { MapData } from '../data/schema';
import { ValueNoise2D, radialMask } from './noise';
import { clamp, lerp, smoothstep } from '../core/math';

export interface TerrainHeight {
  heightAt(x: number, z: number): number;
  /** Terrain normal at a world position (approx via finite differences). */
  normalAt(x: number, z: number): THREE.Vector3;
}

export class TerrainSystem {
  readonly mesh: THREE.Mesh;
  private heightData!: Float32Array;
  private minH = 0;
  private range = 1;
  readonly size: number;
  readonly resolution: number;
  private noise: ValueNoise2D;

  constructor(scene: THREE.Scene, map: MapData, private onEvent: (msg: string) => void) {
    this.size = map.size;
    this.resolution = map.resolution;
    this.noise = new ValueNoise2D(map.seed);

    const geo = this.buildGeometry(map);
    const mat = this.buildMaterial(map);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    scene.add(this.mesh);
  }

  private buildGeometry(map: MapData): THREE.BufferGeometry {
    const res = map.resolution;
    const size = map.size;
    const step = size / (res - 1);
    const positions = new Float32Array(res * res * 3);
    const uvs = new Float32Array(res * res * 2);
    const heights = new Float32Array(res * res);
    const indices: number[] = [];

    const fbm = (x: number, z: number): number => {
      // Large rolling features + medium hills + small detail.
      const a = this.noise.fbm(x / 420, z / 420, 4) * 9;
      const b = this.noise.fbm(x / 120, z / 120, 3) * 4;
      const c = this.noise.fbm(x / 28, z / 28, 2) * 0.7;
      // Gentle bowl so the playfield edges rise toward a low ridge. Kept low
      // (5 m, not 14) because a tall rim reads as a wall on the horizon and
      // blocks the view of the village.
      const half = size * 0.44;
      const d = Math.sqrt(x * x + z * z);
      const rim = radialMask(d, half, size * 0.5) * 5;
      return a + b + c + rim;
    };

    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = -size / 2 + i * step;
        const z = -size / 2 + j * step;
        const h = fbm(x, z);
        const idx = j * res + i;
        heights[idx] = h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = z;
        uvs[idx * 2] = x / 12;
        uvs[idx * 2 + 1] = z / 12;
      }
    }
    // Normalise so the playfield sits near y=0..6, edges rise to ~20.
    const range = Math.max(1e-6, maxH - minH);
    for (let idx = 0; idx < heights.length; idx++) {
      const h01 = (heights[idx] - minH) / range;
      const y = lerp(0.2, 7, h01) + (positions[idx * 3 + 1] > 10 ? (positions[idx * 3 + 1] - 10) * 1.2 : 0);
      positions[idx * 3 + 1] = Math.round(y * 100) / 100;
      // Store the FINAL mesh height so heightAt() agrees with the rendered
      // surface exactly. Storing the raw fBm value here put the player below
      // the terrain and made the world invisible.
      heights[idx] = positions[idx * 3 + 1];
    }
    this.heightData = heights;
    this.minH = 0;
    this.range = 1;

    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = j * res + i;
        const b = a + 1;
        const c = a + res;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // Bake layer tinting into vertex colours. These are TINTS, not colours:
    // the diffuse texture already carries the base colour, and multiplying a
    // dark vertex colour by a dark texture produced near-black terrain. Values
    // hover around 1.0 so the texture shows through at its natural brightness.
    const colors = new Float32Array(res * res * 3);
    const nrm = geo.getAttribute('normal');
    const cMud = new THREE.Color(1.0, 0.96, 0.9);
    const cGrass = new THREE.Color(0.82, 1.0, 0.72);
    const cRock = new THREE.Color(0.95, 0.95, 0.98);
    const cSnow = new THREE.Color(1.35, 1.4, 1.45);
    const tmp = new THREE.Color();
    for (let idx = 0; idx < res * res; idx++) {
      const y = positions[idx * 3 + 1];
      const slope = 1 - Math.abs(nrm.getY(idx)); // 0 flat .. 1 vertical
      tmp.copy(cMud);
      tmp.lerp(cGrass, smoothstep(1.5, 4.5, y) * 0.75);
      tmp.lerp(cRock, smoothstep(0.25, 0.6, slope));
      tmp.lerp(cSnow, smoothstep(9, 16, y) * 0.85);
      colors[idx * 3] = tmp.r;
      colors[idx * 3 + 1] = tmp.g;
      colors[idx * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  private buildMaterial(map: MapData): THREE.Material {
    const layers = map.layers.slice(0, 4);
    const texCache = new Map<string, THREE.Texture>();
    const loadTex = (name: string): THREE.Texture => {
      const cached = texCache.get(name);
      if (cached) return cached;
      const tex = new THREE.TextureLoader().load(`assets/textures/${name}_diff.jpg`);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      texCache.set(name, tex);
      return tex;
    };

    // A standard lit material is used instead of a hand-written ShaderMaterial:
    // it is guaranteed to compile on every backend (WebGL2 and WebGPU), gets
    // shadows and fog for free, and cannot silently fail to render. Layer
    // blending is done with vertex colours baked from the height/slope rules,
    // which costs nothing at draw time.
    const base = loadTex(layers[0]?.texture ?? 'brown_mud');
    base.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: base,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
    });
    return mat;
  }

  heightAt(x: number, z: number): number {
    const res = this.resolution;
    const size = this.size;
    const step = size / (res - 1);
    const fx = Math.min(res - 1, Math.max(0, (x + size / 2) / step));
    const fz = Math.min(res - 1, Math.max(0, (z + size / 2) / step));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (i: number, j: number): number => this.heightData[clamp(j, 0, res - 1) * res + clamp(i, 0, res - 1)];
    const h00 = at(ix, iz), h10 = at(ix + 1, iz);
    const h01 = at(ix, iz + 1), h11 = at(ix + 1, iz + 1);
    const h = lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
    // heightData already holds the final mesh height (see buildGeometry).
    return h;
  }

  normalAt(x: number, z: number): THREE.Vector3 {
    const e = 0.6;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
  }
}

function makeSplatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  const rng = mulberryInt(777);
  for (let i = 0; i < img.data.length; i += 4) {
    // Blend grass (weak), mud (strong in low areas), dirt patches, gravel speckles.
    const x = (i / 4) % 256;
    const y = Math.floor(i / 4 / 256);
    const v = rng();
    const slopeish = Math.sin(x * 0.13) * 0.5 + Math.cos(y * 0.11) * 0.5;
    img.data[i] = 255;     // R: mud
    img.data[i + 1] = clamp(Math.round(255 * (0.35 + v * 0.3)), 0, 255); // G: dirt
    img.data[i + 2] = clamp(Math.round(255 * slopeish * 0.4), 0, 255);  // B: gravel
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function mulberryInt(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
