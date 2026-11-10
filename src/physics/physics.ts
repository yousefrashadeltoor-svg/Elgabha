/*
 * Physics wrapper around Rapier 3D (WASM via rapier3d-compat).
 *
 * Collision groups:
 *   WORLD=1, PLAYER=2, ENEMY=4, PROJECTILE=8, DEBRIS=16, TRIGGER=32, VEHICLE=64
 *
 * Bullets are NOT rigid bodies (ADR-002): a custom ballistic integrator in
 * weapons/ballistics.ts raycasts against this world each step.
 */

import RAPIER from '@dimforge/rapier3d-compat';

export const COL = {
  WORLD: 1,
  PLAYER: 2,
  ENEMY: 4,
  PROJECTILE: 8,
  DEBRIS: 16,
  TRIGGER: 32,
  VEHICLE: 64,
} as const;

export const RAY_MASK_WORLD_PLAYERS = COL.WORLD | COL.PLAYER | COL.ENEMY | COL.DEBRIS | COL.VEHICLE;

export interface RayHit {
  entityId: number | null;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  distance: number;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  private world: RAPIER.World | null = null;
  private bodies = new Map<number, RAPIER.RigidBody>();
  private nextBodyId = 1;
  private staticBody: RAPIER.RigidBody | null = null;

  async init(): Promise<void> {
    await RAPIER.init();
    const gravity = { x: 0, y: -9.81, z: 0 };
    this.world = new RAPIER.World(gravity);
  }

  get ready(): boolean {
    return this.world !== null;
  }

  private ensure(): RAPIER.World {
    if (!this.world) throw new Error('physics not initialised');
    return this.world;
  }

  step(dt: number): void {
    this.ensure().timestep = dt;
    this.ensure().step();
  }

  /** Static box collider for the world. */
  addStaticBox(pos: [number, number, number], half: [number, number, number], rotY: number, layer = COL.WORLD): number {
    const w = this.ensure();
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]).setRotation(new RAPIER.Quaternion(0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2))));
    const collider = w.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setCollisionGroups((layer << 16) | 0xffff),
      body,
    );
    void collider;
    return this.registerBody(body);
  }

  addStaticCylinder(pos: [number, number, number], radius: number, halfHeight: number, layer = COL.WORLD): number {
    const w = this.ensure();
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]));
    const collider = w.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius)
        .setCollisionGroups((layer << 16) | 0xffff),
      body,
    );
    void collider;
    return this.registerBody(body);
  }

  /** Dynamic capsule body for a player/enemy. Returns the body id. */
  spawnCapsule(
    pos: [number, number, number],
    radius: number,
    height: number,
    layer: number,
    isKinematic = false,
  ): number {
    const w = this.ensure();
    const desc = isKinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true);
    const body = w.createRigidBody(desc.setTranslation(pos[0], pos[1], pos[2]));
    const collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(height / 2 - radius, radius)
        .setCollisionGroups((layer << 16) | 0xffff)
        .setFriction(0.2),
      body,
    );
    void collider;
    return this.registerBody(body);
  }

  private registerBody(body: RAPIER.RigidBody): number {
    const id = this.nextBodyId++;
    this.bodies.set(id, body);
    return id;
  }

  getBody(id: number): RAPIER.RigidBody | undefined {
    return this.bodies.get(id);
  }

  removeBody(id: number): void {
    const body = this.bodies.get(id);
    if (body) {
      this.ensure().removeRigidBody(body);
      this.bodies.delete(id);
    }
  }

  /** Cast a ray and return the first hit against the given mask. */
  raycast(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number, mask: number): RayHit | null {
    const w = this.ensure();
    const ray = new RAPIER.Ray(origin, dir);
    const hit = w.castRay(ray, maxDist, true, undefined, mask);
    if (!hit) return null;
    const point = { x: origin.x + dir.x * hit.timeOfImpact, y: origin.y + dir.y * hit.timeOfImpact, z: origin.z + dir.z * hit.timeOfImpact };
    const collider = hit.collider;
    let normal = { x: 0, y: 1, z: 0 };
    const n = w.castRayAndGetNormal(ray, maxDist, true, undefined, mask);
    if (n) {
      normal = { x: n.normal.x, y: n.normal.y, z: n.normal.z };
    }
    return { entityId: null, point, normal, distance: hit.timeOfImpact, collider };
  }

  raycastPoint(origin: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, mask: number): RayHit | null {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dz = target.z - origin.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return this.raycast(origin, { x: dx / len, y: dy / len, z: dz / len }, len, mask);
  }

  setBodyTranslation(id: number, pos: { x: number; y: number; z: number }): void {
    const body = this.bodies.get(id);
    if (!body) return;
    body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
  }

  getBodyTranslation(id: number): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  getCollidersCount(): number {
    if (!this.world) return 0;
    return this.world.colliders.len();
  }
}
