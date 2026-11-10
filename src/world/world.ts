/*
 * World building: procedural village structures (izba, barn, church, ruin,
 * shed, walls, sandbags, trenches, crates, barrels, trees, fence, well, cart,
 * wrecked vehicles), cover points for AI, a coarse navmesh, and simple
 * destruction (walls + crates shatter into debris chunks).
 */

import * as THREE from 'three';
import type { MapData } from '../data/schema';
import type { TerrainSystem } from './terrain';
import { Rng } from '../core/rng';

export interface ColliderDef {
  type: 'box' | 'cylinder';
  pos: [number, number, number];
  size: [number, number, number]; // box: half-extents; cylinder: radius, half-height
  rotY: number;
  layer: number; // 1 = world
  destroyable?: boolean;
}

export interface CoverPoint {
  x: number; z: number;
  dirX: number; dirZ: number; // facing away from cover
  height: 'low' | 'high';
  occupied: boolean;
}

export interface NavTile {
  x: number; z: number; passable: boolean;
}

export class WorldBuilder {
  readonly colliders: ColliderDef[] = [];
  readonly coverPoints: CoverPoint[] = [];
  readonly navTiles: NavTile[] = [];
  readonly group = new THREE.Group();
  private destructibles = new Map<THREE.Mesh, number>(); // mesh -> maxHealth
  private materials = new Map<string, THREE.Material>();
  private rng: Rng;

  constructor(private terrain: TerrainSystem, private onEvent: (msg: string) => void) {
    this.rng = new Rng(12345);
  }

  build(scene: THREE.Scene, map: MapData): void {
    const yAt = (x: number, z: number): number => this.terrain.heightAt(x, z);

    for (const b of map.buildings) {
      this.buildBuilding(b.type, b.x, yAt(b.x, b.z), b.z, b.rot, b.scale);
    }
    for (const t of map.trenches) {
      this.buildTrench(t.points, t.width, t.depth);
    }
    for (const p of map.props) {
      this.buildProp(p.type, p.x, yAt(p.x, p.z), p.z, p.rot);
    }
    this.buildNavMesh(map);
    scene.add(this.group);
    this.onEvent(`world built: ${map.buildings.length} buildings, ${map.props.length} props, ${this.colliders.length} colliders`);
  }

  private mat(kind: string, color: number, rough = 0.9, metal = 0.05): THREE.Material {
    const key = `${kind}:${color}`;
    let m = this.materials.get(key);
    if (!m) {
      // MeshLambertMaterial: no environment map is available in this build, and
      // a MeshStandardMaterial with metalness but no envMap renders black.
      // Lambert keeps the world readable under the sun/hemisphere lights.
      m = new THREE.MeshLambertMaterial({ color });
      this.materials.set(key, m);
    }
    return m;
  }

