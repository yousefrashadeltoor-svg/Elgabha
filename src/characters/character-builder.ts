/*
 * Character builder: procedural low-poly soldiers (ADR-005).
 * Builds a faction-coloured body from primitives with a head, helmet,
 * torso, arms and legs. Variation indices shift proportions so a squad
 * does not look cloned. No external character assets are used.
 */

import * as THREE from 'three';
import type { CharacterData } from '../data/schema';

const FACTION_COLORS: Record<string, { uniform: number; helmet: number; skin: number }> = {
  soviet: { uniform: 0x5a5f3a, helmet: 0x4a4d38, skin: 0xb08a68 },
  german: { uniform: 0x4a4f45, helmet: 0x3c4038, skin: 0xb89070 },
  shared: { uniform: 0x555a4a, helmet: 0x45483c, skin: 0xb08a68 },
};

export interface CharacterMesh {
  group: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  height: number;
}

export function buildCharacterMesh(c: CharacterData): CharacterMesh {
  const colors = FACTION_COLORS[c.faction] ?? FACTION_COLORS.shared;
  const g = new THREE.Group();
  const uniform = new THREE.MeshLambertMaterial({ color: colors.uniform });
  const helmet = new THREE.MeshLambertMaterial({ color: colors.helmet });
  const skin = new THREE.MeshLambertMaterial({ color: colors.skin });
  const leather = new THREE.MeshLambertMaterial({ color: 0x3a2f22 });

  const build = 0.9 + (c.variation.build % 3) * 0.08;
  const heightScale = 0.94 + (c.variation.height % 3) * 0.05;
  const totalHeight = 1.78 * heightScale;

  // legs
  const legGeo = new THREE.CapsuleGeometry(0.11 * build, 0.62, 4, 8);
  for (const sx of [-0.13, 0.13]) {
    const leg = new THREE.Mesh(legGeo, uniform);
    leg.position.set(sx, 0.45, 0);
    leg.castShadow = true;
    g.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.26), leather);
    boot.position.set(sx, 0.06, 0.03);
    boot.castShadow = true;
    g.add(boot);
  }

  // torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2 * build, 0.5, 4, 10), uniform);
  torso.position.y = 1.12;
  torso.castShadow = true;
  g.add(torso);

  // belt + pouches
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * build, 0.22 * build, 0.1, 10), leather);
  belt.position.y = 0.86;
  g.add(belt);

  // arms
  const armGeo = new THREE.CapsuleGeometry(0.075 * build, 0.5, 4, 8);
  for (const sx of [-0.28, 0.28]) {
    const arm = new THREE.Mesh(armGeo, uniform);
    arm.position.set(sx * build, 1.12, 0);
    arm.rotation.z = sx > 0 ? -0.12 : 0.12;
    arm.castShadow = true;
    g.add(arm);
  }

  // head + helmet
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin);
  head.position.y = 1.56;
  head.castShadow = true;
  g.add(head);

  const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), helmet);
  helmetMesh.position.y = 1.6;
  helmetMesh.castShadow = true;
  g.add(helmetMesh);

  // rifle slung (simple)
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
  rifle.position.set(0.2, 1.0, 0.1);
  rifle.rotation.x = 0.3;
  g.add(rifle);

  g.scale.setScalar(heightScale);
  return { group: g, head, torso, height: totalHeight };
}

export function disposeCharacterMesh(m: CharacterMesh): void {
  m.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | undefined;
    mat?.dispose();
  });
}