  private box(
    parent: THREE.Object3D, w: number, h: number, d: number,
    x: number, y: number, z: number, rotY: number,
    kind: string, color: number, opts: { collider?: boolean; castShadow?: boolean; receiveShadow?: boolean; health?: number } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(kind, color));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    parent.add(mesh);
    if (opts.collider !== false) {
      const half = [w / 2, h / 2, d / 2];
      this.colliders.push({
        type: 'box',
        pos: [x, y, z],
        size: [half[0], half[1], half[2]],
        rotY,
        layer: 1,
        destroyable: opts.health !== undefined,
      });
      if (opts.health !== undefined) this.destructibles.set(mesh, opts.health);
    }
    return mesh;
  }

  private buildBuilding(type: string, x: number, groundY: number, z: number, rot: number, scale: number): void {
    const g = new THREE.Group();
    g.position.set(x, groundY, z);
    g.rotation.y = rot;
    g.scale.setScalar(scale);
    const S = (v: number): number => v * scale;

    switch (type) {
      case 'izba':
        this.box(g, S(7), S(3.2), S(5.5), 0, S(1.6), 0, 0, 'wood', 0x6d5638);
        // gable roof
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(S(4.4), S(2.6), 4),
          this.mat('roof', 0x4a4030, 1),
        );
        roof.position.y = S(4.0);
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        g.add(roof);
        this.box(g, S(1.2), S(1.2), S(0.1), S(2.2), S(1.9), -S(2.76), 0, 'wooddoor', 0x4e3722, { collider: false });
        this.box(g, S(1.1), S(1.0), S(0.1), -S(2.4), S(1.8), -S(2.76), 0, 'window', 0x2a3540, { collider: false, health: 20 });
        this.box(g, S(1.1), S(1.0), S(0.1), S(0.2), S(1.8), S(2.76), 0, 'window', 0x2a3540, { collider: false, health: 20 });
        // chimney
        this.box(g, S(0.7), S(2.2), S(0.7), S(1.6), S(4.6), S(0.6), 0.3, 'stone', 0x77695a, { collider: false });
        break;
      case 'barn':
        this.box(g, S(9), S(4), S(6), 0, S(2), 0, 0, 'wood', 0x6b5436);
        this.box(g, S(9.8), S(1.4), S(6.6), 0, S(4.4), 0, 0, 'roof', 0x5a4630, { collider: false });
        this.box(g, S(2.4), S(2), S(0.1), S(0.8), S(1.6), -S(3.05), 0, 'wooddoor', 0x4a3a28, { collider: false });
        break;
      case 'church':
        this.box(g, S(6), S(5), S(9), 0, S(2.5), 0, 0, 'stone', 0x8a8170, { health: 420 });
        this.box(g, S(6.8), S(1.8), S(9.8), 0, S(5.6), 0, 0, 'roof', 0x6f6350, { collider: false });
        // bell tower
        this.box(g, S(2.6), S(5.5), S(2.6), 0, S(6), -S(5.2), 0, 'stone', 0x867c6a, { health: 300 });
        this.box(g, S(3), S(2), S(3), 0, S(8.2), -S(5.2), 0, 'roof', 0x4e4538, { collider: false });
        break;
      case 'ruin':
        this.box(g, S(3.4), S(1.6), S(1), S(0), S(0.8), S(0), 0, 'rubble', 0x6f6152, { health: 60 });
        this.box(g, S(1), S(1.4), S(3.4), S(0), S(0.7), S(0), 0.4, 'rubble', 0x60564a, { health: 60 });
        this.box(g, S(2), S(0.9), S(2), S(1.6), S(0.45), S(1.2), 0.2, 'rubble', 0x574f45, { health: 40 });
        break;
      case 'shed':
        this.box(g, S(3), S(2.2), S(2.6), 0, S(1.1), 0, 0, 'wood', 0x5c5038);
        this.box(g, S(3.4), S(0.6), S(3), 0, S(2.4), 0, 0, 'roof', 0x4a3f2c, { collider: false });
        break;
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        // push shadows down so buildings sit on the terrain
        o.position.y += 0.02;
      }
    });
    this.group.add(g);
  }

  private buildTrench(points: [number, number][], width: number, depth: number): void {
    if (points.length < 2) return;
    const mat = this.mat('trench', 0x3a3d33, 1);
    for (let i = 1; i < points.length; i++) {
      const [x0, z0] = points[i - 1];
      const [x1, z1] = points[i];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ang = Math.atan2(dz, dx);
      const y = this.terrain.heightAt(x0, z0);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.4), mat);
      wall.position.set((x0 + x1) / 2, y - depth * 0.25, (z0 + z1) / 2);
      wall.rotation.y = ang;
      this.group.add(wall);
      const wall2 = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.4), mat);
      wall2.position.set((x0 + x1) / 2, y - depth * 0.25, (z0 + z1) / 2 + Math.sin(ang + Math.PI / 2) * width);
      wall2.rotation.y = ang;
      this.group.add(wall2);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, width), mat);
      floor.position.set((x0 + x1) / 2, y - depth, (z0 + z1) / 2 + Math.sin(ang + Math.PI / 2) * width * 0.5);
      floor.rotation.y = ang;
      this.group.add(floor);
      // collider for the trench walls
      const nx = Math.sin(ang + Math.PI / 2);
      const nz = -Math.cos(ang + Math.PI / 2);
      this.colliders.push({
        type: 'box',
        pos: [(x0 + x1) / 2, y - depth * 0.25, (z0 + z1) / 2],
        size: [len / 2, 1.1, 0.4],
        rotY: ang,
        layer: 1,
      });
      this.colliders.push({
        type: 'box',
        pos: [(x0 + x1) / 2, y - depth * 0.25, (z0 + z1) / 2 + nx * width],
        size: [len / 2, 1.1, 0.4],
        rotY: ang,
        layer: 1,
      });
      // cover points along the walls
      const mid = Math.floor(i / 2);
      this.coverPoints.push({
        x: (x0 + x1) / 2 + nx * width * 0.5, z: (z0 + z1) / 2 + nx * width * 0.5,
        dirX: -nx, dirZ: -nz, height: 'high', occupied: false,
      });
      void mid;
    }
  }

  private buildProp(type: string, x: number, y: number, z: number, rot: number): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rot;
    const S = 1;
    switch (type) {
      case 'sandbag':
        for (let i = 0; i < 3; i++) {
          this.box(g, 1.4, 0.4, 0.7, i * 1.1 - 1.1, 0.2, 0, 0, 'sand', 0x9c9466, { health: 50 });
        }
        this.box(g, 1.4, 0.4, 0.7, -0.15, 0.6, 0.4, 0, 'sand', 0x948c5e, { health: 50 });
        this.coverPoints.push({
          x, z,
          dirX: Math.sin(rot), dirZ: -Math.cos(rot), height: 'high', occupied: false,
        });
        break;
      case 'barbedwire':
        this.box(g, 3.2, 0.1, 0.1, 0, 0.55, 0, 0, 'wire', 0x4a4a44, { collider: false });
        this.box(g, 3.2, 0.1, 0.1, 0, 0.9, 0, 0, 'wire', 0x4a4a44, { collider: false });
        for (let i = 0; i < 3; i++) this.box(g, 0.08, 1, 0.08, -1.4 + i * 1.4, 0.5, 0, 0, 'wire', 0x3c3c36, { collider: false });
        break;
      case 'crate':
        this.box(g, 1, 1, 1, 0, 0.5, 0, 0, 'wood', 0x6b5a40, { health: 30 });
        this.coverPoints.push({ x, z, dirX: Math.sin(rot), dirZ: -Math.cos(rot), height: 'low', occupied: false });
        break;
      case 'barrel':
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(S * 0.45, S * 0.45, S * 1.1, 12),
          this.mat('metal', 0x5a5e55, 0.5, 0.8),
        );
        barrel.position.y = 0.55;
        barrel.castShadow = true;
        g.add(barrel);
        this.colliders.push({ type: 'cylinder', pos: [x, y + 0.55, z], size: [0.45, 0.55, 0], rotY: rot, layer: 1 });
        break;
      case 'cart':
        this.box(g, 2.6, 0.5, 1.6, 0, 0.8, 0, 0, 'wood', 0x5d4c33);
        const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 10);
        for (const [wx, wz] of [[-1.1, 0.9], [1.1, 0.9], [-1.1, -0.9], [1.1, -0.9]]) {
          const w = new THREE.Mesh(wheelGeo, this.mat('metal', 0x4a4a44, 0.7, 0.6));
          w.rotation.z = Math.PI / 2;
          w.position.set(wx, 0.5, wz);
          w.castShadow = true;
          g.add(w);
        }
        break;
      case 'well':
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 1, 12, 1, true), this.mat('stone', 0x7a7262));
        ring.position.y = 0.5;
        g.add(ring);
        this.box(g, 0.3, 1.6, 0.3, 1.2, 0.8, 0, 0, 'wood', 0x5d4c33, { collider: false });
        this.box(g, 0.3, 0.08, 1.6, 1.2, 1.5, 0, 0, 'wood', 0x5d4c33, { collider: false });
        this.colliders.push({ type: 'cylinder', pos: [x, y + 0.5, z], size: [1.05, 0.5, 0], rotY: rot, layer: 1 });
        break;
      case 'fence':
        this.box(g, 2.4, 0.09, 0.09, 0, 0.6, 0, 0, 'wood', 0x6a5639, { collider: false });
        for (let i = 0; i < 3; i++) this.box(g, 0.09, 1.2, 0.09, -1.1 + i * 1.1, 0.6, 0, 0, 'wood', 0x5f4e35, { collider: false });
        break;
      case 'tree':
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 3.4, 7), this.mat('wood', 0x4c3a28, 1));
        trunk.position.y = 1.7;
        trunk.castShadow = true;
        g.add(trunk);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + this.rng.range(0, 1);
          const bh = this.rng.range(1.2, 2.2);
          const br = this.rng.range(0.8, 1.4);
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(br, 7, 5), this.mat('leaf', 0x3f4a2e, 1));
          leaf.position.set(Math.cos(a) * 0.4, 2.6 + this.rng.range(-0.4, 0.4), Math.sin(a) * 0.4);
          leaf.scale.y = 0.8;
          leaf.castShadow = true;
          g.add(leaf);
        }
        this.colliders.push({ type: 'cylinder', pos: [x, y + 0.4, z], size: [0.35, 1.7, 0], rotY: rot, layer: 1 });
        this.coverPoints.push({ x, z, dirX: Math.sin(rot), dirZ: -Math.cos(rot), height: 'low', occupied: false });
        break;
      case 'haystack':
        const hay = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), this.mat('hay', 0x8a7a3c, 1));
        hay.scale.set(1.4, 0.9, 1);
        hay.position.y = 1.3;
        hay.castShadow = true;
        g.add(hay);
        this.coverPoints.push({ x, z, dirX: Math.sin(rot), dirZ: -Math.cos(rot), height: 'low', occupied: false });
        break;
      case 'wreck_tank':
        this.box(g, 5.5, 1.6, 2.8, 0, 1, 0, 0, 'metal', 0x4a4438, { health: 400 });
        this.box(g, 2.2, 0.9, 2.8, -1.6, 1.2, 0, 0.2, 'metal', 0x3f3a30, { health: 200 });
        this.box(g, 3, 0.7, 1.6, 1.8, 1.3, 0, -0.1, 'metal', 0x443d31, { collider: false });
        this.coverPoints.push({ x, z, dirX: Math.sin(rot), dirZ: -Math.cos(rot), height: 'high', occupied: false });
        break;
      case 'wreck_truck':
        this.box(g, 4.6, 1.8, 2.2, 0, 1.1, 0, 0, 'metal', 0x4e4a3c, { health: 300 });
        this.box(g, 1.6, 1.4, 2, -2.4, 1.1, 0, 0.1, 'metal', 0x46423a, { collider: false });
        this.coverPoints.push({ x, z, dirX: Math.sin(rot), dirZ: -Math.cos(rot), height: 'high', occupied: false });
        break;
      default:
        break;
    }
    this.group.add(g);
  }

  private buildNavMesh(map: MapData): void {
    const cell = 8;
    const half = map.size / 2;
    const cols = Math.ceil(map.size / cell);
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = -half + i * cell + cell / 2;
        const cz = -half + j * cell + cell / 2;
        let passable = true;
        for (const c of this.colliders) {
          if (c.type === 'box') {
            if (Math.abs(cx - c.pos[0]) < c.size[0] + 1.5 && Math.abs(cz - c.pos[2]) < c.size[2] + 1.5) {
              passable = false;
              break;
            }
          }
        }
        this.navTiles.push({ x: cx, z: cz, passable });
      }
    }
  }

  /** Find the nearest passable nav tile to a world position. */
  nearestPassable(x: number, z: number): { x: number; z: number } | null {
    let best: NavTile | null = null;
    let bestD = Infinity;
    for (const t of this.navTiles) {
      if (!t.passable) continue;
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** A* over the nav grid (diagonal moves cost more). */
  findPath(sx: number, sz: number, ex: number, ez: number): { x: number; z: number }[] {
    const best = this.nearestPassable(sx, sz);
    const bestE = this.nearestPassable(ex, ez);
    if (!best || !bestE) return [];
    const cell = 8;
    const GRID = 120; // consistent with the 400 m map at 8 m cells; map size >= 960 m safe
    const half = this.group.position.x; // unused, keep cell-based mapping
    void half;
    const indexOf = (x: number, z: number): number => {
      const i = Math.round((x + (cell * GRID) / 2) / cell);
      const j = Math.round((z + (cell * GRID) / 2) / cell);
      return j * GRID + i;
    };
    const idxS = indexOf(best.x, best.z);
    const idxE = indexOf(bestE.x, bestE.z);
    if (idxS === idxE) return [{ x: ex, z: ez }];

    const open = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    open.set(idxS, 0);
    gScore.set(idxS, 0);

    const neighbors = (i: number): number[] => {
      const out: number[] = [];
      const ci = i % GRID;
      const cj = Math.floor(i / GRID);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const niI = ci + dx;
        const nj = cj + dz;
        if (niI < 0 || niI >= GRID || nj < 0 || nj >= GRID) continue;
        const ni = nj * GRID + niI;
        const nx = (niI - GRID / 2) * cell + cell / 2;
        const nz = (nj - GRID / 2) * cell + cell / 2;
        const tile = this.navTiles.find((t) => Math.abs(t.x - nx) < 0.1 && Math.abs(t.z - nz) < 0.1);
        if (tile && tile.passable) out.push(ni);
      }
      return out;
    };

    let guard = 0;
    while (open.size > 0 && guard++ < 3000) {
      let cur = -1;
      let curF = Infinity;
      for (const [i, f] of open) {
        if (f < curF) {
          curF = f;
          cur = i;
        }
      }
      if (cur === idxE) break;
      open.delete(cur);
      const curX = ((cur % GRID) - GRID / 2) * cell;
      const curZ = (Math.floor(cur / GRID) - GRID / 2) * cell;
      for (const ni of neighbors(cur)) {
        const nX = ((ni % GRID) - GRID / 2) * cell;
        const nZ = (Math.floor(ni / GRID) - GRID / 2) * cell;
        const g = (gScore.get(cur) ?? 0) + Math.hypot(nX - curX, nZ - curZ);
        if (g < (gScore.get(ni) ?? Infinity)) {
          gScore.set(ni, g);
          const h = Math.hypot(nX - bestE.x, nZ - bestE.z);
          open.set(ni, g + h);
          cameFrom.set(ni, cur);
        }
      }
    }

    const path: { x: number; z: number }[] = [];
    let node = idxE;
    guard = 0;
    while (node !== idxS && guard++ < 300) {
      const nX = ((node % GRID) - GRID / 2) * cell + cell / 2;
      const nZ = (Math.floor(node / GRID) - GRID / 2) * cell + cell / 2;
      path.push({ x: nX, z: nZ });
      const next = cameFrom.get(node);
      if (next === undefined) break;
      node = next;
    }
    path.reverse();
    path.push({ x: ex, z: ez });
    return path;
  }

  damageMesh(mesh: THREE.Mesh, dmg: number): boolean {
    if (!this.destructibles.has(mesh)) return false;
    const health = (this.destructibles.get(mesh) ?? 0) - dmg;
    if (health <= 0) {
      this.destructibles.delete(mesh);
      mesh.visible = false;
      mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) o.visible = false;
      });
      // spawn debris chunks
      const pos = mesh.position;
      for (let i = 0; i < 8; i++) {
        const chunk = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.25, 0.25),
          this.mat('debris', 0x55503f, 1),
        );
        chunk.position.set(pos.x + (Math.random() - 0.5), pos.y + 0.6, pos.z + (Math.random() - 0.5));
        this.group.add(chunk);
      }
      this.onEvent('structure destroyed');
      return true;
    }
    this.destructibles.set(mesh, health);
    return false;
  }
}
